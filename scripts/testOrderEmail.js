require('dotenv').config();

const { notifyNewWebsiteOrder } = require('../utils/orderEmailNotifier');

(async () => {
  const sent = await notifyNewWebsiteOrder({
    source: 'website',
    orderId: 'TEST-EMAIL',
    customer_name: 'Khách kiểm tra',
    customer_phone: '0900000000',
    customer_address: 'Đây là email kiểm tra, không phải đơn hàng thật.',
    payment_method: 'cash',
    total_price: 0,
    items: [{ product_name: 'Email test CandletShop', quantity: 1 }],
  });

  if (!sent) {
    console.error('Gửi email kiểm tra thất bại. Kiểm tra BREVO_API_KEY hoặc các biến MAIL_* trong .env.');
    process.exitCode = 1;
    return;
  }
  console.log('Đã gửi email kiểm tra. Hãy kiểm tra cả thư mục Spam.');
})();
