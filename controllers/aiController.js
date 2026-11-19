const { GoogleGenAI } = require('@google/genai');
const Order = require('../models/Order');
const Material = require('../models/Material');
const Product = require('../models/Product');
const AdCost = require('../models/AdCost');
const AffiliateFee = require('../models/AffiliateFee');
const ImportTicket = require('../models/ImportTicket');
const ExpenseTicket = require('../models/ExpenseTicket');
const FundTransaction = require('../models/FundTransaction');
const SystemConfig = require('../models/SystemConfig');
const { enrichProductAvailability } = require('../utils/productAvailability');
const { getFundAccountIds, buildOrderRevenueMap } = require('../utils/carrierCodAccounts');
const { buildBusinessContext, SUGGESTED_QUESTIONS, buildSmartAlertsPrompt } = require('../utils/aiHelper');
const { createCurrentUnitCostResolver } = require('../utils/currentOrderCost');

const AI_CONFIG_KEY = 'ai_analyst_config';
const DEFAULT_OPENAI_MODEL = 'gpt-5.4';
const ALLOWED_OPENAI_MODELS = ['gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-4.1', 'o3', 'gpt-4o'];
const FALLBACK_OPENAI_MODELS = ['gpt-5.4', 'gpt-4.1', 'gpt-4o'];
const AD_PLATFORMS = ['facebook', 'tiktok', 'shopee', 'website', 'instagram', 'other'];

const DAY_MS = 24 * 60 * 60 * 1000;
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

const getVietnamDateString = (dateObj = new Date()) => {
  const vietnamTime = new Date(dateObj.getTime() + VIETNAM_OFFSET_MS);
  const y = vietnamTime.getUTCFullYear();
  const m = String(vietnamTime.getUTCMonth() + 1).padStart(2, '0');
  const d = String(vietnamTime.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const parseDateKey = (dateKey) => {
  const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const calendarDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return getVietnamDateString(new Date(calendarDate.getTime() - VIETNAM_OFFSET_MS)) === dateKey
    ? calendarDate
    : null;
};

const calendarDateKey = (calendarDate) => {
  const y = calendarDate.getUTCFullYear();
  const m = String(calendarDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(calendarDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const resolvePeriodParams = ({ days, endDate, filterType, periodLabel } = {}) => {
  const todayVietnam = parseDateKey(getVietnamDateString(new Date()));
  if (Number(days) > 0) {
    const parsedEnd = endDate ? parseDateKey(endDate) : todayVietnam;
    return {
      days: Math.max(1, parseInt(days, 10) || todayVietnam.getUTCDate()),
      endCalendarDate: parsedEnd || todayVietnam,
    };
  }

  const label = String(filterType || periodLabel || '').toLowerCase();
  if (label === 'today' || label.includes('hôm nay')) {
    return { days: 1, endCalendarDate: todayVietnam };
  }
  if (label === 'this_week' || label.includes('tuần này')) {
    const dayOfWeek = todayVietnam.getUTCDay();
    return { days: dayOfWeek === 0 ? 7 : dayOfWeek, endCalendarDate: todayVietnam };
  }
  if (label === 'last_month' || label.includes('tháng trước')) {
    const firstDayOfThisMonth = new Date(Date.UTC(todayVietnam.getUTCFullYear(), todayVietnam.getUTCMonth(), 1));
    const lastDayOfLastMonth = new Date(firstDayOfThisMonth.getTime() - 1);
    const endCal = new Date(Date.UTC(
      lastDayOfLastMonth.getUTCFullYear(),
      lastDayOfLastMonth.getUTCMonth(),
      lastDayOfLastMonth.getUTCDate()
    ));
    return { days: lastDayOfLastMonth.getUTCDate(), endCalendarDate: endCal };
  }
  if (label === 'this_year' || label.includes('năm nay')) {
    const startOfYear = new Date(Date.UTC(todayVietnam.getUTCFullYear(), 0, 1));
    const diffDays = Math.floor((todayVietnam - startOfYear) / DAY_MS) + 1;
    return { days: Math.max(1, diffDays), endCalendarDate: todayVietnam };
  }

  // Mặc định: Tháng này
  return { days: todayVietnam.getUTCDate(), endCalendarDate: todayVietnam };
};

// ─── AI Config Reader & Provider Selection ──────────────────────────────────
const loadAiConfig = async () => {
  const doc = await SystemConfig.findOne({ key: AI_CONFIG_KEY }).lean();
  let raw = doc?.value || {};
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = {}; }
  }
  const openaiApiKey = typeof raw?.openaiApiKey === 'string' ? raw.openaiApiKey.trim() : '';
  const requestedModel = typeof raw?.openaiModel === 'string' && raw.openaiModel.trim()
    ? raw.openaiModel.trim()
    : DEFAULT_OPENAI_MODEL;
  const openaiModel = ALLOWED_OPENAI_MODELS.includes(requestedModel) ? requestedModel : DEFAULT_OPENAI_MODEL;
  const geminiApiKey = String(process.env.GEMINI_API_KEY || '').trim();

  const activeProvider = openaiApiKey ? 'openai' : (geminiApiKey ? 'gemini' : 'none');
  const activeModel = activeProvider === 'openai' ? openaiModel : (activeProvider === 'gemini' ? 'gemini-2.5-flash' : '');

  return {
    openaiApiKey,
    openaiModel,
    geminiApiKey,
    hasOpenaiKey: Boolean(openaiApiKey),
    hasGeminiFallback: Boolean(geminiApiKey),
    activeProvider,
    activeModel,
  };
};

const extractOpenAIText = (payload) => {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const parts = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if ((content?.type === 'output_text' || content?.type === 'text') && content.text) {
        parts.push(content.text);
      }
    }
  }
  if (parts.length) return parts.join('\n').trim();
  const choiceContent = payload?.choices?.[0]?.message?.content;
  if (typeof choiceContent === 'string') return choiceContent.trim();
  return '';
};

const isModelNotFoundError = (status, message = '') => {
  const lower = String(message).toLowerCase();
  return status === 404
    || lower.includes('model_not_found')
    || lower.includes('does not exist')
    || lower.includes('do not have access')
    || lower.includes('unsupported model');
};

const callOpenAI = async ({ apiKey, model = DEFAULT_OPENAI_MODEL, systemPrompt, messages = [], jsonMode = false }) => {
  const candidates = [model, ...FALLBACK_OPENAI_MODELS.filter((m) => m !== model)];
  let lastError = null;

  for (const candidateModel of candidates) {
    try {
      const inputMessages = messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || ''),
      }));

      const body = {
        model: candidateModel,
        instructions: systemPrompt,
        input: inputMessages.length === 1 && inputMessages[0].role === 'user'
          ? inputMessages[0].content
          : inputMessages,
        max_output_tokens: jsonMode ? 1200 : 2500,
        store: false,
      };

      if (jsonMode) {
        body.text = {
          format: {
            type: 'json_schema',
            name: 'candlet_smart_alerts',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                alerts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      type: { type: 'string', enum: ['danger', 'warning', 'success', 'info'] },
                      title: { type: 'string' },
                      message: { type: 'string' },
                    },
                    required: ['type', 'title', 'message'],
                  },
                },
              },
              required: ['alerts'],
            },
          },
        };
      }

      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errMsg = payload?.error?.message || `OpenAI API error (${response.status})`;
        if (isModelNotFoundError(response.status, errMsg) && candidateModel !== candidates.at(-1)) {
          lastError = new Error(errMsg);
          continue;
        }
        const err = new Error(errMsg);
        err.status = response.status;
        throw err;
      }

      const text = extractOpenAIText(payload);
      if (!text) throw new Error('OpenAI trả về phản hồi rỗng');
      return { text, model: candidateModel, provider: 'openai' };
    } catch (error) {
      lastError = error;
      if (!isModelNotFoundError(error.status, error.message)) {
        throw error;
      }
    }
  }

  throw lastError || new Error('Không thể kết nối OpenAI GPT');
};

// ─── Đồng bộ toàn bộ dữ liệu kinh doanh thực tế ─────────────────────────────
const fetchDashboardData = async (options = {}) => {
  const { days, endCalendarDate } = resolvePeriodParams(options);

  const startCalendarDate = new Date(endCalendarDate.getTime() - ((days - 1) * DAY_MS));
  const startOfCurrentPeriod = new Date(startCalendarDate.getTime() - VIETNAM_OFFSET_MS);
  const endOfPeriod = new Date(endCalendarDate.getTime() + DAY_MS - VIETNAM_OFFSET_MS - 1);

  const endOfPrevPeriod = new Date(startOfCurrentPeriod.getTime() - 1);
  const startPrevCalendarDate = new Date(startCalendarDate.getTime() - (days * DAY_MS));
  const endPrevCalendarDate = new Date(startCalendarDate.getTime() - DAY_MS);
  const startOfPrevPeriod = new Date(startPrevCalendarDate.getTime() - VIETNAM_OFFSET_MS);

  const [
    ordersCurrent,
    ordersPrev,
    adsCurrent,
    adsPrev,
    materials,
    products,
    affiliateFees,
    fundAgg,
    completedOrdersAll,
    withdrawnAgg,
    adjustmentAgg,
    importDebtAgg,
    importsInPeriod,
    pendingImportsCount,
    expensesInPeriod,
    adTopupAgg,
    adCostAllAgg,
  ] = await Promise.all([
    Order.find({ ordered_at: { $gte: startOfCurrentPeriod, $lte: endOfPeriod } }).lean(),
    Order.find({ ordered_at: { $gte: startOfPrevPeriod, $lte: endOfPrevPeriod } }).lean(),
    AdCost.find({ date: { $gte: startOfCurrentPeriod, $lte: endOfPeriod } }).lean(),
    AdCost.find({ date: { $gte: startOfPrevPeriod, $lte: endOfPrevPeriod } }).lean(),
    Material.find({}).lean(),
    Product.find({})
      .populate('base_ingredients.ingredient_id')
      .populate('resolved_base_ingredients.ingredient_id')
      .populate('skus.extra_ingredients.ingredient_id')
      .lean(),
    AffiliateFee.find({}).lean(),
    FundTransaction.aggregate([{ $group: { _id: null, totalBalance: { $sum: '$fund_change' } } }]),
    Order.find({
      status: 'completed',
      delivery_status: { $nin: ['returning', 'returned', 'failed', 'cancelled'] },
    }).select('source total_price tracking_enabled payment_method shipping_carrier revenue_account').lean(),
    FundTransaction.aggregate([
      { $match: { type: 'revenue_withdrawal' } },
      { $group: { _id: '$source', totalWithdrawn: { $sum: '$amount' } } },
    ]),
    FundTransaction.aggregate([
      { $match: { type: 'platform_adjustment' } },
      { $group: { _id: '$source', totalAdjustment: { $sum: '$platform_change' } } },
    ]),
    ImportTicket.aggregate([
      { $match: { payment_status: { $ne: 'settled' } } },
      { $group: { _id: null, totalDebt: { $sum: '$total_amount' } } },
    ]),
    ImportTicket.find({
      status: 'completed',
      completed_at: { $gte: startOfCurrentPeriod, $lte: endOfPeriod },
    }).select('code total_amount completed_at').lean(),
    ImportTicket.countDocuments({ status: 'pending' }),
    ExpenseTicket.find({
      createdAt: { $gte: startOfCurrentPeriod, $lte: endOfPeriod },
    }).sort({ createdAt: -1 }).lean(),
    FundTransaction.aggregate([
      { $match: { type: { $in: ['ad_topup', 'ad_adjustment'] } } },
      {
        $group: {
          _id: '$source',
          totalTopup: {
            $sum: { $cond: [{ $eq: ['$type', 'ad_topup'] }, '$amount', '$platform_change'] },
          },
        },
      },
    ]),
    AdCost.aggregate([{ $group: { _id: '$platform', totalSpent: { $sum: '$base_amount' } } }]),
  ]);
  const unitCostFor = createCurrentUnitCostResolver(products);

  // 1. Phân loại trạng thái đơn hàng khớp 100% với adminController.js
  const isActiveRevenueOrder = (o) => (
    o.status !== 'returned'
    && o.status !== 'cancelled'
    && !['returning', 'returned', 'failed', 'cancelled'].includes(o.delivery_status)
  );
  const isReturnedOrder = (o) => (
    o.status === 'returned'
    || ['returning', 'returned', 'failed'].includes(o.delivery_status)
  );
  const isCancelledOrder = (o) => (
    o.status === 'cancelled' || o.delivery_status === 'cancelled'
  );

  const activeCurrent = ordersCurrent.filter(isActiveRevenueOrder);
  const returnedCurrent = ordersCurrent.filter(isReturnedOrder);
  const cancelledCurrent = ordersCurrent.filter(isCancelledOrder);
  const activePrev = ordersPrev.filter(isActiveRevenueOrder);
  const returnedPrev = ordersPrev.filter(isReturnedOrder);

  const deliveryBreakdown = {
    total: ordersCurrent.length,
    delivered: activeCurrent.filter((o) => o.delivery_status === 'delivered' || o.status === 'completed').length,
    shipping: activeCurrent.filter((o) => ['shipping', 'delivering', 'picked_up'].includes(o.delivery_status)).length,
    pending: activeCurrent.filter((o) => !['delivered', 'shipping', 'delivering', 'picked_up'].includes(o.delivery_status) && o.status !== 'completed').length,
    returned: returnedCurrent.length,
    cancelled: cancelledCurrent.length,
  };

  const revCurrent = activeCurrent.reduce((sum, o) => sum + ((o.is_replacement || o.is_seeding) ? 0 : (o.total_price || 0)), 0);
  const revPrev = activePrev.reduce((sum, o) => sum + ((o.is_replacement || o.is_seeding) ? 0 : (o.total_price || 0)), 0);
  const revenueGrowth = revPrev === 0 ? null : Number((((revCurrent - revPrev) / revPrev) * 100).toFixed(1));

  const ordCurrent = activeCurrent.filter((o) => !o.is_replacement && !o.is_seeding).length;
  const ordPrev = activePrev.filter((o) => !o.is_replacement && !o.is_seeding).length;
  const ordersGrowth = ordPrev === 0 ? null : Number((((ordCurrent - ordPrev) / ordPrev) * 100).toFixed(1));

  const adCurrentTotal = adsCurrent.reduce((sum, a) => sum + (a.amount || 0), 0);
  const adPrevTotal = adsPrev.reduce((sum, a) => sum + (a.amount || 0), 0);
  const adCostGrowth = adPrevTotal === 0 ? null : Number((((adCurrentTotal - adPrevTotal) / adPrevTotal) * 100).toFixed(1));

  // Tính phí Affiliate chính xác theo ngày trong tháng giống adminController.js
  const calculateExactAffiliateFee = (startCalendar, endCalendar) => {
    let totalFee = 0;
    const platformFees = {};
    const iter = new Date(startCalendar);
    let safeGuard = 0;
    while (iter <= endCalendar && safeGuard < 5000) {
      const m = iter.getUTCMonth() + 1;
      const y = iter.getUTCFullYear();
      const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const monthlyFees = affiliateFees.filter((f) => f.month === m && f.year === y);
      monthlyFees.forEach((f) => {
        const dailyAmount = (f.amount || 0) / daysInMonth;
        totalFee += dailyAmount;
        const plat = f.platform || 'khác';
        platformFees[plat] = (platformFees[plat] || 0) + dailyAmount;
      });
      iter.setUTCDate(iter.getUTCDate() + 1);
      safeGuard++;
    }
    return { totalFee, platformFees };
  };

  const currentAffiliateData = calculateExactAffiliateFee(startCalendarDate, endCalendarDate);
  const affiliateFeeCurrentTotal = currentAffiliateData.totalFee;
  const prevAffiliateData = calculateExactAffiliateFee(startPrevCalendarDate, endPrevCalendarDate);
  const affiliateFeePrevTotal = prevAffiliateData.totalFee;

  const normalCompletedCurrent = activeCurrent.filter((o) => !o.is_replacement && !o.is_seeding);
  const replacementCurrent = activeCurrent.filter((o) => o.is_replacement);
  const seedingCurrent = activeCurrent.filter((o) => o.is_seeding);
  const normalCompletedPrev = activePrev.filter((o) => !o.is_replacement && !o.is_seeding);

  const currentCOGS = normalCompletedCurrent.reduce(
    (sum, o) => sum + (o.items || []).reduce((s, item) => s + (unitCostFor(item) * item.quantity), 0) + (o.packaging_cost || 0),
    0
  );
  const prevCOGS = normalCompletedPrev.reduce(
    (sum, o) => sum + (o.items || []).reduce((s, item) => s + (unitCostFor(item) * item.quantity), 0) + (o.packaging_cost || 0),
    0
  );

  const currentLogistics = normalCompletedCurrent.reduce((sum, o) => sum + (o.logistics_cost || 0), 0);
  const prevLogistics = normalCompletedPrev.reduce((sum, o) => sum + (o.logistics_cost || 0), 0);

  const currentReplacementCost = replacementCurrent.reduce(
    (sum, o) => sum + (o.items || []).reduce((s, item) => s + (unitCostFor(item) * item.quantity), 0) + (o.packaging_cost || 0) + (o.logistics_cost || 0),
    0
  );
  const prevReplacementCost = activePrev.filter((o) => o.is_replacement).reduce(
    (sum, o) => sum + (o.items || []).reduce((s, item) => s + (unitCostFor(item) * item.quantity), 0) + (o.packaging_cost || 0) + (o.logistics_cost || 0),
    0
  );

  const currentSeedingCost = seedingCurrent.reduce(
    (sum, o) => sum + (o.seeding_cost || 0) - (o.total_price || 0) + (o.items || []).reduce((s, item) => s + (unitCostFor(item) * item.quantity), 0) + (o.packaging_cost || 0) + (o.logistics_cost || 0),
    0
  );
  const prevSeedingCost = activePrev.filter((o) => o.is_seeding).reduce(
    (sum, o) => sum + (o.seeding_cost || 0) - (o.total_price || 0) + (o.items || []).reduce((s, item) => s + (unitCostFor(item) * item.quantity), 0) + (o.packaging_cost || 0) + (o.logistics_cost || 0),
    0
  );
  const seedingCostGrowth = prevSeedingCost === 0 ? null : Number((((currentSeedingCost - prevSeedingCost) / prevSeedingCost) * 100).toFixed(1));

  const currentReturnCosts = returnedCurrent.reduce((sum, o) => sum + (o.return_cost || 0), 0);
  const prevReturnCosts = returnedPrev.reduce((sum, o) => sum + (o.return_cost || 0), 0);

  const realProfitCurrent = revCurrent - currentCOGS - adCurrentTotal - currentLogistics - currentReturnCosts - currentReplacementCost - currentSeedingCost - affiliateFeeCurrentTotal;
  const realProfitPrev = revPrev - prevCOGS - adPrevTotal - prevLogistics - prevReturnCosts - prevReplacementCost - prevSeedingCost - affiliateFeePrevTotal;
  const realProfitGrowth = realProfitPrev === 0 ? null : Number((((realProfitCurrent - realProfitPrev) / Math.abs(realProfitPrev)) * 100).toFixed(1));

  // 2. Xu hướng theo ngày & Cơ cấu chi phí
  const chartDataMap = {};
  for (let i = 0; i < days; i++) {
    const calendarDate = new Date(startCalendarDate.getTime() + (i * DAY_MS));
    const dateKey = calendarDateKey(calendarDate);
    const dayStr = `${dateKey.slice(8, 10)}/${dateKey.slice(5, 7)}`;
    chartDataMap[dateKey] = { date: dayStr, dateKey, revenue: 0, cost: 0, cogs: 0 };
  }

  ordersCurrent.forEach((o) => {
    const dateKey = getVietnamDateString(new Date(o.ordered_at));
    if (chartDataMap[dateKey]) {
      if (isActiveRevenueOrder(o)) {
        if (!o.is_replacement && !o.is_seeding) {
          chartDataMap[dateKey].revenue += (o.total_price || 0);
        }
        const cogs = (o.items || []).reduce((sum, item) => sum + (unitCostFor(item) * item.quantity), 0) + (o.packaging_cost || 0);
        const logistics = (o.logistics_cost || 0);
        chartDataMap[dateKey].cogs += cogs;
        chartDataMap[dateKey].cost += cogs + logistics + (o.seeding_cost || 0);
      } else if (isReturnedOrder(o)) {
        chartDataMap[dateKey].cost += (o.return_cost || 0);
      }
    }
  });

  adsCurrent.forEach((a) => {
    const dateKey = getVietnamDateString(new Date(a.date));
    if (chartDataMap[dateKey]) {
      chartDataMap[dateKey].cost += (a.amount || 0);
    }
  });

  const chartData = Object.values(chartDataMap);
  const peakRevenueDay = [...chartData].sort((a, b) => b.revenue - a.revenue)[0] || null;
  const peakCostDay = [...chartData].sort((a, b) => b.cost - a.cost)[0] || null;
  const activeSalesDays = chartData.filter((d) => d.revenue > 0).length;

  const totalCOGSForStructure = chartData.reduce((sum, d) => sum + d.cogs, 0);
  const totalLogisticsAndReturns = currentLogistics + currentReturnCosts;
  const totalCostForStructure = totalCOGSForStructure + adCurrentTotal + affiliateFeeCurrentTotal + totalLogisticsAndReturns;

  const costStructure = {
    ads: totalCostForStructure > 0 ? +((adCurrentTotal / totalCostForStructure) * 100).toFixed(1) : 0,
    inventory: totalCostForStructure > 0 ? +((totalCOGSForStructure / totalCostForStructure) * 100).toFixed(1) : 0,
    logistics: totalCostForStructure > 0 ? +((totalLogisticsAndReturns / totalCostForStructure) * 100).toFixed(1) : 0,
    affiliate: totalCostForStructure > 0 ? +((affiliateFeeCurrentTotal / totalCostForStructure) * 100).toFixed(1) : 0,
  };

  // 3. Thống kê theo Nền tảng (kèm chi phí Ads & Affiliate từng nền tảng)
  const platformMap = {};
  ordersCurrent.forEach((o) => {
    const src = o.source || 'khác';
    if (!platformMap[src]) {
      platformMap[src] = { source: src, orders: 0, revenue: 0, returned: 0, replacements: 0, affiliate_fee: 0, ad_cost: 0 };
    }
    if (isActiveRevenueOrder(o)) {
      if (!o.is_replacement && !o.is_seeding) {
        platformMap[src].orders += 1;
        platformMap[src].revenue += (o.total_price || 0);
      } else if (o.is_replacement) {
        platformMap[src].replacements += 1;
      }
    } else if (isReturnedOrder(o)) {
      platformMap[src].returned += 1;
    }
  });

  adsCurrent.forEach((a) => {
    const plat = a.platform === 'other' ? 'khác' : (a.platform || 'khác');
    if (!platformMap[plat]) {
      platformMap[plat] = { source: plat, orders: 0, revenue: 0, returned: 0, replacements: 0, affiliate_fee: 0, ad_cost: 0 };
    }
    platformMap[plat].ad_cost += (a.amount || 0);
  });

  Object.entries(currentAffiliateData.platformFees).forEach(([src, amount]) => {
    if (amount > 0) {
      if (!platformMap[src]) {
        platformMap[src] = { source: src, orders: 0, revenue: 0, returned: 0, replacements: 0, affiliate_fee: 0, ad_cost: 0 };
      }
      platformMap[src].affiliate_fee += amount;
    }
  });

  const platformStats = Object.values(platformMap).sort((a, b) => b.revenue - a.revenue);

  // Số dư ví Ads hiện tại
  const topupMap = {};
  adTopupAgg.forEach((item) => {
    if (!item._id) return;
    const plat = item._id === 'youtube' ? 'other' : item._id;
    topupMap[plat] = (topupMap[plat] || 0) + item.totalTopup;
  });
  const adSpentMap = {};
  adCostAllAgg.forEach((item) => {
    if (!item._id) return;
    const plat = item._id === 'youtube' ? 'other' : item._id;
    adSpentMap[plat] = (adSpentMap[plat] || 0) + item.totalSpent;
  });
  const adBalances = AD_PLATFORMS.map((platform) => ({
    platform,
    totalTopup: topupMap[platform] || 0,
    totalSpent: adSpentMap[platform] || 0,
    balance: (topupMap[platform] || 0) - (adSpentMap[platform] || 0),
  }));

  // 4. Hiệu suất Sản phẩm & Phân loại SKU (đồng bộ 100% với adminController.js)
  const productMap = {};
  normalCompletedCurrent.forEach((o) => {
    const orderTotalRaw = (o.items || []).reduce((sum, item) => sum + ((item.unit_price || 0) * item.quantity), 0);
    const orderNetRevenue = (o.total_price || 0) - (o.logistics_cost || 0);

    (o.items || []).forEach((item) => {
      const key = item.productId || String(item.product_id);
      if (!productMap[key]) {
        productMap[key] = {
          productId: item.productId,
          product_name: item.product_name,
          totalQty: 0,
          totalRevenue: 0,
          totalCOGS: 0,
          returnedQty: 0,
          variantsMap: {},
        };
      }
      productMap[key].totalQty += item.quantity;

      const variantKey = item.sku_id || 'default';
      if (!productMap[key].variantsMap[variantKey]) {
        productMap[key].variantsMap[variantKey] = {
          sku_id: item.sku_id,
          sku_label: item.sku_label || 'Mặc định',
          totalQty: 0,
          totalRevenue: 0,
          totalCOGS: 0,
          returnedQty: 0,
        };
      }
      productMap[key].variantsMap[variantKey].totalQty += item.quantity;
      productMap[key].variantsMap[variantKey].totalCOGS += unitCostFor(item) * item.quantity;

      let itemRevenue = 0;
      if (orderTotalRaw > 0) {
        const itemShare = ((item.unit_price || 0) * item.quantity) / orderTotalRaw;
        itemRevenue = orderNetRevenue * itemShare;
      } else {
        itemRevenue = orderNetRevenue / ((o.items || []).length || 1);
      }
      productMap[key].totalRevenue += itemRevenue;
      productMap[key].variantsMap[variantKey].totalRevenue += itemRevenue;
      productMap[key].totalCOGS += unitCostFor(item) * item.quantity;
    });
  });

  returnedCurrent.forEach((o) => {
    (o.items || []).forEach((item) => {
      const key = item.productId || String(item.product_id);
      if (productMap[key]) {
        productMap[key].returnedQty += item.quantity;
        const variantKey = item.sku_id || 'default';
        if (productMap[key].variantsMap?.[variantKey]) {
          productMap[key].variantsMap[variantKey].returnedQty += item.quantity;
        }
      }
    });
  });

  const productStats = Object.values(productMap)
    .map((p) => {
      const grossMargin = p.totalRevenue > 0 ? ((p.totalRevenue - p.totalCOGS) / p.totalRevenue) * 100 : 0;
      const adShare = revCurrent > 0 ? (p.totalRevenue / revCurrent) * adCurrentTotal : 0;
      const netProfit = p.totalRevenue - p.totalCOGS - adShare;
      const netMargin = p.totalRevenue > 0 ? (netProfit / p.totalRevenue) * 100 : 0;
      const returnRate = (p.totalQty + p.returnedQty) > 0 ? (p.returnedQty / (p.totalQty + p.returnedQty)) * 100 : 0;

      const variants = Object.values(p.variantsMap || {})
        .map((v) => {
          const vGrossMargin = v.totalRevenue > 0 ? ((v.totalRevenue - v.totalCOGS) / v.totalRevenue) * 100 : 0;
          const vAdShare = revCurrent > 0 ? (v.totalRevenue / revCurrent) * adCurrentTotal : 0;
          const vNetProfit = v.totalRevenue - v.totalCOGS - vAdShare;
          return {
            ...v,
            grossMargin: +vGrossMargin.toFixed(1),
            netProfit: Math.round(vNetProfit),
          };
        })
        .sort((a, b) => b.totalRevenue - a.totalRevenue);

      const { variantsMap, ...rest } = p;
      return {
        ...rest,
        variants,
        grossMargin: +grossMargin.toFixed(1),
        netMargin: +netMargin.toFixed(1),
        netProfit: Math.round(netProfit),
        adShare: Math.round(adShare),
        returnRate: +returnRate.toFixed(1),
      };
    })
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  // 5. Danh mục sản phẩm & năng lực sản xuất từ tồn kho nguyên liệu (BOM)
  const enrichedProducts = products.map((p) => {
    const obj = { ...p };
    let base_cost = 0;
    const baseList = obj.resolved_base_ingredients?.length ? obj.resolved_base_ingredients : (obj.base_ingredients || []);
    baseList.forEach((item) => {
      if (item.ingredient_id?.price) {
        base_cost += item.ingredient_id.price * item.quantity;
      }
    });
    obj.base_cost = base_cost;
    if (obj.skus) {
      obj.skus = obj.skus.map((sku) => {
        let extra_cost = 0;
        (sku.extra_ingredients || []).forEach((item) => {
          if (item.ingredient_id?.price) {
            extra_cost += item.ingredient_id.price * item.quantity;
          }
        });
        return { ...sku, cost: base_cost + extra_cost };
      });
    }
    return enrichProductAvailability(obj);
  });

  const sellableProducts = enrichedProducts.filter((p) => p.product_type !== 'sub_formula');
  const subFormulas = enrichedProducts.filter((p) => p.product_type === 'sub_formula');
  const catalogSummary = {
    totalSellable: sellableProducts.length,
    totalSubFormulas: subFormulas.length,
    outOfStockCount: sellableProducts.filter((p) => p.stock === 0).length,
    products: sellableProducts.map((p) => {
      const skuCosts = (p.skus || []).map((s) => s.cost).filter((c) => Number.isFinite(c));
      const minCost = skuCosts.length ? Math.min(...skuCosts) : (p.base_cost || 0);
      const maxCost = skuCosts.length ? Math.max(...skuCosts) : (p.base_cost || 0);
      const outOfStockSkus = (p.skus || []).filter((s) => s.stock === 0).map((s) => (s.combination || []).join('-'));
      return {
        name: p.name,
        productId: p.productId,
        base_price: p.base_price,
        minCost: Math.round(minCost),
        maxCost: Math.round(maxCost),
        stock: p.stock,
        outOfStockSkus: outOfStockSkus.slice(0, 4),
      };
    }),
  };

  // 6. Tồn kho Nguyên vật liệu & Nhập kho
  const inventoryValue = materials.reduce((sum, m) => sum + ((m.actualStock || 0) * (m.price || 0)), 0);
  const availableInventoryValue = materials.reduce((sum, m) => sum + ((m.stock || 0) * (m.price || 0)), 0);
  const materialsWithValue = materials.map((m) => ({
    name: m.name,
    category: m.category,
    unit: m.unit,
    price: m.price || 0,
    stock: Number((m.stock || 0).toFixed(4)),
    actualStock: Number((m.actualStock || 0).toFixed(4)),
    totalValue: (m.actualStock || 0) * (m.price || 0),
  }));

  const inventorySummary = {
    totalMaterials: materials.length,
    availableInventoryValue,
    outOfStockCount: materialsWithValue.filter((m) => m.actualStock <= 0).length,
    lowStockCount: materialsWithValue.filter((m) => m.actualStock > 0 && m.actualStock <= 10).length,
    lowOrOutMaterials: [...materialsWithValue]
      .filter((m) => m.actualStock <= 10)
      .sort((a, b) => a.actualStock - b.actualStock),
    topValueMaterials: [...materialsWithValue]
      .filter((m) => m.totalValue > 0)
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, 10),
    importsInPeriodCount: importsInPeriod.length,
    importsInPeriodAmount: importsInPeriod.reduce((sum, t) => sum + (t.total_amount || 0), 0),
    pendingImportsCount,
  };

  // 7. Quỹ tiền mặt, Số dư nền tảng chưa rút & Công nợ nhập kho (khớp 100% với fundController.getSummary)
  const totalFundBalance = fundAgg.length > 0 ? fundAgg[0].totalBalance : 0;
  const totalImportDebt = importDebtAgg.length > 0 ? importDebtAgg[0].totalDebt : 0;
  const revenueMap = await buildOrderRevenueMap(completedOrdersAll);
  const withdrawnMap = {};
  const adjustmentMap = {};
  withdrawnAgg.forEach((item) => { withdrawnMap[item._id || 'khác'] = item.totalWithdrawn; });
  adjustmentAgg.forEach((item) => { adjustmentMap[item._id || 'khác'] = item.totalAdjustment; });

  const configuredAccounts = await getFundAccountIds();
  const fundPlatforms = [...new Set([
    ...configuredAccounts,
    ...Object.keys(revenueMap).filter((p) => p.startsWith('carrier_')),
    ...Object.keys(withdrawnMap).filter((p) => p.startsWith('carrier_')),
    ...Object.keys(adjustmentMap).filter((p) => p.startsWith('carrier_')),
  ])];

  const platformBalances = fundPlatforms.map((platform) => {
    const totalRevenue = revenueMap[platform] || 0;
    const totalWithdrawn = withdrawnMap[platform] || 0;
    const totalAdjustment = adjustmentMap[platform] || 0;
    return {
      platform,
      totalRevenue,
      totalWithdrawn,
      totalAdjustment,
      availableBalance: totalRevenue - totalWithdrawn + totalAdjustment,
    };
  });

  const totalPlatformAvailable = platformBalances.reduce((sum, p) => sum + (p.availableBalance || 0), 0);
  const expectedFund = totalFundBalance + totalPlatformAvailable - totalImportDebt;

  // 8. Phiếu chi tiêu ngoài trong kỳ
  const expenseByCatMap = {};
  expensesInPeriod.forEach((e) => {
    const cat = e.category || 'Khác';
    if (!expenseByCatMap[cat]) expenseByCatMap[cat] = { category: cat, amount: 0, count: 0 };
    expenseByCatMap[cat].amount += (e.amount || 0);
    expenseByCatMap[cat].count += 1;
  });

  const expenseSummary = {
    totalInPeriod: expensesInPeriod.reduce((sum, e) => sum + (e.amount || 0), 0),
    countInPeriod: expensesInPeriod.length,
    byCategory: Object.values(expenseByCatMap).sort((a, b) => b.amount - a.amount),
    recent: expensesInPeriod.slice(0, 6).map((e) => ({
      code: e.code,
      title: e.title,
      category: e.category || 'Khác',
      amount: e.amount || 0,
    })),
  };

  return {
    dateRange: {
      startDate: calendarDateKey(startCalendarDate),
      endDate: calendarDateKey(endCalendarDate),
      days,
    },
    totalRevenue: revCurrent,
    revenueGrowth,
    newOrders: ordCurrent,
    ordersGrowth,
    realProfit: realProfitCurrent,
    realProfitGrowth,
    returnedOrders: returnedCurrent.length,
    returnRate: ordCurrent > 0 ? +((returnedCurrent.length / ordCurrent) * 100).toFixed(1) : 0,
    returnCost: currentReturnCosts,
    cancelledOrders: cancelledCurrent.length,
    cogs: currentCOGS,
    adCost: adCurrentTotal,
    adCostGrowth,
    affiliateFee: affiliateFeeCurrentTotal,
    logisticsCost: currentLogistics,
    replacementCost: currentReplacementCost,
    replacementOrders: replacementCurrent.length,
    seedingOrders: seedingCurrent.length,
    seedingCost: currentSeedingCost,
    seedingCostGrowth,
    inventoryValue,
    costStructure,
    deliveryBreakdown,
    platformStats,
    adBalances,
    productStats,
    catalogSummary,
    inventorySummary,
    fundSummary: {
      totalFundBalance,
      platformBalances,
      totalPlatformAvailable,
      totalImportDebt,
      expectedFund,
    },
    expenseSummary,
    trendSummary: {
      peakRevenueDay,
      peakCostDay,
      activeSalesDays,
      totalDays: days,
    },
  };
};

exports.fetchDashboardData = fetchDashboardData;

// ─── Controllers ────────────────────────────────────────────────────────────

// @desc    Lấy cấu hình AI Business Analyst hiện tại (OpenAI GPT / Gemini fallback)
// @route   GET /api/ai/config
// @access  Private/Admin
exports.getAiConfig = async (req, res, next) => {
  try {
    const config = await loadAiConfig();
    res.status(200).json({
      success: true,
      data: {
        openaiApiKey: config.openaiApiKey,
        openaiModel: config.openaiModel,
        hasOpenaiKey: config.hasOpenaiKey,
        hasGeminiFallback: config.hasGeminiFallback,
        activeProvider: config.activeProvider,
        activeModel: config.activeModel,
        allowedModels: ALLOWED_OPENAI_MODELS,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Cập nhật cấu hình AI Business Analyst trong Cài đặt
// @route   PUT /api/ai/config
// @access  Private/Admin
exports.updateAiConfig = async (req, res, next) => {
  try {
    const openaiApiKey = typeof req.body?.openaiApiKey === 'string' ? req.body.openaiApiKey.trim() : '';
    const requestedModel = typeof req.body?.openaiModel === 'string' && req.body.openaiModel.trim()
      ? req.body.openaiModel.trim()
      : DEFAULT_OPENAI_MODEL;
    const openaiModel = ALLOWED_OPENAI_MODELS.includes(requestedModel) ? requestedModel : DEFAULT_OPENAI_MODEL;

    await SystemConfig.findOneAndUpdate(
      { key: AI_CONFIG_KEY },
      { $set: { key: AI_CONFIG_KEY, value: { openaiApiKey, openaiModel } } },
      { upsert: true, new: true }
    );

    const updated = await loadAiConfig();
    res.status(200).json({
      success: true,
      message: updated.hasOpenaiKey
        ? `Đã lưu cấu hình OpenAI GPT (${updated.openaiModel}).`
        : 'Đã xóa API Key GPT. Hệ thống tự động chuyển về Gemini AI mặc định.',
      data: {
        openaiApiKey: updated.openaiApiKey,
        openaiModel: updated.openaiModel,
        hasOpenaiKey: updated.hasOpenaiKey,
        hasGeminiFallback: updated.hasGeminiFallback,
        activeProvider: updated.activeProvider,
        activeModel: updated.activeModel,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Kiểm tra kết nối OpenAI GPT API Key trực tiếp từ trang Cài đặt
// @route   POST /api/ai/test-config
// @access  Private/Admin
exports.testAiConfig = async (req, res) => {
  try {
    const saved = await loadAiConfig();
    const apiKey = (typeof req.body?.openaiApiKey === 'string' ? req.body.openaiApiKey.trim() : '') || saved.openaiApiKey;
    const requestedModel = (typeof req.body?.openaiModel === 'string' ? req.body.openaiModel.trim() : '') || saved.openaiModel || DEFAULT_OPENAI_MODEL;

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập OpenAI API Key trước khi kiểm tra kết nối.',
      });
    }

    const result = await callOpenAI({
      apiKey,
      model: requestedModel,
      systemPrompt: 'Bạn là AI Business Analyst của CandletShop.',
      messages: [{ role: 'user', content: 'Trả lời đúng 1 câu ngắn xác nhận kết nối thành công.' }],
    });

    res.status(200).json({
      success: true,
      message: `Kết nối OpenAI thành công với model ${result.model}!`,
      data: {
        provider: 'openai',
        model: result.model,
        reply: result.text,
      },
    });
  } catch (error) {
    const msg = error.message || 'Không thể kết nối tới OpenAI API';
    res.status(400).json({
      success: false,
      message: `Kiểm tra thất bại: ${msg}`,
    });
  }
};

// @desc    Lấy câu hỏi gợi ý
// @route   GET /api/ai/suggestions
// @access  Private
exports.getSuggestions = async (req, res) => {
  const config = await loadAiConfig().catch(() => ({ activeProvider: 'gemini', activeModel: 'gemini-2.5-flash' }));
  res.status(200).json({
    success: true,
    data: SUGGESTED_QUESTIONS,
    meta: {
      provider: config.activeProvider,
      model: config.activeModel,
    },
  });
};

// @desc    Lấy danh sách cảnh báo thông minh (Smart Alerts)
// @route   GET /api/ai/smart-alerts
// @access  Private
exports.getSmartAlerts = async (req, res) => {
  try {
    const config = await loadAiConfig();
    if (!config.hasOpenaiKey && !config.hasGeminiFallback) {
      return res.status(503).json({ success: false, message: 'Chưa cấu hình API Key cho AI' });
    }

    const dashboardData = await fetchDashboardData();
    const prompt = buildSmartAlertsPrompt(dashboardData);
    let alerts = [];

    if (config.hasOpenaiKey) {
      const result = await callOpenAI({
        apiKey: config.openaiApiKey,
        model: config.openaiModel,
        systemPrompt: 'Bạn là AI Business Analyst của CandletShop. Phân tích dữ liệu và trả về tối đa 3 cảnh báo JSON.',
        messages: [{ role: 'user', content: prompt }],
        jsonMode: true,
      });
      try {
        const parsed = JSON.parse(result.text);
        alerts = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.alerts) ? parsed.alerts : []);
      } catch (e) {
        console.error('Failed to parse OpenAI Smart Alerts JSON:', result.text);
      }
    } else {
      const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });
      try {
        alerts = JSON.parse(response.text);
        if (!Array.isArray(alerts)) alerts = [];
      } catch (e) {
        console.error('Failed to parse Gemini Smart Alerts JSON:', response.text);
      }
    }

    res.status(200).json({ success: true, data: alerts.slice(0, 3) });
  } catch (error) {
    const errMessage = error.message || '';
    if (
      error.status === 429
      || error.status === 503
      || errMessage.includes('429')
      || errMessage.includes('503')
      || errMessage.includes('UNAVAILABLE')
      || errMessage.includes('quota')
      || errMessage.toLowerCase().includes('rate limit')
      || errMessage.includes('Too Many Requests')
      || errMessage.includes('high demand')
    ) {
      return res.status(503).json({ success: false, message: 'Hệ thống AI đang bị quá tải, vui lòng thử lại sau vài phút.' });
    }

    console.error('Smart Alerts Error:', errMessage || error);
    res.status(500).json({ success: false, message: 'Lỗi khi tạo cảnh báo', data: [] });
  }
};

// @desc    Chat với AI Business Analyst (Ưu tiên OpenAI GPT cấu hình trong Cài đặt, fallback Gemini)
// @route   POST /api/ai/chat
// @access  Private
exports.chat = async (req, res) => {
  try {
    const config = await loadAiConfig();
    if (!config.hasOpenaiKey && !config.hasGeminiFallback) {
      return res.status(503).json({
        success: false,
        message: 'Chưa cấu hình OpenAI API Key trong Cài đặt và cũng chưa có GEMINI_API_KEY dự phòng.',
      });
    }

    const {
      message,
      history = [],
      periodLabel = 'Tháng này',
      days,
      endDate,
      filterType,
      currentPage = '',
    } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập câu hỏi' });
    }

    // Đồng bộ toàn bộ dữ liệu kinh doanh theo đúng kỳ báo cáo đang chọn
    const dashboardData = await fetchDashboardData({ days, endDate, filterType, periodLabel });
    const systemPrompt = buildBusinessContext(dashboardData, periodLabel, currentPage);

    const validHistory = history
      .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content.trim())
      .slice(-20);

    // 1. Nếu Admin đã cấu hình OpenAI API Key trong Cài đặt -> Dùng OpenAI GPT với model tốt nhất
    if (config.hasOpenaiKey) {
      const conversationMessages = [
        ...validHistory.map((h) => ({ role: h.role, content: h.content })),
        { role: 'user', content: message.trim() },
      ];

      const result = await callOpenAI({
        apiKey: config.openaiApiKey,
        model: config.openaiModel,
        systemPrompt,
        messages: conversationMessages,
      });

      return res.status(200).json({
        success: true,
        data: {
          message: result.text,
          role: 'assistant',
          provider: 'openai',
          model: result.model,
        },
      });
    }

    // 2. Nếu chưa cấu hình OpenAI API Key -> Dùng Gemini AI hiện tại
    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    const contents = [];
    let lastRole = null;
    for (const h of validHistory) {
      const role = h.role === 'assistant' ? 'model' : 'user';
      if (contents.length === 0 && role === 'model') continue;
      if (role === lastRole) continue;
      contents.push({ role, parts: [{ text: h.content }] });
      lastRole = role;
    }

    if (lastRole === 'user') {
      contents.push({ role: 'model', parts: [{ text: '...' }] });
    }
    contents.push({ role: 'user', parts: [{ text: message.trim() }] });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction: systemPrompt,
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        message: response.text,
        role: 'assistant',
        provider: 'gemini',
        model: 'gemini-2.5-flash',
      },
    });
  } catch (error) {
    console.error('AI Chat Error:', error.message || error);

    const errMsg = error.message || '';
    if (errMsg.includes('API_KEY_INVALID') || errMsg.includes('API key not valid') || errMsg.includes('Incorrect API key') || error.status === 401) {
      return res.status(401).json({
        success: false,
        message: '❌ API Key không hợp lệ. Vui lòng kiểm tra lại API Key trong phần Cài đặt hệ thống.',
      });
    }
    if (errMsg.includes('PERMISSION_DENIED') || error.status === 403) {
      return res.status(403).json({
        success: false,
        message: '❌ API Key không có quyền truy cập model này. Vui lòng kiểm tra lại quyền hạn tài khoản API.',
      });
    }
    if (errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('insufficient_quota') || error.status === 429) {
      return res.status(429).json({
        success: false,
        message: '⚠️ Đã vượt giới hạn quota hoặc hạn mức API. Vui lòng kiểm tra hạn mức tài khoản hoặc thử lại sau.',
      });
    }

    res.status(500).json({
      success: false,
      message: `Lỗi AI: ${errMsg.slice(0, 180)}`,
    });
  }
};
