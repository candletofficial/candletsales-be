const Product = require('../models/Product');
const { removeFileIfLocal } = require('./uploadController');
const { enrichProductAvailability } = require('../utils/productAvailability');

const materialId = value => String(value?._id || value || '');
const formulaId = value => String(value?.formula_id?._id || value?.formula_id || '');

const mergeIngredients = (entries = []) => {
  const totals = new Map();
  for (const entry of entries) {
    const id = materialId(entry?.ingredient_id);
    const quantity = Number(entry?.quantity);
    if (!id || !Number.isFinite(quantity) || quantity < 0) continue;
    totals.set(id, Number(((totals.get(id) || 0) + quantity).toFixed(4)));
  }
  return [...totals].filter(([, quantity]) => quantity > 0)
    .map(([ingredient_id, quantity]) => ({ ingredient_id, quantity }));
};

const prepareProductPayload = async (input, existing = null) => {
  const payload = { ...(existing?.toObject?.() || existing || {}), ...input };
  delete payload._id;
  delete payload.__v;
  delete payload.createdAt;
  delete payload.updatedAt;
  delete payload.resolved_base_ingredients;

  payload.product_type = payload.product_type === 'sub_formula' ? 'sub_formula' : 'sellable';
  payload.base_ingredients = mergeIngredients(payload.base_ingredients);
  if (payload.product_type === 'sub_formula') {
    payload.batch_yield = Math.max(1, Math.trunc(Number(payload.batch_yield) || 1));
    payload.base_price = 0;
    payload.original_price = 0;
    payload.shop_order = null;
    payload.variant_groups = [];
    payload.skus = [];
    payload.formula_components = [];
    payload.resolved_base_ingredients = payload.base_ingredients;
    return payload;
  }

  payload.batch_yield = 1;

  const components = Array.isArray(payload.formula_components) ? payload.formula_components : [];
  const normalizedComponents = [];
  const seen = new Set();
  for (const component of components) {
    const id = formulaId(component);
    const quantity = Number(component?.quantity);
    if (!id || seen.has(id)) {
      const error = new Error('Công thức phụ không hợp lệ hoặc bị chọn trùng.');
      error.statusCode = 400;
      throw error;
    }
    if (existing && id === String(existing._id)) {
      const error = new Error('Sản phẩm không thể dùng chính nó làm công thức phụ.');
      error.statusCode = 400;
      throw error;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      const error = new Error('Số phần công thức phụ dùng cho mỗi sản phẩm phải lớn hơn 0.');
      error.statusCode = 400;
      throw error;
    }
    seen.add(id);
    normalizedComponents.push({ formula_id: id, quantity: Number(quantity.toFixed(4)) });
  }

  const formulas = normalizedComponents.length
    ? await Product.find({ _id: { $in: normalizedComponents.map(item => item.formula_id) }, product_type: 'sub_formula' }).lean()
    : [];
  if (formulas.length !== normalizedComponents.length) {
    const error = new Error('Có công thức phụ không tồn tại hoặc không đúng loại.');
    error.statusCode = 400;
    throw error;
  }
  const byId = new Map(formulas.map(formula => [String(formula._id), formula]));
  const expanded = [...payload.base_ingredients];
  for (const component of normalizedComponents) {
    const formula = byId.get(component.formula_id);
    const ingredients = formula.resolved_base_ingredients?.length
      ? formula.resolved_base_ingredients : formula.base_ingredients || [];
    const batchYield = Math.max(1, Number(formula.batch_yield) || 1);
    for (const ingredient of ingredients) {
      expanded.push({ ingredient_id: ingredient.ingredient_id, quantity: (Number(ingredient.quantity) * component.quantity) / batchYield });
    }
  }
  payload.formula_components = normalizedComponents;
  payload.resolved_base_ingredients = mergeIngredients(expanded);
  return payload;
};

const refreshDependentProducts = async formulaIdValue => {
  const dependents = await Product.find({ product_type: 'sellable', 'formula_components.formula_id': formulaIdValue });
  for (const product of dependents) {
    const payload = await prepareProductPayload(product.toObject(), product);
    await Product.updateOne({ _id: product._id }, { $set: { resolved_base_ingredients: payload.resolved_base_ingredients } });
  }
};

// Lấy danh sách sản phẩm và tự động tính toán BOM Cost
exports.getProducts = async (req, res, next) => {
  try {
    const filter = req.query.type === 'sellable' ? { product_type: { $ne: 'sub_formula' } }
      : req.query.type === 'sub_formula' ? { product_type: 'sub_formula' } : {};
    const products = await Product.find(filter)
      .populate('base_ingredients.ingredient_id')
      .populate('resolved_base_ingredients.ingredient_id')
      .populate({ path: 'formula_components.formula_id', select: 'productId name product_type batch_yield base_ingredients resolved_base_ingredients' })
      .populate('skus.extra_ingredients.ingredient_id')
      .sort({ createdAt: -1 });

    const result = products.map((p) => {
      const obj = p.toObject();

      // Tính base_cost
      let base_cost = 0;
      if (obj.resolved_base_ingredients?.length || obj.base_ingredients) {
        (obj.resolved_base_ingredients?.length ? obj.resolved_base_ingredients : obj.base_ingredients).forEach(item => {
          if (item.ingredient_id && item.ingredient_id.price) {
            base_cost += item.ingredient_id.price * item.quantity;
          }
        });
      }
      obj.base_cost = base_cost;

      // Tính cost cho từng SKU
      if (obj.skus) {
        obj.skus.forEach(sku => {
          let extra_cost = 0;
          if (sku.extra_ingredients) {
            sku.extra_ingredients.forEach(item => {
              if (item.ingredient_id && item.ingredient_id.price) {
                extra_cost += item.ingredient_id.price * item.quantity;
              }
            });
          }
          sku.cost = base_cost + extra_cost;
        });
      }

      return enrichProductAvailability(obj);
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

exports.createProduct = async (req, res, next) => {
  try {
    const payload = await prepareProductPayload(req.body);
    const product = await Product.create(payload);
    res.status(201).json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};

exports.updateShopOrder = async (req, res, next) => {
  try {
    const orderedProductIds = Array.isArray(req.body.orderedProductIds)
      ? req.body.orderedProductIds.map(String)
      : [];
    const uniqueIds = [...new Set(orderedProductIds)];

    if (!uniqueIds.length || uniqueIds.length !== orderedProductIds.length) {
      return res.status(400).json({ success: false, message: 'Danh sách sắp xếp sản phẩm không hợp lệ' });
    }

    const existingCount = await Product.countDocuments({ _id: { $in: uniqueIds }, product_type: { $ne: 'sub_formula' } });
    if (existingCount !== uniqueIds.length) {
      return res.status(400).json({ success: false, message: 'Có sản phẩm không còn tồn tại trong danh sách' });
    }

    await Product.bulkWrite(uniqueIds.map((id, index) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { shop_order: index + 1 } },
      },
    })));

    res.status(200).json({ success: true, message: 'Đã cập nhật thứ tự sản phẩm' });
  } catch (error) {
    next(error);
  }
};

exports.updateProduct = async (req, res, next) => {
  try {
    const existing = await Product.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm' });

    // Thu thập danh sách ảnh cũ trong database
    const oldImages = [existing.image, ...(existing.images || [])].filter(Boolean);

    // Thu thập danh sách ảnh mới được gửi lên
    const newImages = [req.body.image, ...(req.body.images || [])].filter(Boolean);

    // Tìm những ảnh cũ bị gỡ bỏ (không còn xuất hiện trong newImages)
    const removedImages = oldImages.filter((oldImg) => !newImages.includes(oldImg));

    // Xóa các file vật lý của những ảnh đã bị loại bỏ
    removedImages.forEach((img) => {
      removeFileIfLocal(img);
    });

    const payload = await prepareProductPayload(req.body, existing);
    const product = await Product.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
    if (product.product_type === 'sub_formula') await refreshDependentProducts(product._id);
    res.status(200).json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};

exports.deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (product?.product_type === 'sub_formula' && await Product.exists({ 'formula_components.formula_id': product._id })) {
      return res.status(400).json({ success: false, message: 'Công thức phụ đang được sản phẩm khác sử dụng nên chưa thể xoá.' });
    }
    if (!product) return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm' });

    // Xóa toàn bộ file ảnh vật lý của sản phẩm trên ổ cứng máy chủ
    const allImages = [product.image, ...(product.images || [])].filter(Boolean);
    allImages.forEach((img) => {
      removeFileIfLocal(img);
    });

    await Product.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Đã xóa sản phẩm và các file ảnh liên quan' });
  } catch (error) {
    next(error);
  }
};
