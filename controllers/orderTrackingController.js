const Order = require('../models/Order');
const FundTransaction = require('../models/FundTransaction');
const { newTrackingToken, trackingPath, publicTrackingOrder } = require('../utils/orderTracking');

exports.createTrackingLink = async (req, res, next) => {
  let session;
  try {
    let order = await Order.findById(req.params.id).select('+tracking_token');
    if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng.' });
    if (order.pancake_order_id) return res.status(400).json({ success: false, message: 'Tính năng này dành cho đơn tạo thủ công.' });
    if (!order.tracking_token) {
      if (['returned', 'cancelled'].includes(order.status) || ['failed', 'cancelled'].includes(order.delivery_status)) {
        return res.status(400).json({ success: false, message: 'Đơn đã hoàn hoặc huỷ không thể bắt đầu lại tiến trình giao hàng. Hãy tạo đơn mới.' });
      }
      session = await Order.startSession();
      await session.withTransaction(async () => {
        // Start the delivery flow exactly once. Do not rewind an existing link.
        const result = await Order.updateOne({
          _id: order._id, tracking_token: { $exists: false },
          status: order.status, delivery_status: order.delivery_status,
        }, {
          $set: {
            tracking_token: newTrackingToken(), tracking_enabled: true,
            status: 'pending', delivery_status: 'pending',
          },
        }, { session });
        if (result.modifiedCount) {
          // Manual orders used to be completed on creation. Remove only their
          // completion revenue; retain stock deductions, shipping and payment data.
          await FundTransaction.deleteMany({
            order_id: order._id,
            $or: [
              { type: 'order_revenue' },
              { type: 'revenue_withdrawal', source: { $in: ['pos', 'facebook', 'instagram'] }, note: /^Tự động chuyển doanh thu / },
            ],
          }, { session });
        }
      });
      order = await Order.findById(req.params.id).select('+tracking_token');
      if (!order?.tracking_token) return res.status(409).json({ success: false, message: 'Đơn hàng vừa thay đổi. Vui lòng tải lại và thử lại.' });
    }
    return res.json({ success: true, data: { order, path: trackingPath(order.tracking_token) } });
  } catch (error) { next(error); }
  finally { if (session) await session.endSession(); }
};

exports.getTrackingOrder = async (req, res, next) => {
  try {
    const { token } = req.params;
    if (!/^[a-f0-9]{48}$/.test(token || '')) return res.status(404).json({ success: false, message: 'Link theo dõi không hợp lệ hoặc đơn hàng không còn tồn tại.' });
    const order = await Order.findOne({ tracking_token: token, tracking_enabled: true });
    if (!order) return res.status(404).json({ success: false, message: 'Link theo dõi không hợp lệ hoặc đơn hàng không còn tồn tại.' });
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, data: publicTrackingOrder(order) });
  } catch (error) { next(error); }
};
