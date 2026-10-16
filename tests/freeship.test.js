const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { freeshipDiscount } = require('../utils/freeshipDiscount');
const Coupon = require('../models/Coupon');
const Product = require('../models/Product');
const Order = require('../models/Order');
const PaymentSession = require('../models/PaymentSession');
const ShippingConfig = require('../models/ShippingConfig');

// No real database, payment gateway, email or inventory is touched.
const inventory = require('../utils/inventoryHelpers');
const mail = require('../utils/orderEmailNotifier');
inventory.triggerAutoConfirmImports = async () => {};
mail.notifyNewWebsiteOrder = async () => {};
const { createOrder, updateOrder } = require('../controllers/orderController');
const { validateCoupon, createCoupon, updateCoupon, getCoupons } = require('../controllers/couponController');
afterEach(() => mock.restoreAll());

const coupon = {
  code: 'FREESHIP', type: 'freeship', value: 0,
  is_active: true, applicable_products: 'all', used_count: 0, quantity: 10,
  usage_limit_per_user: 'unlimited', customer_condition: 'all',
  start_date: new Date('2020-01-01'), end_date: new Date('2099-01-01'),
};
const product = { _id: 'product-1', base_price: 80000, skus: [] };
const items = [{ product_id: product._id, quantity: 1, unit_price: 80000 }];
const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test('freeship equals shipping, even when shipping exceeds merchandise price', () => {
  assert.equal(freeshipDiscount(coupon, items, 16000), 16000);
  assert.equal(freeshipDiscount(coupon, items, 120000), 120000);
  assert.throws(() => freeshipDiscount(coupon, items, 0), /đã được miễn phí/);
  for (const fee of [-1, NaN, Infinity]) {
    assert.throws(() => freeshipDiscount(coupon, items, fee), /không hợp lệ/);
  }
});

test('restricted coupon requires a matching product', () => {
  const restricted = { ...coupon, applicable_products: 'specific', product_ids: ['other'] };
  assert.throws(() => freeshipDiscount(restricted, items, 16000), /không áp dụng/);
  restricted.product_ids = [product._id];
  assert.equal(freeshipDiscount(restricted, items, 16000), 16000);
});

test('admin validation preserves percent/fixed calculations and handles freeship', async () => {
  for (const [type, value, expected] of [['percent', 10, 8000], ['fixed', 10000, 10000], ['freeship', 0, 120000]]) {
    mock.method(Coupon, 'findOne', async () => ({ ...coupon, type, value }));
    const res = response();
    await validateCoupon({ body: { code: coupon.code, items, totalPrice: 80000, shippingFee: 120000, source: 'website' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.discount_amount, expected);
    mock.restoreAll();
  }
});

function mockCheckout() {
  mock.method(Coupon, 'findOne', async () => coupon);
  mock.method(Coupon, 'findOneAndUpdate', async () => ({}));
  mock.method(Product, 'find', async () => [product]);
  mock.method(ShippingConfig, 'findOne', async () => null);
  mock.method(Order, 'exists', async () => false);
  mock.method(PaymentSession, 'exists', async () => false);
  mock.method(PaymentSession, 'create', async data => ({ ...data, status: 'pending' }));
  mock.method(Order, 'create', async data => data);
}

const request = (payment_method) => ({ body: {
  source: 'website', payment_method, shippingMethod: 'standard',
  // Client deliberately sends incorrect prices; backend must use the catalogue.
  items: [{ ...items[0], unit_price: 1 }], total_price: 1,
  shipping_fee: 16000, discount_code: 'FREESHIP', discount_amount: 999999,
} });

test('COD freeship charges catalogue subtotal and consumes one coupon use', async () => {
  mockCheckout();
  const res = response();
  await createOrder(request('cash'), res, error => { throw error; });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.total_price, 80000);
  assert.equal(res.body.data.discount_amount, 16000);
  assert.equal(res.body.data.shipping_fee, 16000);
  assert.equal(Coupon.findOneAndUpdate.mock.callCount(), 1);
});

test('QR session uses discounted amount without creating an order or consuming a coupon', async () => {
  mockCheckout();
  const res = response();
  await createOrder(request('transfer'), res, error => { throw error; });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.total_price, 80000);
  assert.equal(PaymentSession.create.mock.calls[0].arguments[0].order_data.discount_amount, 16000);
  assert.equal(Order.create.mock.callCount(), 0);
  assert.equal(Coupon.findOneAndUpdate.mock.callCount(), 0);
});

test('expired coupon is rejected before a QR payment session is created', async () => {
  mockCheckout();
  mock.method(Coupon, 'findOne', async () => ({ ...coupon, end_date: new Date('2020-01-01') }));
  const res = response();
  await createOrder(request('transfer'), res, error => { throw error; });
  assert.equal(res.statusCode, 400);
  assert.equal(PaymentSession.create.mock.callCount(), 0);
});

test('partial shipping discount supports percentage, cap, fixed and rounding', () => {
  const percent = { ...coupon, shipping_discount_type: 'percent', value: 50, min_order_value: 80000 };
  assert.equal(freeshipDiscount(percent, items, 30000), 15000);
  assert.equal(freeshipDiscount({ ...percent, max_discount: 10000 }, items, 30000), 10000);
  assert.equal(freeshipDiscount({ ...percent, value: 33 }, items, 15001), 4950);
  const fixed = { ...percent, shipping_discount_type: 'fixed', value: 20000 };
  assert.equal(freeshipDiscount(fixed, items, 30000), 20000);
  assert.equal(freeshipDiscount(fixed, items, 15000), 15000);
});

test('minimum uses merchandise value, excludes shipping, and includes exact threshold', () => {
  assert.throws(() => freeshipDiscount({ ...coupon, min_order_value: 80001 }, items, 100000), /đơn từ/);
  assert.equal(freeshipDiscount({ ...coupon, min_order_value: 80000 }, items, 16000), 16000);
});

test('partial discounts produce correct COD and QR totals', async () => {
  for (const payment of ['cash', 'transfer']) {
    for (const [mode, value, cap, expected] of [['percent', 50, null, 8000], ['percent', 100, 10000, 10000], ['fixed', 5000, null, 5000], ['fixed', 30000, null, 16000]]) {
      mockCheckout();
      mock.method(Coupon, 'findOne', async () => ({ ...coupon, shipping_discount_type: mode, value, max_discount: cap, min_order_value: 80000 }));
      const res = response();
      await createOrder(request(payment), res, error => { throw error; });
      assert.equal(res.statusCode, 201);
      assert.equal(res.body.data.total_price, 96000 - expected);
      mock.restoreAll();
    }
  }
});

test('client cannot inflate item prices to bypass the minimum in COD or QR', async () => {
  for (const payment of ['cash', 'transfer']) {
    mockCheckout();
    mock.method(Coupon, 'findOne', async () => ({ ...coupon, min_order_value: 100000 }));
    const req = request(payment);
    req.body.items[0].unit_price = 200000;
    let error;
    await createOrder(req, response(), err => { error = err; });
    assert.equal(error.statusCode, 400);
    assert.match(error.message, /đơn từ/);
    assert.equal(PaymentSession.create.mock.callCount(), 0);
    assert.equal(Order.create.mock.callCount(), 0);
    mock.restoreAll();
  }
});

test('verified QR confirmation keeps the paid snapshot if coupon settings change', async () => {
  mockCheckout();
  mock.method(Coupon, 'findOne', async () => ({ ...coupon, shipping_discount_type: 'fixed', value: 2000, min_order_value: 100000 }));
  const req = request('transfer');
  req.internalPaymentConfirmation = { transactionId: 'test-transaction' };
  req.body.items = items;
  req.body.discount_amount = 8000;
  req.body.total_price = 88000;
  const res = response();
  await createOrder(req, res, error => { throw error; });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.total_price, 88000);
  assert.equal(res.body.data.discount_amount, 8000);
});

test('create rejects invalid freeship configurations and stores valid settings', async () => {
  mock.method(Coupon, 'findOne', async () => null);
  mock.method(Coupon, 'create', async body => body);
  const valid = { ...coupon, shipping_discount_type: 'percent', value: 50, min_order_value: 100000, max_discount: 20000 };
  for (const change of [{ value: 101 }, { value: -1 }, { value: 0 }, { min_order_value: -1 }, { max_discount: -10 }, { shipping_discount_type: 'invalid' }]) {
    const res = response();
    await createCoupon({ body: { ...valid, ...change } }, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(Coupon.create.mock.callCount(), 0);
  const res = response();
  await createCoupon({ body: valid }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.value, 50);
  assert.equal(res.body.data.min_order_value, 100000);
  assert.equal(res.body.data.is_website_only, true);
});

test('partial coupon updates validate against saved type and preserve settings', async () => {
  const saved = { ...coupon, shipping_discount_type: 'percent', value: 50, min_order_value: 100000, max_discount: 20000 };
  mock.method(Coupon, 'findById', async () => ({ ...saved, toObject: () => ({ ...saved }) }));
  mock.method(Coupon, 'findOne', async () => null);
  mock.method(Coupon, 'findByIdAndUpdate', async (id, body) => body);
  const invalid = response();
  await updateCoupon({ params: { id: 'test' }, body: { value: 101 } }, invalid);
  assert.equal(invalid.statusCode, 400);
  const res = response();
  await updateCoupon({ params: { id: 'test' }, body: { is_active: false } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.value, 50);
  assert.equal(res.body.data.min_order_value, 100000);
});

test('frontend and backend agree on thresholds, partial discounts and caps', async () => {
  const { calculateShippingDiscount } = await import('../../candletsales-fe/src/utils/couponUtils.js');
  const variants = [coupon,
    { ...coupon, shipping_discount_type: 'percent', value: 50, max_discount: 10000, min_order_value: 80000 },
    { ...coupon, shipping_discount_type: 'fixed', value: 20000, min_order_value: 80000 },
  ];
  for (const c of variants) {
    for (const fee of [1000, 16000, 50000]) {
      assert.equal(calculateShippingDiscount(c, fee, 80000), freeshipDiscount(c, items, fee));
    }
  }
  assert.equal(calculateShippingDiscount(variants[1], 16000, 79999), 0);
  assert.equal(calculateShippingDiscount(variants[1], 0, 80000), 0);
});

test('POS list excludes freeship and website-only coupons, admin list remains complete', async () => {
  const records = [coupon,
    { ...coupon, code: 'WEB10', type: 'percent', value: 10, is_website_only: true },
    { ...coupon, code: 'ALL10', type: 'percent', value: 10, is_website_only: false },
  ];
  mock.method(Coupon, 'find', filter => {
    const data = records.filter(c => (!filter.type || c.type !== filter.type.$ne)
      && (!filter.is_website_only || c.is_website_only !== filter.is_website_only.$ne));
    return { populate: () => ({ sort: async () => data }) };
  });
  for (const source of ['pos', 'website', undefined]) {
    const res = response();
    await getCoupons({ query: { source } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data.map(c => c.code), source === 'pos' ? ['ALL10'] : ['FREESHIP', 'WEB10', 'ALL10']);
  }
});

test('manual code validation rejects restricted coupons at POS including missing source', async () => {
  for (const restricted of [coupon, { ...coupon, type: 'fixed', value: 10000, is_website_only: true }]) {
    mock.method(Coupon, 'findOne', async () => restricted);
    for (const source of ['pos', 'shopee', undefined]) {
      const res = response();
      await validateCoupon({ body: { code: coupon.code, items, totalPrice: 80000, shippingFee: 16000, source } }, res);
      assert.equal(res.statusCode, 400);
      assert.match(res.body.message, /chỉ dành cho Website/);
    }
    const website = response();
    await validateCoupon({ body: { code: coupon.code, items, totalPrice: 80000, shippingFee: 16000, source: 'website' } }, website);
    assert.equal(website.statusCode, 200);
    mock.restoreAll();
  }
  mock.method(Coupon, 'findOne', async () => ({ ...coupon, type: 'fixed', value: 10000 }));
  const pos = response();
  await validateCoupon({ body: { code: coupon.code, items, totalPrice: 80000, source: 'pos' } }, pos);
  assert.equal(pos.statusCode, 200);
  assert.equal(pos.body.data.discount_amount, 10000);
});

test('POS creation and editing cannot bypass website coupon restriction', async () => {
  for (const restricted of [coupon, { ...coupon, type: 'fixed', value: 10000, is_website_only: true }]) {
    mockCheckout();
    mock.method(Coupon, 'findOne', async () => restricted);
    for (const posMode of ['online', 'offline']) {
      const req = request('cash');
      Object.assign(req.body, { source: 'pos', pos_mode: posMode });
      const res = response();
      await createOrder(req, res, error => { throw error; });
      assert.equal(res.statusCode, 400);
      assert.equal(Order.create.mock.callCount(), 0);
      mock.method(Order, 'findById', async () => ({ source: 'website' }));
      req.params = { id: 'test' };
      const edited = response();
      await updateOrder(req, edited, error => { throw error; });
      assert.equal(edited.statusCode, 400);
      assert.match(edited.body.message, /Website/);
    }
    mock.restoreAll();
  }
});
