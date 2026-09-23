const express = require('express');
const router = express.Router();
const { uploadSingle, uploadMultiple } = require('../middlewares/uploadMiddleware');
const {
  uploadProductImage,
  uploadProductImages,
  deleteFile,
} = require('../controllers/uploadController');
const { protect, adminOnly } = require('../middlewares/authMiddleware');

router.use(protect, adminOnly);

// Upload 1 ảnh đại diện sản phẩm
router.post('/product-image', uploadSingle, uploadProductImage);

// Upload nhiều ảnh bộ sưu tập sản phẩm (gallery)
router.post('/product-images', uploadMultiple, uploadProductImages);

// Xóa file ảnh trên máy chủ
router.delete('/', deleteFile);

module.exports = router;
