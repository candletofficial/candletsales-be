const mongoose = require('mongoose');

const shippingConfigSchema = new mongoose.Schema({
  method: {
    type: String,
    required: true,
    enum: ['standard', 'express'],
    unique: true
  },
  materials: [{
    material_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Material',
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 0
    }
  }]
}, { timestamps: true });

module.exports = mongoose.model('ShippingConfig', shippingConfigSchema);
