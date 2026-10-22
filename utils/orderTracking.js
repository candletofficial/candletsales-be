const { randomBytes } = require('node:crypto');

const newTrackingToken = () => randomBytes(24).toString('hex');
const SHORT_TOKEN_LENGTH = 16;
const shortTrackingCode = token => {
  const prefix = String(token || '').slice(0, SHORT_TOKEN_LENGTH);
  return /^[a-f0-9]{16}$/i.test(prefix) ? Buffer.from(prefix, 'hex').toString('base64url') : '';
};
const trackingPath = token => `/d/${shortTrackingCode(token)}`;

function trackingTokenQuery(token) {
  const value = String(token || '').trim();
  if (/^[a-f0-9]{48}$/i.test(value)) return value.toLowerCase();
  if (/^[a-f0-9]{16}$/i.test(value)) return new RegExp(`^${value.toLowerCase()}`);
  if (/^[a-z0-9_-]{11}$/i.test(value)) {
    try {
      const prefix = Buffer.from(value, 'base64url').toString('hex');
      if (/^[a-f0-9]{16}$/.test(prefix)) return new RegExp(`^${prefix}`);
    } catch {
      return null;
    }
  }
  return null;
}

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
    payment_method: order.payment_method,
    payment_status: order.payment_status,
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

module.exports = { newTrackingToken, shortTrackingCode, trackingPath, trackingTokenQuery, trackingTransitionError, publicTrackingOrder };
