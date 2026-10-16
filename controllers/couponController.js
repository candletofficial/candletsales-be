const Coupon = require('../models/Coupon');
const { freeshipDiscount } = require('../utils/freeshipDiscount');

const normalizeFreeship = (body) => {
  if (body.type === 'freeship') {
    body.is_website_only = true;
    if (!body.shipping_discount_type) {
      body.shipping_discount_type = 'percent';
      body.value = 100;
    }
    const value = Number(body.value);
    const minimum = Number(body.min_order_value ?? 0);
    const cap = body.max_discount === '' || body.max_discount == null ? null : Number(body.max_discount);
    if (!['percent', 'fixed'].includes(body.shipping_discount_type)
      || !Number.isFinite(value) || value <= 0
      || (body.shipping_discount_type === 'percent' && value > 100)
      || !Number.isFinite(minimum) || minimum < 0
      || (cap !== null && (!Number.isFinite(cap) || cap <= 0))) {
      throw new Error('Mã freeship cần mức giảm lớn hơn 0 (tối đa 100%), đơn tối thiểu không âm và mức giảm tối đa hợp lệ.');
    }
    body.value = value;
    body.min_order_value = minimum;
    body.max_discount = body.shipping_discount_type === 'percent' ? cap : null;
  }
};

// @desc    Lấy danh sách mã giảm giá
// @route   GET /api/coupons
// @access  Private
exports.getCoupons = async (req, res) => {
  try {
    // No source means the admin management list; it must retain every coupon.
    const source = req.query?.source;
    const filter = source && source !== 'website'
      ? { type: { $ne: 'freeship' }, is_website_only: { $ne: true } }
      : {};
    const coupons = await Coupon.find(filter).populate('product_ids', 'name productId').sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: coupons });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Lấy chi tiết mã giảm giá
// @route   GET /api/coupons/:id
// @access  Private
exports.getCouponById = async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id).populate('product_ids', 'name productId');
    if (!coupon) return res.status(404).json({ success: false, message: 'Không tìm thấy mã giảm giá' });
    res.status(200).json({ success: true, data: coupon });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Tạo mã giảm giá mới
// @route   POST /api/coupons
// @access  Private
exports.createCoupon = async (req, res) => {
  try {
    normalizeFreeship(req.body);
    req.body.code = req.body.code.toUpperCase();
    const existing = await Coupon.findOne({ code: req.body.code });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Mã giảm giá này đã tồn tại' });
    }

    const coupon = await Coupon.create(req.body);
    res.status(201).json({ success: true, data: coupon });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Cập nhật mã giảm giá
// @route   PUT /api/coupons/:id
// @access  Private
exports.updateCoupon = async (req, res) => {
  try {
    const current = await Coupon.findById(req.params.id);
    if (!current) return res.status(404).json({ success: false, message: 'Không tìm thấy mã giảm giá' });
    if ((req.body.type || current.type) === 'freeship') {
      req.body = { ...current.toObject(), ...req.body };
      delete req.body._id;
      delete req.body.__v;
    }
    normalizeFreeship(req.body);
    if (req.body.code) {
      req.body.code = req.body.code.toUpperCase();
      const existing = await Coupon.findOne({ code: req.body.code, _id: { $ne: req.params.id } });
      if (existing) {
        return res.status(400).json({ success: false, message: 'Mã giảm giá này đã tồn tại' });
      }
    }
    
    const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!coupon) return res.status(404).json({ success: false, message: 'Không tìm thấy mã giảm giá' });
    res.status(200).json({ success: true, data: coupon });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Xóa mã giảm giá
// @route   DELETE /api/coupons/:id
// @access  Private
exports.deleteCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    if (!coupon) return res.status(404).json({ success: false, message: 'Không tìm thấy mã giảm giá' });
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Kiểm tra và tính toán giảm giá
// @route   POST /api/coupons/validate
// @access  Private
exports.validateCoupon = async (req, res) => {
  try {
    const { code, items, totalPrice, shippingFee = 0, source = 'pos' } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Vui lòng nhập mã giảm giá' });
    if (totalPrice === undefined) return res.status(400).json({ success: false, message: 'Thiếu tổng tiền đơn hàng' });

    const coupon = await Coupon.findOne({ code: code.toUpperCase() });
    
    if (!coupon) {
      return res.status(404).json({ success: false, message: 'Mã giảm giá không tồn tại' });
    }
    if (source !== 'website' && (coupon.type === 'freeship' || coupon.is_website_only)) {
      return res.status(400).json({ success: false, message: 'Mã này chỉ dành cho Website, không áp dụng tại POS hoặc kênh khác.' });
    }
    if (!coupon.is_active) {
      return res.status(400).json({ success: false, message: 'Mã giảm giá đã bị vô hiệu hóa' });
    }
    if (coupon.used_count >= coupon.quantity) {
      return res.status(400).json({ success: false, message: 'Mã giảm giá đã hết lượt sử dụng' });
    }

    const now = new Date();
    if (now < new Date(coupon.start_date)) {
      return res.status(400).json({ success: false, message: 'Mã giảm giá chưa đến thời gian áp dụng' });
    }
    if (now > new Date(coupon.end_date)) {
      return res.status(400).json({ success: false, message: 'Mã giảm giá đã hết hạn' });
    }

    // Tính toán giá trị eligible
    let eligibleAmount = 0;
    
    if (coupon.applicable_products === 'all') {
      eligibleAmount = totalPrice;
    } else {
      // Chỉ áp dụng cho các sản phẩm cụ thể
      if (!items || items.length === 0) {
        return res.status(400).json({ success: false, message: 'Giỏ hàng trống' });
      }
      
      const applicableIds = coupon.product_ids.map(id => id.toString());
      
      // Tính tổng giá trị các sản phẩm hợp lệ trong giỏ hàng (theo đơn giá * số lượng của từng item)
      // Lưu ý: Sản phẩm hợp lệ được tính bằng unit_price * quantity
      let validItemsTotal = 0;
      let hasValidItem = false;
      
      items.forEach(item => {
        if (applicableIds.includes(item.product_id.toString())) {
          hasValidItem = true;
          // Lấy giá trị của item này
          validItemsTotal += (item.unit_price * item.quantity);
        }
      });
      
      if (!hasValidItem) {
        return res.status(400).json({ success: false, message: 'Mã giảm giá không áp dụng cho sản phẩm trong đơn này' });
      }
      
      eligibleAmount = validItemsTotal;
      // Trong trường hợp tổng tiền thủ công bé hơn giá trị sản phẩm tính tự động, không để eligible vượt quá tổng tiền thủ công.
      if (eligibleAmount > totalPrice) {
        eligibleAmount = totalPrice;
      }
    }

    // Bắt đầu tính số tiền được giảm
    let discountAmount = 0;
    if (coupon.type === 'fixed') {
      discountAmount = coupon.value;
    } else if (coupon.type === 'percent') {
      discountAmount = (eligibleAmount * coupon.value) / 100;
      if (coupon.max_discount && discountAmount > coupon.max_discount) {
        discountAmount = coupon.max_discount;
      }
    }

    // Không thể giảm quá số tiền được áp dụng (eligibleAmount)
    if (discountAmount > eligibleAmount) {
      discountAmount = eligibleAmount;
    }
    
    // Và chắn chắn không giảm quá tổng giá trị đơn hàng
    if (discountAmount > totalPrice) {
      discountAmount = totalPrice;
    }

    if (coupon.type === 'freeship') {
      discountAmount = freeshipDiscount(coupon, items, shippingFee);
    }

    res.status(200).json({
      success: true,
      data: {
        type: coupon.type,
        discount_amount: discountAmount,
        coupon_id: coupon._id,
        code: coupon.code,
        name: coupon.name
      }
    });

  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};
