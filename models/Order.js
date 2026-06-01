const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  // Snapshot thông tin sản phẩm tại thời điểm đặt hàng
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  productId: { type: String, required: true },     // mã sản phẩm VD: SP-1234567
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
  items: {
    type: [orderItemSchema],
    required: true,
    validate: [(arr) => arr.length > 0, 'Đơn hàng phải có ít nhất 1 sản phẩm'],
  },
  total_price: { type: Number, required: true, min: 0 }, // admin có thể chỉnh tay
  logistics_cost: { type: Number, default: 0 },
  source: { 
    type: String, 
    enum: ['shopee', 'tiktok', 'instagram', 'facebook', 'youtube', 'google', 'khác'], 
    default: 'khác' 
  },
  shippingMethod: {
    type: String,
    enum: ['standard', 'express'],
    default: 'standard'
  },
  packaging_cost: { type: Number, default: 0 },
  note: { type: String, default: '' },
  ordered_at: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
