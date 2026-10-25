const Product = require('../models/Product');
const { removeFileIfLocal } = require('./uploadController');
const { enrichProductAvailability } = require('../utils/productAvailability');

// Lấy danh sách sản phẩm và tự động tính toán BOM Cost
exports.getProducts = async (req, res, next) => {
  try {
    const products = await Product.find()
      .populate('base_ingredients.ingredient_id')
      .populate('skus.extra_ingredients.ingredient_id')
      .sort({ createdAt: -1 });

    const result = products.map((p) => {
      const obj = p.toObject();

      // Tính base_cost
      let base_cost = 0;
      if (obj.base_ingredients) {
        obj.base_ingredients.forEach(item => {
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
    const product = await Product.create(req.body);
    res.status(201).json({ success: true, data: product });
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

    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    res.status(200).json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};

exports.deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
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
