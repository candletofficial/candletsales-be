const Order = require('../models/Order');
const Product = require('../models/Product');
const Material = require('../models/Material');
const { buildMaterialDeductions } = require('./orderController');

// Helper to generate a random order ID
const generateOrderId = () => `DH-${Math.floor(1000000 + Math.random() * 9000000)}`;

/**
 * Kiểm tra xem đơn hàng có được xác nhận là "Đã thu tiền / Hoàn thành" hay không.
 * Áp dụng cho cả đợt tạo mới và cập nhật đơn hàng từ Pancake webhook.
 *
 * Logic:
 * 1. status=16 (Pancake "Đã thu tiền" / Collected money)
 * 2. status_name chứa các từ khóa hoàn thành
 * 3. histories[] có shopee_status.new = 'COMPLETED' (dành riêng cho đơn Shopee:
 *    Shopee đánh dấu COMPLETED nhưng Pancake không tự chuyển sang status=16)
 *
 * NOTE: status=3 (Received) chưa phải hoàn thành — khách nhận hàng nhưng chưa đối soát.
 * NOTE: status=8 (Packaging) — đóng gói, hoàn toàn không phải hoàn thành.
 */
const checkIsCompleted = (payload) => {
  const statusName = (payload.status_name || '').toLowerCase();

  // 1. Pancake status code 16 = Collected money
  if (payload.status === 16) return true;

  // 2. status_name keywords
  if (
    statusName.includes('đã thu tiền') ||
    statusName.includes('hoàn thành') ||
    statusName.includes('đã đối soát') ||
    statusName === 'received_money' ||
    statusName === 'completed' ||
    statusName === 'done' ||
    statusName === 'paid'
  ) return true;

  // 3. Shopee: kiểm tra histories[] có shopee_status.new = 'COMPLETED'
  // Pancake không tự chuyển status=16 cho đơn Shopee sau khi đối soát
  const histories = payload.histories || [];
  const shopeeCompleted = histories.some(
    h => h.shopee_status && h.shopee_status.new === 'COMPLETED'
  );
  if (shopeeCompleted) return true;

  return false;
};


exports.handlePancakeWebhook = async (req, res, next) => {
  try {
    const payload = req.body;
    console.log('\n=== PANCAKE WEBHOOK RECEIVED ===');
    console.log(`Processing Order ID: ${payload.id}, Event: ${payload.event_type}`);
    console.log(`[DEBUG] status_code=${payload.status}, status_name="${payload.status_name}", partner_status="${payload.partner?.partner_status}"`);
    console.log(`[DEBUG] display_id=${payload.display_id}`);

    // Validate payload
    if (!payload.id || !payload.customer || !payload.items) {
      return res.status(200).json({ success: true, message: 'Ignored: Invalid payload structure' });
    }

    // Check if order already exists in our database
    const existingOrder = await Order.findOne({ pancake_order_id: payload.id });
    if (existingOrder) {
      // Check if order is cancelled
      const statusName = (payload.status_name || '').toLowerCase();
      // status 7 = Cancelled. status 9 = Waiting for pick up (KHÔNG phải cancelled)
      const isCancelled = payload.status === 7 || 
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

      // Check if order is returned
      // status 5 = Returned, status 4 = Returning
      const isReturned = payload.status === 5 || payload.status === 4 ||
        statusName.includes('đã hoàn') || statusName === 'hoàn' || statusName.includes('hoàn hàng') || statusName.includes('chuyển hoàn') || statusName.includes('returned') || (payload.partner && payload.partner.partner_status === 'returned');
      
      if (isReturned && existingOrder.status !== 'returned') {
        console.log(`Order ${payload.id} is returned on Pancake. Marking as returned...`);
        const { processReturnOrder } = require('./orderController');
        try {
          await processReturnOrder(existingOrder._id, null);
          return res.status(200).json({ success: true, message: 'Order marked as returned' });
        } catch (err) {
          console.error(`Failed to mark order ${payload.id} as returned:`, err.message);
          // Don't return 500, return 200 so Pancake doesn't retry infinitely
          return res.status(200).json({ success: false, message: 'Failed to mark as returned' });
        }
      }

      let updated = false;

      // Check if order became completed from pending
      const isCompleted = checkIsCompleted(payload);
      if (isCompleted && existingOrder.status === 'pending') {
        console.log(`Order ${payload.id} is now completed. Marking as completed...`);
        existingOrder.status = 'completed';
        updated = true;

        const FundTransaction = require('../models/FundTransaction');
        
        // Calculate new amount for transaction log
        // Với đơn marketplace (Shopee, TikTok,...): "Tiền cần thu" = (Tổng - Giảm giá) - Phí sàn
        // Với đơn trực tiếp (Facebook, offline): dùng cash/transfer/cod
        const calcOrderAmount = (p) => {
          const feeMarketplace = p.fee_marketplace || 0;
          if (feeMarketplace > 0) {
            return Math.max(0, (p.total_price || 0) - (p.total_discount || 0) - feeMarketplace);
          }
          const directAmount = (p.cash || 0) + (p.transfer_money || 0) + (p.charged_by_card || 0) + (p.money_to_collect || p.cod || 0);
          return directAmount > 0 ? directAmount : (p.buyer_total_amount || p.total_price_after_sub_discount || 0);
        };
        const newOrderAmount = calcOrderAmount(payload);
        const revenueAmount = newOrderAmount > 0 ? newOrderAmount : existingOrder.total_price;

        await FundTransaction.create({
          type: 'order_revenue',
          amount: revenueAmount,
          fund_change: 0,
          platform_change: revenueAmount,
          source: existingOrder.source,
          order_id: existingOrder._id,
          note: `Doanh thu đơn hàng ${existingOrder.orderId}`,
          created_by: 'System'
        });
      }
      // NOTE: Không tự động hạ cấp đơn từ 'completed' xuống 'pending'
      // vì Pancake có thể gửi webhook nhiều lần với trạng thái khác nhau (ghi chú, địa chỉ, ...)
      // Đơn đã được xác nhận "đã thu tiền" sẽ chỉ thay đổi khi bị "hoàn" chính thức

      // Check if total_price changed
      // Với đơn marketplace (Shopee, TikTok,...): "Tiền cần thu" = (Tổng - Giảm giá) - Phí sàn
      const calcOrderAmountUpdate = (p) => {
        const feeMarketplace = p.fee_marketplace || 0;
        if (feeMarketplace > 0) {
          return Math.max(0, (p.total_price || 0) - (p.total_discount || 0) - feeMarketplace);
        }
        const directAmount = (p.cash || 0) + (p.transfer_money || 0) + (p.charged_by_card || 0) + (p.money_to_collect || p.cod || 0);
        return directAmount > 0 ? directAmount : (p.buyer_total_amount || p.total_price_after_sub_discount || 0);
      };
      const newOrderAmount = calcOrderAmountUpdate(payload);

      if (newOrderAmount > 0 && existingOrder.total_price !== newOrderAmount) {
        console.log(`Order ${payload.id} amount changed from ${existingOrder.total_price} to ${newOrderAmount}. Updating...`);
        existingOrder.total_price = newOrderAmount;
        updated = true;
      }

      // Sync customer info and note
      if (payload.customer) {
        if (payload.customer.name && existingOrder.customer_name !== payload.customer.name) {
          existingOrder.customer_name = payload.customer.name;
          updated = true;
        }
        if (payload.customer.phone_numbers && payload.customer.phone_numbers.length > 0) {
          if (existingOrder.customer_phone !== payload.customer.phone_numbers[0]) {
            existingOrder.customer_phone = payload.customer.phone_numbers[0];
            updated = true;
          }
        }
        if (payload.customer.shipping_address && payload.customer.shipping_address.full_address) {
          if (existingOrder.customer_address !== payload.customer.shipping_address.full_address) {
            existingOrder.customer_address = payload.customer.shipping_address.full_address;
            updated = true;
          }
        }
      }
      
      if (payload.note !== undefined && existingOrder.note !== payload.note) {
        existingOrder.note = payload.note;
        updated = true;
      }

      // If unit_cost is 0 for any item, we should try to recalculate it
      const hasZeroCost = existingOrder.items.some(i => !i.unit_cost || i.unit_cost === 0);
      if (hasZeroCost) {
        const allProducts = await Product.find().populate('base_ingredients.ingredient_id').populate('skus.extra_ingredients.ingredient_id');
        for (let item of existingOrder.items) {
          if (!item.unit_cost || item.unit_cost === 0) {
            let matchedProduct = allProducts.find(p => p._id.toString() === item.product_id?.toString());
            if (matchedProduct) {
              let base_cost = 0;
              if (matchedProduct.base_ingredients) {
                matchedProduct.base_ingredients.forEach(bi => {
                  if (bi.ingredient_id && bi.ingredient_id.price) {
                    base_cost += bi.ingredient_id.price * bi.quantity;
                  }
                });
              }
              let unit_cost = base_cost;
              if (item.sku_id && matchedProduct.skus) {
                const matchedSku = matchedProduct.skus.find(s => s.id === item.sku_id);
                if (matchedSku && matchedSku.extra_ingredients) {
                  let extra_cost = 0;
                  matchedSku.extra_ingredients.forEach(ei => {
                    if (ei.ingredient_id && ei.ingredient_id.price) {
                      extra_cost += ei.ingredient_id.price * ei.quantity;
                    }
                  });
                  unit_cost += extra_cost;
                }
              }
              if (unit_cost > 0) {
                item.unit_cost = unit_cost;
                updated = true;
              }
            }
          }
        }
      }

      if (updated) {
        await existingOrder.save();
        return res.status(200).json({ success: true, message: 'Order updated' });
      }

      console.log(`Order ${payload.id} already exists. Skipping creation.`);
      return res.status(200).json({ success: true, message: 'Order already exists' });
    }

    // Guard: nếu đơn chưa có trong DB nhưng đã bị hủy/hoàn → bỏ qua, không tạo mới
    const statusNameNew = (payload.status_name || '').toLowerCase();
    // status 7 = Cancelled. status 9 = Waiting for pick up (KHÔNG phải cancelled)
    const isCancelledNew = payload.status === 7 ||
      statusNameNew.includes('huỷ') ||
      statusNameNew.includes('hủy') ||
      statusNameNew.includes('cancel') ||
      (payload.partner && payload.partner.partner_status === 'cancelled');
    // status 5 = Returned, status 4 = Returning
    const isReturnedNew = payload.status === 5 || payload.status === 4 ||
      statusNameNew.includes('đã hoàn') || statusNameNew === 'hoàn' ||
      statusNameNew.includes('hoàn hàng') || statusNameNew.includes('chuyển hoàn') ||
      statusNameNew.includes('returned') ||
      (payload.partner && payload.partner.partner_status === 'returned');

    if (isCancelledNew || isReturnedNew) {
      console.log(`Order ${payload.id} is cancelled/returned but not in DB. Skipping creation.`);
      return res.status(200).json({ success: true, message: 'Ignored: Cancelled or returned order not in DB' });
    }

    const allProducts = await Product.find().populate('base_ingredients.ingredient_id').populate('skus.extra_ingredients.ingredient_id');
    const orderItems = [];

    // Map Pancake items to our Products
    for (const item of payload.items) {
      const shopeeName = item.variation_info?.name || 'Sản phẩm không rõ';
      const shopeeSku = item.variation_info?.detail || '';
      const shopeeSkuCode = item.variation_info?.sku || item.sku || item.product_id || item.barcode || '';

      let matchedProduct = null;
      let matchedSkuId = null;

      // 1. Try to match EXACTLY by SKU Code
      if (shopeeSkuCode) {
        const skuCodeUpper = String(shopeeSkuCode).toUpperCase();
        for (const p of allProducts) {
          if (p.skus && p.skus.length > 0) {
            const foundSku = p.skus.find(s => s.id && s.id.toUpperCase() === skuCodeUpper);
            if (foundSku) {
              matchedProduct = p;
              matchedSkuId = foundSku.id;
              break;
            }
          }
          if (!matchedProduct && p.productId && p.productId.toUpperCase() === skuCodeUpper) {
            matchedProduct = p;
            break;
          }
        }
      }

      // 2. If no exact match, fallback to substring matching against ALL SKUs and ProductIDs sorted by length
      if (!matchedProduct) {
        const shopeeFullTextUpper = (shopeeName + ' ' + shopeeSku + ' ' + shopeeSkuCode).toUpperCase();
        const allIdentifiers = [];
        
        for (const p of allProducts) {
          if (p.skus && p.skus.length > 0) {
            for (const s of p.skus) {
              if (s.id) {
                allIdentifiers.push({ type: 'sku', id: s.id.toUpperCase(), skuId: s.id, product: p });
              }
            }
          }
          if (p.productId) {
            allIdentifiers.push({ type: 'product', id: p.productId.toUpperCase(), product: p });
          }
        }
        
        // Sort by length descending (longest string matches first to prevent partial matches like SET inside RBY_SET)
        allIdentifiers.sort((a, b) => b.id.length - a.id.length);
        
        for (const identifier of allIdentifiers) {
          if (shopeeFullTextUpper.includes(identifier.id)) {
            matchedProduct = identifier.product;
            if (identifier.type === 'sku') {
              matchedSkuId = identifier.skuId;
            }
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

      // 4. If we found a product but no SKU, try to find a SKU from the variation detail
      if (matchedProduct && !matchedSkuId && matchedProduct.skus && matchedProduct.skus.length > 0) {
        const variationDetailUpper = shopeeSku.toUpperCase();
        const variationDetailLower = shopeeSku.toLowerCase();
        
        // 4a. Try exact match on sku id in variation detail
        const sortedProductSkus = [...matchedProduct.skus].sort((a, b) => (b.id?.length || 0) - (a.id?.length || 0));
        for (const s of sortedProductSkus) {
          if (s.id && variationDetailUpper.includes(s.id.toUpperCase())) {
            matchedSkuId = s.id;
            break;
          }
        }
        
        // 4b. If still not found, try to match by sku label
        if (!matchedSkuId) {
          for (const s of matchedProduct.skus) {
            if (s.label && variationDetailLower.includes(s.label.toLowerCase())) {
              matchedSkuId = s.id;
              break;
            }
          }
        }
      }

      let unit_cost = 0;
      if (matchedProduct) {
        let base_cost = 0;
        if (matchedProduct.base_ingredients) {
          matchedProduct.base_ingredients.forEach(item => {
            if (item.ingredient_id && item.ingredient_id.price) {
              base_cost += item.ingredient_id.price * item.quantity;
            }
          });
        }
        
        unit_cost = base_cost;
        
        if (matchedSkuId && matchedProduct.skus) {
          const matchedSku = matchedProduct.skus.find(s => s.id === matchedSkuId);
          if (matchedSku && matchedSku.extra_ingredients) {
            let extra_cost = 0;
            matchedSku.extra_ingredients.forEach(item => {
              if (item.ingredient_id && item.ingredient_id.price) {
                extra_cost += item.ingredient_id.price * item.quantity;
              }
            });
            unit_cost += extra_cost;
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
        unit_cost: unit_cost,
        quantity: item.quantity || 1
      });
    }

    // We only deduct materials for items that we successfully mapped to a Product in our DB
    const validItems = orderItems.filter(i => i.product_id);
    let logisticsCost = 0;

    // Determine shipping method (Hỏa tốc vs Thường)
    const payloadStr = JSON.stringify(payload).toLowerCase();
    const isExpress = payloadStr.includes('hỏa tốc') || payloadStr.includes('instant') || payloadStr.includes('grabexpress') || payloadStr.includes('ahamove');
    const shippingMethod = isExpress ? 'express' : 'standard';

    if (validItems.length > 0) {
      const { deductions, packagingCost } = await buildMaterialDeductions(validItems, shippingMethod);
      logisticsCost = packagingCost || 0;

      for (const [matId, qtyToDeduct] of deductions.entries()) {
        const mat = await Material.findById(matId);
        if (mat) {
          const newActual = Number((mat.actualStock - qtyToDeduct).toFixed(4));
          const newStock = Number((mat.stock - qtyToDeduct).toFixed(4));
          const calcStatus = (actual, min) => (actual <= 0 ? 'out_of_stock' : actual <= min ? 'low_stock' : 'in_stock');
          await Material.findByIdAndUpdate(matId, {
            actualStock: newActual,
            stock: newStock,
            status: calcStatus(newActual, mat.minStock),
          });
        }
      }
    } else {
      console.log('No valid products matched. Material deduction skipped for this order.');
    }

    // Calculate the final actual amount received/to be collected
    // Với đơn marketplace (Shopee, TikTok,...): "Tiền cần thu" = (Tổng - Giảm giá) - Phí sàn → khớp Pancake
    // Với đơn trực tiếp (Facebook, offline): dùng cash/transfer/cod
    const feeMarketplace = payload.fee_marketplace || 0;
    let orderAmount;
    if (feeMarketplace > 0) {
      orderAmount = Math.max(0, (payload.total_price || 0) - (payload.total_discount || 0) - feeMarketplace);
    } else {
      const finalAmount = (payload.cash || 0) +
                          (payload.transfer_money || 0) +
                          (payload.charged_by_card || 0) +
                          (payload.money_to_collect || payload.cod || 0);
      orderAmount = finalAmount > 0 ? finalAmount : (payload.buyer_total_amount || payload.total_price_after_sub_discount || 0);
    }

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

    const statusName = (payload.status_name || '').toLowerCase();
    const isCompleted = checkIsCompleted(payload);
      // checkIsCompleted kiểm tra:
      // - status=16 (Collected money)
      // - status_name chứa từ khoá hoàn thành
      // - histories[].shopee_status.new = 'COMPLETED' (dành cho đơn Shopee)
    const initialStatus = isCompleted ? 'completed' : 'pending';

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
      status: initialStatus,
      ordered_at: orderedAt,
    });

    await order.save();
    console.log(`Successfully saved Pancake order as: ${order.orderId}`);

    // Trigger auto confirm imports
    const { triggerAutoConfirmImports } = require('../utils/inventoryHelpers');
    triggerAutoConfirmImports().catch(console.error);

    res.status(200).json({ success: true, message: 'Order processed successfully' });
  } catch (error) {
    console.error('Error handling Pancake webhook:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
