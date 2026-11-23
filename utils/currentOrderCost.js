const mongoose = require('mongoose');
const Product = require('../models/Product');

const number = value => Number(value) || 0;

const ingredientCost = (ingredients = []) => ingredients.reduce((sum, row) => (
  row?.suspended === true ? sum : sum + number(row?.ingredient_id?.price) * number(row?.quantity)
), 0);

const calculateProductUnitCost = (product, skuId) => {
  if (!product) return null;
  const baseIngredients = product.resolved_base_ingredients?.length
    ? product.resolved_base_ingredients
    : product.base_ingredients || [];
  const sku = (product.skus || []).find(row => String(row.id) === String(skuId || ''));
  return ingredientCost(baseIngredients) + ingredientCost(sku?.extra_ingredients || []);
};

const createCurrentUnitCostResolver = (products = []) => {
  const byId = new Map(products.map(product => [String(product._id), product]));
  const byCode = new Map(products.map(product => [String(product.productId), product]));

  return item => {
    // A per-order recipe is an intentional snapshot and must not be replaced by
    // a later product recipe.
    if (Array.isArray(item?.material_overrides)) return number(item.unit_cost);
    const product = byId.get(String(item?.product_id || ''))
      || byCode.get(String(item?.productId || ''));
    const currentCost = calculateProductUnitCost(product, item?.sku_id);
    return currentCost === null ? number(item?.unit_cost) : currentCost;
  };
};

const buildCurrentUnitCostResolver = async (orders = []) => {
  const objectIds = new Set();
  const productCodes = new Set();

  for (const order of orders) {
    for (const item of order?.items || []) {
      const id = String(item?.product_id || '');
      if (mongoose.isValidObjectId(id)) objectIds.add(id);
      const code = String(item?.productId || '').trim();
      if (code) productCodes.add(code);
    }
  }

  const filters = [];
  if (objectIds.size) filters.push({ _id: { $in: [...objectIds] } });
  if (productCodes.size) filters.push({ productId: { $in: [...productCodes] } });

  const products = filters.length
    ? await Product.find(filters.length === 1 ? filters[0] : { $or: filters })
      .populate('base_ingredients.ingredient_id')
      .populate('resolved_base_ingredients.ingredient_id')
      .populate('skus.extra_ingredients.ingredient_id')
      .lean()
    : [];

  return createCurrentUnitCostResolver(products);
};

module.exports = {
  buildCurrentUnitCostResolver,
  calculateProductUnitCost,
  createCurrentUnitCostResolver,
};
