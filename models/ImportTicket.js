const mongoose = require('mongoose');

const importTicketSchema = new mongoose.Schema({
  code: { type: String, unique: true },
  items: [{
    material_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
    quantity: { type: Number, required: true, min: 0 },
    unit_price: { type: Number, required: true, min: 0 },
    total_price: { type: Number, required: true, min: 0 }
  }],
  total_amount: { type: Number, required: true, min: 0 },
  imported_by: {
    type: String,
    required: true,
    default: 'Admin'
  },
  status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
  note: { type: String, default: '' },
  completed_at: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('ImportTicket', importTicketSchema);
