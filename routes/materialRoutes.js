const express = require('express');
const { protect, adminOnly } = require('../middlewares/authMiddleware');
const materialController = require('../controllers/materialController');

const router = express.Router();

// Tất cả các route quản lý nguyên liệu đều yêu cầu đăng nhập và có quyền admin
router.use(protect);
// Nếu cần chỉ admin mặc định mới được quản lý, có thể dùng adminOnly, 
// nhưng thường quản lý nguyên liệu nhân viên (active user) cũng có thể xem/sửa, 
// tùy vào logic. Ở đây tạm thời chỉ cần protect (user active) là được.

router.route('/')
  .get(materialController.getMaterials)
  .post(materialController.createMaterial);

router.route('/:id')
  .put(materialController.updateMaterial)
  .delete(materialController.deleteMaterial);

module.exports = router;
