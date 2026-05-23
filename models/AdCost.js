const mongoose = require('mongoose');

const adCostSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  platform: {
    type: String,
    required: true,
    enum: ['facebook', 'tiktok', 'shopee', 'google', 'instagram', 'youtube'],
  },
  amount: { type: Number, required: true, min: 0 },
  note: { type: String, default: '' },
}, { timestamps: true });

// Index để query theo tháng nhanh
adCostSchema.index({ date: 1, platform: 1 });

module.exports = mongoose.model('AdCost', adCostSchema);
