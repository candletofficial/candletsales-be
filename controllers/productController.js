const Product = require('../models/Product');

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

      return obj;
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
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!product) return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm' });
    res.status(200).json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};

exports.deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm' });
    res.status(200).json({ success: true, message: 'Đã xóa sản phẩm' });
  } catch (error) {
    next(error);
  }
};
