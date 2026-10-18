const Order = require('../models/Order');

// Old deletions left display-only revenue entries behind. Keep unrelated money
// movements visible, and only omit orphan order revenue with no fund movement.
async function filterOrphanOrderRevenue(records) {
  const candidates = records.filter(record => record.type === 'order_revenue'
    && record.order_id && Number(record.fund_change) === 0);
  if (!candidates.length) return records;
  const ids = [...new Set(candidates.map(record => String(record.order_id)))];
  const orders = await Order.find({ _id: { $in: ids } }).select('_id').lean();
  const existing = new Set(orders.map(order => String(order._id)));
  const orphanIds = new Set(candidates.filter(record => !existing.has(String(record.order_id))).map(record => String(record._id)));
  return records.filter(record => !orphanIds.has(String(record._id)));
}

module.exports = { filterOrphanOrderRevenue };
