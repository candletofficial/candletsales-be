const { test } = require('node:test');
const assert = require('node:assert/strict');
const Order = require('../models/Order');
const { extractPancakeCustomerDetails, applyPancakeCustomerDetails } = require('../utils/pancakeCustomerDetails');

test('keeps customer profile distinct from the order recipient and prefers order address', () => {
  const order = {};
  applyPancakeCustomerDetails(order, {
    customer: { name: 'Buyer', customer_id: 'customer-1', username: 'buyer', phone_numbers: ['0123', '0456', '0123'], emails: ['buyer@example.test'], shipping_address: { full_address: 'Old address' } },
    shipping_address: { full_name: 'Recipient', phone_number: '0789', full_address: 'Order address', commune_name: 'Ward', province_name: 'City' },
    bill_full_name: 'Billing name', bill_phone_number: '0999',
  });
  assert.equal(order.customer_name, 'Buyer');
  assert.equal(order.customer_phone, '0123');
  assert.equal(order.customer_address, 'Order address');
  assert.equal(order.pancake_details.recipient_name, 'Recipient');
  assert.equal(order.pancake_details.recipient_phone, '0789');
  assert.deepEqual(order.pancake_details.phones, ['0123', '0456']);
});

test('billing and legacy address are used when current shipping details are missing', () => {
  const order = {};
  applyPancakeCustomerDetails(order, { bill_full_name: 'Recipient', bill_phone_number: '0123', customer: { shipping_address: { full_address: 'Legacy address' } } });
  assert.equal(order.customer_name, 'Recipient');
  assert.equal(order.customer_phone, '0123');
  assert.equal(order.customer_address, 'Legacy address');
});

test('partial and replayed events retain previously saved details and sync time', () => {
  const order = {};
  const payload = { customer: { name: 'Buyer', phone_numbers: ['0123'], emails: ['buyer@example.test'], returned_order_count: 0 }, shipping_address: { full_address: 'Address' } };
  assert.equal(applyPancakeCustomerDetails(order, payload), true);
  const before = structuredClone(order);
  assert.equal(applyPancakeCustomerDetails(order, { status: 5 }), false);
  assert.equal(applyPancakeCustomerDetails(order, payload), false);
  assert.deepEqual(order, before);
  applyPancakeCustomerDetails(order, { customer: { order_count: 3, emails: [] } });
  assert.equal(order.pancake_details.address, 'Address');
  assert.deepEqual(order.pancake_details.phones, ['0123']);
  assert.deepEqual(order.pancake_details.emails, []);
});

test('normalization preserves zero and false but rejects malformed or unrelated fields', () => {
  const details = extractPancakeCustomerDetails({
    account: 'private', secret: 'private', shipping_address: null,
    customer: { name: {}, phone_numbers: [null, {}, ' 0123 ', '0123'], order_count: '0', purchased_amount: 0, reward_point: -1, succeed_order_count: null, returned_order_count: 'bad', is_block: false, identity_code: 'private' },
  });
  assert.deepEqual(details, { phones: ['0123'], order_count: 0, purchased_amount: 0, is_block: false });
});

test('schema retains normalized details without adding empty arrays on partial updates', () => {
  const order = new Order({ orderId: 'TEST', total_price: 0 });
  applyPancakeCustomerDetails(order, { customer: { name: 'Buyer', order_count: 0 }, partner: { partner_name: 'Carrier' } });
  assert.equal(order.validateSync(), undefined);
  assert.equal(order.pancake_details.phones, undefined);
  applyPancakeCustomerDetails(order, { customer: { emails: ['buyer@example.test'] } });
  assert.equal(order.pancake_details.name, 'Buyer');
  assert.equal(order.pancake_details.carrier, 'Carrier');
  assert.equal(order.pancake_details.order_count, 0);
  assert.equal(applyPancakeCustomerDetails(order, { customer: { emails: ['buyer@example.test'] } }), false);
});
