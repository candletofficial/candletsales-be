const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');

const Product = require('../models/Product');
const Review = require('../models/Review');
const productController = require('../controllers/productController');
const shopController = require('../controllers/shopController');

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});

test.afterEach(() => mock.restoreAll());

test('sellable products default to visible in the shop', () => {
  assert.equal(Product.schema.path('is_visible_in_shop').defaultValue, true);
});

test('shop catalogue excludes products explicitly hidden by an admin', async () => {
  let receivedFilter;
  const query = {
    populate() { return this; },
    async sort() { return []; },
  };
  mock.method(Product, 'find', (filter) => {
    receivedFilter = filter;
    return query;
  });
  mock.method(Review, 'aggregate', async () => []);

  const res = response();
  await shopController.getShopProducts({}, res, error => { throw error; });

  assert.deepEqual(receivedFilter.is_visible_in_shop, { $ne: false });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, []);
});

test('admin can hide a sellable product with the dedicated endpoint', async () => {
  let receivedUpdate;
  mock.method(Product, 'findOneAndUpdate', async (filter, update) => {
    receivedUpdate = { filter, update };
    return { _id: filter._id, name: 'Nến thử nghiệm', is_visible_in_shop: false };
  });

  const res = response();
  await productController.updateShopVisibility({
    params: { id: 'product-1' },
    body: { is_visible_in_shop: false },
  }, res, error => { throw error; });

  assert.deepEqual(receivedUpdate.filter.product_type, { $nin: ['sub_formula', 'custom'] });
  assert.deepEqual(receivedUpdate.update, { $set: { is_visible_in_shop: false } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.is_visible_in_shop, false);
});
