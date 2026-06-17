require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('./models/Order');
const FundTransaction = require('./models/FundTransaction');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  console.log('Connected to remote DB');
  
  const fundAgg = await FundTransaction.aggregate([{ $group: { _id: null, totalBalance: { $sum: '$fund_change' } } }]);
  const totalFundBalance = fundAgg.length > 0 ? fundAgg[0].totalBalance : 0;
  
  const orderRevAgg = await Order.aggregate([
    { $match: { status: { $ne: 'returned' } } },
    { $group: { _id: '$source', totalRevenue: { $sum: '$total_price' } } }
  ]);
  const withdrawnAgg = await FundTransaction.aggregate([
    { $match: { type: 'revenue_withdrawal' } },
    { $group: { _id: '$source', totalWithdrawn: { $sum: '$amount' } } }
  ]);
  
  const revMap = {}; orderRevAgg.forEach(i => revMap[i._id] = i.totalRevenue);
  const withMap = {}; withdrawnAgg.forEach(i => withMap[i._id] = i.totalWithdrawn);
  
  let shopeeAvail = 0;
  const platforms = ['shopee', 'tiktok', 'instagram', 'facebook', 'youtube', 'google', 'khác'];
  platforms.forEach(p => {
    const rev = revMap[p] || 0;
    const withD = withMap[p] || 0;
    const avail = rev - withD;
    console.log(p + ' available: ' + avail);
    if (p === 'shopee') shopeeAvail = avail;
  });
  
  console.log('current total fund: ' + totalFundBalance);
  console.log('current shopee avail: ' + shopeeAvail);

  const targetFund = 923382;
  const targetShopee = 586225;

  const fundDiff = targetFund - totalFundBalance;
  const shopeeDiff = targetShopee - shopeeAvail; 

  console.log('fundDiff to apply:', fundDiff);
  console.log('shopeeDiff to apply:', shopeeDiff); 

  if (fundDiff !== 0) {
    await FundTransaction.create({
      type: 'admin_deposit',
      amount: Math.abs(fundDiff),
      fund_change: fundDiff,
      note: 'Đồng bộ lại tài sản chung theo yêu cầu',
      created_by: 'System Sync'
    });
    console.log('Adjusted fund balance by', fundDiff);
  }

  if (shopeeDiff > 0) {
    await Order.create({
      orderId: 'SYNC-SHOPEE-' + Date.now(),
      status: 'completed',
      source: 'shopee',
      is_seeding: true,
      total_price: shopeeDiff,
      seeding_cost: 0,
      logistics_cost: 0,
      items: [],
      ordered_at: new Date(),
      note: 'Đơn ảo đồng bộ doanh thu khả dụng'
    });
    console.log('Created dummy order to add', shopeeDiff, 'to Shopee');
  } else if (shopeeDiff < 0) {
    await FundTransaction.create({
      type: 'revenue_withdrawal',
      source: 'shopee',
      amount: Math.abs(shopeeDiff),
      fee: 0,
      fund_change: 0, 
      note: 'Đồng bộ lại doanh thu khả dụng Shopee theo yêu cầu',
      created_by: 'System Sync'
    });
    console.log('Withdrawn', Math.abs(shopeeDiff), 'from Shopee');
  }

  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
