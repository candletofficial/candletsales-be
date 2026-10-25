const materialId = (value) => String(value?._id || value || '');

const materialStock = (material) => {
  if (!material || typeof material !== 'object') return 0;
  const hasActual = material.actualStock !== null && material.actualStock !== undefined && material.actualStock !== '';
  const actual = Number(material.actualStock);
  if (hasActual && Number.isFinite(actual)) return Math.max(0, actual);
  const system = Number(material.stock);
  return Number.isFinite(system) ? Math.max(0, system) : 0;
};

const recipeCapacity = (entries = []) => {
  const requirements = new Map();
  for (const entry of entries) {
    const required = Number(entry?.quantity);
    if (!Number.isFinite(required) || required <= 0) continue;
    const id = materialId(entry.ingredient_id);
    if (!id || !entry.ingredient_id || typeof entry.ingredient_id !== 'object') return 0;
    const current = requirements.get(id) || { required: 0, stock: materialStock(entry.ingredient_id) };
    current.required += required;
    current.stock = Math.min(current.stock, materialStock(entry.ingredient_id));
    requirements.set(id, current);
  }
  if (!requirements.size) return null;
  return Math.min(...[...requirements.values()].map(({ stock, required }) => Math.max(0, Math.floor((stock + 1e-9) / required))));
};

const enrichProductAvailability = (product) => {
  const value = product?.toObject ? product.toObject() : { ...product };
  const base = value.base_ingredients || [];
  value.skus = (value.skus || []).map((sku) => ({
    ...sku,
    stock: recipeCapacity([...base, ...(sku.extra_ingredients || [])]),
  }));
  const skuStocks = value.skus.map((sku) => sku.stock).filter((stock) => Number.isFinite(stock));
  value.stock = skuStocks.length ? Math.max(...skuStocks) : recipeCapacity(base);
  return value;
};

module.exports = { materialStock, recipeCapacity, enrichProductAvailability };
