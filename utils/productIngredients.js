const skuIngredients = (sku) => (
  sku?.resolved_extra_ingredients?.length
    ? sku.resolved_extra_ingredients
    : sku?.extra_ingredients || []
);

const skuUsesBaseFormula = (sku) => sku?.use_base_formula !== false;

const productBaseIngredients = (product, sku = null) => {
  if (sku && !skuUsesBaseFormula(sku)) return [];
  return product?.resolved_base_ingredients?.length
    ? product.resolved_base_ingredients
    : product?.base_ingredients || [];
};

module.exports = { productBaseIngredients, skuIngredients, skuUsesBaseFormula };
