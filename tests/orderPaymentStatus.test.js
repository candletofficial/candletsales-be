const test = require('node:test');
const assert = require('node:assert/strict');
const { returnedPaymentStatus, canRecordRefund } = require('../utils/orderPaymentStatus');

test('paid returns wait for a real refund while unpaid returns close payment', () => {
  assert.equal(returnedPaymentStatus('paid'), 'refund_pending');
  assert.equal(returnedPaymentStatus('refund_pending'), 'refund_pending');
  assert.equal(returnedPaymentStatus('pending'), 'failed');
  assert.equal(returnedPaymentStatus(undefined), 'failed');
});

test('refund confirmation is allowed for paid cancelled or returned transfers only', () => {
  assert.equal(canRecordRefund({ payment_method: 'transfer', payment_status: 'refund_pending', status: 'returned' }), true);
  assert.equal(canRecordRefund({ payment_method: 'transfer', payment_status: 'paid', delivery_status: 'cancelled' }), true);
  assert.equal(canRecordRefund({ payment_method: 'transfer', payment_status: 'failed', status: 'returned' }), false);
  assert.equal(canRecordRefund({ payment_method: 'cash', payment_status: 'paid', status: 'returned' }), false);
  assert.equal(canRecordRefund({ source: 'shopee', payment_method: 'transfer', payment_status: 'paid', status: 'returned' }), false);
  assert.equal(canRecordRefund({ payment_method: 'transfer', payment_status: 'paid', status: 'completed' }), false);
});
