const mongoose = require('mongoose');

const fundTransactionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['admin_deposit', 'admin_withdrawal', 'revenue_withdrawal', 'import_payment', 'ad_topup', 'seeding_payment', 'shipping_payment', 'system_adjustment', 'expense_payment', 'platform_adjustment', 'ad_adjustment', 'order_revenue'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  fee: {
    type: Number,
    default: 0,
    min: 0
  },
  fund_change: {
    type: Number,
    required: true
  },
  platform_change: {
    type: Number,
    default: 0
  },
  source: {
    type: String, // 'shopee', 'tiktok', etc. (only for revenue_withdrawal)
    default: null
  },
  import_ticket_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ImportTicket',
    default: null
  },
  order_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    default: null
  },
  expense_ticket_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExpenseTicket',
    default: null
  },
  ad_cost_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AdCost',
    default: null
  },
  note: {
    type: String,
    default: ''
  },
  created_by: {
    type: String,
    required: true,
    default: 'Admin'
  }
}, { timestamps: true });

module.exports = mongoose.model('FundTransaction', fundTransactionSchema);
