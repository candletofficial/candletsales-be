const express = require('express');
const router = express.Router();
const {
  getUsers,
  approveUser,
  rejectUser,
  revokeUser,
  deleteUser,
  getUserStats,
  getDashboardStats,
  getRecentActivities
} = require('../controllers/adminController');
const { protect } = require('../middlewares/authMiddleware');

// Tất cả routes đều yêu cầu đăng nhập và status = active
router.use(protect);

router.get('/users/stats', getUserStats);
router.get('/users', getUsers);
router.get('/dashboard', getDashboardStats);
router.get('/activities', getRecentActivities);
router.put('/users/:id/approve', approveUser);
router.put('/users/:id/reject', rejectUser);
router.put('/users/:id/revoke', revokeUser);
router.delete('/users/:id', deleteUser);

module.exports = router;
