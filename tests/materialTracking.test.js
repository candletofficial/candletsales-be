const test = require('node:test');
const assert = require('node:assert/strict');
const { __trackingHelpers } = require('../controllers/materialController');

test('temporary replacement keeps its origin and restores the old material when tracking resumes', () => {
  const original = [
    { ingredient_id: 'old', quantity: 12, suspended: false },
    { ingredient_id: 'new', quantity: 3, suspended: false },
  ];

  const replaced = __trackingHelpers.replaceIngredient(original, 'old', 'new');
  assert.deepEqual(replaced, [
    { ingredient_id: 'new', quantity: 12, suspended: false, replacement_for: 'old' },
    { ingredient_id: 'new', quantity: 3, suspended: false },
  ]);

  const restored = __trackingHelpers.restoreIngredient(replaced, 'old');
  assert.deepEqual(restored, [
    { ingredient_id: 'old', quantity: 12, suspended: false, replacement_for: null },
    { ingredient_id: 'new', quantity: 3, suspended: false },
  ]);
});

test('material lifecycle queries exclude custom order templates', () => {
  const filter = __trackingHelpers.materialUsageFilter('material-id');

  assert.deepEqual(filter.product_type, { $ne: 'custom' });
  assert.ok(filter.$or.some(condition => condition['base_ingredients.ingredient_id'] === 'material-id'));
});
