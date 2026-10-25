const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, unique: true },
  enabled: { type: Boolean, default: true },
  scent_notes: { type: [String], default: [] },
  intensity: { type: String, enum: ['', 'nhẹ', 'vừa', 'đậm'], default: '' },
  suitable_spaces: { type: [String], default: [] },
  occasions: { type: [String], default: [] },
  moods: { type: [String], default: [] },
  audiences: { type: [String], default: [] },
  burn_time: { type: String, default: '' },
  selling_points: { type: [String], default: [] },
  keywords: { type: [String], default: [] },
  advice_notes: { type: String, default: '' },
  updated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

module.exports = mongoose.model('MessengerProductProfile', schema);
