const test = require('node:test');
const assert = require('node:assert/strict');
const { groupFundHistory, filterFundHistory } = require('../utils/groupFundHistory');

const withdrawal = (overrides = {}) => ({
  _id: 'withdrawal-1', type: 'revenue_withdrawal', source: 'shopee',
  amount: 108000, fee: 0, fund_change: 0, platform_change: 0,
  created_by: 'Admin', createdAt: '2026-10-10T10:00:00.000Z',
  note: 'Rút tiền từ shopee để nạp quảng cáo', ...overrides,
});
const topup = (overrides = {}) => ({
  _id: 'topup-1', type: 'ad_topup', source: 'shopee',
  amount: 100000, fee: 8000, fund_change: 0, platform_change: 0,
  created_by: 'Admin', createdAt: '2026-10-10T10:00:00.500Z',
  note: 'Nạp tiền quảng cáo shopee từ tài sản riêng', ...overrides,
});

test('legacy topup displays one action with gross debit, net credit and fee; ledger is unchanged', () => {
  const ledger = [topup(), withdrawal()];
  const snapshot = structuredClone(ledger);
  const history = groupFundHistory(ledger);
  assert.equal(history.length, 1);
  assert.equal(history[0].type, 'ad_topup');
  assert.equal(history[0].amount, 100000);
  assert.equal(history[0].fee, 8000);
  assert.equal(history[0].platform_change, -108000);
  assert.equal(history[0].fund_change, 0);
  assert.equal(history[0].funding_source, 'platform');
  assert.equal(history[0].note, 'Nạp tiền quảng cáo từ số dư shopee');
  assert.deepEqual(ledger, snapshot);
});

test('explicit links disambiguate repeated topups and support delayed writes', () => {
  const records = [
    withdrawal(), withdrawal({ _id: 'withdrawal-2' }),
    topup({ related_transaction_id: 'withdrawal-1', createdAt: '2026-10-10T10:01:00Z' }),
    topup({ _id: 'topup-2', related_transaction_id: 'withdrawal-2', createdAt: '2026-10-10T10:02:00Z' }),
  ];
  const result = groupFundHistory(records);
  assert.deepEqual(result.map(row => row._id), ['topup-2', 'topup-1']);
  assert.ok(result.every(row => row.platform_change === -108000));
});

test('populated link groups a topup even when withdrawal is outside the date query', () => {
  const result = groupFundHistory([topup({ related_transaction_id: withdrawal() })]);
  assert.equal(result.length, 1);
  assert.equal(result[0].platform_change, -108000);
});

test('ambiguous legacy matches are left intact rather than guessing', () => {
  assert.equal(groupFundHistory([withdrawal(), withdrawal({ _id: 'withdrawal-2' }), topup()]).length, 3);
  assert.equal(groupFundHistory([withdrawal(), topup(), topup({ _id: 'topup-2' })]).length, 3);
});

test('unrelated withdrawals are not merged with topups', () => {
  for (const changes of [
    { source: 'tiktok' }, { created_by: 'Other admin' }, { amount: 100000 },
    { fund_change: 108000 }, { note: 'Rút doanh thu về quỹ' },
    { order_id: 'order-1' }, { fee: 1000 },
    { createdAt: '2026-10-10T09:59:00Z' }, { createdAt: '2026-10-10T10:00:01Z' },
  ]) assert.equal(groupFundHistory([withdrawal(changes), topup()]).length, 2);
});

test('common-fund topups and orphaned entries retain their original values', () => {
  const common = topup({ fund_change: -108000 });
  assert.deepEqual(groupFundHistory([common]), [common]);
  assert.deepEqual(groupFundHistory([withdrawal()]), [withdrawal()]);
  assert.deepEqual(groupFundHistory([topup()]), [topup()]);
});

test('custom notes are preserved and zero-fee topups are grouped', () => {
  const result = groupFundHistory([withdrawal({ amount: 100000 }), topup({ fee: 0, note: 'Chiến dịch tháng 10' })]);
  assert.equal(result.length, 1);
  assert.equal(result[0].note, 'Chiến dịch tháng 10');
  assert.equal(result[0].platform_change, -100000);
});

test('type filtering operates on grouped actions, with no duplicate withdrawal', () => {
  const normal = withdrawal({ _id: 'normal', fund_change: 200000, amount: 200000, note: 'Rút về quỹ' });
  const result = groupFundHistory([withdrawal(), topup(), normal]);
  assert.equal(filterFundHistory(result, { type: 'all' }).length, 2);
  assert.equal(filterFundHistory(result, { type: 'ad_topup' }).length, 1);
  assert.deepEqual(filterFundHistory(result, { type: 'revenue_withdrawal' }).map(row => row._id), ['normal']);
});

test('a pair across a date boundary appears only on the topup date', () => {
  const result = groupFundHistory([
    withdrawal({ createdAt: '2026-09-30T23:59:59.900Z' }),
    topup({ createdAt: '2026-10-01T00:00:00.100Z' }),
  ]);
  assert.equal(filterFundHistory(result, { endDate: '2026-09-30T23:59:59.999Z' }).length, 0);
  assert.equal(filterFundHistory(result, { startDate: '2026-10-01T00:00:00Z' }).length, 1);
  assert.deepEqual(groupFundHistory([]), []);
});
