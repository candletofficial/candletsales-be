const mongoose = require('mongoose');
require('dotenv').config();

const FundTransaction = require('./models/FundTransaction');
const Order = require('./models/Order');

async function fixRevenue() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to DB');

    const txs = await FundTransaction.find({ type: 'order_revenue' });
    let fixedCount = 0;

    for (let tx of txs) {
      if (!tx.order_id) continue;
      const order = await Order.findById(tx.order_id);
      if (order) {
        if (tx.amount !== order.total_price) {
          console.log(`Fixing tx for order ${order.orderId}: amount was ${tx.amount}, now ${order.total_price}`);
          tx.amount = order.total_price;
          tx.platform_change = order.total_price;
          await tx.save();
          fixedCount++;
        }
      }
    }

    console.log(`Fixed ${fixedCount} transactions.`);
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

fixRevenue();
