const Order = require('../models/Order');
const Product = require('../models/Product');
const Material = require('../models/Material');

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
 * Trả về Map<ingredient_id_string, totalQuantity>
 */
const buildMaterialDeductions = async (items) => {
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

  return deductions;
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
    const { items, total_price, logistics_cost, source, note, ordered_at } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Đơn hàng phải có ít nhất 1 sản phẩm' });
    }

    // 1. Tính lượng nguyên liệu cần trừ & kiểm tra tồn kho
    const deductions = await buildMaterialDeductions(items);
    
    // Kiểm tra xem có nguyên liệu nào bị hết hàng (actualStock === 0) không
    for (const [materialId, deductQty] of deductions.entries()) {
      const mat = await Material.findById(materialId);
      if (mat && mat.actualStock === 0) {
        return res.status(400).json({ 
          success: false, 
          message: `Không thể tạo đơn hàng vì nguyên liệu "${mat.name}" đã hết (tồn kho thực tế = 0).` 
        });
      }
    }

    // 2. Tạo đơn hàng
    const orderId = generateOrderId();
    const order = await Order.create({
      orderId,
      items,
      total_price,
      logistics_cost: logistics_cost || 0,
      source: source || 'khác',
      note: note || '',
      ordered_at: ordered_at || new Date(),
    });

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

    res.status(201).json({ success: true, data: order, message: 'Đã tạo đơn hàng thành công' });
  } catch (error) {
    next(error);
  }
};

// PUT /api/orders/:id
exports.updateOrder = async (req, res, next) => {
  try {
    const { items, total_price, logistics_cost, source, note, ordered_at } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Đơn hàng phải có ít nhất 1 sản phẩm' });
    }

    const oldOrder = await Order.findById(req.params.id);
    if (!oldOrder) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
    }

    // 1. Tính toán lượng nguyên liệu cũ và mới
    const oldDeductions = await buildMaterialDeductions(oldOrder.items);
    const newDeductions = await buildMaterialDeductions(items);

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
        if (mat && mat.actualStock === 0) {
          return res.status(400).json({ 
            success: false, 
            message: `Không thể thêm sản phẩm vì nguyên liệu "${mat.name}" đã hết (tồn kho = 0).` 
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
      { items, total_price, logistics_cost, source, note, ordered_at },
      { new: true, runValidators: true }
    );

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

    // Hoàn lại số lượng nguyên liệu nếu có yêu cầu
    if (restoreStock === 'true') {
      try {
        const refunds = await buildMaterialDeductions(order.items);
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

    res.status(200).json({ success: true, message: 'Đã xóa đơn hàng' + (restoreStock === 'true' ? ' và hoàn lại nguyên liệu' : '') });
  } catch (error) {
    next(error);
  }
};
