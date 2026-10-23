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

const makeOrder = ({ source, trackingEnabled, trackingToken }) => ({
  _id: `${source}-order`,
  orderId: source === 'website' ? 'DH-1234567' : 'DH-7654321',
  source,
  tracking_enabled: trackingEnabled,
  tracking_token: trackingToken,
  items: [],
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
});

test('order lookup only returns an existing tracking path for non-website orders', async () => {
  const websiteOrder = makeOrder({ source: 'website', trackingEnabled: false });
  const manualOrder = makeOrder({
    source: 'facebook',
    trackingEnabled: true,
    trackingToken: '0123456789abcdef0123456789abcdef0123456789abcdef',
  });

  mock.method(Order, 'find', () => ({
    select: () => ({ sort: async () => [websiteOrder, manualOrder] }),
  }));

  try {
    const res = response();
    await getShopOrders({ query: { phone: '0328624761' } }, res, (error) => { throw error; });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data[0].tracking_path, null);
    assert.equal(res.body.data[0].tracking_token, undefined);
    assert.equal(res.body.data[1].tracking_path, '/s/ASNFZ4mrze8?v=8');
    assert.equal(res.body.data[1].tracking_token, undefined);
  } finally {
    mock.restoreAll();
  }
});
