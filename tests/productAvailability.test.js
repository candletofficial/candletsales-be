const test = require('node:test');
const assert = require('node:assert/strict');
const { recipeCapacity, enrichProductAvailability } = require('../utils/productAvailability');

const material = (id, actualStock, stock = actualStock) => ({ _id: id, actualStock, stock });

test('recipe stock is the smallest whole number producible from its materials', () => {
  assert.equal(recipeCapacity([
    { ingredient_id: material('wax', 105), quantity: 20 },
    { ingredient_id: material('wick', 20), quantity: 1 },
    { ingredient_id: material('oil', 38), quantity: 10 },
  ]), 3);
});

test('repeated material requirements are combined before calculating stock', () => {
  const wax = material('wax', 100);
  assert.equal(recipeCapacity([
    { ingredient_id: wax, quantity: 20 },
    { ingredient_id: wax, quantity: 5 },
  ]), 4);
});

test('product and SKU stock include base and extra ingredients', () => {
  const product = enrichProductAvailability({
    _id: 'product-1',
    base_ingredients: [{ ingredient_id: material('wax', 100), quantity: 20 }],
    skus: [
      { id: 'rose', extra_ingredients: [{ ingredient_id: material('rose-oil', 21), quantity: 5 }] },
      { id: 'wood', extra_ingredients: [{ ingredient_id: material('wood-oil', 6), quantity: 5 }] },
    ],
  });
  assert.equal(product.skus[0].stock, 4);
  assert.equal(product.skus[1].stock, 1);
  assert.equal(product.stock, 4);
});

test('SKU stock uses resolved ingredients from its attached sub-formulas', () => {
  const product = enrichProductAvailability({
    base_ingredients: [{ ingredient_id: material('wax', 100), quantity: 20 }],
    skus: [{
      id: 'with-sub-formula',
      extra_ingredients: [{ ingredient_id: material('direct-oil', 100), quantity: 1 }],
      resolved_extra_ingredients: [
        { ingredient_id: material('direct-oil', 100), quantity: 1 },
        { ingredient_id: material('sub-formula-oil', 12), quantity: 5 },
      ],
    }],
  });

  assert.equal(product.skus[0].stock, 2);
  assert.equal(product.stock, 2);
});

test('add-on SKU ignores the product base formula', () => {
  const product = enrichProductAvailability({
    base_ingredients: [{ ingredient_id: material('wax', 0), quantity: 20 }],
    skus: [{
      id: 'gift-bag-only',
      use_base_formula: false,
      resolved_extra_ingredients: [{ ingredient_id: material('gift-bag', 12), quantity: 1 }],
    }],
  });

  assert.equal(product.skus[0].stock, 12);
  assert.equal(product.stock, 12);
});

test('missing recipes remain unknown and missing materials make stock zero', () => {
  assert.equal(recipeCapacity([]), null);
  assert.equal(recipeCapacity([{ ingredient_id: null, quantity: 1 }]), 0);
  assert.equal(enrichProductAvailability({ base_ingredients: [], skus: [] }).stock, null);
});

test('suspended ingredients do not limit production capacity', () => {
  assert.equal(recipeCapacity([
    { ingredient_id: material('wax', 100), quantity: 20 },
    { ingredient_id: material('paused-oil', 0), quantity: 10, suspended: true },
  ]), 5);
});
