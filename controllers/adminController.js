const User = require('../models/User');
const Order = require('../models/Order');
const Material = require('../models/Material');
const AdCost = require('../models/AdCost');
const ImportTicket = require('../models/ImportTicket');
const InventoryCheck = require('../models/InventoryCheck');

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
      materials,
      recentOrders,
      recentImports,
      recentInventoryChecks
    ] = await Promise.all([
      Order.find({ ordered_at: { $gte: startOfCurrentPeriod, $lte: endOfPeriod } }),
      Order.find({ ordered_at: { $gte: startOfPrevPeriod, $lte: endOfPrevPeriod } }),
      AdCost.find({ date: { $gte: startOfCurrentPeriod, $lte: endOfPeriod } }),
      AdCost.find({ date: { $gte: startOfPrevPeriod, $lte: endOfPrevPeriod } }),
      Material.find({}),
      Order.find({}).sort({ ordered_at: -1 }).limit(15),
      ImportTicket.find({ status: 'completed' }).sort({ completed_at: -1 }).limit(3),
      InventoryCheck.find({}).sort({ createdAt: -1 }).limit(3)
    ]);

    // 1. Calculate main metrics
    const completedCurrent = ordersCurrent.filter(o => (o.status || 'completed') === 'completed');
    const returnedCurrent = ordersCurrent.filter(o => o.status === 'returned');
    const completedPrev = ordersPrev.filter(o => (o.status || 'completed') === 'completed');
    const returnedPrev = ordersPrev.filter(o => o.status === 'returned');

    const revCurrent = completedCurrent.reduce((sum, o) => sum + ((o.is_replacement || o.is_seeding) ? 0 : (o.total_price || 0)), 0);
    const revPrev = completedPrev.reduce((sum, o) => sum + ((o.is_replacement || o.is_seeding) ? 0 : (o.total_price || 0)), 0);
    const revenueGrowth = revPrev === 0 ? null : ((revCurrent - revPrev) / revPrev * 100);

    const ordCurrent = ordersCurrent.filter(o => !o.is_replacement && !o.is_seeding).length;
    const ordPrev = ordersPrev.filter(o => !o.is_replacement && !o.is_seeding).length;
    const ordersGrowth = ordPrev === 0 ? null : ((ordCurrent - ordPrev) / ordPrev * 100);

    const inventoryValue = materials.reduce((sum, m) => sum + (m.actualStock * (m.price || 0)), 0);

    const adCurrentTotal = adsCurrent.reduce((sum, a) => sum + a.amount, 0);
    const adPrevTotal = adsPrev.reduce((sum, a) => sum + a.amount, 0);
    const adCostGrowth = adPrevTotal === 0 ? null : ((adCurrentTotal - adPrevTotal) / adPrevTotal * 100);

    const normalCompletedCurrent = completedCurrent.filter(o => !o.is_replacement && !o.is_seeding);
    const replacementCurrent = completedCurrent.filter(o => o.is_replacement);
    const seedingCurrent = completedCurrent.filter(o => o.is_seeding);

    const normalCompletedPrev = completedPrev.filter(o => !o.is_replacement && !o.is_seeding);

    const currentCOGS = normalCompletedCurrent.reduce((sum, o) => {
      return sum + (o.items || []).reduce((itemSum, item) => itemSum + ((item.unit_cost || 0) * item.quantity), 0) + (o.packaging_cost || 0);
    }, 0);
    const prevCOGS = normalCompletedPrev.reduce((sum, o) => {
      return sum + (o.items || []).reduce((itemSum, item) => itemSum + ((item.unit_cost || 0) * item.quantity), 0) + (o.packaging_cost || 0);
    }, 0);

    const currentLogistics = normalCompletedCurrent.reduce((sum, o) => sum + (o.logistics_cost || 0), 0);
    const prevLogistics = normalCompletedPrev.reduce((sum, o) => sum + (o.logistics_cost || 0), 0);

    const currentReplacementCost = replacementCurrent.reduce((sum, o) => {
      return sum + (o.items || []).reduce((itemSum, item) => itemSum + ((item.unit_cost || 0) * item.quantity), 0) + (o.packaging_cost || 0) + (o.logistics_cost || 0);
    }, 0);
    const prevReplacementCost = completedPrev.filter(o => o.is_replacement).reduce((sum, o) => {
      return sum + (o.items || []).reduce((itemSum, item) => itemSum + ((item.unit_cost || 0) * item.quantity), 0) + (o.packaging_cost || 0) + (o.logistics_cost || 0);
    }, 0);

    const currentSeedingCost = seedingCurrent.reduce((sum, o) => {
      return sum + (o.seeding_cost || 0) + (o.items || []).reduce((itemSum, item) => itemSum + ((item.unit_cost || 0) * item.quantity), 0) + (o.packaging_cost || 0) + (o.logistics_cost || 0);
    }, 0);
    const prevSeedingCost = completedPrev.filter(o => o.is_seeding).reduce((sum, o) => {
      return sum + (o.seeding_cost || 0) + (o.items || []).reduce((itemSum, item) => itemSum + ((item.unit_cost || 0) * item.quantity), 0) + (o.packaging_cost || 0) + (o.logistics_cost || 0);
    }, 0);
    const seedingCostGrowth = prevSeedingCost === 0 ? null : ((currentSeedingCost - prevSeedingCost) / prevSeedingCost * 100);

    const currentReturnCosts = returnedCurrent.reduce((sum, o) => sum + (o.return_cost || 0), 0);
    const prevReturnCosts = returnedPrev.reduce((sum, o) => sum + (o.return_cost || 0), 0);

    const realProfitCurrent = revCurrent - currentCOGS - adCurrentTotal - currentLogistics - currentReturnCosts - currentReplacementCost - currentSeedingCost;
    const realProfitPrev = revPrev - prevCOGS - adPrevTotal - prevLogistics - prevReturnCosts - prevReplacementCost - prevSeedingCost;
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
        if ((o.status || 'completed') === 'completed') {
          if (!o.is_replacement && !o.is_seeding) {
            chartDataMap[dateKey].revenue += (o.total_price || 0);
          }
          const cogs = (o.items || []).reduce((sum, item) => sum + ((item.unit_cost || 0) * item.quantity), 0) + (o.packaging_cost || 0);
          const logistics = (o.logistics_cost || 0);
          chartDataMap[dateKey].cogs += cogs;
          chartDataMap[dateKey].cost += cogs + logistics + (o.seeding_cost || 0);
        } else if (o.status === 'returned') {
          chartDataMap[dateKey].cost += (o.return_cost || 0);
        }
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
    const totalLogisticsAndReturns = currentLogistics + currentReturnCosts;
    
    const totalCostForStructure = totalCOGS + totalAds + totalLogisticsAndReturns;
    
    const costStructure = {
      ads: totalCostForStructure > 0 ? (totalAds / totalCostForStructure * 100) : 0,
      inventory: totalCostForStructure > 0 ? (totalCOGS / totalCostForStructure * 100) : 0,
      logistics: totalCostForStructure > 0 ? (totalLogisticsAndReturns / totalCostForStructure * 100) : 0
    };


    // 4. Platform Stats (per source)
    const platformMap = {};
    const allCompletedOrders = [...normalCompletedCurrent, ...replacementCurrent];
    ordersCurrent.forEach(o => {
      const src = o.source || 'khác';
      if (!platformMap[src]) {
        platformMap[src] = { source: src, orders: 0, revenue: 0, returned: 0, replacements: 0 };
      }
      if ((o.status || 'completed') === 'completed') {
        if (!o.is_replacement && !o.is_seeding) {
          platformMap[src].orders += 1;
          platformMap[src].revenue += (o.total_price || 0);
        } else if (o.is_replacement) {
          platformMap[src].replacements += 1;
        }
      } else if (o.status === 'returned') {
        platformMap[src].returned += 1;
      }
    });
    const platformStats = Object.values(platformMap).sort((a, b) => b.revenue - a.revenue);

    // 5. Product Stats (per product)
    const productMap = {};
    normalCompletedCurrent.forEach(o => {
      const orderTotalRaw = (o.items || []).reduce((sum, item) => sum + ((item.unit_price || 0) * item.quantity), 0);
      // Doanh thu thực tế của sản phẩm = Tổng tiền thu khách - Phí ship khách trả (tức là chỉ còn tiền hàng - giảm giá)
      const orderNetRevenue = (o.total_price || 0) - (o.logistics_cost || 0);

      (o.items || []).forEach(item => {
        const key = item.productId || String(item.product_id);
        if (!productMap[key]) {
          productMap[key] = {
            productId: item.productId,
            product_name: item.product_name,
            product_image: item.product_image || null,
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
        productMap[key].variantsMap[variantKey].totalCOGS += (item.unit_cost || 0) * item.quantity;
        
        let itemRevenue = 0;
        if (orderTotalRaw > 0) {
           const itemShare = ((item.unit_price || 0) * item.quantity) / orderTotalRaw;
           itemRevenue = (orderNetRevenue * itemShare);
           productMap[key].totalRevenue += itemRevenue;
        } else {
           itemRevenue = orderNetRevenue;
           productMap[key].totalRevenue += itemRevenue;
        }
        productMap[key].variantsMap[variantKey].totalRevenue += itemRevenue;

        productMap[key].totalCOGS += (item.unit_cost || 0) * item.quantity;
      });
    });
    // Count returned items
    returnedCurrent.forEach(o => {
      (o.items || []).forEach(item => {
        const key = item.productId || String(item.product_id);
        if (productMap[key]) {
          productMap[key].returnedQty += item.quantity;
          const variantKey = item.sku_id || 'default';
          if (productMap[key].variantsMap && productMap[key].variantsMap[variantKey]) {
            productMap[key].variantsMap[variantKey].returnedQty += item.quantity;
          }
        }
      });
    });

    // Allocate ad cost per product proportional to revenue
    const totalRevenueForAdAlloc = revCurrent;
    const productStats = Object.values(productMap).map(p => {
      const grossMargin = p.totalRevenue > 0 ? ((p.totalRevenue - p.totalCOGS) / p.totalRevenue) * 100 : 0;
      const adShare = totalRevenueForAdAlloc > 0 ? (p.totalRevenue / totalRevenueForAdAlloc) * adCurrentTotal : 0;
      const netProfit = p.totalRevenue - p.totalCOGS - adShare;
      const netMargin = p.totalRevenue > 0 ? (netProfit / p.totalRevenue) * 100 : 0;
      const returnRate = (p.totalQty + p.returnedQty) > 0 ? (p.returnedQty / (p.totalQty + p.returnedQty)) * 100 : 0;
      
      const variants = Object.values(p.variantsMap || {}).map(v => {
         const vGrossMargin = v.totalRevenue > 0 ? ((v.totalRevenue - v.totalCOGS) / v.totalRevenue) * 100 : 0;
         const vAdShare = totalRevenueForAdAlloc > 0 ? (v.totalRevenue / totalRevenueForAdAlloc) * adCurrentTotal : 0;
         const vNetProfit = v.totalRevenue - v.totalCOGS - vAdShare;
         const vNetMargin = v.totalRevenue > 0 ? (vNetProfit / v.totalRevenue) * 100 : 0;
         const vReturnRate = (v.totalQty + v.returnedQty) > 0 ? (v.returnedQty / (v.totalQty + v.returnedQty)) * 100 : 0;
         return {
            ...v,
            grossMargin: Number(vGrossMargin.toFixed(1)),
            netMargin: Number(vNetMargin.toFixed(1)),
            netProfit: Math.round(vNetProfit),
            adShare: Math.round(vAdShare),
            returnRate: Number(vReturnRate.toFixed(1))
         };
      }).sort((a,b) => b.totalRevenue - a.totalRevenue);

      const { variantsMap, ...rest } = p;

      return {
        ...rest,
        variants,
        grossMargin: Number(grossMargin.toFixed(1)),
        netMargin: Number(netMargin.toFixed(1)),
        netProfit: Math.round(netProfit),
        adShare: Math.round(adShare),
        returnRate: Number(returnRate.toFixed(1)),
      };
    });

    const recentActivities = [];
    recentOrders.forEach(o => {
      const sourceName = o.source ? o.source.charAt(0).toUpperCase() + o.source.slice(1) : 'Hệ thống';
      recentActivities.push({
        type: 'order',
        title: `Đơn hàng mới #${o.orderId || o._id.toString().slice(-4).toUpperCase()}`,
        subtitle: `Khách từ ${sourceName} vừa đặt hàng`,
        detail: `${(o.total_price || 0).toLocaleString('vi-VN')} ₫`,
        time: o.ordered_at
      });
    });
    recentImports.forEach(t => {
      const itemsCount = t.items ? t.items.length : 0;
      recentActivities.push({
        type: 'import',
        title: `Cập nhật kho hàng`,
        subtitle: `Đã nhập phiếu ${t.code} (${itemsCount} loại NVL)`,
        detail: `${(t.total_amount || 0).toLocaleString('vi-VN')} ₫`,
        time: t.completed_at || t.updatedAt
      });
    });
    recentInventoryChecks.forEach(c => {
      const itemsCount = c.items ? c.items.length : 0;
      let totalDiff = 0;
      if (c.items) {
         totalDiff = c.items.reduce((sum, item) => sum + Math.abs(item.difference || 0), 0);
      }
      recentActivities.push({
        type: 'inventory_check',
        title: `Kiểm kê kho hàng`,
        subtitle: `Phiếu kiểm kho do ${c.checked_by || 'Admin'} thực hiện (${itemsCount} loại NVL)`,
        detail: `Chênh lệch: ${totalDiff}`,
        time: c.createdAt
      });
    });
    
    recentActivities.sort((a, b) => {
      const timeA = new Date(a.time || 0).getTime();
      const timeB = new Date(b.time || 0).getTime();
      return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
    });

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
        returnedOrders: returnedCurrent.length,
        returnRate: ordCurrent > 0 ? Number(((returnedCurrent.length / ordCurrent) * 100).toFixed(1)) : 0,
        returnCost: currentReturnCosts,
        cogs: currentCOGS,
        logisticsCost: currentLogistics,
        replacementCost: currentReplacementCost,
        replacementOrders: replacementCurrent.length,
        seedingCost: currentSeedingCost,
        seedingCostGrowth: seedingCostGrowth !== null ? Number(seedingCostGrowth.toFixed(1)) : null,
        platformStats,
        productStats,
        chartData,
        costStructure,
        recentOrders,
        allOrders: ordersCurrent,
        recentActivities: recentActivities.slice(0, 10)
      }
    });

  } catch (error) {
    console.error('Lỗi khi lấy dashboard stats:', error);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
};

// @desc    Lấy danh sách hoạt động gần đây
// @route   GET /api/admin/activities
exports.getRecentActivities = async (req, res) => {
  try {
    const [
      recentOrders,
      recentImports,
      recentInventoryChecks
    ] = await Promise.all([
      Order.find({}).sort({ ordered_at: -1 }).limit(15),
      ImportTicket.find({ status: 'completed' }).sort({ completed_at: -1 }).limit(3),
      InventoryCheck.find({}).sort({ createdAt: -1 }).limit(3)
    ]);

    const recentActivities = [];
    recentOrders.forEach(o => {
      const sourceName = o.source ? o.source.charAt(0).toUpperCase() + o.source.slice(1) : 'Hệ thống';
      recentActivities.push({
        type: 'order',
        title: `Đơn hàng mới #${o.orderId || o._id.toString().slice(-4).toUpperCase()}`,
        subtitle: `Khách từ ${sourceName} vừa đặt hàng`,
        detail: `${(o.total_price || 0).toLocaleString('vi-VN')} ₫`,
        time: o.ordered_at
      });
    });
    recentImports.forEach(t => {
      const itemsCount = t.items ? t.items.length : 0;
      recentActivities.push({
        type: 'import',
        title: `Cập nhật kho hàng`,
        subtitle: `Đã nhập phiếu ${t.code} (${itemsCount} loại NVL)`,
        detail: `${(t.total_amount || 0).toLocaleString('vi-VN')} ₫`,
        time: t.completed_at || t.updatedAt
      });
    });
    recentInventoryChecks.forEach(c => {
      const itemsCount = c.items ? c.items.length : 0;
      let totalDiff = 0;
      if (c.items) {
         totalDiff = c.items.reduce((sum, item) => sum + Math.abs(item.difference || 0), 0);
      }
      recentActivities.push({
        type: 'inventory_check',
        title: `Kiểm kê kho hàng`,
        subtitle: `Phiếu kiểm kho do ${c.checked_by || 'Admin'} thực hiện (${itemsCount} loại NVL)`,
        detail: `Chênh lệch: ${totalDiff}`,
        time: c.createdAt
      });
    });
    
    recentActivities.sort((a, b) => {
      const timeA = new Date(a.time || 0).getTime();
      const timeB = new Date(b.time || 0).getTime();
      return (isNaN(b_time = timeB) ? 0 : b_time) - (isNaN(a_time = timeA) ? 0 : a_time);
    });

    res.status(200).json({
      success: true,
      data: {
        recentOrders,
        recentActivities: recentActivities.slice(0, 10)
      }
    });

  } catch (error) {
    console.error('Lỗi khi lấy hoạt động gần đây:', error);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
};
