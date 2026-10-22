const { randomBytes } = require('node:crypto');

const newTrackingToken = () => randomBytes(24).toString('hex');
const trackingPath = token => `/theo-doi-don/${token}`;

function trackingTransitionError(order, next) {
  if (!order.tracking_enabled || !next || next === order.delivery_status) return null;
  if (['returned', 'cancelled'].includes(order.status)) return 'Đơn đã hoàn hoặc huỷ không thể đổi trạng thái giao hàng.';
  const transitions = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['pending', 'shipping', 'cancelled'],
    shipping: ['delivered', 'failed'],
    delivered: [], failed: [], cancelled: [],
  };
  return transitions[order.delivery_status || 'pending']?.includes(next)
    ? null : 'Vui lòng chuyển trạng thái giao hàng theo đúng thứ tự.';
}

function publicTrackingOrder(order) {
  return {
    orderId: order.orderId,
    status: order.status,
    delivery_status: order.delivery_status,
    ordered_at: order.ordered_at,
    updated_at: order.updatedAt,
    total_price: order.total_price,
    shippingMethod: order.shippingMethod,
    customer: {
      name: order.customer_name || '',
      phone: order.customer_phone || '',
      address: order.customer_address || '',
    },
    items: (order.items || []).map(item => ({
      product_name: item.product_name, product_image: item.product_image,
      sku_label: item.sku_label, quantity: item.quantity, unit_price: item.unit_price,
    })),
  };
}

module.exports = { newTrackingToken, trackingPath, trackingTransitionError, publicTrackingOrder };
