const text = value => (typeof value === 'string' || typeof value === 'number') ? String(value).trim() : '';
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const first = (...values) => values.map(text).find(Boolean);

// Keep an allowlist, not the raw webhook (which also includes unrelated account data).
function extractPancakeCustomerDetails(payload) {
  const customer = object(payload.customer);
  const shipping = object(payload.shipping_address);
  const legacyShipping = object(customer.shipping_address);
  const partner = object(payload.partner);
  const details = {};
  const strings = {
    customer_id: first(customer.customer_id, customer.id),
    name: customer.name,
    username: customer.username,
    recipient_name: first(shipping.full_name, payload.bill_full_name, legacyShipping.full_name),
    recipient_phone: first(shipping.phone_number, payload.bill_phone_number, legacyShipping.phone_number),
    recipient_email: payload.bill_email,
    address: first(shipping.full_address, shipping.marketplace_address, legacyShipping.full_address),
    street: shipping.address,
    commune: first(shipping.commune_name, shipping.commnue_name),
    district: shipping.district_name,
    province: shipping.province_name,
    postcode: shipping.post_code,
    source_name: payload.order_sources_name,
    page_name: object(payload.page).name,
    carrier: partner.partner_name,
    tracking_url: payload.tracking_link,
    conversation_url: customer.conversation_link,
    order_url: payload.order_link,
    delivery_note: payload.note_print,
  };
  for (const [key, value] of Object.entries(strings)) if (text(value)) details[key] = text(value);
  for (const [key, value] of Object.entries({ phones: customer.phone_numbers, emails: customer.emails })) {
    if (Array.isArray(value)) details[key] = [...new Set(value.map(text).filter(Boolean))];
  }
  for (const key of ['order_count', 'succeed_order_count', 'returned_order_count', 'purchased_amount', 'reward_point']) {
    const value = customer[key];
    if ((typeof value === 'number' || (typeof value === 'string' && value.trim())) && Number.isFinite(Number(value)) && Number(value) >= 0) details[key] = Number(value);
  }
  if (typeof customer.is_block === 'boolean') details.is_block = customer.is_block;
  return details;
}

function applyPancakeCustomerDetails(order, payload) {
  const patch = extractPancakeCustomerDetails(payload);
  const previous = order.pancake_details?.toObject?.() || order.pancake_details || {};
  let changed = false;
  if (Object.entries(patch).some(([key, value]) => JSON.stringify(previous[key]) !== JSON.stringify(value))) {
    order.pancake_details = { ...previous, ...patch, synced_at: new Date() };
    changed = true;
  }
  const basic = {
    customer_name: first(patch.name, patch.recipient_name),
    customer_phone: first(patch.phones?.[0], patch.recipient_phone),
    customer_address: patch.address,
  };
  for (const [key, value] of Object.entries(basic)) {
    if (value && order[key] !== value) { order[key] = value; changed = true; }
  }
  return changed;
}

module.exports = { extractPancakeCustomerDetails, applyPancakeCustomerDetails };
