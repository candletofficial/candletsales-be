const Order = require('../models/Order');
const Material = require('../models/Material');
const Product = require('../models/Product');
const ShippingConfig = require('../models/ShippingConfig');
const SystemConfig = require('../models/SystemConfig');
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
    const { items, total_price, logistics_cost, source, shippingMethod, note, ordered_at, orderId: clientOrderId, is_replacement, is_seeding, seeding_cost, discount_amount, discount_code } = req.body;

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

    // 2. Tạo đơn hàng
    const order = await Order.create({
      orderId,
      items: items || [],
      total_price: total_price || 0,
      logistics_cost: logistics_cost || 0,
      source: source || 'khác',
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
    const { items, total_price, logistics_cost, source, shippingMethod, note, ordered_at, is_replacement, is_seeding, seeding_cost, discount_amount, discount_code } = req.body;

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
      { items: items || [], total_price: total_price || 0, logistics_cost, source, shippingMethod, packaging_cost: packagingCost, note, is_replacement: is_replacement || false, is_seeding: is_seeding || false, seeding_cost: seeding_cost || 0, ordered_at, discount_amount: discount_amount || 0, discount_code: discount_code || null },
      { new: true, runValidators: true }
    );

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

    // Đọc chi phí hoàn từ cấu hình hệ thống
    const returnCostConfig = await SystemConfig.findOne({ key: 'return_cost_per_platform' });
    let returnCosts = {};
    if (returnCostConfig && returnCostConfig.value) {
      try {
        returnCosts = JSON.parse(returnCostConfig.value);
      } catch (e) {}
    }
    const orderSource = order.source || 'khác';
    const returnCost = returnCosts[orderSource] ? Number(returnCosts[orderSource]) : 0;

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
