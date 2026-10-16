// Shipping discounts must not be capped by the merchandise subtotal.
const freeshipDiscount = (coupon, items, shippingFee) => {
  const fail = (message) => {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  };
  if (!Array.isArray(items) || !items.length) fail('Giỏ hàng trống.');
  const subtotal = items.reduce((sum, item) => sum + Number(item.unit_price) * Number(item.quantity), 0);
  if (!Number.isFinite(subtotal) || subtotal < 0) fail('Giá trị đơn hàng không hợp lệ.');
  const minimum = Number(coupon.min_order_value || 0);
  if (subtotal < minimum) {
    fail(`Mã freeship áp dụng cho đơn từ ${minimum.toLocaleString('vi-VN')}đ tiền hàng (chưa gồm phí vận chuyển).`);
  }
  if (coupon.applicable_products === 'specific') {
    const ids = coupon.product_ids.map(id => String(id._id || id));
    if (!items.some(item => ids.includes(String(item.product_id?._id || item.product_id)))) {
      fail('Mã freeship không áp dụng cho sản phẩm trong đơn này.');
    }
  }
  const fee = Number(shippingFee);
  if (!Number.isFinite(fee) || fee < 0) fail('Phí vận chuyển không hợp lệ.');
  if (fee === 0) fail('Đơn hàng đã được miễn phí vận chuyển, không cần áp dụng mã freeship.');
  const mode = coupon.shipping_discount_type || 'percent';
  const value = coupon.shipping_discount_type ? Number(coupon.value) : 100;
  let discount = mode === 'fixed' ? value : fee * value / 100;
  if (mode === 'percent' && coupon.max_discount > 0) discount = Math.min(discount, coupon.max_discount);
  return Math.min(fee, Math.max(0, Math.round(discount)));
};

module.exports = { freeshipDiscount };
