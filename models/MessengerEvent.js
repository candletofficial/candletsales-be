const mongoose = require('mongoose');

const messengerEventSchema = new mongoose.Schema({
  event_id: { type: String, required: true, unique: true },
  page_id: String,
  psid: String,
  status: { type: String, enum: ['processing', 'processed', 'failed', 'ignored'], default: 'processing' },
  attempts: { type: Number, default: 1 },
  error: { type: String, default: '' },
  processed_at: Date,
}, { timestamps: true });

messengerEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

module.exports = mongoose.model('MessengerEvent', messengerEventSchema);
