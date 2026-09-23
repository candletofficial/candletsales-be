const mongoose = require('mongoose');

// Immutable audit log for inbound payment notifications. The unique transaction
// id is the idempotency guard when SePay retries the same webhook.
const sePayTransactionSchema = new mongoose.Schema({
  transaction_id: { type: String, required: true, unique: true, index: true },
  order_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  payment_session_id: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentSession', default: null },
  payment_code: { type: String, default: '' },
  amount: { type: Number, required: true, min: 0 },
  account_number: { type: String, default: '' },
  reference_code: { type: String, default: '' },
  status: { type: String, enum: ['received', 'confirmed', 'rejected'], required: true },
  reject_reason: { type: String, default: '' },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true });

module.exports = mongoose.model('SePayTransaction', sePayTransactionSchema);
