const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  image_url: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true, maxlength: 1000 },
  trigger_keywords: { type: [String], default: [] },
  usage_notes: { type: String, default: '', trim: true, maxlength: 1000 },
  linked_products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  enabled: { type: Boolean, default: true, index: true },
  priority: { type: Number, default: 0, min: -100, max: 100 },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

module.exports = mongoose.model('MessengerBotMedia', schema);
