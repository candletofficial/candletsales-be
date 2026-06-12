const Coupon = require('../models/Coupon');

// @desc    Lấy danh sách mã giảm giá
// @route   GET /api/coupons
// @access  Private
exports.getCoupons = async (req, res) => {
  try {
    const coupons = await Coupon.find().populate('product_ids', 'name productId').sort({ createdAt: -1 });
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
    const { code, items, totalPrice } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Vui lòng nhập mã giảm giá' });
    if (totalPrice === undefined) return res.status(400).json({ success: false, message: 'Thiếu tổng tiền đơn hàng' });

    const coupon = await Coupon.findOne({ code: code.toUpperCase() });
    
    if (!coupon) {
      return res.status(404).json({ success: false, message: 'Mã giảm giá không tồn tại' });
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

    res.status(200).json({
      success: true,
      data: {
        discount_amount: discountAmount,
        coupon_id: coupon._id,
        code: coupon.code,
        name: coupon.name
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
