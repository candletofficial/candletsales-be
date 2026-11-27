const Material = require('../models/Material');
const Product = require('../models/Product');

const normalizeOilColor = (value) => {
  const color = String(value || '').trim().toLowerCase();
  const legacy = ['lavender', 'rose', 'amber', 'forest', 'ocean', 'citrus', 'wood'];
  return /^#[0-9a-f]{6}$/.test(color) || legacy.includes(color) ? color : '';
};

// Lấy danh sách nguyên vật liệu
exports.getMaterials = async (req, res, next) => {
  try {
    const materials = await Material.find().sort({ createdAt: -1 });

    // Tính lại status động dựa trên actualStock và minStock (không dùng giá trị lưu trong DB)
    const result = materials.map((m) => {
      const obj = m.toObject();
      if (obj.isTrackingEnabled === false) {
        obj.status = 'untracked';
        return obj;
      }
      const actual = Number(obj.actualStock);
      const min = Number(obj.minStock);
      if (actual === 0) obj.status = 'out_of_stock';
      else if (actual <= min) obj.status = 'low_stock';
      else obj.status = 'in_stock';
      return obj;
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

// Custom products are calculation templates. They must not participate in the
// lifecycle of a live product formula (suspend, replace, resume or delete
// protection). Their materials become operational only after the custom group
// is added to an actual order.
const materialUsageFilter = materialId => ({
  product_type: { $ne: 'custom' },
  $or: [
    { 'base_ingredients.ingredient_id': materialId },
    { 'resolved_base_ingredients.ingredient_id': materialId },
    { 'skus.extra_ingredients.ingredient_id': materialId },
    { 'base_ingredients.replacement_for': materialId },
    { 'resolved_base_ingredients.replacement_for': materialId },
    { 'skus.extra_ingredients.replacement_for': materialId },
  ],
});

const ingredientId = entry => String(entry?.ingredient_id?._id || entry?.ingredient_id || '');

const setIngredientSuspended = (entries = [], materialId, suspended) => entries.map(entry => (
  ingredientId(entry) === String(materialId) ? { ...entry, suspended } : entry
));

const replacementForId = entry => String(entry?.replacement_for?._id || entry?.replacement_for || '');

const replaceIngredient = (entries = [], oldId, newId) => entries.map(entry => (
  ingredientId(entry) === String(oldId)
    ? { ...entry, ingredient_id: newId, suspended: false, replacement_for: oldId }
    : entry
));

const restoreIngredient = (entries = [], materialId) => entries.map(entry => {
  if (replacementForId(entry) === String(materialId)) {
    return { ...entry, ingredient_id: materialId, suspended: false, replacement_for: null };
  }
  return ingredientId(entry) === String(materialId) ? { ...entry, suspended: false } : entry;
});

exports.__trackingHelpers = { materialUsageFilter, replaceIngredient, restoreIngredient };

const updateProductMaterialReferences = async (materialId, action, replacementId = null) => {
  const products = await Product.find(materialUsageFilter(materialId));
  for (const product of products) {
    const value = product.toObject();
    const change = action === 'replace'
      ? entries => replaceIngredient(entries, materialId, replacementId)
      : action === 'resume'
        ? entries => restoreIngredient(entries, materialId)
        : entries => setIngredientSuspended(entries, materialId, true);
    product.set('base_ingredients', change(value.base_ingredients));
    product.set('resolved_base_ingredients', change(value.resolved_base_ingredients));
    product.set('skus', (value.skus || []).map(sku => ({
      ...sku,
      extra_ingredients: change(sku.extra_ingredients),
    })));
    await product.save();
  }
  return products.length;
};

exports.getMaterialUsage = async (req, res, next) => {
  try {
    const material = await Material.findById(req.params.id).lean();
    if (!material) return res.status(404).json({ success: false, message: 'Không tìm thấy nguyên vật liệu' });
    const [products, replacements] = await Promise.all([
      Product.find(materialUsageFilter(req.params.id)).select('_id productId name product_type').lean(),
      Material.find({ _id: { $ne: req.params.id }, isTrackingEnabled: { $ne: false } })
        .select('_id name sku unit category').sort({ name: 1 }).lean(),
    ]);
    res.json({ success: true, data: { material, products, replacements } });
  } catch (error) {
    next(error);
  }
};

exports.setMaterialTracking = async (req, res, next) => {
  try {
    const material = await Material.findById(req.params.id);
    if (!material) return res.status(404).json({ success: false, message: 'Không tìm thấy nguyên vật liệu' });

    const enabled = req.body.enabled === true || req.body.enabled === 'true';
    if (enabled) {
      const affectedProducts = await updateProductMaterialReferences(material._id, 'resume');
      material.isTrackingEnabled = true;
      material.formulaSuspended = false;
      await material.save();
      return res.json({ success: true, data: material, affectedProducts });
    }

    const usageCount = await Product.countDocuments(materialUsageFilter(material._id));
    const action = req.body.formulaAction;
    if (usageCount > 0 && !['suspend', 'replace'].includes(action)) {
      return res.status(409).json({
        success: false,
        code: 'MATERIAL_IN_FORMULAS',
        message: 'Nguyên vật liệu đang được dùng trong công thức. Hãy chọn đình chỉ hoặc thay thế.',
        usageCount,
      });
    }

    let replacement = null;
    if (action === 'replace') {
      if (!req.body.replacementMaterialId || String(req.body.replacementMaterialId) === String(material._id)) {
        return res.status(400).json({ success: false, message: 'Vui lòng chọn nguyên vật liệu thay thế hợp lệ' });
      }
      replacement = await Material.findOne({ _id: req.body.replacementMaterialId, isTrackingEnabled: { $ne: false } });
      if (!replacement) {
        return res.status(400).json({ success: false, message: 'Nguyên vật liệu thay thế không tồn tại hoặc đã tạm ngừng theo dõi' });
      }
    }

    const affectedProducts = usageCount > 0
      ? await updateProductMaterialReferences(material._id, action, replacement?._id)
      : 0;
    material.isTrackingEnabled = false;
    material.formulaSuspended = action === 'suspend' && usageCount > 0;
    await material.save();
    res.json({ success: true, data: material, affectedProducts, replacement });
  } catch (error) {
    next(error);
  }
};

// Helper tính trạng thái: chỉ dùng actualStock so sánh với minStock
const calculateStatus = (actualStock, minStock) => {
  const actual = Number(actualStock);
  const min = Number(minStock);
  if (actual === 0) return 'out_of_stock';
  if (actual <= min) return 'low_stock';
  return 'in_stock';
};

// Tạo nguyên vật liệu mới
exports.createMaterial = async (req, res, next) => {
  try {
    const payload = { ...req.body };
    delete payload.isTrackingEnabled;
    delete payload.formulaSuspended;
    payload.isConcentratedOil = payload.isConcentratedOil === true || payload.isConcentratedOil === 'true';
    payload.oilColor = normalizeOilColor(payload.oilColor);
    // Tự động tạo SKU nếu frontend không gửi
    if (!payload.sku) {
      payload.sku = `NL-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 10)}`;
    }
    
    // Tính toán trạng thái dựa vào actualStock (mặc định bằng stock khi tạo mới)
    const actualStock = payload.actualStock !== undefined && payload.actualStock !== null
      ? payload.actualStock
      : payload.stock;
    payload.actualStock = actualStock;
    payload.status = calculateStatus(actualStock, payload.minStock || 10);

    const material = await Material.create(payload);
    res.status(201).json({ success: true, data: material });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Mã SKU đã tồn tại' });
    }
    next(error);
  }
};

// Cập nhật nguyên vật liệu
exports.updateMaterial = async (req, res, next) => {
  try {
    const payload = { ...req.body };
    delete payload.isTrackingEnabled;
    delete payload.formulaSuspended;
    const currentMaterial = await Material.findById(req.params.id);
    if (!currentMaterial) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nguyên vật liệu' });
    }

    if (payload.isConcentratedOil !== undefined) {
      payload.isConcentratedOil = payload.isConcentratedOil === true || payload.isConcentratedOil === 'true';
    }
    if (payload.oilColor !== undefined) payload.oilColor = normalizeOilColor(payload.oilColor);

    if (payload.sku !== undefined) {
      payload.sku = String(payload.sku).trim();
      if (payload.sku === currentMaterial.sku) {
        delete payload.sku;
      } else {
        const duplicatedSku = await Material.exists({ sku: payload.sku, _id: { $ne: currentMaterial._id } });
        if (duplicatedSku) {
          return res.status(400).json({ success: false, message: 'Mã SKU đã được dùng cho nguyên vật liệu khác' });
        }
      }
    }
    
    // Nếu có cập nhật số lượng, actualStock hoặc minStock, cần tính lại trạng thái
    if (payload.stock !== undefined || payload.actualStock !== undefined || payload.minStock !== undefined) {
      // Nếu frontend gửi lên một stock mới, cập nhật actualStock bằng đúng với stock đó
      let updatedActualStock = currentMaterial.actualStock;
      if (payload.stock !== undefined && payload.stock !== currentMaterial.stock) {
        updatedActualStock = payload.stock;
        // Ghi đè lại vào payload để lưu xuống DB
        payload.actualStock = updatedActualStock;
      } else if (payload.actualStock !== undefined) {
        updatedActualStock = payload.actualStock;
      }
      
      const newMinStock = payload.minStock !== undefined ? payload.minStock : currentMaterial.minStock;

      // Chỉ dùng actualStock để tính trạng thái
      payload.status = calculateStatus(updatedActualStock, newMinStock);
    }

    const material = await Material.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
    if (!material) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nguyên vật liệu' });
    }
    res.status(200).json({ success: true, data: material });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Mã SKU đã được dùng cho nguyên vật liệu khác' });
    }
    next(error);
  }
};

// Xóa nguyên vật liệu
exports.deleteMaterial = async (req, res, next) => {
  try {
    const materialId = req.params.id;

    // Kiểm tra xem nguyên liệu có đang được sử dụng trong công thức sản phẩm nào không
    const usedInProductsCount = await Product.countDocuments(materialUsageFilter(materialId));

    if (usedInProductsCount > 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Không thể xoá nguyên vật liệu đang được cấu hình trong công thức của sản phẩm.' 
      });
    }

    const material = await Material.findByIdAndDelete(materialId);
    if (!material) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nguyên vật liệu' });
    }
    res.status(200).json({ success: true, message: 'Đã xóa nguyên vật liệu' });
  } catch (error) {
    next(error);
  }
};

// Xóa một phân loại khỏi tất cả nguyên vật liệu
exports.deleteCategory = async (req, res, next) => {
  try {
    const categoryName = req.params.categoryName;
    if (!categoryName) {
      return res.status(400).json({ success: false, message: 'Thiếu tên phân loại' });
    }
    
    // Cập nhật tất cả nguyên vật liệu có categoryName này thành rỗng
    const result = await Material.updateMany(
      { category: categoryName },
      { $unset: { category: 1 } }
    );
    
    res.status(200).json({ success: true, message: 'Đã xóa phân loại', modifiedCount: result.modifiedCount });
  } catch (error) {
    next(error);
  }
};
