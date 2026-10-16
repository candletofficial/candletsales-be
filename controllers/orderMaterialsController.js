const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Material = require('../models/Material');
const { itemMaterials, materialId, materialTotals, materialDifference, materialsRevision } = require('../utils/orderItemMaterials');

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

async function loadItem(req, session = null) {
  if (!mongoose.isValidObjectId(req.params.id)) fail('Mã đơn hàng không hợp lệ.');
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0) fail('Sản phẩm trong đơn không hợp lệ.');
  const order = await Order.findById(req.params.id).session(session);
  if (!order) fail('Không tìm thấy đơn hàng.', 404);
  const item = order.items[index];
  if (!item) fail('Không tìm thấy sản phẩm trong đơn.', 404);
  const product = item.product_id ? await Product.findById(item.product_id).session(session) : null;
  if (!product && !Array.isArray(item.material_overrides)) fail('Sản phẩm không còn công thức nguyên liệu để đối chiếu.');
  const entries = itemMaterials(item, product);
  return { order, item, entries, index };
}

exports.getItemMaterials = async (req, res, next) => {
  try {
    const { order, item, entries } = await loadItem(req);
    const totals = materialTotals(entries);
    const materials = await Material.find({ _id: { $in: [...totals.keys()] } });
    const byId = new Map(materials.map(material => [String(material._id), material]));
    res.json({ success: true, data: {
      revision: materialsRevision(order, item, entries),
      product_id: materialId(item.product_id), sku_id: item.sku_id, quantity: item.quantity,
      customized: Array.isArray(item.material_overrides),
      ingredients: [...totals].map(([id, quantity]) => {
        const material = byId.get(id);
        const saved = entries.find(entry => materialId(entry.ingredient_id) === id);
        return { ingredient_id: id, quantity, name: material?.name || saved?.name || 'Nguyên liệu đã bị xoá',
          unit: material?.unit || saved?.unit || '', price: material?.price ?? saved?.unit_cost ?? 0,
          actualStock: material?.actualStock ?? null, missing: !material };
      }),
    } });
  } catch (error) { next(error); }
};

exports.updateItemMaterials = async (req, res, next) => {
  let session;
  try {
    const ingredients = req.body.ingredients;
    if (!Array.isArray(ingredients) || !ingredients.length) fail('Cần ít nhất một nguyên liệu.');
    if (typeof req.body.revision !== 'string' || !req.body.revision) fail('Vui lòng tải lại nguyên liệu trước khi lưu.');
    const seen = new Set();
    const normalized = ingredients.map(entry => {
      const id = materialId(entry?.ingredient_id);
      const quantity = Number(entry?.quantity);
      if (!mongoose.isValidObjectId(id) || seen.has(id)) fail('Nguyên liệu không hợp lệ hoặc bị chọn trùng.');
      if (!Number.isFinite(quantity) || quantity <= 0 || Number(quantity.toFixed(4)) !== quantity) {
        fail('Lượng nguyên liệu phải lớn hơn 0, tối đa 4 chữ số thập phân.');
      }
      seen.add(id);
      return { ingredient_id: id, quantity };
    });

    session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
      const { order, item, entries, index } = await loadItem(req, session);
      if (['returned', 'cancelled'].includes(order.status) || ['failed', 'cancelled'].includes(order.delivery_status)) {
        fail('Không thể đổi nguyên liệu của đơn đã hoàn hoặc huỷ.');
      }
      if (materialsRevision(order, item, entries) !== req.body.revision) {
        fail('Đơn hàng hoặc công thức đã thay đổi. Vui lòng mở lại phần nguyên liệu.', 409);
      }
      const diff = materialDifference(entries, normalized, item.quantity);
      const ids = [...new Set([...materialTotals(entries).keys(), ...seen])];
      const materials = await Material.find({ _id: { $in: ids } }).session(session);
      const byId = new Map(materials.map(material => [String(material._id), material]));
      for (const id of ids) if (!byId.has(id)) fail('Có nguyên liệu đã bị xoá. Không thể cập nhật tồn kho.');
      for (const [id, amount] of diff) {
        const material = byId.get(id);
        if (amount > 0 && material.actualStock < amount) {
          fail(`Nguyên liệu "${material.name}" không đủ (cần thêm ${amount} ${material.unit}, còn ${material.actualStock}).`);
        }
      }
      // Sequential transactional writes: either both stock and recipe commit, or neither does.
      for (const [id, amount] of diff) {
        const material = byId.get(id);
        material.stock = Number((material.stock - amount).toFixed(4));
        material.actualStock = Number((material.actualStock - amount).toFixed(4));
        await material.save({ session });
      }
      item.material_overrides = normalized.map(entry => {
        const material = byId.get(entry.ingredient_id);
        return { ...entry, name: material.name, unit: material.unit, unit_cost: material.price };
      });
      item.unit_cost = item.material_overrides.reduce((sum, entry) => sum + entry.quantity * entry.unit_cost, 0);
      item.materials_key = item.materials_key || randomUUID();
      order.markModified('items');
      await order.save({ session });
      result = { item: order.items[index], order };
    });
    res.json({ success: true, message: 'Đã đổi nguyên liệu và cập nhật tồn kho.', data: result });
  } catch (error) { next(error); }
  finally { if (session) await session.endSession(); }
};
