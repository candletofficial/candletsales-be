/**
 * Script tạo tài khoản admin mặc định
 * Chạy: node scripts/seedAdmin.js
 *
 * Tài khoản này sẽ có:
 * - status = 'active'   (đăng nhập được ngay)
 * - isDefaultAdmin = true (không thể bị xóa/thu hồi)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

const ADMIN_EMAIL = process.env.DEFAULT_ADMIN_EMAIL || 'admin@candletsales.com';
const ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@123456';
const ADMIN_NAME = process.env.DEFAULT_ADMIN_NAME || 'Admin';

async function seedAdmin() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Đã kết nối MongoDB');

    // Kiểm tra đã tồn tại chưa
    const existing = await User.findOne({ isDefaultAdmin: true });
    if (existing) {
      console.log(`⚠️  Admin mặc định đã tồn tại: ${existing.email}`);
      process.exit(0);
    }

    const admin = await User.create({
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      role: 'admin',
      status: 'active',
      isDefaultAdmin: true,
    });

    console.log('🎉 Tạo tài khoản admin mặc định thành công!');
    console.log('─────────────────────────────────────');
    console.log(`📧 Email    : ${admin.email}`);
    console.log(`🔑 Password : ${ADMIN_PASSWORD}`);
    console.log(`👤 Tên      : ${admin.name}`);
    console.log('─────────────────────────────────────');
    console.log('⚠️  Hãy đổi mật khẩu sau khi đăng nhập lần đầu!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Lỗi khi tạo admin:', error.message);
    process.exit(1);
  }
}

seedAdmin();
