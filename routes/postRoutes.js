const express = require('express');
const router = express.Router();
const {
  getPublicPosts,
  getPublicPostBySlug,
  recordPostView,
  togglePostLike,
  getAdminPosts,
  createPost,
  updatePost,
  deletePost,
} = require('../controllers/postController');
const { protect } = require('../middlewares/authMiddleware');

// Middleware xác thực quyền quản trị viên
const requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Bạn không có quyền quản trị viên để thực hiện thao tác này!',
  });
};

// ================= PUBLIC ROUTES =================
// GET /api/posts - Danh sách bài viết cho trang Câu Chuyện ngoài shop
router.get('/posts', getPublicPosts);

// GET /api/posts/:slug - Chi tiết bài viết cho khách đọc
router.get('/posts/:slug', getPublicPostBySlug);

// POST /api/posts/:slug/view - Ghi nhận lượt xem bài viết
router.post('/posts/:slug/view', recordPostView);

// POST /api/posts/:slug/like - Thả tim / Hủy thả tim bài viết
router.post('/posts/:slug/like', togglePostLike);

// ================= ADMIN ROUTES =================
// Quản trị bài viết
router.get('/admin/posts', protect, requireAdmin, getAdminPosts);
router.post('/admin/posts', protect, requireAdmin, createPost);
router.put('/admin/posts/:id', protect, requireAdmin, updatePost);
router.delete('/admin/posts/:id', protect, requireAdmin, deletePost);

module.exports = router;
