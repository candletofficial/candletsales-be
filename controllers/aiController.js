const { GoogleGenAI } = require('@google/genai');
const Order = require('../models/Order');
const Material = require('../models/Material');
const AdCost = require('../models/AdCost');
const ImportTicket = require('../models/ImportTicket');
const InventoryCheck = require('../models/InventoryCheck');
const FundTransaction = require('../models/FundTransaction');
const { buildBusinessContext, SUGGESTED_QUESTIONS, buildSmartAlertsPrompt } = require('../utils/aiHelper');

// Helper lấy dữ liệu dashboard (dùng lại logic từ adminController)
const getLocalDateString = (dateObj) => {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const fetchDashboardData = async () => {
  const now = new Date();
  const days = now.getDate(); // Tháng này
  const endOfPeriod = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const startOfCurrentPeriod = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 0, 0, 0, 0);

  const [ordersCurrent, adsCurrent, materials] = await Promise.all([
    Order.find({ ordered_at: { $gte: startOfCurrentPeriod, $lte: endOfPeriod } }),
    AdCost.find({ date: { $gte: startOfCurrentPeriod, $lte: endOfPeriod } }),
    Material.find({}),
  ]);

  const activeCurrent = ordersCurrent.filter((o) => o.status !== 'returned');
  const returnedCurrent = ordersCurrent.filter((o) => o.status === 'returned');
  const normalCompletedCurrent = activeCurrent.filter((o) => !o.is_replacement && !o.is_seeding);
  const replacementCurrent = activeCurrent.filter((o) => o.is_replacement);
  const seedingCurrent = activeCurrent.filter((o) => o.is_seeding);

  const revCurrent = activeCurrent.reduce(
    (sum, o) => sum + ((o.is_replacement || o.is_seeding) ? 0 : o.total_price || 0), 0
  );
  const ordCurrent = activeCurrent.filter((o) => !o.is_replacement && !o.is_seeding).length;
  const adCurrentTotal = adsCurrent.reduce((sum, a) => sum + a.amount, 0);
  const inventoryValue = materials.reduce((sum, m) => sum + m.actualStock * (m.price || 0), 0);

  const currentCOGS = normalCompletedCurrent.reduce((sum, o) =>
    sum + (o.items || []).reduce((s, item) => s + (item.unit_cost || 0) * item.quantity, 0) + (o.packaging_cost || 0), 0);
  const currentLogistics = normalCompletedCurrent.reduce((sum, o) => sum + (o.logistics_cost || 0), 0);
  const currentReplacementCost = replacementCurrent.reduce((sum, o) =>
    sum + (o.items || []).reduce((s, item) => s + (item.unit_cost || 0) * item.quantity, 0) + (o.packaging_cost || 0) + (o.logistics_cost || 0), 0);
  const currentSeedingCost = seedingCurrent.reduce((sum, o) =>
    sum + (o.seeding_cost || 0) - (o.total_price || 0) + (o.items || []).reduce((s, item) => s + (item.unit_cost || 0) * item.quantity, 0) + (o.packaging_cost || 0) + (o.logistics_cost || 0), 0);
  const currentReturnCosts = returnedCurrent.reduce((sum, o) => sum + (o.return_cost || 0), 0);

  const realProfit = revCurrent - currentCOGS - adCurrentTotal - currentLogistics - currentReturnCosts - currentReplacementCost - currentSeedingCost;

  // Platform stats
  const platformMap = {};
  ordersCurrent.forEach((o) => {
    const src = o.source || 'khác';
    if (!platformMap[src]) platformMap[src] = { source: src, orders: 0, revenue: 0, returned: 0, replacements: 0 };
    if (o.status !== 'returned') {
      if (!o.is_replacement && !o.is_seeding) {
        platformMap[src].orders += 1;
        platformMap[src].revenue += o.total_price || 0;
      } else if (o.is_replacement) platformMap[src].replacements += 1;
    } else if (o.status === 'returned') {
      platformMap[src].returned += 1;
    }
  });

  // Product stats
  const productMap = {};
  normalCompletedCurrent.forEach((o) => {
    const orderTotalRaw = (o.items || []).reduce((sum, item) => sum + ((item.unit_price || 0) * item.quantity), 0);
    const orderNetRevenue = (o.total_price || 0) - (o.logistics_cost || 0);

    (o.items || []).forEach((item) => {
      const key = item.productId || String(item.product_id);
      if (!productMap[key]) {
        productMap[key] = { productId: item.productId, product_name: item.product_name, totalQty: 0, totalRevenue: 0, totalCOGS: 0, returnedQty: 0 };
      }
      productMap[key].totalQty += item.quantity;
      
      let itemRevenue = 0;
      if (orderTotalRaw > 0) {
         const itemShare = ((item.unit_price || 0) * item.quantity) / orderTotalRaw;
         itemRevenue = orderNetRevenue * itemShare;
      } else {
         itemRevenue = orderNetRevenue / (o.items.length || 1);
      }
      productMap[key].totalRevenue += itemRevenue;
      
      productMap[key].totalCOGS += (item.unit_cost || 0) * item.quantity;
    });
  });

  const totalCOGS_cost = currentCOGS;
  const totalLogisticsAndReturns = currentLogistics + currentReturnCosts;
  const totalCostForStructure = totalCOGS_cost + adCurrentTotal + totalLogisticsAndReturns;

  const productStats = Object.values(productMap).map((p) => {
    const grossMargin = p.totalRevenue > 0 ? ((p.totalRevenue - p.totalCOGS) / p.totalRevenue) * 100 : 0;
    const adShare = revCurrent > 0 ? (p.totalRevenue / revCurrent) * adCurrentTotal : 0;
    const netProfit = p.totalRevenue - p.totalCOGS - adShare;
    const netMargin = p.totalRevenue > 0 ? (netProfit / p.totalRevenue) * 100 : 0;
    return { ...p, grossMargin: +grossMargin.toFixed(1), netMargin: +netMargin.toFixed(1), netProfit: Math.round(netProfit) };
  }).sort((a, b) => b.totalRevenue - a.totalRevenue);

  return {
    totalRevenue: revCurrent,
    newOrders: ordCurrent,
    realProfit,
    returnedOrders: returnedCurrent.length,
    returnRate: ordCurrent > 0 ? +((returnedCurrent.length / ordCurrent) * 100).toFixed(1) : 0,
    returnCost: currentReturnCosts,
    cogs: currentCOGS,
    adCost: adCurrentTotal,
    logisticsCost: currentLogistics,
    replacementCost: currentReplacementCost,
    replacementOrders: replacementCurrent.length,
    seedingCost: currentSeedingCost,
    inventoryValue,
    costStructure: {
      ads: totalCostForStructure > 0 ? +(adCurrentTotal / totalCostForStructure * 100).toFixed(1) : 0,
      inventory: totalCostForStructure > 0 ? +(totalCOGS_cost / totalCostForStructure * 100).toFixed(1) : 0,
      logistics: totalCostForStructure > 0 ? +(totalLogisticsAndReturns / totalCostForStructure * 100).toFixed(1) : 0,
    },
    platformStats: Object.values(platformMap).sort((a, b) => b.revenue - a.revenue),
    productStats,
  };
};

exports.fetchDashboardData = fetchDashboardData;

// ─── Controllers ────────────────────────────────────────────────────────────

// @desc    Lấy câu hỏi gợi ý
// @route   GET /api/ai/suggestions
// @access  Private
exports.getSuggestions = (req, res) => {
  res.status(200).json({ success: true, data: SUGGESTED_QUESTIONS });
};

// @desc    Lấy danh sách cảnh báo thông minh (Smart Alerts)
// @route   GET /api/ai/smart-alerts
// @access  Private
exports.getSmartAlerts = async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ success: false, message: 'Chưa cấu hình GEMINI_API_KEY' });
    }

    const dashboardData = await fetchDashboardData();
    const prompt = buildSmartAlertsPrompt(dashboardData);

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    // Gemini sẽ trả về text JSON, cần parse
    const text = response.text;
    let alerts = [];
    try {
      alerts = JSON.parse(text);
      if (!Array.isArray(alerts)) alerts = [];
    } catch (e) {
      console.error('Failed to parse Smart Alerts JSON:', text);
    }

    res.status(200).json({ success: true, data: alerts.slice(0, 3) });
  } catch (error) {
    require('fs').appendFileSync('error.log', new Date().toISOString() + ' ' + (error.stack || error) + '\n');
    
    const errMessage = error.message || '';
    if (
      error.status === 429 || 
      error.status === 503 ||
      errMessage.includes('429') || 
      errMessage.includes('503') || 
      errMessage.includes('UNAVAILABLE') || 
      errMessage.includes('quota') || 
      errMessage.toLowerCase().includes('rate limit') || 
      errMessage.includes('Too Many Requests') ||
      errMessage.includes('high demand')
    ) {
      console.warn(`Smart Alerts: Gemini API Unavailable/Rate Limited (${error.status || '503/429'})`);
      return res.status(503).json({ success: false, message: 'Hệ thống AI đang bị quá tải, vui lòng thử lại sau vài phút.' });
    }
    
    console.error('Smart Alerts Error:', errMessage || error);
    res.status(500).json({ success: false, message: 'Lỗi khi tạo cảnh báo', data: [] });
  }
};

// @desc    Chat với AI Business Analyst
// @route   POST /api/ai/chat
// @access  Private
exports.chat = async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        success: false,
        message: 'Chưa cấu hình GEMINI_API_KEY. Vui lòng thêm vào file .env',
      });
    }

    const { message, history = [], periodLabel = 'Tháng này' } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập câu hỏi' });
    }

    // Lấy dữ liệu kinh doanh thực tế
    const dashboardData = await fetchDashboardData();
    const systemPrompt = buildBusinessContext(dashboardData, periodLabel);

    // Khởi tạo Gemini với SDK mới (@google/genai)
    const ai = new GoogleGenAI({ apiKey });

    // Build nội dung chat (history hợp lệ + message mới)
    const contents = [];

    const validHistory = history.filter((h) => h.role && h.content);
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

    const aiResponse = response.text;

    res.status(200).json({
      success: true,
      data: { message: aiResponse, role: 'assistant' },
    });
  } catch (error) {
    console.error('AI Chat Error:', error.message || error);

    const errMsg = error.message || '';
    if (errMsg.includes('API_KEY_INVALID') || errMsg.includes('API key not valid')) {
      return res.status(401).json({ success: false, message: '❌ API key không hợp lệ. Kiểm tra lại GEMINI_API_KEY trong .env' });
    }
    if (errMsg.includes('PERMISSION_DENIED')) {
      return res.status(403).json({ success: false, message: '❌ API key không có quyền truy cập. Tạo key mới tại aistudio.google.com' });
    }
    if (errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED')) {
      return res.status(429).json({ success: false, message: '⚠️ Đã vượt giới hạn API. Thử lại sau ít phút.' });
    }

    res.status(500).json({
      success: false,
      message: `Lỗi AI: ${errMsg.slice(0, 150)}`,
    });
  }
};
