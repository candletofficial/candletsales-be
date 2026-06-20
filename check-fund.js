const mongoose = require('mongoose');
const Order = require('./models/Order');
const FundTransaction = require('./models/FundTransaction');

mongoose.connect('mongodb://localhost:27017/candletsales').then(async () => {
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
  const platforms = ['shopee', 'tiktok', 'instagram', 'facebook', 'youtube', 'website', 'khác'];
  platforms.forEach(p => {
    const rev = revMap[p] || 0;
    const withD = withMap[p] || 0;
    const avail = rev - withD;
    console.log(p + ' available: ' + avail);
    if (p === 'shopee') shopeeAvail = avail;
  });
  
  console.log('total fund: ' + totalFundBalance);
  process.exit(0);
});
