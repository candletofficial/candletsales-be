const mongoose = require('mongoose');

const AffiliateFeeSchema = new mongoose.Schema({
  month: {
    type: Number,
    required: true,
    min: 1,
    max: 12
  },
  year: {
    type: Number,
    required: true
  },
  platform: {
    type: String,
    required: true,
    enum: ['shopee', 'tiktok']
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  }
}, { timestamps: true });

// Ensure uniqueness per platform per month
AffiliateFeeSchema.index({ month: 1, year: 1, platform: 1 }, { unique: true });

module.exports = mongoose.model('AffiliateFee', AffiliateFeeSchema);
