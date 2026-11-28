const returnedPaymentStatus = status => (
  ['paid', 'refund_pending'].includes(status) ? 'refund_pending' : status === 'refunded' ? 'refunded' : 'failed'
);

const canRecordRefund = order => !['shopee', 'tiktok'].includes(order?.source)
  && order?.payment_method === 'transfer'
  && ['paid', 'refund_pending'].includes(order?.payment_status)
  && (
    ['cancelled', 'returned'].includes(order?.status)
    || ['cancelled', 'returned'].includes(order?.delivery_status)
  );

module.exports = { returnedPaymentStatus, canRecordRefund };
