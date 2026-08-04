const Material = require('../models/Material');
const Product = require('../models/Product');

// Lấy danh sách nguyên vật liệu
exports.getMaterials = async (req, res, next) => {
  try {
    const materials = await Material.find().sort({ createdAt: -1 });

    // Tính lại status động dựa trên actualStock và minStock (không dùng giá trị lưu trong DB)
    const result = materials.map((m) => {
      const obj = m.toObject();
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
    
    // Nếu có cập nhật số lượng, actualStock hoặc minStock, cần tính lại trạng thái
    if (payload.stock !== undefined || payload.actualStock !== undefined || payload.minStock !== undefined) {
      const currentMaterial = await Material.findById(req.params.id);
      if (!currentMaterial) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy nguyên vật liệu' });
      }
      
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
    next(error);
  }
};

// Xóa nguyên vật liệu
exports.deleteMaterial = async (req, res, next) => {
  try {
    const materialId = req.params.id;

    // Kiểm tra xem nguyên liệu có đang được sử dụng trong công thức sản phẩm nào không
    const usedInProductsCount = await Product.countDocuments({
      $or: [
        { 'base_ingredients.ingredient_id': materialId },
        { 'skus.extra_ingredients.ingredient_id': materialId }
      ]
    });

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
