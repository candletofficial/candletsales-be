const FundTransaction = require('../models/FundTransaction');
const Order = require('../models/Order');
const ImportTicket = require('../models/ImportTicket');
const mongoose = require('mongoose');

const PLATFORMS = ['pos', 'shopee', 'tiktok', 'youtube', 'website', 'khác'];

exports.getSummary = async (req, res) => {
  try {
    // 1. Calculate Total Fund Balance
    const fundAgg = await FundTransaction.aggregate([
      { $group: { _id: null, totalBalance: { $sum: '$fund_change' } } }
    ]);
    const totalFundBalance = fundAgg.length > 0 ? fundAgg[0].totalBalance : 0;

    // 2. Calculate Platform Balances
    // Get total revenue for each platform
    const orderRevenueAgg = await Order.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: '$source', totalRevenue: { $sum: '$total_price' } } }
    ]);

    // Get total withdrawn for each platform
    const withdrawnAgg = await FundTransaction.aggregate([
      { $match: { type: 'revenue_withdrawal' } },
      { $group: { _id: '$source', totalWithdrawn: { $sum: '$amount' } } }
    ]);

    const adjustmentAgg = await FundTransaction.aggregate([
      { $match: { type: 'platform_adjustment' } },
      { $group: { _id: '$source', totalAdjustment: { $sum: '$platform_change' } } }
    ]);

    const revenueMap = {};
    const withdrawnMap = {};
    const adjustmentMap = {};

    orderRevenueAgg.forEach(item => {
      const source = item._id || 'khác';
      revenueMap[source] = item.totalRevenue;
    });

    withdrawnAgg.forEach(item => {
      const source = item._id || 'khác';
      withdrawnMap[source] = item.totalWithdrawn;
    });

    adjustmentAgg.forEach(item => {
      const source = item._id || 'khác';
      adjustmentMap[source] = item.totalAdjustment;
    });

    const platformBalances = PLATFORMS.map(platform => {
      const totalRevenue = revenueMap[platform] || 0;
      const totalWithdrawn = withdrawnMap[platform] || 0;
      const totalAdjustment = adjustmentMap[platform] || 0;
      const availableBalance = totalRevenue - totalWithdrawn + totalAdjustment;
      
      return {
        platform,
        totalRevenue,
        totalWithdrawn,
        totalAdjustment,
        availableBalance
      };
    });

    const adminDepositsAgg = await FundTransaction.aggregate([
      { $match: { type: { $in: ['admin_deposit', 'admin_withdrawal'] } } },
      { $group: { 
          _id: '$created_by', 
          totalDeposit: { 
            $sum: { $cond: [{ $eq: ['$type', 'admin_deposit'] }, '$amount', 0] } 
          },
          totalWithdrawal: { 
            $sum: { $cond: [{ $eq: ['$type', 'admin_withdrawal'] }, '$amount', 0] } 
          },
          netDeposit: { $sum: '$fund_change' }
        } 
      },
      { $sort: { netDeposit: -1 } }
    ]);

    const adminDeposits = adminDepositsAgg.map(item => ({
      admin: item._id || 'Unknown',
      totalDeposit: item.totalDeposit,
      totalWithdrawal: item.totalWithdrawal,
      netDeposit: item.netDeposit
    }));

    // 4. Tính tổng nợ phiếu nhập chưa tất toán (payment_status = 'unsettled' hoặc không có)
    const importDebtAgg = await ImportTicket.aggregate([
      { $match: { payment_status: { $ne: 'settled' } } },
      { $group: { _id: null, totalDebt: { $sum: '$total_amount' } } }
    ]);
    const totalImportDebt = importDebtAgg.length > 0 ? importDebtAgg[0].totalDebt : 0;

    res.json({
      success: true,
      data: {
        totalFundBalance,
        platformBalances,
        adminDeposits,
        totalImportDebt
      }
    });
  } catch (error) {
    console.error('Error in getSummary:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi tải thông tin quỹ' });
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limitParam = parseInt(req.query.limit);
    const limit = isNaN(limitParam) ? 20 : limitParam;
    const skip = limit > 0 ? (page - 1) * limit : 0;
    const filter = {};
    if (req.query.type && req.query.type !== 'all') {
      filter.type = req.query.type;
    }

    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};
      if (req.query.startDate) {
        filter.createdAt.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        filter.createdAt.$lte = new Date(req.query.endDate);
      }
    }

    let query = FundTransaction.find(filter)
      .populate({ path: 'import_ticket_id', select: 'code' })
      .sort({ createdAt: -1 });

    if (limit > 0) {
      query = query.skip(skip).limit(limit);
    }

    const transactions = await query;

    const total = await FundTransaction.countDocuments(filter);

    res.json({
      success: true,
      data: {
        transactions,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        totalItems: total
      }
    });
  } catch (error) {
    console.error('Error in getTransactions:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi tải lịch sử giao dịch' });
  }
};

exports.deposit = async (req, res) => {
  try {
    const { amount, note, created_by } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Số tiền góp vốn không hợp lệ' });
    }

    const transaction = new FundTransaction({
      type: 'admin_deposit',
      amount,
      fund_change: amount, // Positive for deposit
      note,
      created_by: created_by || 'Admin'
    });

    await transaction.save();

    res.json({ success: true, message: 'Góp vốn thành công', data: transaction });
  } catch (error) {
    console.error('Error in deposit:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi góp vốn' });
  }
};

exports.withdrawCapital = async (req, res) => {
  try {
    const { amount, note, created_by } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Số tiền rút không hợp lệ' });
    }

    const fundAgg = await FundTransaction.aggregate([
      { $group: { _id: null, totalBalance: { $sum: '$fund_change' } } }
    ]);
    const totalFundBalance = fundAgg.length > 0 ? fundAgg[0].totalBalance : 0;

    if (amount > totalFundBalance) {
      return res.status(400).json({ success: false, message: 'Số tiền rút vượt quá tài sản chung' });
    }

    const transaction = new FundTransaction({
      type: 'admin_withdrawal',
      amount,
      fund_change: -amount,
      note,
      created_by: created_by || 'Admin'
    });

    await transaction.save();

    res.json({ success: true, message: 'Rút vốn thành công', data: transaction });
  } catch (error) {
    console.error('Error in withdrawCapital:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi rút vốn' });
  }
};

exports.withdrawRevenue = async (req, res) => {
  try {
    const { source, amount, fee, note, created_by } = req.body;

    if (!PLATFORMS.includes(source)) {
      return res.status(400).json({ success: false, message: 'Nền tảng không hợp lệ' });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Số tiền rút không hợp lệ' });
    }

    const numFee = fee ? Number(fee) : 0;
    if (numFee < 0) {
      return res.status(400).json({ success: false, message: 'Phí không hợp lệ' });
    }

    // Double check if available balance is sufficient
    const orderRevenueAgg = await Order.aggregate([
      { $match: { status: 'completed', source } },
      { $group: { _id: null, totalRevenue: { $sum: '$total_price' } } }
    ]);
    const totalRevenue = orderRevenueAgg.length > 0 ? orderRevenueAgg[0].totalRevenue : 0;

    const withdrawnAgg = await FundTransaction.aggregate([
      { $match: { type: 'revenue_withdrawal', source } },
      { $group: { _id: null, totalWithdrawn: { $sum: '$amount' } } }
    ]);
    const totalWithdrawn = withdrawnAgg.length > 0 ? withdrawnAgg[0].totalWithdrawn : 0;

    const availableBalance = totalRevenue - totalWithdrawn;

    if (amount > availableBalance) {
      return res.status(400).json({ success: false, message: `Số dư khả dụng trên ${source} không đủ để rút` });
    }

    const fundChange = amount - numFee;

    const transaction = new FundTransaction({
      type: 'revenue_withdrawal',
      amount,
      fee: numFee,
      fund_change: fundChange,
      source,
      note,
      created_by: created_by || 'Admin'
    });

    await transaction.save();

    res.json({ success: true, message: 'Rút tiền thành công', data: transaction });
  } catch (error) {
    console.error('Error in withdrawRevenue:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi rút tiền' });
  }
};

exports.syncFund = async (req, res) => {
  try {
    const { target, newAmount, note, created_by } = req.body;
    if (newAmount === undefined || newAmount < 0) {
      return res.status(400).json({ success: false, message: 'Số tiền mới không hợp lệ' });
    }

    if (target === 'total_fund') {
      const fundAgg = await FundTransaction.aggregate([
        { $group: { _id: null, totalBalance: { $sum: '$fund_change' } } }
      ]);
      const currentBalance = fundAgg.length > 0 ? fundAgg[0].totalBalance : 0;
      const diff = newAmount - currentBalance;

      if (diff !== 0) {
        const transaction = new FundTransaction({
          type: 'system_adjustment',
          amount: Math.abs(diff),
          fund_change: diff,
          note: note || 'Đồng bộ hệ thống (Tổng tài sản chung)',
          created_by: created_by || 'Admin'
        });
        await transaction.save();
      }
      return res.json({ success: true, message: 'Đồng bộ tài sản chung thành công' });
    } else if (PLATFORMS.includes(target)) {
      // Calculate current platform balance
      const orderRevenueAgg = await Order.aggregate([
        { $match: { status: 'completed', source: target } },
        { $group: { _id: null, totalRevenue: { $sum: '$total_price' } } }
      ]);
      const totalRevenue = orderRevenueAgg.length > 0 ? orderRevenueAgg[0].totalRevenue : 0;

      const withdrawnAgg = await FundTransaction.aggregate([
        { $match: { type: 'revenue_withdrawal', source: target } },
        { $group: { _id: null, totalWithdrawn: { $sum: '$amount' } } }
      ]);
      const totalWithdrawn = withdrawnAgg.length > 0 ? withdrawnAgg[0].totalWithdrawn : 0;

      const adjustmentAgg = await FundTransaction.aggregate([
        { $match: { type: 'platform_adjustment', source: target } },
        { $group: { _id: null, totalAdjustment: { $sum: '$platform_change' } } }
      ]);
      const totalAdjustment = adjustmentAgg.length > 0 ? adjustmentAgg[0].totalAdjustment : 0;

      const currentBalance = totalRevenue - totalWithdrawn + totalAdjustment;
      const diff = newAmount - currentBalance;

      if (diff !== 0) {
        const transaction = new FundTransaction({
          type: 'platform_adjustment',
          amount: Math.abs(diff),
          fund_change: 0,
          platform_change: diff,
          source: target,
          note: note || `Đồng bộ hệ thống (Nền tảng ${target})`,
          created_by: created_by || 'Admin'
        });
        await transaction.save();
      }
      return res.json({ success: true, message: `Đồng bộ số dư ${target} thành công` });
    } else {
      return res.status(400).json({ success: false, message: 'Mục tiêu đồng bộ không hợp lệ' });
    }
  } catch (error) {
    console.error('Error in syncFund:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi đồng bộ tài sản' });
  }
};

exports.deleteAllTransactions = async (req, res) => {
  try {
    // Xoá tất cả lịch sử giao dịch hiện tại
    await FundTransaction.deleteMany({});

    // Vì số dư khả dụng của nền tảng = tổng doanh thu (Order) - rút - điều chỉnh.
    // Xoá lịch sử làm rút/điều chỉnh = 0 -> số dư nền tảng sẽ bị đội lên bằng tổng doanh thu từ trước đến nay.
    // Để reset số dư nền tảng về 0, ta cần chèn 1 giao dịch điều chỉnh âm đúng bằng tổng doanh thu.
    const orderRevenueAgg = await Order.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: '$source', totalRevenue: { $sum: '$total_price' } } }
    ]);

    const adjustmentTransactions = [];
    orderRevenueAgg.forEach(item => {
      const source = item._id || 'khác';
      const totalRevenue = item.totalRevenue;
      
      if (totalRevenue > 0) {
        adjustmentTransactions.push({
          type: 'platform_adjustment',
          amount: totalRevenue,
          fund_change: 0,
          platform_change: -totalRevenue,
          source: source,
          note: `Hệ thống tự động Reset số dư về 0`,
          created_by: 'System'
        });
      }
    });

    if (adjustmentTransactions.length > 0) {
      await FundTransaction.insertMany(adjustmentTransactions);
    }

    res.json({ success: true, message: 'Đã xoá toàn bộ lịch sử và reset số dư về 0' });
  } catch (error) {
    console.error('Error in deleteAllTransactions:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi xoá lịch sử giao dịch' });
  }
};
