const User = require('../models/User');
const Order = require('../models/Order');
const Material = require('../models/Material');
const AdCost = require('../models/AdCost');
const ImportTicket = require('../models/ImportTicket');
const InventoryCheck = require('../models/InventoryCheck');
const FundTransaction = require('../models/FundTransaction');
const AffiliateFee = require('../models/AffiliateFee');
const { filterOrphanOrderRevenue } = require('../utils/filterOrphanOrderRevenue');
const { groupFundHistory } = require('../utils/groupFundHistory');
const { buildCurrentUnitCostResolver } = require('../utils/currentOrderCost');

// @desc    Lấy danh sách tài khoản (hỗ trợ filter status, role, tìm kiếm)
// @route   GET /api/admin/users
// @access  Private/Admin
exports.getUsers = async (req, res) => {
  try {
    const { status, role, search, page = 1, limit = 20 } = req.query;
    const filter = {};

    // Không hiển thị chính mình trong danh sách nếu không yêu cầu cụ thể
    filter._id = { $ne: req.user.id };

    if (status) filter.status = status;
    if (role) filter.role = role;

    if (search && search.trim()) {
      const term = search.trim();
      filter.$or = [
        { name: { $regex: term, $options: 'i' } },
        { email: { $regex: term, $options: 'i' } },
        { phone: { $regex: term, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    // Thống kê số lượng tổng quan theo vai trò
    const [adminCount, customerCount, totalAll] = await Promise.all([
      User.countDocuments({ _id: { $ne: req.user.id }, role: 'admin' }),
      User.countDocuments({ _id: { $ne: req.user.id }, role: 'customer' }),
      User.countDocuments({ _id: { $ne: req.user.id } }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        users,
        stats: {
          adminCount,
          customerCount,
          totalCount: totalAll,
        },
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(total / Number(limit)) || 1,
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

// @desc    Cập nhật vai trò tài khoản (admin / customer)
// @route   PUT /api/admin/users/:id/role
// @access  Private/Admin
exports.updateUserRole = async (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'customer'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Vai trò không hợp lệ (admin hoặc customer)' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
    }

    if (user.isDefaultAdmin) {
      return res.status(400).json({ success: false, message: 'Không thể thay đổi vai trò tài khoản admin gốc' });
    }

    if (user._id.toString() === req.user.id) {
      return res.status(400).json({ success: false, message: 'Không thể tự thay đổi vai trò của chính mình' });
    }

    // Nghiêm cấm nâng cấp tài khoản khách hàng mua sắm thành quản trị viên
    if (user.role === 'customer' && role === 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Tài khoản khách hàng không được phép nâng cấp lên Quản trị viên vì lý do an toàn bảo mật!'
      });
    }

    user.role = role;
    await user.save();

    res.status(200).json({
      success: true,
      message: `Đã đổi vai trò tài khoản sang ${role === 'admin' ? 'Quản trị viên' : 'Khách hàng'}`,
      data: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Thống kê tài khoản theo trạng thái và vai trò
// @route   GET /api/admin/users/stats
// @access  Private/Admin
exports.getUserStats = async (req, res) => {
  try {
    const [total, pending, active, rejected, totalAdmins, totalCustomers] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ status: 'pending' }),
      User.countDocuments({ status: 'active' }),
      User.countDocuments({ status: 'rejected' }),
      User.countDocuments({ role: 'admin' }),
      User.countDocuments({ role: 'customer' }),
    ]);

    res.status(200).json({
      success: true,
      data: { total, pending, active, rejected, totalAdmins, totalCustomers },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Dashboard Analytics (E-commerce)
// @route   GET /api/admin/dashboard
// @access  Private/Admin

const DAY_MS = 24 * 60 * 60 * 1000;
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

// Việt Nam không áp dụng giờ mùa hè. Dịch timestamp thêm UTC+7 rồi dùng UTC getters
// giúp kết quả ổn định dù tiến trình Node đang chạy ở múi giờ nào.
const getVietnamDateString = (dateObj) => {
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

exports.getDashboardStats = async (req, res) => {
  try {
    const days = Math.max(1, parseInt(req.query.days) || 30);
    const requestedEndDate = req.query.endDate;
    const endCalendarDate = requestedEndDate
      ? parseDateKey(requestedEndDate)
      : parseDateKey(getVietnamDateString(new Date()));
    if (!endCalendarDate) {
      return res.status(400).json({ success: false, message: 'Ngày kết thúc không hợp lệ' });
    }

    const startCalendarDate = new Date(endCalendarDate.getTime() - ((days - 1) * DAY_MS));
    const startOfCurrentPeriod = new Date(startCalendarDate.getTime() - VIETNAM_OFFSET_MS);
    const endOfPeriod = new Date(endCalendarDate.getTime() + DAY_MS - VIETNAM_OFFSET_MS - 1);
    const endOfPrevPeriod = new Date(startOfCurrentPeriod.getTime() - 1);
    const startPrevCalendarDate = new Date(startCalendarDate.getTime() - (days * DAY_MS));
    const endPrevCalendarDate = new Date(startCalendarDate.getTime() - DAY_MS);
    const startOfPrevPeriod = new Date(startPrevCalendarDate.getTime() - VIETNAM_OFFSET_MS);

    const [
      ordersCurrent, ordersPrev,
      adsCurrent, adsPrev,
      materials,
      recentOrders,
      recentImports,
      recentInventoryChecks,
      recentFundTransactions,
      affiliateFees
    ] = await Promise.all([
      Order.find({ ordered_at: { $gte: startOfCurrentPeriod, $lte: endOfPeriod } }),
      Order.find({ ordered_at: { $gte: startOfPrevPeriod, $lte: endOfPrevPeriod } }),
      AdCost.find({ date: { $gte: startOfCurrentPeriod, $lte: endOfPeriod } }),
      AdCost.find({ date: { $gte: startOfPrevPeriod, $lte: endOfPrevPeriod } }),
      Material.find({}),
      Order.find({}).sort({ ordered_at: -1 }).limit(15),
      ImportTicket.find({ status: 'completed' }).sort({ completed_at: -1 }).limit(3),
      InventoryCheck.find({}).sort({ createdAt: -1 }).limit(3),
      FundTransaction.find({}).sort({ createdAt: -1 }).limit(10).lean(),
      AffiliateFee.find({})
    ]);
    const unitCostFor = await buildCurrentUnitCostResolver([...ordersCurrent, ...ordersPrev]);
    const visibleFundTransactions = groupFundHistory(await filterOrphanOrderRevenue(recentFundTransactions));

    // 1. Calculate main metrics. Keep this definition aligned with OrderManagement.
    const isActiveRevenueOrder = o => (
      o.status !== 'returned'
      && o.status !== 'cancelled'
      && !['returning', 'returned', 'failed', 'cancelled'].includes(o.delivery_status)
    );
    const isReturnedOrder = o => o.status === 'returned'
      || ['returning', 'returned', 'failed'].includes(o.delivery_status);

    const activeCurrent = ordersCurrent.filter(isActiveRevenueOrder);
    const returnedCurrent = ordersCurrent.filter(isReturnedOrder);
    const activePrev = ordersPrev.filter(isActiveRevenueOrder);
    const returnedPrev = ordersPrev.filter(isReturnedOrder);

    const revCurrent = activeCurrent.reduce((sum, o) => sum + ((o.is_replacement || o.is_seeding) ? 0 : (o.total_price || 0)), 0);
    const revPrev = activePrev.reduce((sum, o) => sum + ((o.is_replacement || o.is_seeding) ? 0 : (o.total_price || 0)), 0);
    const revenueGrowth = revPrev === 0 ? null : ((revCurrent - revPrev) / revPrev * 100);

    const ordCurrent = activeCurrent.filter(o => !o.is_replacement && !o.is_seeding).length;
    const ordPrev = activePrev.filter(o => !o.is_replacement && !o.is_seeding).length;
    const ordersGrowth = ordPrev === 0 ? null : ((ordCurrent - ordPrev) / ordPrev * 100);

    const inventoryValue = materials.reduce((sum, m) => sum + (m.actualStock * (m.price || 0)), 0);

    const adCurrentTotal = adsCurrent.reduce((sum, a) => sum + a.amount, 0);
    const adPrevTotal = adsPrev.reduce((sum, a) => sum + a.amount, 0);
    const adCostGrowth = adPrevTotal === 0 ? null : ((adCurrentTotal - adPrevTotal) / adPrevTotal * 100);

    // Calculate exact affiliate fee for a date range
    const calculateExactAffiliateFee = (startCalendar, endCalendar) => {
      let totalFee = 0;
      const platformFees = {};
      
      let iter = new Date(startCalendar);
      // to avoid infinite loop on edge cases, limit to reasonable days
      let safeGuard = 0;
      while (iter <= endCalendar && safeGuard < 5000) {
        const m = iter.getUTCMonth() + 1;
        const y = iter.getUTCFullYear();
        const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
        
        const monthlyFees = affiliateFees.filter(f => f.month === m && f.year === y);
        monthlyFees.forEach(f => {
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

    const normalCompletedCurrent = activeCurrent.filter(o => !o.is_replacement && !o.is_seeding);
    const replacementCurrent = activeCurrent.filter(o => o.is_replacement);
    const seedingCurrent = activeCurrent.filter(o => o.is_seeding);

    const normalCompletedPrev = activePrev.filter(o => !o.is_replacement && !o.is_seeding);

    const currentCOGS = normalCompletedCurrent.reduce((sum, o) => {
      return sum + (o.items || []).reduce((itemSum, item) => itemSum + (unitCostFor(item) * item.quantity), 0) + (o.packaging_cost || 0);
    }, 0);
    const prevCOGS = normalCompletedPrev.reduce((sum, o) => {
      return sum + (o.items || []).reduce((itemSum, item) => itemSum + (unitCostFor(item) * item.quantity), 0) + (o.packaging_cost || 0);
    }, 0);

    const currentLogistics = normalCompletedCurrent.reduce((sum, o) => sum + (o.logistics_cost || 0), 0);
    const prevLogistics = normalCompletedPrev.reduce((sum, o) => sum + (o.logistics_cost || 0), 0);

    const currentReplacementCost = replacementCurrent.reduce((sum, o) => {
      return sum + (o.items || []).reduce((itemSum, item) => itemSum + (unitCostFor(item) * item.quantity), 0) + (o.packaging_cost || 0) + (o.logistics_cost || 0);
    }, 0);
    const prevReplacementCost = activePrev.filter(o => o.is_replacement).reduce((sum, o) => {
      return sum + (o.items || []).reduce((itemSum, item) => itemSum + (unitCostFor(item) * item.quantity), 0) + (o.packaging_cost || 0) + (o.logistics_cost || 0);
    }, 0);

    const currentSeedingCost = seedingCurrent.reduce((sum, o) => {
      return sum + (o.seeding_cost || 0) - (o.total_price || 0) + (o.items || []).reduce((itemSum, item) => itemSum + (unitCostFor(item) * item.quantity), 0) + (o.packaging_cost || 0) + (o.logistics_cost || 0);
    }, 0);
    const prevSeedingCost = activePrev.filter(o => o.is_seeding).reduce((sum, o) => {
      return sum + (o.seeding_cost || 0) - (o.total_price || 0) + (o.items || []).reduce((itemSum, item) => itemSum + (unitCostFor(item) * item.quantity), 0) + (o.packaging_cost || 0) + (o.logistics_cost || 0);
    }, 0);
    const seedingCostGrowth = prevSeedingCost === 0 ? null : ((currentSeedingCost - prevSeedingCost) / prevSeedingCost * 100);

    const currentReturnCosts = returnedCurrent.reduce((sum, o) => sum + (o.return_cost || 0), 0);
    const prevReturnCosts = returnedPrev.reduce((sum, o) => sum + (o.return_cost || 0), 0);

    const realProfitCurrent = revCurrent - currentCOGS - adCurrentTotal - currentLogistics - currentReturnCosts - currentReplacementCost - currentSeedingCost - affiliateFeeCurrentTotal;
    const realProfitPrev = revPrev - prevCOGS - adPrevTotal - prevLogistics - prevReturnCosts - prevReplacementCost - prevSeedingCost - affiliateFeePrevTotal;
    const realProfitGrowth = realProfitPrev === 0 ? null : ((realProfitCurrent - realProfitPrev) / Math.abs(realProfitPrev) * 100);

    // 2. Chart data (X days)
    const chartDataMap = {};
    for (let i = 0; i < days; i++) {
      const calendarDate = new Date(startCalendarDate.getTime() + (i * DAY_MS));
      const dateKey = calendarDateKey(calendarDate);
      const dayStr = `${dateKey.slice(8, 10)}/${dateKey.slice(5, 7)}`;
      chartDataMap[dateKey] = { date: dayStr, revenue: 0, cost: 0, cogs: 0 };
    }

    // Accumulate revenue, COGS and Logistics
    ordersCurrent.forEach(o => {
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

    // Accumulate Ad Costs (and leave affiliate fee for overall total, not daily charts since it's monthly)
    adsCurrent.forEach(a => {
      const dateKey = getVietnamDateString(new Date(a.date));
      if (chartDataMap[dateKey]) {
        chartDataMap[dateKey].cost += a.amount;
      }
    });

    const chartData = Object.values(chartDataMap);

    // 3. Cost structure (Ads, Inventory/COGS, Logistics)
    const totalCOGS = chartData.reduce((sum, d) => sum + d.cogs, 0);
    const totalAds = adCurrentTotal;
    const totalAffiliate = affiliateFeeCurrentTotal;
    const totalLogisticsAndReturns = currentLogistics + currentReturnCosts;
    
    const totalCostForStructure = totalCOGS + totalAds + totalAffiliate + totalLogisticsAndReturns;
    
    const costStructure = {
      ads: totalCostForStructure > 0 ? (totalAds / totalCostForStructure * 100) : 0,
      inventory: totalCostForStructure > 0 ? (totalCOGS / totalCostForStructure * 100) : 0,
      logistics: totalCostForStructure > 0 ? (totalLogisticsAndReturns / totalCostForStructure * 100) : 0,
      affiliate: totalCostForStructure > 0 ? (totalAffiliate / totalCostForStructure * 100) : 0
    };


    // 4. Platform Stats (per source)
    const platformMap = {};
    const allCompletedOrders = [...normalCompletedCurrent, ...replacementCurrent];
    ordersCurrent.forEach(o => {
      const src = o.source || 'khác';
      if (!platformMap[src]) {
        platformMap[src] = { source: src, orders: 0, revenue: 0, returned: 0, replacements: 0, affiliate_fee: 0 };
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

    Object.entries(currentAffiliateData.platformFees).forEach(([src, amount]) => {
      if (amount > 0) {
        if (!platformMap[src]) {
          platformMap[src] = { source: src, orders: 0, revenue: 0, returned: 0, replacements: 0, affiliate_fee: 0 };
        }
        platformMap[src].affiliate_fee = (platformMap[src].affiliate_fee || 0) + amount;
      }
    });

    const platformStats = Object.values(platformMap).map(p => {
      p.affiliate_fee = p.affiliate_fee || 0;
      return p;
    }).sort((a, b) => b.revenue - a.revenue);

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
        productMap[key].variantsMap[variantKey].totalCOGS += unitCostFor(item) * item.quantity;
        
        let itemRevenue = 0;
        if (orderTotalRaw > 0) {
           const itemShare = ((item.unit_price || 0) * item.quantity) / orderTotalRaw;
           itemRevenue = (orderNetRevenue * itemShare);
           productMap[key].totalRevenue += itemRevenue;
        } else {
           itemRevenue = orderNetRevenue / (o.items.length || 1);
           productMap[key].totalRevenue += itemRevenue;
        }
        productMap[key].variantsMap[variantKey].totalRevenue += itemRevenue;

        productMap[key].totalCOGS += unitCostFor(item) * item.quantity;
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

    if (visibleFundTransactions) {
      visibleFundTransactions.forEach(ft => {
        let title = 'Giao dịch quỹ';
        let type = 'fund';
        if (ft.type === 'admin_deposit') { title = 'Góp vốn quỹ'; type = 'deposit'; }
        else if (ft.type === 'admin_withdrawal') { title = 'Rút vốn quỹ'; type = 'withdraw'; }
        else if (ft.type === 'revenue_withdrawal') { title = 'Rút doanh thu'; type = 'withdraw'; }
        else if (ft.type === 'import_payment') { title = 'Thanh toán phiếu nhập'; type = 'payment'; }
        else if (ft.type === 'seeding_payment') { title = 'Chi phí Seeding'; type = 'payment'; }
        else if (ft.type === 'shipping_payment') { title = 'Phí giao hàng'; type = 'payment'; }
        else if (ft.type === 'system_adjustment') { title = 'Đồng bộ hệ thống'; type = 'fund'; }
        else if (ft.type === 'expense_payment') { title = 'Chi tiêu'; type = 'expense'; }
        else if (ft.type === 'order_revenue') { title = 'Doanh thu đơn hàng'; type = 'deposit'; }
        else if (ft.type === 'platform_adjustment') { title = 'Điều chỉnh nền tảng'; type = 'fund'; }
        
        // Smart display: use fund_change if non-zero, else platform_change, else amount (for order_revenue/revenue_withdrawal)
        let displayChange = ft.fund_change !== 0 ? ft.fund_change
          : (ft.platform_change && ft.platform_change !== 0) ? ft.platform_change
          : (ft.type === 'revenue_withdrawal' ? -(ft.amount || 0)
          : (ft.type === 'order_revenue' ? (ft.amount || 0) : 0));
        
        recentActivities.push({
          type: type,
          title: title,
          subtitle: `Do ${ft.created_by || 'Admin'} thực hiện`,
          detail: `${displayChange >= 0 ? '+' : ''}${displayChange.toLocaleString('vi-VN')} đ`,
          time: ft.createdAt
        });
      });
    }
    
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
        affiliateFee: affiliateFeeCurrentTotal,
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
      recentInventoryChecks,
      recentFundTransactions
    ] = await Promise.all([
      Order.find({}).sort({ ordered_at: -1 }).limit(15),
      ImportTicket.find({ status: 'completed' }).sort({ completed_at: -1 }).limit(3),
      InventoryCheck.find({}).sort({ createdAt: -1 }).limit(3),
      FundTransaction.find({}).sort({ createdAt: -1 }).limit(10).lean()
    ]);
    const visibleFundTransactions = groupFundHistory(await filterOrphanOrderRevenue(recentFundTransactions));

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

    if (visibleFundTransactions) {
      visibleFundTransactions.forEach(ft => {
        let title = 'Giao dịch quỹ';
        let type = 'fund';
        if (ft.type === 'admin_deposit') { title = 'Góp vốn quỹ'; type = 'deposit'; }
        else if (ft.type === 'admin_withdrawal') { title = 'Rút vốn quỹ'; type = 'withdraw'; }
        else if (ft.type === 'revenue_withdrawal') { title = 'Rút doanh thu'; type = 'withdraw'; }
        else if (ft.type === 'import_payment') { title = 'Thanh toán phiếu nhập'; type = 'payment'; }
        else if (ft.type === 'seeding_payment') { title = 'Chi phí Seeding'; type = 'payment'; }
        else if (ft.type === 'shipping_payment') { title = 'Phí giao hàng'; type = 'payment'; }
        else if (ft.type === 'system_adjustment') { title = 'Đồng bộ hệ thống'; type = 'fund'; }
        else if (ft.type === 'expense_payment') { title = 'Chi tiêu'; type = 'expense'; }
        else if (ft.type === 'order_revenue') { title = 'Doanh thu đơn hàng'; type = 'deposit'; }
        else if (ft.type === 'platform_adjustment') { title = 'Điều chỉnh nền tảng'; type = 'fund'; }

        const displayChange = ft.fund_change !== 0 ? ft.fund_change
          : (ft.platform_change && ft.platform_change !== 0) ? ft.platform_change
          : (ft.type === 'revenue_withdrawal' ? -(ft.amount || 0)
          : (ft.type === 'order_revenue' ? (ft.amount || 0) : 0));

        recentActivities.push({
          type: type,
          title: title,
          subtitle: `Do ${ft.created_by || 'Admin'} thực hiện`,
          detail: `${displayChange >= 0 ? '+' : ''}${displayChange.toLocaleString('vi-VN')} đ`,
          time: ft.createdAt
        });
      });
    }
    
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
