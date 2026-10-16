const crypto = require('crypto');

const materialId = value => String(value?._id || value || '');
const roundQuantity = value => Number(value.toFixed(4));

function itemMaterials(item, product) {
  if (Array.isArray(item.material_overrides)) return item.material_overrides;
  return [
    ...(product?.base_ingredients || []),
    ...(product?.skus?.find(sku => sku.id === item.sku_id)?.extra_ingredients || []),
  ];
}

function materialTotals(entries, quantity = 1) {
  const totals = new Map();
  for (const entry of entries) {
    const id = materialId(entry.ingredient_id);
    if (!id) continue;
    totals.set(id, roundQuantity((totals.get(id) || 0) + Number(entry.quantity) * quantity));
  }
  return totals;
}

function materialDifference(before, after, quantity) {
  const diff = materialTotals(after, quantity);
  for (const [id, amount] of materialTotals(before, quantity)) {
    diff.set(id, roundQuantity((diff.get(id) || 0) - amount));
  }
  return new Map([...diff].filter(([, amount]) => amount !== 0));
}

function materialsRevision(order, item, entries) {
  return crypto.createHash('sha256').update(JSON.stringify({
    updatedAt: order.updatedAt, status: order.status, delivery: order.delivery_status,
    product: materialId(item.product_id), sku: item.sku_id, quantity: item.quantity,
    materials: [...materialTotals(entries)].sort(([a], [b]) => a.localeCompare(b)),
  })).digest('hex');
}

// Only the dedicated, transactional admin endpoint can change material recipes.
// Normal order saves retain the server's recipe even from a stale form/client.
function preserveOrderMaterials(items = [], previous = []) {
  return items.map(item => {
    const { material_overrides, materials_key, ...clean } = item;
    const matches = previous.filter(old => materialId(old.product_id) === materialId(item.product_id)
      && (old.sku_id || null) === (item.sku_id || null));
    const existing = materials_key ? matches.find(old => old.materials_key === materials_key) : matches[0];
    if (materials_key && previous.length && !existing) {
      const error = new Error('Dòng sản phẩm đã thay đổi. Vui lòng tải lại đơn hàng.');
      error.statusCode = 409;
      throw error;
    }
    if (!materials_key && matches.length > 1 && matches.some(old => old.material_overrides)) {
      const error = new Error('Có nhiều dòng sản phẩm đã đổi nguyên liệu. Vui lòng tải lại đơn hàng.');
      error.statusCode = 409;
      throw error;
    }
    if (Array.isArray(existing?.material_overrides)) {
      clean.material_overrides = existing.material_overrides;
      clean.materials_key = existing.materials_key;
      clean.unit_cost = existing.unit_cost;
    }
    return clean;
  });
}

module.exports = { itemMaterials, materialId, materialTotals, materialDifference, materialsRevision, preserveOrderMaterials };
