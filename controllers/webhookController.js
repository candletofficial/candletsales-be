const Order = require('../models/Order');
const Product = require('../models/Product');
const Material = require('../models/Material');
const { buildMaterialDeductions } = require('./orderController');

// Helper to generate a random order ID
const generateOrderId = () => `DH-${Math.floor(1000000 + Math.random() * 9000000)}`;

exports.handlePancakeWebhook = async (req, res, next) => {
  try {
    const payload = req.body;
    require('fs').writeFileSync('last_payload.json', JSON.stringify(payload, null, 2));
    console.log('\n=== PANCAKE WEBHOOK RECEIVED ===');
    console.log(`Processing Order ID: ${payload.id}, Event: ${payload.event_type}`);

    // Validate payload
    if (!payload.id || !payload.customer || !payload.items) {
      return res.status(200).json({ success: true, message: 'Ignored: Invalid payload structure' });
    }

    // Check if order already exists in our database
    const existingOrder = await Order.findOne({ pancake_order_id: payload.id });
    if (existingOrder) {
      // Check if order is cancelled
      const statusName = (payload.status_name || '').toLowerCase();
      const isCancelled = payload.status === 7 || payload.status === 9 || 
        statusName.includes('huỷ') || 
        statusName.includes('hủy') || 
        statusName.includes('cancel') ||
        (payload.partner && payload.partner.partner_status === 'cancelled');
      
      if (isCancelled) {
        console.log(`Order ${payload.id} is cancelled on Pancake. Deleting and refunding materials...`);
        const FundTransaction = require('../models/FundTransaction');
        const order = await Order.findByIdAndDelete(existingOrder._id);
        
        if (order) {
          await FundTransaction.deleteMany({ order_id: order._id });
          
          if (order.status !== 'returned') {
            const { deductions: refunds } = await buildMaterialDeductions(order.items, order.shippingMethod);
            const updatePromises = [];
            for (const [materialId, refundQty] of refunds.entries()) {
              updatePromises.push(
                (async () => {
                  const mat = await Material.findById(materialId);
                  if (!mat) return;
                  const newStock = Number((mat.stock + refundQty).toFixed(4));
                  const newActual = Number((mat.actualStock + refundQty).toFixed(4));
                  const calcStatus = (actual, min) => (actual <= 0 ? 'out_of_stock' : actual <= min ? 'low_stock' : 'in_stock');
                  await Material.findByIdAndUpdate(materialId, {
                    stock: newStock,
                    actualStock: newActual,
                    status: calcStatus(newActual, mat.minStock),
                  });
                })()
              );
            }
            await Promise.all(updatePromises);
          }
        }
        return res.status(200).json({ success: true, message: 'Order deleted and materials refunded' });
      }

      console.log(`Order ${payload.id} already exists. Skipping creation.`);
      return res.status(200).json({ success: true, message: 'Order already exists' });
    }

    const allProducts = await Product.find();
    const orderItems = [];

    // Map Pancake items to our Products
    for (const item of payload.items) {
      const shopeeName = item.variation_info?.name || 'Sản phẩm không rõ';
      const shopeeSku = item.variation_info?.detail || '';
      const shopeeSkuCode = item.variation_info?.sku || item.sku || item.product_id || item.barcode || '';

      let matchedProduct = null;
      let matchedSkuId = null;

      // 1. Try to match by SKU Code (Mã sản phẩm hoặc Mã SKU)
      if (shopeeSkuCode) {
        const skuCodeUpper = String(shopeeSkuCode).toUpperCase();
        for (const p of allProducts) {
          if (p.productId && p.productId.toUpperCase() === skuCodeUpper) {
            matchedProduct = p;
            break;
          }
          if (p.skus && p.skus.length > 0) {
            const foundSku = p.skus.find(s => s.id && s.id.toUpperCase() === skuCodeUpper);
            if (foundSku) {
              matchedProduct = p;
              matchedSkuId = foundSku.id;
              break;
            }
          }
        }
      }

      // 2. Fallback: Check if the SKU code is embedded inside the Shopee Name or Shopee Detail
      if (!matchedProduct) {
        const shopeeFullTextUpper = (shopeeName + ' ' + shopeeSku).toUpperCase();
        for (const p of allProducts) {
          if (p.skus && p.skus.length > 0) {
            const foundSku = p.skus.find(s => s.id && shopeeFullTextUpper.includes(s.id.toUpperCase()));
            if (foundSku) {
              matchedProduct = p;
              matchedSkuId = foundSku.id;
              break;
            }
          }
          if (p.productId && shopeeFullTextUpper.includes(p.productId.toUpperCase())) {
            matchedProduct = p;
            break;
          }
        }
      }

      // 3. Fallback to name matching
      if (!matchedProduct) {
        const shopeeFullTextLower = (shopeeName + ' ' + shopeeSku).toLowerCase();
        for (const p of allProducts) {
          if (shopeeFullTextLower.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(shopeeName.toLowerCase())) {
            matchedProduct = p;
            break;
          }
        }
      }

      orderItems.push({
        product_id: matchedProduct ? matchedProduct._id : null,
        productId: matchedProduct ? matchedProduct.productId : 'UNKNOWN_SHOPEE',
        product_name: matchedProduct ? matchedProduct.name : shopeeName,
        product_image: matchedProduct ? matchedProduct.image : null,
        sku_id: matchedSkuId, // Use the matched SKU ID if found
        sku_label: shopeeSku,
        unit_price: item.variation_info?.retail_price || 0,
        quantity: item.quantity || 1
      });
    }

    // We only deduct materials for items that we successfully mapped to a Product in our DB
    const validItems = orderItems.filter(i => i.product_id);
    let logisticsCost = 0;

    if (validItems.length > 0) {
      const { deductions, packagingCost } = await buildMaterialDeductions(validItems, 'standard');
      logisticsCost = packagingCost || 0;

      for (const [matId, qtyToDeduct] of deductions.entries()) {
        const mat = await Material.findById(matId);
        if (mat) {
          const newActual = Math.max(0, Number((mat.actualStock - qtyToDeduct).toFixed(4)));
          const newStock = Math.max(0, Number((mat.stock - qtyToDeduct).toFixed(4)));
          await Material.findByIdAndUpdate(matId, {
            actualStock: newActual,
            stock: newStock
          });
        }
      }
    } else {
      console.log('No valid products matched. Material deduction skipped for this order.');
    }

    // Calculate the final actual amount received/to be collected
    const finalAmount = (payload.cash || 0) + 
                        (payload.transfer_money || 0) + 
                        (payload.charged_by_card || 0) + 
                        (payload.money_to_collect || payload.cod || 0);

    const orderAmount = finalAmount > 0 ? finalAmount : (payload.buyer_total_amount || payload.total_price_after_sub_discount || 0);

    // Determine order date
    // Pancake uses inserted_at or created_at for the order. Sometimes they are at the root level.
    // Pancake sends UTC time like "2026-08-02 23:35:00" without 'Z', which Node parses as Local Time by mistake.
    let rawDate = payload.inserted_at || payload.created_at || payload.order_date || payload.updated_at;
    if (typeof rawDate === 'string' && !rawDate.endsWith('Z')) {
      // Replace space with T and append Z to force UTC parsing
      rawDate = rawDate.replace(' ', 'T');
      if (!rawDate.includes('T')) rawDate += 'T00:00:00';
      rawDate += 'Z';
    }
    const orderedAt = rawDate ? new Date(rawDate) : new Date();

    // Determine shipping method (Hỏa tốc vs Thường)
    // Shopee express delivery usually contains "hỏa tốc", "instant", "grab", "ahamove"
    const payloadStr = JSON.stringify(payload).toLowerCase();
    const isExpress = payloadStr.includes('hỏa tốc') || payloadStr.includes('instant') || payloadStr.includes('grabexpress') || payloadStr.includes('ahamove');
    const shippingMethod = isExpress ? 'express' : 'standard';

    // Determine order source
    let orderSource = 'khác';
    if (payloadStr.includes('shopee') || (payload.customer?.order_sources?.includes('-3'))) {
      orderSource = 'shopee';
    } else if (payloadStr.includes('tiktok')) {
      orderSource = 'tiktok';
    } else if (payloadStr.includes('facebook') || payloadStr.includes('fb')) {
      orderSource = 'facebook';
    } else if (payloadStr.includes('instagram')) {
      orderSource = 'instagram';
    } else if (payloadStr.includes('website') || payloadStr.includes('web')) {
      orderSource = 'website';
    }

    const order = new Order({
      orderId: payload.display_id || payload.id || generateOrderId(),
      pancake_order_id: payload.id,
      items: orderItems,
      total_price: orderAmount || 0,
      source: orderSource,
      pos_mode: 'online',
      customer_name: payload.customer.name || '',
      customer_phone: payload.customer.phone_numbers ? payload.customer.phone_numbers[0] : '',
      customer_address: payload.customer.shipping_address ? payload.customer.shipping_address.full_address : '',
      payment_method: payload.cod > 0 ? 'cash' : 'transfer',
      shippingMethod: shippingMethod,
      packaging_cost: logisticsCost,
      note: payload.note || '',
      status: 'completed',
      ordered_at: orderedAt,
    });

    await order.save();
    console.log(`Successfully saved Pancake order as: ${order.orderId}`);

    // Deduct materials for the new order
    const { deductions } = await buildMaterialDeductions(orderItems, shippingMethod);
    const updatePromises = [];
    for (const [materialId, deductQty] of deductions.entries()) {
      updatePromises.push(
        (async () => {
          const mat = await Material.findById(materialId);
          if (!mat) return;
          const newStock = Number((mat.stock - deductQty).toFixed(4));
          const newActual = Number((mat.actualStock - deductQty).toFixed(4));
          const calcStatus = (actual, min) => (actual <= 0 ? 'out_of_stock' : actual <= min ? 'low_stock' : 'in_stock');
          await Material.findByIdAndUpdate(materialId, {
            stock: newStock,
            actualStock: newActual,
            status: calcStatus(newActual, mat.minStock),
          });
        })()
      );
    }
    await Promise.all(updatePromises);

    // Trigger auto confirm imports
    const { triggerAutoConfirmImports } = require('../utils/inventoryHelpers');
    triggerAutoConfirmImports().catch(console.error);

    res.status(200).json({ success: true, message: 'Order processed successfully' });
  } catch (error) {
    console.error('Error handling Pancake webhook:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
