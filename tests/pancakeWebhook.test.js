const { test, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { classifyPancakeStatus } = require('../utils/pancakeOrderStatus');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Material = require('../models/Material');
const FundTransaction = require('../models/FundTransaction');
const SystemConfig = require('../models/SystemConfig');
const ShippingConfig = require('../models/ShippingConfig');
const orderController = require('../controllers/orderController');
const inventory = require('../utils/inventoryHelpers');
const { handlePancakeWebhook } = require('../controllers/webhookController');

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const product = {
  _id: '000000000000000000000001', productId: 'CANDLE', name: 'Nến thử nghiệm',
  base_ingredients: [{ ingredient_id: 'material-1', quantity: 3 }], skus: [],
};
const makeOrder = status => ({
  _id: 'order-1', orderId: 'TEST-PANCAKE', pancake_order_id: 'pancake-1',
  source: 'shopee', status, total_price: 100000, shippingMethod: 'standard',
  items: [{ product_id: product._id, quantity: 2, unit_cost: 10000 }],
  async save() { return this; },
});

beforeEach(() => {
  // All persistence is mocked. No database, inventory or money is modified.
  mock.method(console, 'log', () => {});
  mock.method(console, 'error', () => {});
  mock.method(Order, 'findByIdAndDelete', () => assert.fail('Webhook must never delete an order'));
  mock.method(Order, 'deleteOne', () => assert.fail('Webhook must never delete an order'));
  mock.method(Order, 'deleteMany', () => assert.fail('Webhook must never delete orders'));
  mock.method(FundTransaction, 'deleteMany', async () => ({}));
  mock.method(FundTransaction, 'create', async data => data);
  mock.method(ShippingConfig, 'findOne', async () => null);
  mock.method(SystemConfig, 'findOne', async () => ({ value: '{"shopee":1000}' }));
  mock.method(Product, 'find', () => ({
    populate() { return this; },
    then(resolve) { return Promise.resolve(resolve([product])); },
  }));
  mock.method(inventory, 'triggerAutoConfirmImports', async () => {});
});
afterEach(() => mock.restoreAll());

test('return codes and names take priority over conflicting carrier cancellation', () => {
  for (const status of [4, 5, '4', '5']) {
    assert.equal(classifyPancakeStatus({ status, partner: { partner_status: 'cancelled' } }), 'returned');
  }
  for (const status_name of ['returning', 'returned', 'Đang hoàn', 'ĐÃ HOÀN', 'chuyển hoàn', ' Đang hoàn hàng ']) {
    assert.equal(classifyPancakeStatus({ status_name, partner: { partner_status: 'cancelled' } }), 'returned');
  }
  assert.equal(classifyPancakeStatus({ status: 7, status_name: 'Đang hoàn' }), 'returned');
});

test('cancellation and removal codes are distinct; ordinary and partial-return states are not full returns', () => {
  for (const status of [6, '6']) assert.equal(classifyPancakeStatus({ status }), 'cancelled');
  for (const status of [7, '7']) assert.equal(classifyPancakeStatus({ status }), 'removed');
  for (const status of [0, 1, 2, 3, 8, 9, 15, 16, 17]) {
    assert.equal(classifyPancakeStatus({ status, partner: { partner_status: 'cancelled' } }), 'other');
  }
  for (const status_name of ['Hoàn thành', 'Đã hoàn thành', 'part_returned', 'Hoàn một phần']) {
    assert.equal(classifyPancakeStatus({ status_name }), 'other');
  }
});

test('partner status is used only when the primary status is not recognized', () => {
  assert.equal(classifyPancakeStatus({ partner: { partner_status: 'RETURNED' } }), 'returned');
  assert.equal(classifyPancakeStatus({ partner: { partner_status: 'Canceled' } }), 'cancelled');
  assert.equal(classifyPancakeStatus({ status: null, partner: { partner_status: 'returning' } }), 'returned');
  assert.equal(classifyPancakeStatus({ status: ' ', partner: { partner_status: 'returned' } }), 'returned');
  assert.equal(classifyPancakeStatus({}), 'other');
});

test('status-only return webhook keeps the order, refunds products and charges return fee only once', async () => {
  const order = makeOrder('completed');
  const material = { stock: 10, actualStock: 10, minStock: 1 };
  mock.method(Order, 'findOne', async () => order);
  mock.method(Order, 'findById', async () => order);
  mock.method(Order, 'findByIdAndUpdate', async (_id, changes) => Object.assign(order, changes));
  mock.method(Material, 'findById', async () => material);
  const stockUpdates = mock.method(Material, 'findByIdAndUpdate', async (_id, changes) => Object.assign(material, changes));

  for (const status of ['4', 5, 6, 7, 16]) {
    const res = response();
    await handlePancakeWebhook({ body: { id: 'pancake-1', status, partner: { partner_status: 'cancelled' } } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(order.status, 'returned');
  }
  assert.equal(stockUpdates.mock.callCount(), 1);
  assert.equal(material.stock, 16);
  assert.equal(order.return_cost, 1000);
  assert.ok(order.returned_at instanceof Date);
  assert.equal(FundTransaction.create.mock.callCount(), 1);
  assert.equal(FundTransaction.create.mock.calls[0].arguments[0].amount, 1000);
  assert.equal(Order.findByIdAndDelete.mock.callCount(), 0);
});

test('return-processing failure returns an error for retry and never deletes the order', async () => {
  const order = makeOrder('pending');
  mock.method(Order, 'findOne', async () => order);
  mock.method(orderController, 'processReturnOrder', async () => { throw new Error('temporary failure'); });
  const res = response();
  await handlePancakeWebhook({ body: { id: 'pancake-1', status: 5 } }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(order.status, 'pending');
  assert.equal(Order.findByIdAndDelete.mock.callCount(), 0);
});

test('genuine cancellation is retained; duplicate cancellation and later return do not refund twice', async () => {
  const order = makeOrder('pending');
  const material = { stock: 10, actualStock: 10, minStock: 1 };
  mock.method(Order, 'findOne', async () => order);
  mock.method(Material, 'findById', async () => material);
  const stockUpdates = mock.method(Material, 'findByIdAndUpdate', async (_id, changes) => Object.assign(material, changes));
  for (const status of [6, '6', 7]) {
    const res = response();
    await handlePancakeWebhook({ body: { id: 'pancake-1', status } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(order.status, 'cancelled');
  }
  assert.equal(stockUpdates.mock.callCount(), 1);
  assert.equal(material.stock, 16);
  assert.equal(FundTransaction.deleteMany.mock.callCount(), 1);
  assert.ok(order.cancelled_at instanceof Date);

  const res = response();
  await handlePancakeWebhook({ body: { id: 'pancake-1', status: 5 } }, res);
  assert.equal(order.status, 'returned');
  assert.equal(stockUpdates.mock.callCount(), 1);
});

test('primary active state is not deleted or cancelled because the carrier cancelled a shipment', async () => {
  const order = makeOrder('pending');
  mock.method(Order, 'findOne', async () => order);
  const res = response();
  await handlePancakeWebhook({ body: { id: 'pancake-1', status: 9, partner: { partner_status: 'cancelled' } } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(order.status, 'pending');
  assert.equal(FundTransaction.deleteMany.mock.callCount(), 0);
});

test('a missing returned order is recreated as history without moving stock or charging fees', async () => {
  mock.method(Order, 'findOne', async () => null);
  const save = mock.method(Order.prototype, 'save', async function () { return this; });
  mock.method(Material, 'findById', () => assert.fail('Historical returned order must not touch stock'));
  const res = response();
  await handlePancakeWebhook({ body: {
    id: 'pancake-1', display_id: 'SHOPEE-TEST', status: '5', status_name: 'returned',
    customer: { name: 'Khách thử nghiệm', order_sources: ['-3'], username: 'test-buyer', order_count: 3 },
    shipping_address: { full_address: 'Test address', full_name: 'Test recipient', phone_number: '0123456789' },
    items: [{ sku: 'CANDLE', quantity: 2, variation_info: { name: 'Nến thử nghiệm', retail_price: 50000 } }],
    total_price_after_sub_discount: 100000,
    partner: { partner_status: 'cancelled' },
  } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(save.mock.callCount(), 1);
  const savedOrder = save.mock.calls[0].this;
  assert.equal(savedOrder.status, 'returned');
  assert.equal(savedOrder.items[0].product_id.toString(), product._id);
  assert.equal(savedOrder.total_price, 100000);
  assert.equal(savedOrder.customer_address, 'Test address');
  assert.equal(savedOrder.pancake_details.recipient_name, 'Test recipient');
  assert.equal(savedOrder.pancake_details.username, 'test-buyer');
  assert.equal(FundTransaction.create.mock.callCount(), 0);
  assert.equal(inventory.triggerAutoConfirmImports.mock.callCount(), 0);
});

test('missing orders require a full payload and unknown cancellations are still ignored', async () => {
  mock.method(Order, 'findOne', async () => null);
  const save = mock.method(Order.prototype, 'save', async () => assert.fail('Must not create incomplete order'));
  for (const status of [5, 6, 7]) {
    const res = response();
    await handlePancakeWebhook({ body: { id: 'pancake-1', status } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
  }
  assert.equal(save.mock.callCount(), 0);
});

test('customer details can be enriched on returned and cancelled orders without stock or revenue changes', async () => {
  for (const status of ['returned', 'cancelled']) {
    const order = makeOrder(status);
    mock.method(Order, 'findOne', async () => order);
    const save = mock.method(order, 'save', async () => order);
    const res = response();
    await handlePancakeWebhook({ body: {
      id: 'pancake-1', status: 5,
      customer: { name: 'Buyer', order_count: 5, returned_order_count: 1 },
      shipping_address: { full_address: 'Order address' },
    } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(order.customer_address, 'Order address');
    assert.equal(order.pancake_details.order_count, 5);
    assert.ok(save.mock.callCount() >= 1);
  }
  assert.equal(FundTransaction.create.mock.callCount(), 0);
  assert.equal(FundTransaction.deleteMany.mock.callCount(), 0);
});
