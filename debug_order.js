require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('./models/Order');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  // Tìm đơn theo orderId hoặc pancake_order_id
  const orders = await Order.find({
    $or: [
      { orderId: { $regex: '260805', $options: 'i' } },
      { pancake_order_id: { $regex: '260805HP8PT5F1', $options: 'i' } }
    ]
  }).sort({ createdAt: -1 }).limit(10);
  
  console.log('=== Ket qua tim kiem don 260805HP8PT5F1 ===');
  console.log('So don tim duoc:', orders.length);
  orders.forEach(o => {
    console.log('- orderId:', o.orderId, '| pancake_order_id:', o.pancake_order_id, '| status:', o.status, '| created:', o.createdAt);
  });

  // Xem 5 don moi nhat
  const latest = await Order.find().sort({ createdAt: -1 }).limit(5);
  console.log('\n=== 5 don moi nhat trong DB ===');
  latest.forEach(o => {
    console.log('- orderId:', o.orderId, '| pancake_order_id:', o.pancake_order_id, '| status:', o.status, '| created:', o.createdAt);
  });

  mongoose.disconnect();
});
