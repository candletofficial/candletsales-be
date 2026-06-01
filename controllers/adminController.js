const User = require('../models/User');
const Order = require('../models/Order');
const Material = require('../models/Material');
const AdCost = require('../models/AdCost');

// @desc    Lấy danh sách tài khoản (có filter theo status)
// @route   GET /api/admin/users
// @access  Private/Admin
exports.getUsers = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};

    // Không hiển thị chính mình trong danh sách
    filter._id = { $ne: req.user.id };

    if (status) filter.status = status;

    const skip = (Number(page) - 1) * Number(limit);
    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Duyệt tài khoản (cấp quyền admin)
// @route   PUT /api/admin/users/:id/approve
// @access  Private/Admin
exports.approveUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
    }

    if (user.isDefaultAdmin) {
      return res.status(400).json({ success: false, message: 'Không thể thay đổi tài khoản admin gốc' });
    }

    if (user.status === 'active') {
      return res.status(400).json({ success: false, message: 'Tài khoản này đã được kích hoạt rồi' });
    }

    user.status = 'active';
    await user.save();

    res.status(200).json({
      success: true,
      message: `Đã cấp quyền admin cho tài khoản ${user.email}`,
      data: { id: user._id, name: user.name, email: user.email, status: user.status },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Từ chối tài khoản
// @route   PUT /api/admin/users/:id/reject
// @access  Private/Admin
exports.rejectUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
    }

    if (user.isDefaultAdmin) {
      return res.status(400).json({ success: false, message: 'Không thể thay đổi tài khoản admin gốc' });
    }

    user.status = 'rejected';
    await user.save();

    res.status(200).json({
      success: true,
      message: `Đã từ chối tài khoản ${user.email}`,
      data: { id: user._id, name: user.name, email: user.email, status: user.status },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Thu hồi quyền truy cập (active → pending)
// @route   PUT /api/admin/users/:id/revoke
// @access  Private/Admin
exports.revokeUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
    }

    if (user.isDefaultAdmin) {
      return res.status(400).json({ success: false, message: 'Không thể thu hồi quyền tài khoản admin gốc' });
    }

    user.status = 'pending';
    await user.save();

    res.status(200).json({
      success: true,
      message: `Đã thu hồi quyền truy cập của tài khoản ${user.email}`,
      data: { id: user._id, name: user.name, email: user.email, status: user.status },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Xóa tài khoản
// @route   DELETE /api/admin/users/:id
// @access  Private/Admin
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
    }

    if (user.isDefaultAdmin) {
      return res.status(400).json({ success: false, message: 'Không thể xóa tài khoản admin gốc' });
    }

    // Không thể tự xóa chính mình
    if (user._id.toString() === req.user.id) {
      return res.status(400).json({ success: false, message: 'Không thể tự xóa tài khoản của mình' });
    }

    await User.findByIdAndDelete(req.params.id);

    res.status(200).json({ success: true, message: 'Đã xóa tài khoản thành công' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Thống kê tài khoản theo trạng thái
// @route   GET /api/admin/users/stats
// @access  Private/Admin
exports.getUserStats = async (req, res) => {
  try {
    const [total, pending, active, rejected] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ status: 'pending' }),
      User.countDocuments({ status: 'active' }),
      User.countDocuments({ status: 'rejected' }),
    ]);

    res.status(200).json({
      success: true,
      data: { total, pending, active, rejected },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Dashboard Analytics (E-commerce)
// @route   GET /api/admin/dashboard
// @access  Private/Admin

const getLocalDateString = (dateObj) => {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

exports.getDashboardStats = async (req, res) => {
  try {
    const days = Math.max(1, parseInt(req.query.days) || 30);
    const endDateParam = req.query.endDate;
    
    let baseDate = new Date();
    if (endDateParam) {
      baseDate = new Date(endDateParam);
    }
    
    // Ngày kết thúc 23:59:59
    const endOfPeriod = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 23, 59, 59, 999);
    // X ngày gần nhất (từ 00:00 của X-1 ngày trước)
    const startOfCurrentPeriod = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() - (days - 1), 0, 0, 0, 0);
    // X ngày trước đó
    const endOfPrevPeriod = new Date(startOfCurrentPeriod.getTime() - 1);
    const startOfPrevPeriod = new Date(endOfPrevPeriod.getFullYear(), endOfPrevPeriod.getMonth(), endOfPrevPeriod.getDate() - (days - 1), 0, 0, 0, 0);

    const [
      ordersCurrent, ordersPrev,
      adsCurrent, adsPrev,
      materials
    ] = await Promise.all([
      Order.find({ ordered_at: { $gte: startOfCurrentPeriod, $lte: endOfPeriod } }),
      Order.find({ ordered_at: { $gte: startOfPrevPeriod, $lte: endOfPrevPeriod } }),
      AdCost.find({ date: { $gte: startOfCurrentPeriod, $lte: endOfPeriod } }),
      AdCost.find({ date: { $gte: startOfPrevPeriod, $lte: endOfPrevPeriod } }),
      Material.find({})
    ]);

    // 1. Calculate main metrics
    const revCurrent = ordersCurrent.reduce((sum, o) => sum + (o.total_price || 0), 0);
    const revPrev = ordersPrev.reduce((sum, o) => sum + (o.total_price || 0), 0);
    const revenueGrowth = revPrev === 0 ? null : ((revCurrent - revPrev) / revPrev * 100);

    const ordCurrent = ordersCurrent.length;
    const ordPrev = ordersPrev.length;
    const ordersGrowth = ordPrev === 0 ? null : ((ordCurrent - ordPrev) / ordPrev * 100);

    const inventoryValue = materials.reduce((sum, m) => sum + (m.actualStock * (m.price || 0)), 0);

    const adCurrentTotal = adsCurrent.reduce((sum, a) => sum + a.amount, 0);
    const adPrevTotal = adsPrev.reduce((sum, a) => sum + a.amount, 0);
    const adCostGrowth = adPrevTotal === 0 ? null : ((adCurrentTotal - adPrevTotal) / adPrevTotal * 100);

    const currentCOGS = ordersCurrent.reduce((sum, o) => {
      return sum + (o.items || []).reduce((itemSum, item) => itemSum + ((item.unit_cost || 0) * item.quantity), 0) + (o.packaging_cost || 0);
    }, 0);
    const prevCOGS = ordersPrev.reduce((sum, o) => {
      return sum + (o.items || []).reduce((itemSum, item) => itemSum + ((item.unit_cost || 0) * item.quantity), 0) + (o.packaging_cost || 0);
    }, 0);

    const currentLogistics = ordersCurrent.reduce((sum, o) => sum + (o.logistics_cost || 0), 0);
    const prevLogistics = ordersPrev.reduce((sum, o) => sum + (o.logistics_cost || 0), 0);

    const realProfitCurrent = revCurrent - currentCOGS - adCurrentTotal - currentLogistics;
    const realProfitPrev = revPrev - prevCOGS - adPrevTotal - prevLogistics;
    const realProfitGrowth = realProfitPrev === 0 ? null : ((realProfitCurrent - realProfitPrev) / Math.abs(realProfitPrev) * 100);

    // 2. Chart data (X days)
    const chartDataMap = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(startOfCurrentPeriod);
      d.setDate(d.getDate() + i);
      const dayStr = d.toLocaleDateString('vi-VN', { month: '2-digit', day: '2-digit' }); // "24/10"
      chartDataMap[getLocalDateString(d)] = { date: dayStr, revenue: 0, cost: 0, cogs: 0 };
    }

    // Accumulate revenue, COGS and Logistics
    ordersCurrent.forEach(o => {
      const dateKey = getLocalDateString(new Date(o.ordered_at));
      if (chartDataMap[dateKey]) {
        chartDataMap[dateKey].revenue += (o.total_price || 0);
        const cogs = (o.items || []).reduce((sum, item) => sum + ((item.unit_cost || 0) * item.quantity), 0) + (o.packaging_cost || 0);
        const logistics = (o.logistics_cost || 0);
        chartDataMap[dateKey].cogs += cogs;
        chartDataMap[dateKey].cost += cogs + logistics;
      }
    });

    // Accumulate Ad Costs
    adsCurrent.forEach(a => {
      const dateKey = getLocalDateString(new Date(a.date));
      if (chartDataMap[dateKey]) {
        chartDataMap[dateKey].cost += a.amount;
      }
    });

    const chartData = Object.values(chartDataMap);

    // 3. Cost structure (Ads, Inventory/COGS, Logistics)
    const totalCOGS = chartData.reduce((sum, d) => sum + d.cogs, 0);
    const totalAds = adCurrentTotal;
    const totalLogistics = currentLogistics;
    
    const totalCostForStructure = totalCOGS + totalAds + totalLogistics;
    
    const costStructure = {
      ads: totalCostForStructure > 0 ? (totalAds / totalCostForStructure * 100) : 0,
      inventory: totalCostForStructure > 0 ? (totalCOGS / totalCostForStructure * 100) : 0,
      logistics: totalCostForStructure > 0 ? (totalLogistics / totalCostForStructure * 100) : 0
    };

    res.status(200).json({
      success: true,
      data: {
        totalRevenue: revCurrent,
        revenueGrowth: revenueGrowth !== null ? Number(revenueGrowth.toFixed(1)) : null,
        newOrders: ordCurrent,
        ordersGrowth: ordersGrowth !== null ? Number(ordersGrowth.toFixed(1)) : null,
        inventoryValue: inventoryValue,
        inventoryGrowth: null, // Not tracking history for now
        adCost: adCurrentTotal,
        adCostGrowth: adCostGrowth !== null ? Number(adCostGrowth.toFixed(1)) : null,
        realProfit: realProfitCurrent,
        realProfitGrowth: realProfitGrowth !== null ? Number(realProfitGrowth.toFixed(1)) : null,
        chartData,
        costStructure
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
