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

test('missing recipes remain unknown and missing materials make stock zero', () => {
  assert.equal(recipeCapacity([]), null);
  assert.equal(recipeCapacity([{ ingredient_id: null, quantity: 1 }]), 0);
  assert.equal(enrichProductAvailability({ base_ingredients: [], skus: [] }).stock, null);
});
