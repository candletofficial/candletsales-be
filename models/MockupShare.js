const mongoose = require('mongoose');

const mockupShareSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true, index: true },
  label_url: { type: String, required: true, trim: true },
  label_file_name: { type: String, trim: true, default: 'Tem custom' },
  finish: { type: String, enum: ['frosted', 'clear', 'amber', 'black'], default: 'frosted' },
  lid: { type: String, enum: ['none', 'gold', 'wood', 'black'], default: 'none' },
  label_width: { type: Number, min: 10, max: 100, default: 52 },
  label_height: { type: Number, min: 10, max: 80, default: 42 },
  label_top: { type: Number, min: 2, max: 70, default: 23 },
  label_rotation: { type: Number, min: -180, max: 180, default: 0 },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  view_count: { type: Number, default: 0 },
  is_active: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('MockupShare', mockupShareSchema);
