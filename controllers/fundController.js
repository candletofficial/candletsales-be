const FundTransaction = require('../models/FundTransaction');
const Order = require('../models/Order');
const mongoose = require('mongoose');

const PLATFORMS = ['pos', 'shopee', 'tiktok', 'youtube', 'google', 'khác'];

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
      { $match: { status: { $ne: 'returned' } } },
      { $group: { _id: '$source', totalRevenue: { $sum: '$total_price' } } }
    ]);

    // Get total withdrawn for each platform
    const withdrawnAgg = await FundTransaction.aggregate([
      { $match: { type: 'revenue_withdrawal' } },
      { $group: { _id: '$source', totalWithdrawn: { $sum: '$amount' } } }
    ]);

    const revenueMap = {};
    const withdrawnMap = {};

    orderRevenueAgg.forEach(item => {
      const source = item._id || 'khác';
      revenueMap[source] = item.totalRevenue;
    });

    withdrawnAgg.forEach(item => {
      const source = item._id || 'khác';
      withdrawnMap[source] = item.totalWithdrawn;
    });

    const platformBalances = PLATFORMS.map(platform => {
      const totalRevenue = revenueMap[platform] || 0;
      const totalWithdrawn = withdrawnMap[platform] || 0;
      const availableBalance = totalRevenue - totalWithdrawn;
      
      return {
        platform,
        totalRevenue,
        totalWithdrawn,
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

    res.json({
      success: true,
      data: {
        totalFundBalance,
        platformBalances,
        adminDeposits
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
      { $match: { status: { $ne: 'returned' }, source } },
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
