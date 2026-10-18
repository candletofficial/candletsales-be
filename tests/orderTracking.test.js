const { test, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Material = require('../models/Material');
const ShippingConfig = require('../models/ShippingConfig');
const FundTransaction = require('../models/FundTransaction');
const inventory = require('../utils/inventoryHelpers');
const mail = require('../utils/orderEmailNotifier');
inventory.triggerAutoConfirmImports = async () => {};
mail.notifyNewWebsiteOrder = async () => {};
const { createOrder, updateOrder, updateDeliveryStatus } = require('../controllers/orderController');
const { createTrackingLink, getTrackingOrder } = require('../controllers/orderTrackingController');
const { newTrackingToken, trackingTransitionError } = require('../utils/orderTracking');
const response = () => ({
  statusCode: 200, headers: {},
  status(code) { this.statusCode = code; return this; },
  set(key, value) { this.headers[key] = value; return this; },
  json(body) { this.body = body; return this; },
});
const fail = error => { throw error; };
const item = { product_name: 'Test candle', quantity: 1, unit_price: 100000 };
const makeOrder = (status = 'pending') => ({
  _id: 'order-1', orderId: 'TEST-ORDER', source: 'facebook', tracking_enabled: true,
  tracking_token: newTrackingToken(), status: status === 'delivered' ? 'completed' : 'pending',
  delivery_status: status, items: [item], total_price: 100000,
  async save() { return this; },
});

beforeEach(() => {
  mock.method(Product, 'find', async () => []);
  mock.method(ShippingConfig, 'findOne', async () => null);
  mock.method(Order, 'create', async data => ({ _id: 'order-1', ...data }));
  mock.method(FundTransaction, 'create', async data => data);
  mock.method(FundTransaction, 'findOne', async () => null);
  mock.method(FundTransaction, 'deleteMany', async () => ({}));
});
afterEach(() => mock.restoreAll());

test('manual tracked creation starts pending with an opaque link and does not book revenue', async () => {
  for (const source of ['shopee', 'facebook', 'pos', 'website']) {
    const res = response();
    await createOrder({ user: { role: 'admin' }, body: {
      items: [item], total_price: 100000, source, create_tracking_link: true,
      delivery_status: 'delivered', status: 'completed', payment_method: 'transfer',
    } }, res, fail);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.data.delivery_status, 'pending');
    assert.equal(res.body.data.status, 'pending');
    assert.match(res.body.data.tracking_token, /^[a-f0-9]{48}$/);
    assert.equal(res.body.data.tracking_enabled, true);
  }
  assert.equal(FundTransaction.create.mock.callCount(), 0);
});

test('ordinary manual creation retains its previous completed behavior', async () => {
  const res = response();
  await createOrder({ user: { role: 'admin' }, body: { items: [item], total_price: 100000, source: 'shopee' } }, res, fail);
  assert.equal(res.body.data.status, 'completed');
  assert.equal(res.body.data.delivery_status, 'delivered');
  assert.equal(res.body.data.tracking_token, undefined);
});

test('public checkout cannot request admin tracking creation', async () => {
  const res = response();
  await createOrder({ body: { create_tracking_link: true, items: [item] } }, res, fail);
  assert.equal(res.statusCode, 403);
  assert.equal(Order.create.mock.callCount(), 0);
});

test('first link resets a completed manual order to pending and later requests preserve its progress', async () => {
  const order = makeOrder('delivered');
  delete order.tracking_token;
  order.tracking_enabled = false;
  mock.method(Order, 'findById', () => ({ select: async () => order }));
  const session = { async withTransaction(callback) { await callback(); }, async endSession() {} };
  mock.method(Order, 'startSession', async () => session);
  const update = mock.method(Order, 'updateOne', async (filter, data, options) => {
    assert.deepEqual(filter, { _id: order._id, tracking_token: { $exists: false }, status: 'completed', delivery_status: 'delivered' });
    assert.equal(options.session, session);
    Object.assign(order, data.$set);
    return { modifiedCount: 1 };
  });
  const first = response();
  const second = response();
  await createTrackingLink({ params: { id: order._id } }, first, fail);
  assert.equal(order.status, 'pending');
  assert.equal(order.delivery_status, 'pending');
  assert.equal(first.body.data.order.delivery_status, 'pending');
  const deletion = FundTransaction.deleteMany.mock.calls[0].arguments;
  assert.equal(deletion[0].order_id, order._id);
  assert.deepEqual(deletion[0].$or[0], { type: 'order_revenue' });
  assert.equal(deletion[0].$or[1].type, 'revenue_withdrawal');
  assert.ok(deletion[0].$or[1].note.test('Tự động chuyển doanh thu Facebook đơn TEST'));
  assert.ok(!deletion[0].$or[1].note.test('Rút doanh thu thủ công'));
  assert.equal(deletion[1].session, session);
  order.delivery_status = 'shipping';
  await createTrackingLink({ params: { id: order._id } }, second, fail);
  assert.equal(first.body.data.path, second.body.data.path);
  assert.equal(update.mock.callCount(), 1);
  assert.equal(order.status, 'pending');
  assert.equal(order.delivery_status, 'shipping');
  assert.equal(FundTransaction.deleteMany.mock.callCount(), 1);
  assert.equal(FundTransaction.create.mock.callCount(), 0);
});

test('link creation cannot reopen orders whose inventory was already refunded', async () => {
  for (const status of ['returned', 'cancelled']) {
    mock.method(Order, 'findById', () => ({ select: async () => ({ _id: 'order-1', status, delivery_status: 'failed' }) }));
    const res = response();
    await createTrackingLink({ params: { id: 'order-1' } }, res, fail);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(FundTransaction.deleteMany.mock.callCount(), 0);
});

test('accounting failure aborts the tracking reset and closes the session', async () => {
  const original = { _id: 'order-1', status: 'completed', delivery_status: 'delivered' };
  const order = { ...original };
  let aborted = false;
  let closed = false;
  const session = {
    async withTransaction(callback) {
      try { await callback(); } catch (error) {
        aborted = true;
        for (const key of Object.keys(order)) delete order[key];
        Object.assign(order, original);
        throw error;
      }
    },
    async endSession() { closed = true; },
  };
  mock.method(Order, 'startSession', async () => session);
  mock.method(Order, 'findById', () => ({ select: async () => order }));
  mock.method(Order, 'updateOne', async (_filter, data, options) => {
    assert.equal(options.session, session);
    Object.assign(order, data.$set);
    return { modifiedCount: 1 };
  });
  mock.method(FundTransaction, 'deleteMany', async () => { throw new Error('Accounting failed'); });
  let failure;
  const res = response();
  await createTrackingLink({ params: { id: 'order-1' } }, res, error => { failure = error; });
  assert.equal(failure.message, 'Accounting failed');
  assert.equal(aborted, true);
  assert.equal(closed, true);
  assert.deepEqual(order, original);
  assert.equal(res.body, undefined);
});

test('link generation rejects missing orders and Pancake orders', async () => {
  for (const order of [null, { pancake_order_id: 'pancake-1' }]) {
    mock.method(Order, 'findById', () => ({ select: async () => order }));
    const res = response();
    await createTrackingLink({ params: { id: 'order-1' } }, res, fail);
    assert.equal(res.statusCode, order ? 400 : 404);
  }
});

test('public tracking only returns customer-facing fields and reflects status changes', async () => {
  const order = makeOrder();
  Object.assign(order, { note: 'Internal', customer_phone: 'private', customer_address: 'private', pancake_details: { name: 'private' } });
  order.items[0] = { ...item, unit_cost: 50000, material_overrides: [{ secret: true }] };
  mock.method(Order, 'findOne', async query => {
    assert.deepEqual(query, { tracking_token: order.tracking_token, tracking_enabled: true });
    return order;
  });
  for (const status of ['pending', 'shipping', 'delivered', 'failed', 'cancelled']) {
    order.delivery_status = status;
    const res = response();
    await getTrackingOrder({ params: { token: order.tracking_token } }, res, fail);
    assert.equal(res.body.data.delivery_status, status);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    for (const field of ['note', 'customer_phone', 'customer_address', 'pancake_details', 'tracking_token', '_id']) assert.equal(res.body.data[field], undefined);
    assert.equal(res.body.data.items[0].unit_cost, undefined);
    assert.equal(res.body.data.items[0].material_overrides, undefined);
  }
});

test('invalid and deleted tracking links return 404', async () => {
  const find = mock.method(Order, 'findOne', async () => null);
  for (const token of ['TEST-ORDER', '../../x', newTrackingToken()]) {
    const res = response();
    await getTrackingOrder({ params: { token } }, res, fail);
    assert.equal(res.statusCode, 404);
  }
  assert.equal(find.mock.callCount(), 1);
});

test('tracked transitions reject skipped steps and reopening terminal/refunded orders', () => {
  assert.equal(trackingTransitionError(makeOrder('pending'), 'confirmed'), null);
  assert.equal(trackingTransitionError(makeOrder('confirmed'), 'pending'), null);
  assert.equal(trackingTransitionError(makeOrder('shipping'), 'failed'), null);
  assert.ok(trackingTransitionError(makeOrder('pending'), 'delivered'));
  assert.ok(trackingTransitionError(makeOrder('shipping'), 'cancelled'));
  assert.ok(trackingTransitionError(makeOrder('delivered'), 'shipping'));
  assert.ok(trackingTransitionError({ ...makeOrder('failed'), status: 'returned' }, 'shipping'));
});

test('both admin update endpoints reject illegal transitions before changing stock or money', async () => {
  const order = makeOrder();
  mock.method(Order, 'findById', async () => order);
  for (const handler of [updateOrder, updateDeliveryStatus]) {
    const res = response();
    await handler({ params: { id: order._id }, body: { items: [item], delivery_status: 'delivered', logistics_cost: 30000 } }, res, fail);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(Product.find.mock.callCount(), 0);
  assert.equal(FundTransaction.create.mock.callCount(), 0);
});

test('delivery books revenue and automatic collection once, even when the request is retried', async () => {
  const order = makeOrder('shipping');
  const transactions = [];
  mock.method(Order, 'findById', async () => order);
  mock.method(FundTransaction, 'findOne', async query => transactions.find(tx => tx.type === query.type));
  mock.method(FundTransaction, 'create', async data => { transactions.push(data); return data; });
  for (let i = 0; i < 2; i++) {
    const res = response();
    await updateDeliveryStatus({ params: { id: order._id }, body: { delivery_status: 'delivered' }, user: {} }, res, fail);
    assert.equal(res.statusCode, 200);
  }
  assert.equal(order.status, 'completed');
  assert.equal(transactions.length, 2);
  assert.equal(transactions.find(tx => tx.type === 'revenue_withdrawal').fund_change, 100000);
});

test('cancelling a tracked order refunds its material once and keeps the link valid', async () => {
  const order = makeOrder('confirmed');
  order.items = [{ ...item, product_id: 'product-1' }];
  const material = { stock: 10, actualStock: 10, minStock: 1 };
  mock.method(Order, 'findById', async () => order);
  mock.method(Product, 'find', async () => [{ _id: 'product-1', base_ingredients: [{ ingredient_id: 'material-1', quantity: 2 }] }]);
  mock.method(Material, 'findById', async () => material);
  const stock = mock.method(Material, 'findByIdAndUpdate', async (_id, data) => Object.assign(material, data));
  for (let i = 0; i < 2; i++) await updateDeliveryStatus({ params: { id: order._id }, body: { delivery_status: 'cancelled', cancelled_reason: 'Test' } }, response(), fail);
  assert.equal(order.status, 'cancelled');
  assert.equal(material.actualStock, 12);
  assert.equal(stock.mock.callCount(), 1);
  assert.match(order.tracking_token, /^[a-f0-9]{48}$/);
});

test('admin detail saves carry a tracked order through confirmation, shipping and delivery', async () => {
  const order = makeOrder();
  const transactions = [];
  mock.method(Order, 'findById', async () => order);
  mock.method(Order, 'findByIdAndUpdate', async (_id, changes) => Object.assign(order, changes));
  mock.method(FundTransaction, 'find', async query => transactions.filter(tx => tx.type === query.type));
  mock.method(FundTransaction, 'findOne', async query => transactions.find(tx => tx.type === query.type));
  mock.method(FundTransaction, 'create', async data => {
    const tx = { ...data, async save() {} }; transactions.push(tx); return tx;
  });
  const token = order.tracking_token;
  for (const delivery_status of ['confirmed', 'shipping', 'delivered', 'delivered']) {
    const res = response();
    await updateOrder({ params: { id: order._id }, user: {}, body: {
      items: order.items, source: order.source, total_price: order.total_price,
      shippingMethod: 'standard', delivery_status, customer_name: 'Test customer',
    } }, res, fail);
    assert.equal(res.statusCode, 200);
    assert.equal(order.delivery_status, delivery_status);
    assert.equal(order.status, delivery_status === 'delivered' ? 'completed' : 'pending');
    assert.equal(order.tracking_token, token);
    if (delivery_status !== 'delivered') assert.equal(transactions.length, 0);
  }
  assert.equal(transactions.length, 2);
});

test('tracking credentials are hidden by default and generation route stays admin-only', () => {
  assert.equal(Order.schema.path('tracking_token').options.select, false);
  const router = require('../routes/orderRoutes');
  const { protect, adminOnly } = require('../middlewares/authMiddleware');
  const routeIndex = router.stack.findIndex(layer => layer.route?.path === '/:id/tracking-link');
  assert.ok(routeIndex > 1);
  const precedingHandlers = router.stack.slice(0, routeIndex).map(layer => layer.handle);
  assert.ok(precedingHandlers.includes(protect));
  assert.ok(precedingHandlers.includes(adminOnly));
});

test('status-only saves keep customer, item and price drafts out of the update', async () => {
  const order = makeOrder();
  Object.assign(order, { customer_name: 'Saved customer', note: 'Saved note', total_price: 100000 });
  const itemsBefore = structuredClone(order.items);
  mock.method(Order, 'findById', async () => order);
  for (const delivery_status of ['confirmed', 'pending', 'confirmed', 'shipping']) {
    const res = response();
    await updateDeliveryStatus({ params: { id: order._id }, body: { delivery_status } }, res, fail);
    assert.equal(res.body.data.delivery_status, delivery_status);
    assert.equal(order.customer_name, 'Saved customer');
    assert.equal(order.note, 'Saved note');
    assert.equal(order.total_price, 100000);
    assert.deepEqual(order.items, itemsBefore);
  }
  assert.equal(FundTransaction.create.mock.callCount(), 0);
});

test('website orders with refunded stock cannot be reopened by status-only saves', async () => {
  const order = { ...makeOrder('failed'), source: 'website', tracking_enabled: false, status: 'returned' };
  mock.method(Order, 'findById', async () => order);
  const res = response();
  await updateDeliveryStatus({ params: { id: order._id }, body: { delivery_status: 'shipping' } }, res, fail);
  assert.equal(res.statusCode, 400);
  assert.equal(order.status, 'returned');
  assert.equal(order.delivery_status, 'failed');
});
