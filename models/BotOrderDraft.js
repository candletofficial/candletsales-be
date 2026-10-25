const mongoose = require('mongoose');

const botOrderDraftSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'MessengerConversation', required: true, index: true },
  page_id: { type: String, required: true },
  psid: { type: String, required: true },
  source: { type: String, enum: ['facebook', 'instagram'], default: 'facebook' },
  customer_name: { type: String, required: true },
  customer_phone: { type: String, required: true },
  customer_address: { type: String, required: true },
  items: { type: [mongoose.Schema.Types.Mixed], default: [] },
  total_price: { type: Number, min: 0, required: true },
  note: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'approving', 'approved', 'rejected'], default: 'pending', index: true },
  order_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewed_at: Date,
}, { timestamps: true });

module.exports = mongoose.model('BotOrderDraft', botOrderDraftSchema);
