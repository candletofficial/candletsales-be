const mongoose = require('mongoose');

// A QR payment session is deliberately separate from Order.  Until SePay has
// verified a matching inbound transfer, no sellable order exists in the system.
const paymentSessionSchema = new mongoose.Schema({
  order_reference: { type: String, required: true, unique: true, index: true },
  payment_code: { type: String, required: true, unique: true, index: true },
  amount: { type: Number, required: true, min: 1 },
  status: {
    type: String,
    enum: ['pending', 'processing', 'confirmed', 'expired', 'failed'],
    default: 'pending',
    index: true,
  },
  expires_at: { type: Date, required: true, index: true },
  order_data: { type: mongoose.Schema.Types.Mixed, required: true },
  order_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  payment_transaction_id: { type: String, default: null },
  failure_reason: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('PaymentSession', paymentSessionSchema);
