/**
 * Tạo tài khoản admin mặc định.
 * Chạy: npm run seed:admin
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

const adminEmail = process.env.DEFAULT_ADMIN_EMAIL;
const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD;
const adminName = process.env.DEFAULT_ADMIN_NAME || 'Admin';

async function seedAdmin() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('Thiếu biến môi trường MONGODB_URI');
    }

    if (!adminEmail || !adminPassword || adminPassword.length < 12) {
      throw new Error(
        'DEFAULT_ADMIN_EMAIL và DEFAULT_ADMIN_PASSWORD (tối thiểu 12 ký tự) là bắt buộc'
      );
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Đã kết nối MongoDB');

    const existing = await User.findOne({ isDefaultAdmin: true });
    if (existing) {
      console.log(`Admin mặc định đã tồn tại: ${existing.email}`);
      return;
    }

    const admin = await User.create({
      name: adminName,
      email: adminEmail,
      password: adminPassword,
      role: 'admin',
      status: 'active',
      isDefaultAdmin: true,
    });

    console.log(`Đã tạo admin mặc định: ${admin.email}`);
    console.log('Mật khẩu được lấy từ biến môi trường và không được in ra terminal.');
  } finally {
    await mongoose.disconnect();
  }
}

seedAdmin().catch((error) => {
  console.error('Không thể tạo admin:', error.message);
  process.exitCode = 1;
});
