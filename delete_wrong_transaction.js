const mongoose = require('mongoose');

mongoose.connect('mongodb+srv://candletsales:candletsales2026@candletsales.2sko5of.mongodb.net/candletsales?appName=Candletsales')
  .then(async () => {
    const Order = mongoose.model('Order', new mongoose.Schema({}, { strict: false }));
    const FundTransaction = mongoose.model('FundTransaction', new mongoose.Schema({}, { strict: false }));

    // Tìm order 260805HP8PTSF1
    const order = await Order.findOne({ orderId: '260805HP8PTSF1' }).lean();
    if (!order) {
      console.log('KHÔNG TÌM THẤY đơn 260805HP8PTSF1');
      await mongoose.disconnect();
      return;
    }

    console.log('Tìm thấy order:', order._id.toString());

    // Xoá giao dịch order_revenue của đơn này
    const result = await FundTransaction.deleteMany({
      type: 'order_revenue',
      order_id: order._id
    });

    console.log(`Đã xoá ${result.deletedCount} giao dịch order_revenue của đơn 260805HP8PTSF1`);
    await mongoose.disconnect();
  })
  .catch(err => console.error('Lỗi:', err.message));
