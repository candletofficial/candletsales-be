require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');

const PORT = process.env.PORT || 5000;

// Kết nối MongoDB rồi mới khởi động server
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
    console.log(`🌍 Môi trường: ${process.env.NODE_ENV}`);
    console.log(`📡 API Health: http://localhost:${PORT}/api/health`);
  });
});

// Xử lý unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err.message);
  process.exit(1);
});
