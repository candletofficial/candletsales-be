require('dotenv').config();
const mongoose = require('mongoose');
const FundTransaction = require('./models/FundTransaction');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  console.log('Connected to remote DB');
  
  const deposits = await FundTransaction.find({ type: 'admin_deposit' });
  
  for (const d of deposits) {
    d.type = 'system_adjustment';
    d.created_by = 'System Sync';
    await d.save();
  }
  
  console.log('Successfully converted', deposits.length, 'admin_deposits to system_adjustments');
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
