const SystemConfig = require('../models/SystemConfig');

const CONFIG_KEY = 'carrier_cod_accounts';
const DEFAULT_ENABLED_CARRIERS = ['spx'];
const BASE_FUND_ACCOUNTS = ['pos', 'shopee', 'tiktok', 'website'];

const normalizeCarrierIds = (value) => {
  if (Array.isArray(value)) return [...new Set(value.map(String).map(id => id.trim()).filter(Boolean))];
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([id]) => String(id).trim())
      .filter(Boolean);
  }
  return DEFAULT_ENABLED_CARRIERS;
};

const getEnabledCarrierIds = async () => {
  const config = await SystemConfig.findOne({ key: CONFIG_KEY }).lean();
  return config ? normalizeCarrierIds(config.value) : DEFAULT_ENABLED_CARRIERS;
};

const carrierAccountId = carrierId => `carrier_${carrierId}`;

const getFundAccountIds = async () => {
  const carrierIds = await getEnabledCarrierIds();
  return [...BASE_FUND_ACCOUNTS, ...carrierIds.map(carrierAccountId)];
};

const resolveOrderRevenueAccount = (order, enabledCarrierIds = DEFAULT_ENABLED_CARRIERS) => {
  const source = order?.source || 'khác';
  const storedAccount = String(order?.revenue_account || '');
  if (storedAccount === 'common' || storedAccount.startsWith('carrier_') || BASE_FUND_ACCOUNTS.includes(storedAccount)) {
    return storedAccount;
  }

  if (source === 'shopee' || source === 'tiktok') return source;
  if (source === 'pos') return order?.payment_method === 'transfer' ? 'common' : 'pos';

  const carrierId = String(order?.shipping_carrier || '').trim();
  const isCarrierCod = order?.payment_method === 'cash'
    && carrierId
    && enabledCarrierIds.includes(carrierId);

  if (isCarrierCod) return carrierAccountId(carrierId);
  return source === 'website' && order?.payment_method === 'transfer' ? 'website' : 'common';
};

const buildOrderRevenueMap = async (orders) => {
  const enabledCarrierIds = await getEnabledCarrierIds();
  return orders.reduce((map, order) => {
    const account = resolveOrderRevenueAccount(order, enabledCarrierIds);
    map[account] = (map[account] || 0) + Number(order.total_price || 0);
    return map;
  }, {});
};

module.exports = {
  CONFIG_KEY,
  DEFAULT_ENABLED_CARRIERS,
  BASE_FUND_ACCOUNTS,
  normalizeCarrierIds,
  getEnabledCarrierIds,
  getFundAccountIds,
  carrierAccountId,
  resolveOrderRevenueAccount,
  buildOrderRevenueMap,
};
