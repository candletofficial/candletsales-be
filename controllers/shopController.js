const Product = require('../models/Product');
const Review = require('../models/Review');
const Coupon = require('../models/Coupon');
const { enrichProductAvailability } = require('../utils/productAvailability');

// Lấy danh sách sản phẩm hiển thị trên trang chủ cửa hàng
exports.getShopProducts = async (req, res, next) => {
  try {
    const products = await Product.find()
      .populate('base_ingredients.ingredient_id')
      .populate('skus.extra_ingredients.ingredient_id')
      .sort({ createdAt: -1 });

    const reviewStats = await Review.aggregate([
      {
        $group: {
          _id: "$product",
          avgRating: { $avg: "$rating" },
          reviewCount: { $sum: 1 }
        }
      }
    ]);

    const statsMap = {};
    reviewStats.forEach(stat => {
      statsMap[stat._id.toString()] = stat;
    });

    const result = products.map((p) => {
      const obj = enrichProductAvailability(p);
      delete obj.base_ingredients;
      for (const sku of obj.skus || []) delete sku.extra_ingredients;
      const stats = statsMap[obj._id.toString()];
      obj.avgRating = stats && stats.avgRating ? stats.avgRating.toFixed(1) : "5.0";
      obj.reviewCount = stats ? stats.reviewCount : 0;
      return obj;
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

// Lấy chi tiết sản phẩm
exports.getShopProductById = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('base_ingredients.ingredient_id')
      .populate('skus.extra_ingredients.ingredient_id');
    if (!product) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm' });
    }

    // Lấy thống kê đánh giá
    const reviewStats = await Review.aggregate([
      { $match: { product: product._id } },
      {
        $group: {
          _id: '$product',
          avgRating: { $avg: '$rating' },
          reviewCount: { $sum: 1 }
        }
      }
    ]);

    const obj = enrichProductAvailability(product);
    obj.base_ingredients = (obj.base_ingredients || []).map((item) => ({
      quantity: item.quantity,
      ingredient_id: item.ingredient_id ? {
        _id: item.ingredient_id._id, name: item.ingredient_id.name, category: item.ingredient_id.category,
        unit: item.ingredient_id.unit, supplier: item.ingredient_id.supplier,
      } : null,
    }));
    for (const sku of obj.skus || []) delete sku.extra_ingredients;
    if (reviewStats.length > 0) {
      obj.avgRating = reviewStats[0].avgRating.toFixed(1);
      obj.reviewCount = reviewStats[0].reviewCount;
    } else {
      obj.avgRating = '5.0';
      obj.reviewCount = 0;
    }

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.status(200).json({ success: true, data: obj });
  } catch (error) {
    next(error);
  }
};

// Lấy danh sách phiếu ưu đãi đang hoạt động
exports.getActiveCoupons = async (req, res, next) => {
  try {
    const now = new Date();
    const coupons = await Coupon.find({
      is_active: true,
      is_public: { $ne: false },
      start_date: { $lte: now },
      end_date: { $gt: now }
    }).sort({ createdAt: -1 });

    // Filter out coupons that have reached their quantity limit
    const activeCoupons = coupons.filter(c => c.used_count < c.quantity);

    // Filter by user eligibility
    const Order = require('../models/Order');
    const validatedCoupons = [];
    
    for (const coupon of activeCoupons) {
      let is_eligible = true;
      let eligibility_error = null;
      
      // Xác định nhãn điều kiện đặc biệt
      let special_condition = null;
      if (coupon.customer_condition === 'returning') {
        special_condition = 'Dành cho khách hàng thân thiết';
      } else if (coupon.customer_condition === 'first_time') {
        special_condition = 'Dành cho khách mua lần đầu';
      } else if (coupon.usage_limit_per_user === 'once') {
        special_condition = 'Mỗi tài khoản dùng 1 lần';
      } else if (coupon.applicable_products === 'specific') {
        special_condition = 'Sản phẩm chỉ định';
      } else if (coupon.is_website_only) {
        special_condition = 'Độc quyền Website';
      }

      if (coupon.is_website_only) {
        if (coupon.usage_limit_per_user === 'once' || coupon.customer_condition !== 'all') {
          if (!req.query.user_id) {
            is_eligible = false;
            // Hiển thị điều kiện đặc biệt của mã thay vì thông báo "Yêu cầu đăng nhập"
            eligibility_error = special_condition || 'Điều kiện đặc biệt Website';
          } else {
            const user_id = req.query.user_id;
            
            if (coupon.usage_limit_per_user === 'once' && is_eligible) {
              const usedOrder = await Order.findOne({ user_id: user_id, discount_code: coupon.code, status: { $ne: 'cancelled' } });
              if (usedOrder) {
                is_eligible = false;
                eligibility_error = 'Đã sử dụng (Mỗi tài khoản 1 lần)';
              }
            }
            
            if (coupon.customer_condition === 'first_time' && is_eligible) {
              const pastOrder = await Order.findOne({ user_id: user_id, status: 'completed' });
              if (pastOrder) {
                is_eligible = false;
                eligibility_error = 'Chỉ dành cho khách mua lần đầu';
              }
            }
            
            if (coupon.customer_condition === 'returning' && is_eligible) {
              const pastOrder = await Order.findOne({ user_id: user_id, status: 'completed' });
              if (!pastOrder) {
                is_eligible = false;
                eligibility_error = 'Chỉ dành cho khách hàng thân thiết';
              }
            }
          }
        }
      }
      
      const cObj = coupon.toObject();
      cObj.is_eligible = is_eligible;
      cObj.eligibility_error = eligibility_error;
      cObj.special_condition = special_condition;
      validatedCoupons.push(cObj);
    }

    res.status(200).json({ success: true, data: validatedCoupons });
  } catch (error) {
    next(error);
  }
};

// Kiểm tra mã giảm giá (dành cho website khi người dùng tự nhập mã)
exports.validateCoupon = async (req, res, next) => {
  try {
    const { code, user_id } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập mã giảm giá' });
    }

    const coupon = await Coupon.findOne({ code: code.toUpperCase(), is_active: true });
    if (!coupon) {
      return res.status(400).json({ success: false, message: 'Mã giảm giá không tồn tại hoặc đã bị vô hiệu' });
    }

    const now = new Date();
    if (now < new Date(coupon.start_date) || now > new Date(coupon.end_date)) {
      return res.status(400).json({ success: false, message: 'Mã giảm giá không trong thời gian hiệu lực' });
    }

    if (coupon.used_count >= coupon.quantity) {
      return res.status(400).json({ success: false, message: 'Mã giảm giá đã hết lượt sử dụng' });
    }

    if (coupon.is_website_only) {
      if (coupon.usage_limit_per_user === 'once' || coupon.customer_condition !== 'all') {
        if (!user_id) {
          return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập để sử dụng mã giảm giá này' });
        }
        
        const Order = require('../models/Order');
        
        if (coupon.usage_limit_per_user === 'once') {
          const usedOrder = await Order.findOne({ user_id: user_id, discount_code: coupon.code, status: { $ne: 'cancelled' } });
          if (usedOrder) {
            return res.status(400).json({ success: false, message: 'Tài khoản của bạn đã sử dụng mã giảm giá này' });
          }
        }
        
        if (coupon.customer_condition === 'first_time') {
          const pastOrder = await Order.findOne({ user_id: user_id, status: 'completed' });
          if (pastOrder) {
            return res.status(400).json({ success: false, message: 'Mã giảm giá này chỉ dành cho tài khoản mua lần đầu' });
          }
        }
        
        if (coupon.customer_condition === 'returning') {
          const pastOrder = await Order.findOne({ user_id: user_id, status: 'completed' });
          if (!pastOrder) {
            return res.status(400).json({ success: false, message: 'Mã giảm giá này chỉ dành cho tài khoản đã từng mua hàng' });
          }
        }
      }
    }

    res.status(200).json({ success: true, data: coupon });
  } catch (error) {
    next(error);
  }
};
