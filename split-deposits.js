require('dotenv').config();
const mongoose = require('mongoose');
const FundTransaction = require('./models/FundTransaction');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  console.log('Connected to remote DB');
  
  // 1. Calculate total existing admin_deposit
  const deposits = await FundTransaction.find({ type: 'admin_deposit' });
  let totalAmount = 0;
  let totalFundChange = 0;
  
  deposits.forEach(d => {
    totalAmount += d.amount;
    totalFundChange += d.fund_change;
  });
  
  console.log('Total Amount:', totalAmount);
  
  // 2. Delete existing
  await FundTransaction.deleteMany({ type: 'admin_deposit' });
  
  // 3. Create two new evenly split deposits
  const halfAmount = totalAmount / 2;
  const halfFundChange = totalFundChange / 2;
  
  await FundTransaction.create({
    type: 'admin_deposit',
    amount: halfAmount,
    fund_change: halfFundChange,
    note: 'Đồng bộ dữ liệu góp vốn ban đầu',
    created_by: 'Phạm Xuân Trung'
  });
  
  await FundTransaction.create({
    type: 'admin_deposit',
    amount: halfAmount,
    fund_change: halfFundChange,
    note: 'Đồng bộ dữ liệu góp vốn ban đầu',
    created_by: 'Đàm Văn Tùng'
  });

  console.log('Successfully split existing admin deposits 50/50.');
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
