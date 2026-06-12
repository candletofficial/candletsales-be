const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: { 
    type: String, 
    required: [true, 'Mã giảm giá là bắt buộc'], 
    unique: true, 
    uppercase: true,
    trim: true
  },
  name: { 
    type: String, 
    required: [true, 'Tên ưu đãi là bắt buộc'],
    trim: true
  },
  type: { 
    type: String, 
    enum: ['percent', 'fixed'], 
    required: true 
  },
  value: { 
    type: Number, 
    required: [true, 'Giá trị giảm là bắt buộc'],
    min: [0, 'Giá trị giảm không được âm']
  },
  max_discount: { 
    type: Number,
    default: null
  },
  quantity: { 
    type: Number, 
    required: [true, 'Số lượng là bắt buộc'],
    min: [1, 'Số lượng tối thiểu là 1']
  },
  used_count: { 
    type: Number, 
    default: 0 
  },
  start_date: { 
    type: Date, 
    required: [true, 'Ngày bắt đầu là bắt buộc'] 
  },
  end_date: { 
    type: Date, 
    required: [true, 'Ngày kết thúc là bắt buộc'] 
  },
  applicable_products: { 
    type: String, 
    enum: ['all', 'specific'], 
    default: 'all' 
  },
  product_ids: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Product' 
  }],
  is_active: { 
    type: Boolean, 
    default: true 
  }
}, { timestamps: true });

module.exports = mongoose.model('Coupon', couponSchema);
