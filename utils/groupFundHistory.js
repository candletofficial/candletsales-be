// Only presentation changes here. Both ledger entries remain intact for balances.
const LEGACY_PAIR_WINDOW_MS = 5000;
const idOf = value => String(value?._id || value || '');

function matchesTopup(withdrawal, topup) {
  return withdrawal?.type === 'revenue_withdrawal'
    && topup.type === 'ad_topup'
    && Boolean(topup.source)
    && withdrawal.source === topup.source
    && withdrawal.created_by === topup.created_by
    && Number(withdrawal.fund_change) === 0
    && Number(topup.fund_change) === 0
    && Number(withdrawal.fee || 0) === 0
    && Number(withdrawal.amount) === Number(topup.amount) + Number(topup.fee || 0);
}

function legacyMatch(withdrawal, topup) {
  const elapsed = new Date(topup.createdAt) - new Date(withdrawal.createdAt);
  return matchesTopup(withdrawal, topup)
    && withdrawal.note === `Rút tiền từ ${topup.source} để nạp quảng cáo`
    && !withdrawal.order_id && !withdrawal.ad_cost_id
    && elapsed >= 0 && elapsed <= LEGACY_PAIR_WINDOW_MS;
}

function groupFundHistory(transactions) {
  const byId = new Map(transactions.map(transaction => [idOf(transaction), transaction]));
  const consumed = new Set();
  const paired = new Map();
  const topups = transactions.filter(transaction => transaction.type === 'ad_topup');

  // New operations have an explicit link, so identical consecutive topups stay distinct.
  for (const topup of topups) {
    if (!topup.related_transaction_id) continue;
    const linked = topup.related_transaction_id;
    const withdrawal = byId.get(idOf(linked)) || (linked.type ? linked : null);
    if (matchesTopup(withdrawal, topup) && !consumed.has(idOf(withdrawal))) {
      paired.set(idOf(topup), withdrawal);
      consumed.add(idOf(withdrawal));
    }
  }

  // Older records have no link: merge only an unambiguous one-to-one pair.
  const legacyTopups = topups.filter(topup => !topup.related_transaction_id);
  const withdrawals = transactions.filter(transaction => transaction.type === 'revenue_withdrawal' && !consumed.has(idOf(transaction)));
  const candidates = new Map();
  const matchCounts = new Map();
  for (const topup of legacyTopups) {
    const matches = withdrawals.filter(withdrawal => legacyMatch(withdrawal, topup));
    candidates.set(idOf(topup), matches);
    for (const withdrawal of matches) matchCounts.set(idOf(withdrawal), (matchCounts.get(idOf(withdrawal)) || 0) + 1);
  }
  for (const topup of legacyTopups) {
    const matches = candidates.get(idOf(topup));
    if (matches.length === 1 && matchCounts.get(idOf(matches[0])) === 1) {
      paired.set(idOf(topup), matches[0]);
      consumed.add(idOf(matches[0]));
    }
  }

  return transactions.filter(transaction => !consumed.has(idOf(transaction))).map(transaction => {
    const withdrawal = paired.get(idOf(transaction));
    if (!withdrawal) return transaction;
    const oldDefaultNote = `Nạp tiền quảng cáo ${transaction.source} từ tài sản riêng`;
    return {
      ...transaction,
      // This is a display value, never written back to the ledger.
      platform_change: -Number(withdrawal.amount),
      funding_source: 'platform',
      note: !transaction.note || transaction.note === oldDefaultNote
        ? `Nạp tiền quảng cáo từ số dư ${transaction.source}` : transaction.note,
    };
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || idOf(b).localeCompare(idOf(a)));
}

function filterFundHistory(transactions, { type, startDate, endDate } = {}) {
  return transactions.filter(transaction => (!type || type === 'all' || transaction.type === type)
    && (!startDate || new Date(transaction.createdAt) >= new Date(startDate))
    && (!endDate || new Date(transaction.createdAt) <= new Date(endDate)));
}

module.exports = { groupFundHistory, filterFundHistory, LEGACY_PAIR_WINDOW_MS };
