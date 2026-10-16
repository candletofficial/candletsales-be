const Order = require('../models/Order');
const Product = require('../models/Product');
const Material = require('../models/Material');
const { buildMaterialDeductions } = require('./orderController');
const { classifyPancakeStatus } = require('../utils/pancakeOrderStatus');
const { applyPancakeCustomerDetails } = require('../utils/pancakeCustomerDetails');

// Helper to generate a random order ID
const generateOrderId = () => `DH-${Math.floor(1000000 + Math.random() * 9000000)}`;

/**
 * Kiểm tra xem đơn hàng có được xác nhận là "Đã thu tiền / Đã đối soát" hay không.
 * Áp dụng cho cả đợt tạo mới và cập nhật đơn hàng từ Pancake webhook.
 *
 * Timeline Shopee:
 *   COMPLETED (shopee_status) = khách xác nhận nhận hàng, nhưng Shopee VẪN GIỮ TIỀN (3-15 ngày)
 *   status=16 "Đã đối soát"   = Shopee thực sự chuyển tiền vào tài khoản → MỚI là hoàn thành
 *
 * NOTE: status=3 (Received / TO_CONFIRM_RECEIVE) — chưa nhận tiền.
 * NOTE: status=8 (Packaging) — đóng gói, không phải hoàn thành.
 * NOTE: shopee_status=COMPLETED — KHÔNG phải đã nhận tiền, chỉ là đơn xong phía khách hàng.
 */
const checkIsCompleted = (payload) => {
  const statusName = (payload.status_name || '').toLowerCase();

  // 1. Pancake status code 16 = "Đã đối soát" / Collected money
  if (payload.status === 16) return true;

  // 2. status_name keywords (dùng cho các nguồn khác: Facebook, offline, TikTok...)
  if (
    statusName.includes('đã thu tiền') ||
    statusName.includes('hoàn thành') ||
    statusName.includes('đã đối soát') ||
    statusName.includes('thanh toán đã chuyển') ||
    statusName.includes('đã thanh toán') ||
    statusName === 'received_money' ||
    statusName === 'completed' ||
    statusName === 'done' ||
    statusName === 'paid'
  ) return true;

  // 3. Shopee status: Khi Pancake cập nhật lịch sử có shopee_status = COMPLETED
  // Đây chính là lúc Shopee báo "Thanh toán đã chuyển thành công"
  if (payload.histories && Array.isArray(payload.histories)) {
    const hasShopeeCompleted = payload.histories.some(
      (h) => h.shopee_status && h.shopee_status.new === 'COMPLETED'
    );
    if (hasShopeeCompleted) return true;
  }

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
    if (!payload.id) {
      return res.status(200).json({ success: true, message: 'Ignored: Invalid payload structure' });
    }

    // Check if order already exists in our database
    const existingOrder = await Order.findOne({ pancake_order_id: payload.id });
    const pancakeStatus = classifyPancakeStatus(payload);
    const isReturned = pancakeStatus === 'returned';
    const isCancelled = pancakeStatus === 'cancelled' || pancakeStatus === 'removed';
    if (existingOrder) {
      // Customer metadata can still be enriched after return/cancellation without
      // replaying stock or revenue operations. Partial events keep saved details.
      if (applyPancakeCustomerDetails(existingOrder, payload)) await existingOrder.save();
      // Replayed or stale events must not delete a returned order or refund it twice.
      if (existingOrder.status === 'returned') {
        return res.status(200).json({ success: true, message: 'Order already returned' });
      }

      if (isReturned) {
        console.log(`Order ${payload.id} is returned on Pancake. Marking as returned...`);
        const { processReturnOrder } = require('./orderController');
        // A retained cancelled order has already had its materials refunded.
        if (existingOrder.status === 'cancelled') {
          existingOrder.status = 'returned';
          existingOrder.returned_at = new Date();
          await existingOrder.save();
        } else {
          await processReturnOrder(existingOrder._id, null);
        }
        return res.status(200).json({ success: true, message: 'Order marked as returned' });
      }

      if (existingOrder.status === 'cancelled') {
        return res.status(200).json({ success: true, message: 'Order already cancelled' });
      }
      
      if (isCancelled) {
        console.log(`Order ${payload.id} is cancelled on Pancake. Keeping order and refunding materials...`);
        const FundTransaction = require('../models/FundTransaction');
        const order = existingOrder;
        
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
        order.status = 'cancelled';
        order.cancelled_at = new Date();
        order.cancelled_reason = pancakeStatus === 'removed' ? 'Đã xoá trên Pancake' : 'Đã huỷ trên Pancake';
        await order.save();
        return res.status(200).json({ success: true, message: 'Order marked as cancelled and materials refunded' });
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

        // Cập nhật lại số tiền trong FundTransaction nếu đơn đã ghi nhận doanh thu
        if (existingOrder.status === 'completed') {
          const FundTransaction = require('../models/FundTransaction');
          const existingRevTx = await FundTransaction.findOne({ order_id: existingOrder._id, type: 'order_revenue' });
          if (existingRevTx) {
            existingRevTx.amount = newOrderAmount;
            existingRevTx.platform_change = newOrderAmount;
            await existingRevTx.save();
          }
        }
      }

      // Customer/recipient details were synchronized before terminal-state guards.
      
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

    if (isCancelled) {
      return res.status(200).json({ success: true, message: 'Ignored: Cancelled order not in DB' });
    }
    if (!payload.customer || !Array.isArray(payload.items)) {
      return res.status(200).json({ success: true, message: 'Ignored: Full order payload required for creation' });
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

      const namePrefix = shopeeName.includes('-') ? shopeeName.split('-')[0].trim().toUpperCase() : '';

      const findExactMatch = (codeToMatch) => {
        if (!codeToMatch) return false;
        const code = String(codeToMatch).toUpperCase();
        
        // Ưu tiên tìm chính xác theo SKU ID trước
        for (const p of allProducts) {
          if (p.skus && p.skus.length > 0) {
            const foundSku = p.skus.find(s => s.id && s.id.toUpperCase() === code);
            if (foundSku) {
              matchedProduct = p;
              matchedSkuId = foundSku.id;
              return true;
            }
          }
        }
        
        // Nếu không có SKU nào khớp, tìm theo Product ID
        for (const p of allProducts) {
          if (p.productId && p.productId.toUpperCase() === code) {
            matchedProduct = p;
            return true;
          }
        }
        return false;
      };

      // 1. Try to match EXACTLY by SKU Code from payload fields
      findExactMatch(shopeeSkuCode);

      // 2. Try to match EXACTLY by prefix extracted from name (e.g., "SS - Nến Thơm...")
      if (!matchedProduct && !matchedSkuId && namePrefix) {
        findExactMatch(namePrefix);
      }

      // 3. Find Product by Name (nếu các bước trên vẫn chưa tìm được)
      if (!matchedProduct) {
        const shopeeFullTextLower = (shopeeName + ' ' + shopeeSku).toLowerCase();
        for (const p of allProducts) {
          if (shopeeFullTextLower.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(shopeeName.toLowerCase())) {
            matchedProduct = p;
            break;
          }
        }
      }

      // 3. Find SKU within Product
      if (matchedProduct && !matchedSkuId && matchedProduct.skus && matchedProduct.skus.length > 0) {
        const variationDetailUpper = shopeeSku.toUpperCase();
        const variationDetailLower = shopeeSku.toLowerCase();
        
        // 3a. Exact match on sku id in variation detail (using word boundary)
        const sortedProductSkus = [...matchedProduct.skus].sort((a, b) => (b.id?.length || 0) - (a.id?.length || 0));
        for (const s of sortedProductSkus) {
          if (s.id) {
            const regex = new RegExp(`\\b${s.id.toUpperCase()}\\b`);
            if (regex.test(variationDetailUpper)) {
              matchedSkuId = s.id;
              break;
            }
          }
        }
        
        // 3b. Best match on labels
        if (!matchedSkuId) {
          let bestSku = null;
          let maxScore = 0;
          
          for (const s of matchedProduct.skus) {
            let score = 0;
            if (s.combination) {
              for (const optId of s.combination) {
                for (const vg of (matchedProduct.variant_groups || [])) {
                  const opt = (vg.options || []).find(o => o.id === optId);
                  if (opt && opt.label) {
                    const lblLower = opt.label.toLowerCase();
                    // Full match gets 2 points
                    if (variationDetailLower.includes(lblLower)) {
                      score += 2;
                    } else {
                      // Partial match (e.g. "túi" or "thiệp" in "kèm túi và thiệp")
                      const words = lblLower.split(/[\s,]+/);
                      for (const w of words) {
                        if (w.length > 2 && variationDetailLower.includes(w)) {
                          score += 1;
                        }
                      }
                    }
                  }
                }
              }
            }
            if (score > maxScore) {
              maxScore = score;
              bestSku = s.id;
            }
          }
          if (bestSku) {
            matchedSkuId = bestSku;
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

      // Construct real SKU label from our database if matched
      let realSkuLabel = shopeeSku;
      if (matchedProduct && matchedSkuId) {
        const skuObj = (matchedProduct.skus || []).find(s => s.id === matchedSkuId);
        if (skuObj && skuObj.combination) {
          const labels = skuObj.combination.map(optId => {
            for (const vg of (matchedProduct.variant_groups || [])) {
              const opt = (vg.options || []).find(o => o.id === optId);
              if (opt && opt.label) return opt.label;
            }
            return optId;
          });
          realSkuLabel = labels.join(' - ');
        }
      }

      orderItems.push({
        product_id: matchedProduct ? matchedProduct._id : null,
        productId: matchedProduct ? matchedProduct.productId : 'UNKNOWN_SHOPEE',
        product_name: matchedProduct ? matchedProduct.name : shopeeName,
        product_image: matchedProduct ? matchedProduct.image : null,
        sku_id: matchedSkuId, // Use the matched SKU ID if found
        sku_label: realSkuLabel, // Use our app's label instead of Pancake's
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

    // A returned order received for the first time is imported for history only.
    // In particular, recreating a previously deleted order must not move stock again.
    if (!isReturned && validItems.length > 0) {
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
    const initialStatus = isReturned ? 'returned' : isCompleted ? 'completed' : 'pending';

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
      returned_at: isReturned ? new Date() : null,
      ordered_at: orderedAt,
    });

    applyPancakeCustomerDetails(order, payload);
    await order.save();
    console.log(`Successfully saved Pancake order as: ${order.orderId}`);

    // Trigger auto confirm imports
    const { triggerAutoConfirmImports } = require('../utils/inventoryHelpers');
    if (!isReturned) triggerAutoConfirmImports().catch(console.error);

    res.status(200).json({ success: true, message: 'Order processed successfully' });
  } catch (error) {
    console.error('Error handling Pancake webhook:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
