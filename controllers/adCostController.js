const AdCost = require('../models/AdCost');
const AffiliateFee = require('../models/AffiliateFee');
const FundTransaction = require('../models/FundTransaction');

const PLATFORMS = ['facebook', 'tiktok', 'shopee', 'website', 'instagram', 'youtube'];

// GET /api/ad-costs/balances
exports.getBalances = async (req, res, next) => {
  try {
    // Tổng tiền đã nạp cho mỗi nền tảng
    const topupAgg = await FundTransaction.aggregate([
      { $match: { type: { $in: ['ad_topup', 'ad_adjustment'] } } },
      { $group: { 
          _id: '$source', 
          totalTopup: { 
            $sum: { 
              $cond: [
                { $eq: ['$type', 'ad_topup'] }, 
                '$amount', 
                '$platform_change' 
              ] 
            } 
          } 
      } }
    ]);

    // Tổng tiền đã chi cho mỗi nền tảng
    const costAgg = await AdCost.aggregate([
      { $group: { _id: '$platform', totalSpent: { $sum: '$base_amount' } } } // using base_amount per user requirement
    ]);

    const topupMap = {};
    topupAgg.forEach(item => { if (item._id) topupMap[item._id] = item.totalTopup; });

    const costMap = {};
    costAgg.forEach(item => { if (item._id) costMap[item._id] = item.totalSpent; });

    const balances = PLATFORMS.map(platform => {
      const totalTopup = topupMap[platform] || 0;
      const totalSpent = costMap[platform] || 0;
      return {
        platform,
        totalTopup,
        totalSpent,
        balance: totalTopup - totalSpent
      };
    });

    res.status(200).json({ success: true, data: balances });
  } catch (error) {
    next(error);
  }
};

// POST /api/ad-costs/topup
exports.topupPlatform = async (req, res, next) => {
  try {
    const { platform, amount, fee, note, created_by, fundingSource = 'common' } = req.body;

    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ success: false, message: 'Nền tảng không hợp lệ' });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Số tiền nạp không hợp lệ' });
    }

    if (fundingSource === 'platform' && (platform === 'facebook' || platform === 'instagram')) {
      return res.status(400).json({ success: false, message: 'Facebook và Instagram chỉ có thể nạp từ tài sản chung' });
    }

    const numFee = fee ? Number(fee) : 0;
    const totalDeduction = Number(amount) + numFee;

    if (fundingSource === 'platform') {
      const Order = require('../models/Order');
      const orderRevenueAgg = await Order.aggregate([
        { $match: { status: { $ne: 'returned' }, source: platform } },
        { $group: { _id: null, totalRevenue: { $sum: '$total_price' } } }
      ]);
      const totalRevenue = orderRevenueAgg.length > 0 ? orderRevenueAgg[0].totalRevenue : 0;
  
      const withdrawnAgg = await FundTransaction.aggregate([
        { $match: { type: 'revenue_withdrawal', source: platform } },
        { $group: { _id: null, totalWithdrawn: { $sum: '$amount' } } }
      ]);
      const totalWithdrawn = withdrawnAgg.length > 0 ? withdrawnAgg[0].totalWithdrawn : 0;
  
      const availableBalance = totalRevenue - totalWithdrawn;
  
      if (totalDeduction > availableBalance) {
        return res.status(400).json({ success: false, message: `Số dư khả dụng trên ${platform} không đủ để nạp` });
      }
      
      // Rút tiền từ nền tảng (không cộng vào tài sản chung -> fund_change = 0)
      await FundTransaction.create({
        type: 'revenue_withdrawal',
        amount: totalDeduction,
        fee: 0,
        fund_change: 0,
        source: platform,
        note: `Rút tiền từ ${platform} để nạp quảng cáo`,
        created_by: created_by || 'Admin'
      });
      
      // Nạp tiền quảng cáo
      const transaction = new FundTransaction({
        type: 'ad_topup',
        amount: Number(amount),
        fee: numFee,
        fund_change: 0,
        source: platform,
        note: note || `Nạp tiền quảng cáo ${platform} từ tài sản riêng`,
        created_by: created_by || 'Admin'
      });
      
      await transaction.save();
      return res.status(200).json({ success: true, message: 'Nạp tiền thành công', data: transaction });
    }

    // Check Fund balance
    const fundAgg = await FundTransaction.aggregate([
      { $group: { _id: null, totalBalance: { $sum: '$fund_change' } } }
    ]);
    const totalFundBalance = fundAgg.length > 0 ? fundAgg[0].totalBalance : 0;

    if (totalFundBalance < totalDeduction) {
      return res.status(400).json({ success: false, message: 'Tài sản chung không đủ để nạp tiền quảng cáo' });
    }

    const transaction = new FundTransaction({
      type: 'ad_topup',
      amount: Number(amount), // Amount entering ad account
      fee: numFee, // VAT
      fund_change: -totalDeduction, // Deduct from Fund
      source: platform,
      note: note || `Nạp tiền quảng cáo ${platform}`,
      created_by: created_by || 'Admin'
    });

    await transaction.save();

    res.status(200).json({ success: true, message: 'Nạp tiền thành công', data: transaction });
  } catch (error) {
    next(error);
  }
};

// GET /api/ad-costs?year=2025&month=5
// Trả về tất cả bản ghi trong tháng
exports.getAdCosts = async (req, res, next) => {
  try {
    const { year, month } = req.query;

    let filter = {};
    if (year && month) {
      const y = parseInt(year);
      const m = parseInt(month) - 1; // JS months 0-indexed
      const start = new Date(y, m, 1);
      const end   = new Date(y, m + 1, 0, 23, 59, 59, 999);
      filter.date = { $gte: start, $lte: end };
    }

    const records = await AdCost.find(filter).sort({ date: 1 });
    res.status(200).json({ success: true, data: records });
  } catch (error) {
    next(error);
  }
};

// POST /api/ad-costs
exports.createAdCost = async (req, res, next) => {
  try {
    const { date, platform, base_amount, vat, amount, note } = req.body;

    // Kiểm tra số dư quảng cáo
    const topupAgg = await FundTransaction.aggregate([
      { $match: { type: { $in: ['ad_topup', 'ad_adjustment'] }, source: platform } },
      { $group: { 
          _id: null, 
          totalTopup: { 
            $sum: { 
              $cond: [{ $eq: ['$type', 'ad_topup'] }, '$amount', '$platform_change'] 
            } 
          } 
      } }
    ]);
    const totalTopup = topupAgg.length > 0 ? topupAgg[0].totalTopup : 0;

    const costAgg = await AdCost.aggregate([
      { $match: { platform } },
      { $group: { _id: null, totalSpent: { $sum: '$base_amount' } } }
    ]);
    const totalSpent = costAgg.length > 0 ? costAgg[0].totalSpent : 0;

    const currentBalance = totalTopup - totalSpent;
    if (currentBalance < Number(base_amount)) {
      return res.status(400).json({ success: false, message: `Số dư tài khoản quảng cáo ${platform} không đủ (Hiện còn: ${currentBalance.toLocaleString('vi-VN')} đ)` });
    }

    const record = await AdCost.create({ date, platform, base_amount, vat, amount, note: note || '' });

    res.status(201).json({ success: true, data: record, message: 'Đã thêm chi phí quảng cáo' });
  } catch (error) {
    next(error);
  }
};

// PUT /api/ad-costs/:id
exports.updateAdCost = async (req, res, next) => {
  try {
    const { date, platform, base_amount, vat, amount, note } = req.body;
    
    // Find old record to know old base_amount
    const oldRecord = await AdCost.findById(req.params.id);
    if (!oldRecord) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy bản ghi' });
    }

    // Kiểm tra số dư quảng cáo nếu platform hoặc base_amount đổi
    const topupAgg = await FundTransaction.aggregate([
      { $match: { type: { $in: ['ad_topup', 'ad_adjustment'] }, source: platform } },
      { $group: { 
          _id: null, 
          totalTopup: { 
            $sum: { 
              $cond: [{ $eq: ['$type', 'ad_topup'] }, '$amount', '$platform_change'] 
            } 
          } 
      } }
    ]);
    const totalTopup = topupAgg.length > 0 ? topupAgg[0].totalTopup : 0;

    const costAgg = await AdCost.aggregate([
      { $match: { platform } },
      { $group: { _id: null, totalSpent: { $sum: '$base_amount' } } }
    ]);
    const totalSpent = costAgg.length > 0 ? costAgg[0].totalSpent : 0;

    // The available balance assuming the old record is reverted
    const availableBalance = (totalTopup - totalSpent) + (oldRecord.platform === platform ? oldRecord.base_amount : 0);
    
    if (availableBalance < Number(base_amount)) {
      return res.status(400).json({ success: false, message: `Số dư tài khoản quảng cáo ${platform} không đủ (Khả dụng: ${availableBalance.toLocaleString('vi-VN')} đ)` });
    }

    const record = await AdCost.findByIdAndUpdate(
      req.params.id,
      { date, platform, base_amount, vat, amount, note },
      { new: true, runValidators: true }
    );
    if (!record) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy bản ghi' });
    }

    res.status(200).json({ success: true, data: record, message: 'Đã cập nhật chi phí' });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/ad-costs/:id
exports.deleteAdCost = async (req, res, next) => {
  try {
    const record = await AdCost.findByIdAndDelete(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy bản ghi' });
    }
    res.status(500).json({ success: false, message: 'Lỗi khi xóa chi phí quảng cáo' });
  } catch (error) {
    next(error);
  }
};

// POST /api/ad-costs/sync
exports.syncAdCost = async (req, res, next) => {
  try {
    const { platform, actualBalance } = req.body;
    
    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ success: false, message: 'Nền tảng không hợp lệ' });
    }

    if (actualBalance === undefined || actualBalance === null) {
      return res.status(400).json({ success: false, message: 'Số tiền thực tế không hợp lệ' });
    }

    // Lấy tổng nạp + điều chỉnh hiện tại
    const topupAgg = await FundTransaction.aggregate([
      { $match: { type: { $in: ['ad_topup', 'ad_adjustment'] }, source: platform } },
      { $group: { 
          _id: null, 
          totalTopup: { 
            $sum: { 
              $cond: [{ $eq: ['$type', 'ad_topup'] }, '$amount', '$platform_change'] 
            } 
          } 
      } }
    ]);
    const totalTopup = topupAgg.length > 0 ? topupAgg[0].totalTopup : 0;

    // Lấy tổng chi
    const costAgg = await AdCost.aggregate([
      { $match: { platform: platform } },
      { $group: { _id: null, totalSpent: { $sum: '$base_amount' } } }
    ]);
    const totalSpent = costAgg.length > 0 ? costAgg[0].totalSpent : 0;

    const currentBalance = totalTopup - totalSpent;
    const diff = Number(actualBalance) - currentBalance;

    if (diff === 0) {
      return res.status(400).json({ success: false, message: 'Số dư không có sự thay đổi' });
    }

    await FundTransaction.create({
      type: 'ad_adjustment',
      amount: Math.abs(diff),
      fee: 0,
      fund_change: 0,
      platform_change: diff,
      source: platform,
      note: `Đồng bộ quỹ quảng cáo (${platform})`,
      created_by: 'System'
    });

    res.status(200).json({ success: true, message: `Đồng bộ quỹ quảng cáo ${platform} thành công` });
  } catch (error) {
    next(error);
  }
};

// GET /api/ad-costs/affiliate-fees
exports.getAffiliateFees = async (req, res, next) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).json({ success: false, message: 'Thiếu year, month' });
    const records = await AffiliateFee.find({ year: Number(year), month: Number(month) });
    res.status(200).json({ success: true, data: records });
  } catch (error) {
    next(error);
  }
};

// POST /api/ad-costs/affiliate-fees
exports.saveAffiliateFee = async (req, res, next) => {
  try {
    const { year, month, platform, amount } = req.body;
    if (!year || !month || !platform) return res.status(400).json({ success: false, message: 'Thiếu thông tin bắt buộc' });
    if (platform !== 'shopee' && platform !== 'tiktok') {
      return res.status(400).json({ success: false, message: 'Chỉ hỗ trợ Shopee và TikTok' });
    }

    let record = await AffiliateFee.findOne({ year, month, platform });
    if (record) {
      record.amount = Number(amount || 0);
      await record.save();
    } else {
      record = await AffiliateFee.create({ year, month, platform, amount: Number(amount || 0) });
    }

    // Update FundTransaction
    const noteStr = `Phí Affiliate tháng ${month}/${year} từ ${platform}`;
    if (Number(amount) > 0) {
      const existingTx = await FundTransaction.findOne({ type: 'revenue_withdrawal', note: noteStr });
      if (existingTx) {
        existingTx.amount = Number(amount);
        await existingTx.save();
      } else {
        await FundTransaction.create({
          type: 'revenue_withdrawal',
          amount: Number(amount),
          fee: 0,
          fund_change: 0,
          source: platform,
          note: noteStr,
          created_by: 'System'
        });
      }
    } else {
      await FundTransaction.deleteMany({ type: 'revenue_withdrawal', note: noteStr });
    }

    res.status(200).json({ success: true, data: record, message: 'Đã lưu phí Affiliate' });
  } catch (error) {
    next(error);
  }
};
