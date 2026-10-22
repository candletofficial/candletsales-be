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
  // Per-unit recipe for this order item only; undefined uses the product recipe.
  material_overrides: {
    type: [{
      ingredient_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
      quantity: { type: Number, required: true, min: 0 },
      name: String,
      unit: String,
      unit_cost: { type: Number, min: 0 },
      _id: false,
    }],
    default: undefined,
  },
  materials_key: { type: String },
  quantity: { type: Number, required: true, min: 1 }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    required: true,
    unique: true,
  },
  pancake_order_id: { type: String, default: null }, // To prevent duplicates
  tracking_enabled: { type: Boolean, default: false },
  tracking_token: { type: String, unique: true, sparse: true, select: false },
  pancake_details: {
    type: new mongoose.Schema({
      customer_id: String, name: String, username: String,
      phones: { type: [String], default: undefined },
      emails: { type: [String], default: undefined },
      recipient_name: String, recipient_phone: String, recipient_email: String,
      address: String, street: String, commune: String, district: String, province: String, postcode: String,
      source_name: String, page_name: String, carrier: String,
      tracking_url: String, conversation_url: String, order_url: String, delivery_note: String,
      order_count: Number, succeed_order_count: Number, returned_order_count: Number,
      purchased_amount: Number, reward_point: Number, is_block: Boolean, synced_at: Date,
    }, { _id: false }),
    default: undefined,
  },
  items: {
    type: [orderItemSchema],
    default: [],
  },
  total_price: { type: Number, required: true, min: 0 }, // admin có thể chỉnh tay
  logistics_cost: { type: Number, default: 0 },
  // Missing on legacy admin orders whose total_price included logistics_cost.
  // Normalized orders keep shop-paid shipping outside the customer total.
  total_excludes_logistics: { type: Boolean, default: undefined },
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
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  payment_method: {
    type: String,
    enum: ['cash', 'transfer'],
    default: 'cash'
  },
  // Thanh toán và giao hàng là hai trạng thái độc lập. Đơn chuyển khoản chỉ
  // được đánh dấu paid sau khi webhook SePay đã xác thực giao dịch thật.
  payment_status: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending'
  },
  payment_code: { type: String, unique: true, sparse: true },
  payment_transaction_id: { type: String, default: null },
  paid_at: { type: Date, default: null },
  // Chỉ được xác nhận sau khi shop đã thực sự chuyển hoàn tiền cho khách.
  refund_transaction_id: { type: String, default: null },
  refunded_at: { type: Date, default: null },
  shippingMethod: {
    type: String,
    enum: ['standard', 'express'],
    default: 'standard'
  },
  shipping_fee: { type: Number, default: 0 },
  packaging_cost: { type: Number, default: 0 },
  note: { type: String, default: '' },
  discount_amount: { type: Number, default: 0 }, // Số tiền được giảm
  discount_code: { type: String, default: null }, // Mã coupon đã dùng
  is_replacement: { type: Boolean, default: false },
  is_seeding: { type: Boolean, default: false },
  seeding_cost: { type: Number, default: 0 },
  ordered_at: { type: Date, default: Date.now },
  // Trạng thái đơn hàng tổng quát
  status: {
    type: String,
    enum: ['pending', 'completed', 'returned', 'cancelled'],
    default: 'completed',
  },
  // Trạng thái giao hàng (Đặc biệt dành cho đơn Website)
  delivery_status: {
    type: String,
    enum: ['pending', 'confirmed', 'shipping', 'delivered', 'failed', 'cancelled'],
    default: 'pending',
  },
  cancelled_reason: { type: String, default: '' },
  cancelled_at: { type: Date, default: null },
  return_cost: { type: Number, default: 0 },   // Chi phí hoàn (lấy từ cấu hình khi đánh dấu hoàn)
  returned_at: { type: Date, default: null },   // Thời điểm đánh dấu hoàn
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
