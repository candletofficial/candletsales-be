const test = require('node:test');
const assert = require('node:assert/strict');
const mock = require('node:test').mock;
const Order = require('../models/Order');
const { getShopOrders } = require('../controllers/orderController');

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test('website order lookup creates a safe tracking path without exposing its token', async () => {
  const order = {
    _id: 'order-1',
    orderId: 'DH-1234567',
    source: 'website',
    tracking_enabled: false,
    tracking_token: undefined,
    items: [],
    async save() { this.saved = true; },
    toObject() {
      return {
        _id: this._id,
        orderId: this.orderId,
        source: this.source,
        tracking_enabled: this.tracking_enabled,
        tracking_token: this.tracking_token,
        items: this.items,
      };
    },
  };

  mock.method(Order, 'find', () => ({
    select: () => ({ sort: async () => [order] }),
  }));

  try {
    const res = response();
    await getShopOrders({ query: { orderId: order.orderId } }, res, (error) => { throw error; });

    assert.equal(res.statusCode, 200);
    assert.equal(order.saved, true);
    assert.match(res.body.data[0].tracking_path, /^\/s\/[A-Za-z0-9_-]{11}\?v=8$/);
    assert.equal(res.body.data[0].tracking_token, undefined);
  } finally {
    mock.restoreAll();
  }
});
