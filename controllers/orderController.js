const Order = require('../models/Order');
const Material = require('../models/Material');
const Product = require('../models/Product');
const ShippingConfig = require('../models/ShippingConfig');
const SystemConfig = require('../models/SystemConfig');
const FundTransaction = require('../models/FundTransaction');
const { triggerAutoConfirmImports } = require('../utils/inventoryHelpers');

// Helper tạo orderId ngẫu nhiên
const generateOrderId = () => `DH-${Math.floor(1000000 + Math.random() * 9000000)}`;

// Helper tính lại status từ actualStock vs minStock
const calcStatus = (actualStock, minStock) => {
  const actual = Number(actualStock);
  const min = Number(minStock);
  if (actual === 0) return 'out_of_stock';
  if (actual <= min) return 'low_stock';
  return 'in_stock';
};

/**
 * Tính toán lượng nguyên liệu cần trừ cho một item đơn hàng.
 * Trả về { deductions: Map<ingredient_id_string, totalQuantity>, packagingCost: Number }
 */
const buildMaterialDeductions = async (items, shippingMethod = 'standard') => {
  // Gom product_id cần fetch
  const productIds = [...new Set(items.map(i => i.product_id))];
  const products = await Product.find({ _id: { $in: productIds } });
  const productMap = Object.fromEntries(products.map(p => [p._id.toString(), p]));

  // Map: materialId -> tổng lượng cần trừ
  const deductions = new Map();

  const addDeduct = (ingredientId, qty) => {
    const key = ingredientId.toString();
    deductions.set(key, (deductions.get(key) || 0) + qty);
  };

  for (const item of items) {
    const product = productMap[item.product_id.toString()];
    if (!product) continue;

    const qty = item.quantity; // số lượng sản phẩm trong đơn

    // 1. Trừ nguyên liệu gốc (base_ingredients) × số lượng sản phẩm
    for (const bi of product.base_ingredients || []) {
      addDeduct(bi.ingredient_id, bi.quantity * qty);
    }

    // 2. Nếu có chọn SKU cụ thể → trừ thêm extra_ingredients của SKU đó
    if (item.sku_id) {
      const sku = (product.skus || []).find(s => s.id === item.sku_id);
      if (sku) {
        for (const ei of sku.extra_ingredients || []) {
          addDeduct(ei.ingredient_id, ei.quantity * qty);
        }
      }
    }
  }

  // 3. Trừ thêm nguyên liệu theo phương thức vận chuyển
  let packagingCost = 0;
  if (shippingMethod) {
    const shippingConfig = await ShippingConfig.findOne({ method: shippingMethod });
    if (shippingConfig && shippingConfig.materials && shippingConfig.materials.length > 0) {
      for (const sm of shippingConfig.materials) {
        addDeduct(sm.material_id, sm.quantity);
        const mat = await Material.findById(sm.material_id);
        if (mat) {
          packagingCost += (mat.price || 0) * sm.quantity;
        }
      }
    }
  }

  return { deductions, packagingCost };
};

// GET /api/orders
exports.getOrders = async (req, res, next) => {
  try {
    const orders = await Order.find().sort({ ordered_at: -1 });
    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    next(error);
  }
};

// GET /api/orders/:id
exports.getOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
    }
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

// POST /api/orders
exports.createOrder = async (req, res, next) => {
  try {
    const { items, total_price, logistics_cost, source, pos_mode, customer_name, customer_phone, customer_address, payment_method, shippingMethod, note, ordered_at, orderId: clientOrderId, is_replacement, is_seeding, seeding_cost, discount_amount, discount_code } = req.body;

    if (!is_seeding && (!items || items.length === 0)) {
      return res.status(400).json({ success: false, message: 'Đơn hàng phải có ít nhất 1 sản phẩm' });
    }

    // Xác định orderId: dùng từ client (nhập tay) hoặc tự sinh nếu không có
    let orderId;
    if (clientOrderId && clientOrderId.trim()) {
      orderId = clientOrderId.trim();
      // Kiểm tra trùng lặp
      const existing = await Order.findOne({ orderId });
      if (existing) {
        return res.status(400).json({ success: false, message: `Mã đơn hàng "${orderId}" đã tồn tại. Vui lòng nhập mã khác.` });
      }
    } else {
      orderId = generateOrderId();
    }

    // 1. Tính lượng nguyên liệu cần trừ & kiểm tra tồn kho & tính phí đóng gói
    const { deductions, packagingCost } = await buildMaterialDeductions(items, shippingMethod);
    
    // Kiểm tra xem số lượng nguyên liệu tồn kho có đủ đáp ứng không
    for (const [materialId, deductQty] of deductions.entries()) {
      const mat = await Material.findById(materialId);
      if (mat && mat.actualStock < deductQty) {
        return res.status(400).json({ 
          success: false, 
          message: `Không thể tạo đơn hàng vì nguyên liệu "${mat.name}" không đủ (yêu cầu: ${deductQty}, tồn kho: ${mat.actualStock}).` 
        });
      }
    }

    // Tính tổng số tiền cần thanh toán ngay: phí seeding + phí ship
    const seedingPayment = is_seeding && seeding_cost ? Number(seeding_cost) : 0;
    const shippingPayment = logistics_cost ? Number(logistics_cost) : 0;
    const totalRequired = seedingPayment + shippingPayment;

    if (totalRequired > 0) {
      const fundAgg = await FundTransaction.aggregate([
        { $group: { _id: null, totalBalance: { $sum: '$fund_change' } } }
      ]);
      const currentFund = fundAgg.length > 0 ? fundAgg[0].totalBalance : 0;
      if (currentFund < totalRequired) {
        return res.status(400).json({ 
          success: false, 
          code: 'INSUFFICIENT_FUND', 
          message: 'Tài sản chung không đủ để trả chi phí (Ship / Seeding).',
          requiredAmount: totalRequired - currentFund
        });
      }
    }

    // 2. Tạo đơn hàng
    const order = await Order.create({
      orderId,
      items: items || [],
      total_price: total_price || 0,
      logistics_cost: logistics_cost || 0,
      source: source || 'khác',
      pos_mode: pos_mode || 'offline',
      customer_name: customer_name || '',
      customer_phone: customer_phone || '',
      customer_address: customer_address || '',
      payment_method: payment_method || 'cash',
      shippingMethod: shippingMethod || 'standard',
      packaging_cost: packagingCost,
      note: note || '',
      discount_amount: discount_amount || 0,
      discount_code: discount_code || null,
      is_replacement: is_replacement || false,
      is_seeding: is_seeding || false,
      seeding_cost: seeding_cost || 0,
      ordered_at: ordered_at || new Date(),
    });

    // Tạo giao dịch trả phí seeding
    if (order.is_seeding && order.seeding_cost > 0) {
      await FundTransaction.create({
        type: 'seeding_payment',
        amount: order.seeding_cost,
        fund_change: -order.seeding_cost,
        order_id: order._id,
        note: `Chi phí đơn Seeding ${order.orderId}`,
        created_by: 'System'
      });
    }

    // Tạo giao dịch trả phí ship
    if (order.logistics_cost > 0) {
      await FundTransaction.create({
        type: 'shipping_payment',
        amount: order.logistics_cost,
        fund_change: -order.logistics_cost,
        order_id: order._id,
        note: `Phí ship đơn hàng ${order.orderId}`,
        created_by: 'System'
      });
    }

    // Tự động chuyển doanh thu POS (Chuyển khoản), Facebook, Instagram vào Tài sản chung
    const isAutoFund = (order.source === 'pos' && order.payment_method === 'transfer') || order.source === 'facebook' || order.source === 'instagram';
    if (isAutoFund && order.total_price > 0) {
      const sourceName = order.source === 'pos' ? 'POS Chuyển khoản' : (order.source === 'facebook' ? 'Facebook' : 'Instagram');
      await FundTransaction.create({
        type: 'revenue_withdrawal',
        amount: order.total_price,
        fee: 0,
        fund_change: order.total_price,
        source: order.source,
        order_id: order._id,
        note: `Tự động chuyển doanh thu ${sourceName} đơn ${order.orderId}`,
        created_by: 'System'
      });
    }

    // Cập nhật used_count của Coupon nếu có dùng mã giảm giá
    if (discount_code && discount_amount > 0) {
      const Coupon = require('../models/Coupon');
      await Coupon.findOneAndUpdate(
        { code: discount_code },
        { $inc: { used_count: 1 } }
      ).catch(err => console.error('[createOrder] Lỗi cập nhật used_count Coupon:', err.message));
    }

    // 3. Cập nhật kho nguyên liệu (trừ stock)
    try {
      const updatePromises = [];
      for (const [materialId, deductQty] of deductions.entries()) {
        updatePromises.push(
          (async () => {
            const mat = await Material.findById(materialId);
            if (!mat) return;

            const newStock = Math.max(0, mat.stock - deductQty);
            const newActual = Math.max(0, mat.actualStock - deductQty);
            const newStatus = calcStatus(newActual, mat.minStock);

            await Material.findByIdAndUpdate(materialId, {
              stock: newStock,
              actualStock: newActual,
              status: newStatus,
            });
          })()
        );
      }
      await Promise.all(updatePromises);
    } catch (deductErr) {
      // Không roll back đơn hàng, chỉ log lỗi trừ kho
      console.error('[createOrder] Lỗi khi trừ nguyên liệu:', deductErr.message);
    }
    // 6. Kích hoạt trigger auto confirm phiếu nhập (chạy ngầm)
    triggerAutoConfirmImports().catch(console.error);

    return res.status(201).json({ success: true, data: order, message: 'Đã tạo đơn hàng thành công' });
  } catch (error) {
    next(error);
  }
};

// PUT /api/orders/:id
exports.updateOrder = async (req, res, next) => {
  try {
    const { items, total_price, logistics_cost, source, pos_mode, customer_name, customer_phone, customer_address, payment_method, shippingMethod, note, ordered_at, is_replacement, is_seeding, seeding_cost, discount_amount, discount_code } = req.body;

    if (!is_seeding && (!items || items.length === 0)) {
      return res.status(400).json({ success: false, message: 'Đơn hàng phải có ít nhất 1 sản phẩm' });
    }

    const oldOrder = await Order.findById(req.params.id);
    if (!oldOrder) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
    }

    // Không cho phép chỉnh sửa đơn hàng đã bị hoàn
    if (oldOrder.status === 'returned') {
      return res.status(400).json({ success: false, message: 'Không thể chỉnh sửa đơn hàng đã bị hoàn' });
    }

    const newSeedingCost = Number(seeding_cost || 0);
    const oldSeedingCost = Number(oldOrder.seeding_cost || 0);
    const newShippingCost = Number(logistics_cost || 0);
    const oldShippingCost = Number(oldOrder.logistics_cost || 0);

    const oldTotalDeduction = (oldOrder.is_seeding ? oldSeedingCost : 0) + oldShippingCost;
    const newTotalDeduction = (is_seeding ? newSeedingCost : 0) + newShippingCost;
    const delta = newTotalDeduction - oldTotalDeduction;

    // Kiểm tra số dư nếu tổng phí tăng lên
    if (delta > 0) {
      const fundAgg = await FundTransaction.aggregate([
        { $group: { _id: null, totalBalance: { $sum: '$fund_change' } } }
      ]);
      const currentFund = fundAgg.length > 0 ? fundAgg[0].totalBalance : 0;
      if (currentFund < delta) {
        return res.status(400).json({ 
          success: false, 
          code: 'INSUFFICIENT_FUND', 
          message: 'Tài sản chung không đủ để trả thêm chi phí (Ship / Seeding).',
          requiredAmount: delta - currentFund
        });
      }
    }

    // 1. Tính toán lượng nguyên liệu cũ và mới
    const oldResult = await buildMaterialDeductions(oldOrder.items, oldOrder.shippingMethod);
    const newResult = await buildMaterialDeductions(items, shippingMethod);
    
    const oldDeductions = oldResult.deductions;
    const newDeductions = newResult.deductions;
    const packagingCost = newResult.packagingCost;

    // 2. Tính sự chênh lệch (diff = new - old)
    // Nếu diff > 0 nghĩa là cần trừ thêm nguyên liệu. Nếu diff < 0 nghĩa là hoàn trả lại nguyên liệu.
    const diffDeductions = new Map();

    for (const [materialId, newQty] of newDeductions.entries()) {
      diffDeductions.set(materialId, newQty);
    }

    for (const [materialId, oldQty] of oldDeductions.entries()) {
      const currentDiff = diffDeductions.get(materialId) || 0;
      diffDeductions.set(materialId, currentDiff - oldQty);
    }

    // 3. Kiểm tra xem có đủ nguyên liệu để thêm (diff > 0) hay không
    for (const [materialId, diffQty] of diffDeductions.entries()) {
      if (diffQty > 0) {
        const mat = await Material.findById(materialId);
        if (mat && mat.actualStock < diffQty) {
          return res.status(400).json({ 
            success: false, 
            message: `Không thể cập nhật đơn hàng vì nguyên liệu "${mat.name}" không đủ (cần thêm: ${diffQty}, tồn kho: ${mat.actualStock}).` 
          });
        }
      }
    }

    // 4. Cập nhật kho nguyên liệu (trừ hoặc cộng thêm dựa trên diff)
    try {
      const updatePromises = [];
      for (const [materialId, diffQty] of diffDeductions.entries()) {
        if (diffQty === 0) continue;

        updatePromises.push(
          (async () => {
            const mat = await Material.findById(materialId);
            if (!mat) return;

            const newStock = Math.max(0, mat.stock - diffQty);
            const newActual = Math.max(0, mat.actualStock - diffQty);
            const newStatus = calcStatus(newActual, mat.minStock);

            await Material.findByIdAndUpdate(materialId, {
              stock: newStock,
              actualStock: newActual,
              status: newStatus,
            });
          })()
        );
      }
      await Promise.all(updatePromises);
    } catch (deductErr) {
      console.error('[updateOrder] Lỗi khi cập nhật nguyên liệu:', deductErr.message);
    }

    // 5. Cập nhật dữ liệu đơn hàng
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { items: items || [], total_price: total_price || 0, logistics_cost, source, pos_mode, customer_name, customer_phone, customer_address, payment_method, shippingMethod, packaging_cost: packagingCost, note, is_replacement: is_replacement || false, is_seeding: is_seeding || false, seeding_cost: newSeedingCost, ordered_at, discount_amount: discount_amount || 0, discount_code: discount_code || null },
      { new: true, runValidators: true }
    );

    // Xử lý FundTransaction cho seeding_payment
    if (order.is_seeding) {
      const existingTx = await FundTransaction.findOne({ order_id: order._id, type: 'seeding_payment' });
      if (newSeedingCost > 0) {
        if (existingTx) {
          existingTx.amount = newSeedingCost;
          existingTx.fund_change = -newSeedingCost;
          await existingTx.save();
        } else {
          await FundTransaction.create({
            type: 'seeding_payment',
            amount: newSeedingCost,
            fund_change: -newSeedingCost,
            order_id: order._id,
            note: `Chi phí đơn Seeding ${order.orderId}`,
            created_by: 'System'
          });
        }
      } else if (existingTx) {
        await existingTx.deleteOne(); // Xóa nếu phí về 0
      }
    } else {
      // Nếu không còn là đơn seeding, xóa seeding_payment nếu có
      await FundTransaction.deleteMany({ order_id: order._id, type: 'seeding_payment' });
    }

    // Xử lý FundTransaction cho shipping_payment
    const existingShipTx = await FundTransaction.findOne({ order_id: order._id, type: 'shipping_payment' });
    if (newShippingCost > 0) {
      if (existingShipTx) {
        existingShipTx.amount = newShippingCost;
        existingShipTx.fund_change = -newShippingCost;
        await existingShipTx.save();
      } else {
        await FundTransaction.create({
          type: 'shipping_payment',
          amount: newShippingCost,
          fund_change: -newShippingCost,
          order_id: order._id,
          note: `Phí ship đơn hàng ${order.orderId}`,
          created_by: 'System'
        });
      }
    } else if (existingShipTx) {
      await existingShipTx.deleteOne(); // Xóa nếu phí ship về 0
    }

    // Xử lý FundTransaction tự động chuyển doanh thu (POS Chuyển khoản, Facebook, Instagram)
    const isAutoFund = (order.source === 'pos' && order.payment_method === 'transfer') || order.source === 'facebook' || order.source === 'instagram';
    const autoFundSources = ['pos', 'facebook', 'instagram'];
    const existingAutoTxList = await FundTransaction.find({ order_id: order._id, type: 'revenue_withdrawal', source: { $in: autoFundSources } });
    
    if (isAutoFund && order.total_price > 0) {
      const sourceName = order.source === 'pos' ? 'POS Chuyển khoản' : (order.source === 'facebook' ? 'Facebook' : 'Instagram');
      
      if (existingAutoTxList.length > 0) {
        const txToUpdate = existingAutoTxList[0];
        txToUpdate.amount = order.total_price;
        txToUpdate.fund_change = order.total_price;
        txToUpdate.source = order.source;
        txToUpdate.note = `Tự động chuyển doanh thu ${sourceName} đơn ${order.orderId}`;
        await txToUpdate.save();
        
        // Xoá các tx thừa nếu có (do lỗi cũ)
        for (let i = 1; i < existingAutoTxList.length; i++) {
          await existingAutoTxList[i].deleteOne();
        }
      } else {
        await FundTransaction.create({
          type: 'revenue_withdrawal',
          amount: order.total_price,
          fee: 0,
          fund_change: order.total_price,
          source: order.source,
          order_id: order._id,
          note: `Tự động chuyển doanh thu ${sourceName} đơn ${order.orderId}`,
          created_by: 'System'
        });
      }
    } else {
      for (const tx of existingAutoTxList) {
        await tx.deleteOne();
      }
    }

    // 6. Kích hoạt trigger auto confirm phiếu nhập (chạy ngầm)
    triggerAutoConfirmImports().catch(console.error);

    res.status(200).json({ success: true, data: order, message: 'Đã cập nhật đơn hàng' });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/orders/:id
exports.deleteOrder = async (req, res, next) => {
  try {
    const { restoreStock } = req.query;
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
    }

    // Hoàn lại tiền vào Tài sản chung nếu là đơn seeding
    if (order.is_seeding) {
      await FundTransaction.deleteMany({ order_id: order._id, type: 'seeding_payment' });
    }
    
    // Hoàn lại phí ship vào Tài sản chung
    if (order.logistics_cost > 0) {
      await FundTransaction.deleteMany({ order_id: order._id, type: 'shipping_payment' });
    }

    // Xóa giao dịch tự động chuyển doanh thu nếu có
    await FundTransaction.deleteMany({ order_id: order._id, type: 'revenue_withdrawal', source: { $in: ['pos', 'facebook', 'instagram'] } });

    // Chỉ hoàn kho khi đơn CHƯA bị hoàn (completed).
    // Đơn đã hoàn (returned) thì nguyên liệu đã được trả lại khi markAsReturned → không hoàn thêm.
    const isReturned = order.status === 'returned';

    if (restoreStock === 'true' && !isReturned) {
      try {
        const { deductions: refunds } = await buildMaterialDeductions(order.items, order.shippingMethod);
        const updatePromises = [];
        for (const [materialId, refundQty] of refunds.entries()) {
          updatePromises.push(
            (async () => {
              const mat = await Material.findById(materialId);
              if (!mat) return;

              const newStock = mat.stock + refundQty;
              const newActual = mat.actualStock + refundQty;
              const newStatus = calcStatus(newActual, mat.minStock);

              await Material.findByIdAndUpdate(materialId, {
                stock: newStock,
                actualStock: newActual,
                status: newStatus,
              });
            })()
          );
        }
        await Promise.all(updatePromises);
      } catch (refundErr) {
        console.error('[deleteOrder] Lỗi khi hoàn lại nguyên liệu:', refundErr.message);
      }
    }

    const msg = isReturned
      ? 'Đã xóa đơn hàng bị hoàn (nguyên liệu đã được hoàn trước đó)'
      : 'Đã xóa đơn hàng' + (restoreStock === 'true' ? ' và hoàn lại nguyên liệu' : '');
    res.status(200).json({ success: true, message: msg });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/orders/:id/return
exports.markAsReturned = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
    }

    if (order.status === 'returned') {
      return res.status(400).json({ success: false, message: 'Đơn hàng này đã được đánh dấu bị hoàn trước đó' });
    }

    // Đọc chi phí hoàn từ body hoặc cấu hình hệ thống
    let returnCost = 0;
    if (req.body && req.body.returnCost !== undefined && req.body.returnCost !== null) {
      returnCost = Number(req.body.returnCost);
    } else {
      const returnCostConfig = await SystemConfig.findOne({ key: 'return_cost_per_platform' });
      let returnCosts = {};
      if (returnCostConfig && returnCostConfig.value) {
        try {
          returnCosts = JSON.parse(returnCostConfig.value);
        } catch (e) {}
      }
      const orderSource = order.source || 'khác';
      returnCost = returnCosts[orderSource] ? Number(returnCosts[orderSource]) : 0;
    }

    // Hoàn lại nguyên liệu vào kho (chỉ hoàn sản phẩm, không hoàn bao bì vận chuyển vì đã hỏng/sử dụng)
    try {
      const { deductions: refunds } = await buildMaterialDeductions(order.items, null);
      const updatePromises = [];
      for (const [materialId, refundQty] of refunds.entries()) {
        updatePromises.push(
          (async () => {
            const mat = await Material.findById(materialId);
            if (!mat) return;
            const newStock = mat.stock + refundQty;
            const newActual = mat.actualStock + refundQty;
            const newStatus = calcStatus(newActual, mat.minStock);
            await Material.findByIdAndUpdate(materialId, {
              stock: newStock,
              actualStock: newActual,
              status: newStatus,
            });
          })()
        );
      }
      await Promise.all(updatePromises);
    } catch (refundErr) {
      console.error('[markAsReturned] Lỗi khi hoàn lại nguyên liệu:', refundErr.message);
    }

    // Xóa giao dịch tự động chuyển doanh thu nếu có (vì đơn đã bị hoàn)
    await FundTransaction.deleteMany({ order_id: order._id, type: 'revenue_withdrawal', source: { $in: ['pos', 'facebook', 'instagram'] } });

    // Cập nhật trạng thái đơn hàng
    const updatedOrder = await Order.findByIdAndUpdate(
      req.params.id,
      {
        status: 'returned',
        return_cost: returnCost,
        returned_at: new Date(),
      },
      { new: true }
    );

    res.status(200).json({
      success: true,
      data: updatedOrder,
      message: `Đã đánh dấu đơn hàng bị hoàn. Chi phí hoàn: ${returnCost.toLocaleString('vi-VN')}đ`,
    });
  } catch (error) {
    next(error);
  }
};
