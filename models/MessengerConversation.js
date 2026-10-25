const mongoose = require('mongoose');

const historySchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  text: { type: String, required: true },
  at: { type: Date, default: Date.now },
}, { _id: false });

const cartItemSchema = new mongoose.Schema({
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  productId: String,
  product_name: String,
  product_image: String,
  sku_id: { type: String, default: null },
  sku_label: { type: String, default: '' },
  customer_label: { type: String, default: '' },
  unit_price: { type: Number, min: 0, required: true },
  quantity: { type: Number, min: 1, required: true },
}, { _id: false });

const messengerConversationSchema = new mongoose.Schema({
  page_id: { type: String, required: true, index: true },
  psid: { type: String, required: true },
  mode: { type: String, enum: ['bot', 'human', 'paused'], default: 'bot' },
  stage: { type: String, enum: ['consulting', 'collecting', 'confirming', 'draft_ready', 'handoff'], default: 'consulting' },
  customer: {
    name: { type: String, default: '' },
    phone: { type: String, default: '' },
    address: { type: String, default: '' },
  },
  cart: { type: [cartItemSchema], default: [] },
  shown_product_ids: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  shown_media_ids: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  referral: {
    ad_id: String,
    ref: String,
    source: String,
    type: String,
  },
  history: { type: [historySchema], default: [] },
  handoff_reason: { type: String, default: '' },
  context_started_at: { type: Date, default: null },
  last_activity_at: { type: Date, default: Date.now },
}, { timestamps: true });

messengerConversationSchema.index({ page_id: 1, psid: 1 }, { unique: true });

module.exports = mongoose.model('MessengerConversation', messengerConversationSchema);
