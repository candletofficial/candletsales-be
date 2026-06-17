const mongoose = require('mongoose');

const expenseTicketSchema = new mongoose.Schema({
  code: { type: String, unique: true },
  title: { type: String, required: true },
  category: { type: String, required: true, default: 'Khác' },
  amount: { type: Number, required: true, min: 0 },
  note: { type: String, default: '' },
  created_by: { type: String, required: true, default: 'Admin' },
  status: { type: String, enum: ['completed'], default: 'completed' }
}, { timestamps: true });

module.exports = mongoose.model('ExpenseTicket', expenseTicketSchema);
