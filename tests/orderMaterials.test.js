const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Material = require('../models/Material');
const ShippingConfig = require('../models/ShippingConfig');
const { itemMaterials, materialsRevision, materialDifference, preserveOrderMaterials } = require('../utils/orderItemMaterials');
const { buildMaterialDeductions } = require('../controllers/orderController');
const { getItemMaterials, updateItemMaterials } = require('../controllers/orderMaterialsController');

afterEach(() => mock.restoreAll());
const ids = { order: '000000000000000000000001', product: '000000000000000000000002', old: '000000000000000000000003', next: '000000000000000000000004', extra: '000000000000000000000005' };
const response = () => ({ json(body) { this.body = body; return this; } });
const query = value => ({ session() { return Promise.resolve(value); }, then(resolve) { return Promise.resolve(resolve(value)); } });

function setup({ stock = 20, status = 'completed', failOrderSave = false, failMaterialSave = 0 } = {}) {
  const product = { _id: ids.product, base_ingredients: [{ ingredient_id: ids.old, quantity: 2 }], skus: [{ id: 'SKU', extra_ingredients: [{ ingredient_id: ids.extra, quantity: 1 }] }] };
  const order = new Order({ _id: ids.order, orderId: 'TEST', total_price: 100000, status, updatedAt: new Date('2026-10-16T00:00:00Z'),
    items: [{ product_id: ids.product, sku_id: 'SKU', product_name: 'Nến', unit_price: 50000, unit_cost: 5000, quantity: 2 }] });
  const materials = [
    { _id: ids.old, name: 'Nguyên liệu cũ', unit: 'g', price: 10, stock: 10, actualStock: 10 },
    { _id: ids.next, name: 'Nguyên liệu mới', unit: 'g', price: 30, stock, actualStock: stock },
    { _id: ids.extra, name: 'Phụ liệu', unit: 'cái', price: 100, stock: 10, actualStock: 10 },
  ];
  let writes = 0;
  let committed = false;
  let aborted = false;
  const session = {
    async withTransaction(callback) {
      const snapshot = materials.map(material => ({ stock: material.stock, actualStock: material.actualStock }));
      try { await callback(); committed = true; }
      catch (err) {
        aborted = true;
        materials.forEach((material, index) => Object.assign(material, snapshot[index]));
        throw err;
      }
    },
    async endSession() {},
  };
  for (const material of materials) material.save = async options => {
    assert.equal(options.session, session);
    writes += 1;
    if (writes === failMaterialSave) throw new Error('Stock write failed');
  };
  mock.method(mongoose, 'startSession', async () => session);
  mock.method(Order, 'findById', () => query(order));
  mock.method(Product, 'findById', () => query(product));
  mock.method(Product, 'find', () => query([product]));
  mock.method(Material, 'find', ({ _id }) => query(materials.filter(material => _id.$in.map(String).includes(material._id))));
  mock.method(order, 'save', async options => {
    assert.equal(options.session, session);
    if (failOrderSave) throw new Error('Order write failed');
    order.updatedAt = new Date('2026-10-16T01:00:00Z');
    return order;
  });
  mock.method(Product, 'findByIdAndUpdate', () => assert.fail('Product recipe must never be changed'));
  mock.method(ShippingConfig, 'findOne', async () => null);
  const req = { params: { id: ids.order, index: '0' }, body: {
    revision: materialsRevision(order, order.items[0], itemMaterials(order.items[0], product)),
    ingredients: [{ ingredient_id: ids.next, quantity: 3 }, { ingredient_id: ids.extra, quantity: 1 }],
  } };
  return { product, order, materials, req, state: () => ({ writes, committed, aborted }) };
}

async function update(req) {
  const res = response();
  let error;
  await updateItemMaterials(req, res, err => { error = err; });
  return { res, error };
}

test('preview combines base and SKU materials per unit and provides a revision', async () => {
  const { req } = setup();
  const res = response();
  await getItemMaterials(req, res, err => { throw err; });
  assert.equal(res.body.data.quantity, 2);
  assert.deepEqual(res.body.data.ingredients.map(entry => [entry.ingredient_id, entry.quantity]), [[ids.old, 2], [ids.extra, 1]]);
  assert.equal(res.body.data.revision, req.body.revision);
});

test('swap refunds old materials, deducts new quantities, leaves other ingredients and formula unchanged', async () => {
  const { req, materials, product, order, state } = setup();
  const originalRecipe = structuredClone(product);
  const { res, error } = await update(req);
  assert.ifError(error);
  assert.equal(res.body.success, true);
  assert.deepEqual(materials.map(material => [material.stock, material.actualStock]), [[14, 14], [14, 14], [10, 10]]);
  assert.deepEqual(product, originalRecipe);
  assert.equal(order.items[0].unit_cost, 190);
  assert.equal(order.items[0].unit_price, 50000);
  assert.equal(order.items[0].material_overrides[0].ingredient_id.toString(), ids.next);
  assert.ok(order.items[0].materials_key);
  assert.equal(state().committed, true);
});

test('insufficient stock rejects the entire swap before any inventory write', async () => {
  const { req, materials, state, order } = setup({ stock: 5 });
  const { error } = await update(req);
  assert.match(error.message, /không đủ/);
  assert.equal(state().writes, 0);
  assert.equal(materials[0].stock, 10);
  assert.equal(order.items[0].material_overrides, undefined);
});

test('increasing an existing ingredient only deducts the extra amount', async () => {
  const { req, materials } = setup();
  req.body.ingredients = [{ ingredient_id: ids.old, quantity: 3 }, { ingredient_id: ids.extra, quantity: 1 }];
  assert.ifError((await update(req)).error);
  assert.equal(materials[0].actualStock, 8);
  assert.equal(materials[1].actualStock, 20);
});

test('later quantity changes, returns and deletes resolve the saved recipe, not a changed product formula', async () => {
  const { req, product, order } = setup();
  assert.ifError((await update(req)).error);
  product.base_ingredients = [{ ingredient_id: ids.old, quantity: 99 }];
  const returned = await buildMaterialDeductions(order.items, null);
  assert.deepEqual([...returned.deductions], [[ids.next, 6], [ids.extra, 2]]);
  order.items[0].quantity = 3;
  const updated = await buildMaterialDeductions(order.items, null);
  assert.deepEqual([...updated.deductions], [[ids.next, 9], [ids.extra, 3]]);
});

test('a second swap uses the first saved recipe and a repeated request is rejected', async () => {
  const { req, materials, product, order, state } = setup();
  assert.ifError((await update(req)).error);
  const firstWrites = state().writes;
  assert.equal((await update(req)).error.statusCode, 409);
  assert.equal(state().writes, firstWrites);
  req.body.revision = materialsRevision(order, order.items[0], itemMaterials(order.items[0], product));
  req.body.ingredients = [{ ingredient_id: ids.old, quantity: 2 }, { ingredient_id: ids.extra, quantity: 1 }];
  assert.ifError((await update(req)).error);
  assert.deepEqual(materials.map(material => material.actualStock), [10, 20, 10]);
});

test('return/cancellation and stale order/recipe updates reject without stock writes', async () => {
  for (const status of ['returned', 'cancelled']) {
    const { req, state } = setup({ status });
    assert.equal((await update(req)).error.statusCode, 400);
    assert.equal(state().writes, 0);
    mock.restoreAll();
  }
  const { req, product, state } = setup();
  product.base_ingredients[0].quantity = 4;
  assert.equal((await update(req)).error.statusCode, 409);
  assert.equal(state().writes, 0);
});

test('invalid, missing and duplicate ingredients are rejected', async () => {
  const { req, state } = setup();
  for (const ingredients of [[], [{ ingredient_id: 'invalid', quantity: 1 }],
    [{ ingredient_id: ids.next, quantity: 0 }], [{ ingredient_id: ids.next, quantity: -1 }],
    [{ ingredient_id: ids.next, quantity: Infinity }], [{ ingredient_id: ids.next, quantity: 0.00001 }],
    [{ ingredient_id: ids.next, quantity: 1 }, { ingredient_id: ids.next, quantity: 2 }],
    [{ ingredient_id: '000000000000000000000099', quantity: 1 }]]) {
    req.body.ingredients = ingredients;
    assert.equal((await update(req)).error.statusCode, 400);
  }
  assert.equal(state().writes, 0);
});

test('stock and order writes share one transaction; failures abort it', async () => {
  for (const options of [{ failMaterialSave: 2 }, { failOrderSave: true }]) {
    const { req, state, materials } = setup(options);
    assert.ok((await update(req)).error);
    assert.equal(state().aborted, true);
    assert.equal(state().committed, false);
    assert.deepEqual(materials.map(material => material.actualStock), [10, 20, 10]);
    mock.restoreAll();
  }
});

test('normal saves preserve current recipe and cost; public creation cannot inject an override', () => {
  const old = { product_id: ids.product, quantity: 1, unit_cost: 190, materials_key: 'line-1', material_overrides: [{ ingredient_id: ids.next, quantity: 3 }] };
  const incoming = { ...old, quantity: 2, unit_cost: 0, material_overrides: [{ ingredient_id: ids.old, quantity: 1 }] };
  assert.deepEqual(preserveOrderMaterials([incoming], [old])[0], { ...old, quantity: 2 });
  const publicItem = preserveOrderMaterials([incoming])[0];
  assert.equal(publicItem.material_overrides, undefined);
  assert.equal(publicItem.materials_key, undefined);
});

test('two lines of the same SKU retain their own overrides via stable keys', () => {
  const a = { product_id: ids.product, materials_key: 'a', unit_cost: 1, material_overrides: [{ ingredient_id: ids.old, quantity: 1 }] };
  const b = { product_id: ids.product, materials_key: 'b', unit_cost: 2, material_overrides: [{ ingredient_id: ids.next, quantity: 2 }] };
  assert.deepEqual(preserveOrderMaterials([b, a], [a, b]), [b, a]);
  assert.throws(() => preserveOrderMaterials([{ product_id: ids.product }], [a, b]), /tải lại/);
});

test('repeated ingredient entries and fractional quantities are netted correctly', () => {
  const before = [{ ingredient_id: ids.old, quantity: 0.1 }, { ingredient_id: ids.old, quantity: 0.2 }];
  const after = [{ ingredient_id: ids.old, quantity: 0.3 }];
  assert.deepEqual([...materialDifference(before, after, 3)], []);
});
