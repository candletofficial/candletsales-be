const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Material = require('../models/Material');
const ShippingConfig = require('../models/ShippingConfig');
const FundTransaction = require('../models/FundTransaction');
const { deleteOrder } = require('../controllers/orderController');
const { getTransactions } = require('../controllers/fundController');
const { filterOrphanOrderRevenue } = require('../utils/filterOrphanOrderRevenue');

afterEach(() => mock.restoreAll());
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const fail = error => { throw error; };

function setup({ status = 'completed', delivery = 'delivered', failAt, missing = false } = {}) {
  let state = {
    order: missing ? null : { _id: 'order-1', status, delivery_status: delivery, shippingMethod: 'standard', items: [{ product_id: 'product-1', quantity: 2, material_overrides: [{ ingredient_id: 'material-1', quantity: 3 }] }] },
    transactions: [
      { _id: 'revenue', order_id: 'order-1', type: 'order_revenue', source: 'facebook' },
      { _id: 'automatic', order_id: 'order-1', type: 'revenue_withdrawal', source: 'facebook' },
      { _id: 'shipping', order_id: 'order-1', type: 'shipping_payment' },
      { _id: 'seeding', order_id: 'order-1', type: 'seeding_payment' },
      { _id: 'other-order', order_id: 'order-2', type: 'order_revenue' },
      { _id: 'manual-withdrawal', type: 'revenue_withdrawal', source: 'facebook' },
      { _id: 'deposit', type: 'admin_deposit' },
    ],
    material: { stock: 10, actualStock: 10, minStock: 1 },
  };
  let closed = false;
  let aborted = false;
  const session = {
    async withTransaction(callback) {
      const original = structuredClone(state);
      try { await callback(); } catch (error) { state = original; aborted = true; throw error; }
    },
    async endSession() { closed = true; },
  };
  const query = value => ({ async session(actual) { assert.equal(actual, session); return value; } });
  mock.method(Order, 'startSession', async () => session);
  mock.method(Order, 'findById', () => query(state.order));
  const deletion = mock.method(Order, 'deleteOne', async (filter, options) => {
    assert.deepEqual(filter, { _id: 'order-1' }); assert.equal(options.session, session); state.order = null;
  });
  mock.method(FundTransaction, 'deleteMany', async (filter, options) => {
    assert.equal(options.session, session);
    assert.deepEqual(filter, {
      order_id: 'order-1', $or: [
        { type: { $in: ['order_revenue', 'seeding_payment', 'shipping_payment'] } },
        { type: 'revenue_withdrawal', source: { $in: ['pos', 'facebook', 'instagram'] } },
      ],
    });
    if (failAt === 'ledger') throw new Error('Ledger failure');
    state.transactions = state.transactions.filter(tx => tx.order_id !== filter.order_id);
  });
  mock.method(Product, 'find', () => query([{ _id: 'product-1', base_ingredients: [{ ingredient_id: 'wrong-material', quantity: 100 }] }]));
  mock.method(ShippingConfig, 'findOne', () => query(null));
  mock.method(Material, 'findById', id => { assert.equal(id, 'material-1'); return query(state.material); });
  const stock = mock.method(Material, 'findByIdAndUpdate', async (_id, updates, options) => {
    assert.equal(options.session, session);
    if (failAt === 'stock') throw new Error('Stock failure');
    Object.assign(state.material, updates);
  });
  return { read: () => state, flags: () => ({ closed, aborted }), stock, deletion };
}

test('deleting an order removes its revenue and linked costs but keeps unrelated transactions', async () => {
  const context = setup();
  const res = response();
  await deleteOrder({ params: { id: 'order-1' }, query: { restoreStock: 'false' } }, res, fail);
  assert.equal(res.statusCode, 200);
  assert.equal(context.read().order, null);
  assert.deepEqual(context.read().transactions.map(tx => tx._id), ['other-order', 'manual-withdrawal', 'deposit']);
  assert.equal(context.stock.mock.callCount(), 0);
  assert.equal(context.flags().closed, true);
});

test('optional stock refund uses the order-specific recipe and shares the deletion transaction', async () => {
  const context = setup();
  await deleteOrder({ params: { id: 'order-1' }, query: { restoreStock: 'true' } }, response(), fail);
  assert.equal(context.read().material.actualStock, 16);
  assert.equal(context.stock.mock.callCount(), 1);
});

test('already returned or cancelled orders never refund stock twice', async () => {
  for (const status of ['returned', 'cancelled']) {
    const context = setup({ status });
    await deleteOrder({ params: { id: 'order-1' }, query: { restoreStock: 'true' } }, response(), fail);
    assert.equal(context.stock.mock.callCount(), 0);
    assert.equal(context.read().order, null);
    mock.restoreAll();
  }
});

test('ledger and stock failures abort order deletion instead of leaving dangling history', async () => {
  for (const failAt of ['ledger', 'stock']) {
    const context = setup({ failAt });
    const before = structuredClone(context.read());
    let error;
    const res = response();
    await deleteOrder({ params: { id: 'order-1' }, query: { restoreStock: 'true' } }, res, failure => { error = failure; });
    assert.ok(error);
    assert.equal(res.body, undefined);
    assert.deepEqual(context.read(), before);
    assert.deepEqual(context.flags(), { aborted: true, closed: true });
    mock.restoreAll();
  }
});

test('retrying an already deleted order has no financial or stock side effects', async () => {
  const context = setup({ missing: true });
  const res = response();
  await deleteOrder({ params: { id: 'order-1' }, query: {} }, res, fail);
  assert.equal(res.statusCode, 404);
  assert.equal(context.deletion.mock.callCount(), 0);
  assert.equal(FundTransaction.deleteMany.mock.callCount(), 0);
});

test('legacy orphan revenue is omitted without hiding real fund movements or valid revenue', async () => {
  const records = [
    { _id: 'orphan', type: 'order_revenue', order_id: 'deleted', fund_change: 0 },
    { _id: 'valid', type: 'order_revenue', order_id: 'exists', fund_change: 0 },
    { _id: 'cash', type: 'order_revenue', order_id: 'deleted', fund_change: 100 },
    { _id: 'unlinked', type: 'order_revenue', fund_change: 0 },
    { _id: 'withdrawal', type: 'revenue_withdrawal', order_id: 'deleted', fund_change: 100 },
  ];
  mock.method(Order, 'find', filter => {
    assert.deepEqual(filter, { _id: { $in: ['deleted', 'exists'] } });
    return { select() { return this; }, async lean() { return [{ _id: 'exists' }]; } };
  });
  assert.deepEqual((await filterOrphanOrderRevenue(records)).map(tx => tx._id), ['valid', 'cash', 'unlinked', 'withdrawal']);
});

test('history removes legacy orphan rows before counting and pagination', async () => {
  mock.method(FundTransaction, 'find', () => ({
    populate() { return this; }, sort() { return this; }, async lean() {
      return [
        { _id: 'orphan', type: 'order_revenue', order_id: 'deleted', fund_change: 0, createdAt: new Date('2026-10-16') },
        { _id: 'valid', type: 'order_revenue', order_id: 'exists', fund_change: 0, createdAt: new Date('2026-10-15') },
      ];
    },
  }));
  mock.method(Order, 'find', () => ({ select() { return this; }, async lean() { return [{ _id: 'exists' }]; } }));
  const res = response();
  await getTransactions({ query: { page: '1', limit: '1' } }, res);
  assert.equal(res.body.data.totalItems, 1);
  assert.equal(res.body.data.totalPages, 1);
  assert.equal(res.body.data.transactions[0]._id, 'valid');
});
