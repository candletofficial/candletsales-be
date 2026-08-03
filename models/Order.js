const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  // Snapshot thông tin sản phẩm tại thời điểm đặt hàng
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  productId: { type: String },     // mã sản phẩm VD: SP-1234567
  product_name: { type: String, required: true },
  product_image: { type: String, default: null },
  sku_id: { type: String, default: null },         // null nếu là sản phẩm không có phân loại
  sku_label: { type: String, default: '' },        // VD: "Rosy Berry - Large"
  unit_price: { type: Number, required: true },    // giá bán tại thời điểm đặt
  unit_cost: { type: Number, default: 0 },          // giá vốn tại thời điểm đặt
  quantity: { type: Number, required: true, min: 1 },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    required: true,
    unique: true,
  },
  pancake_order_id: { type: String, default: null }, // To prevent duplicates
  items: {
    type: [orderItemSchema],
    default: [],
  },
  total_price: { type: Number, required: true, min: 0 }, // admin có thể chỉnh tay
  logistics_cost: { type: Number, default: 0 },
  source: { 
    type: String, 
    enum: ['pos', 'shopee', 'tiktok', 'instagram', 'facebook', 'youtube', 'website', 'khác'], 
    default: 'khác' 
  },
  pos_mode: {
    type: String,
    enum: ['online', 'offline'],
    default: 'offline'
  },
  customer_name: { type: String, default: '' },
  customer_phone: { type: String, default: '' },
  customer_address: { type: String, default: '' },
  payment_method: {
    type: String,
    enum: ['cash', 'transfer'],
    default: 'cash'
  },
  shippingMethod: {
    type: String,
    enum: ['standard', 'express'],
    default: 'standard'
  },
  packaging_cost: { type: Number, default: 0 },
  note: { type: String, default: '' },
  discount_amount: { type: Number, default: 0 }, // Số tiền được giảm
  discount_code: { type: String, default: null }, // Mã coupon đã dùng
  is_replacement: { type: Boolean, default: false },
  is_seeding: { type: Boolean, default: false },
  seeding_cost: { type: Number, default: 0 },
  ordered_at: { type: Date, default: Date.now },
  // Trạng thái đơn hàng
  status: {
    type: String,
    enum: ['pending', 'completed', 'returned'],
    default: 'completed',
  },
  return_cost: { type: Number, default: 0 },   // Chi phí hoàn (lấy từ cấu hình khi đánh dấu hoàn)
  returned_at: { type: Date, default: null },   // Thời điểm đánh dấu hoàn
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
