const multer = require('multer');

// Bộ lọc định dạng file: chỉ chấp nhận ảnh
const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Chỉ chấp nhận các tệp ảnh hợp lệ (JPEG, PNG, WEBP, GIF, AVIF)!'), false);
  }
};

const upload = multer({
  // Chỉ giữ file trong RAM trong lúc backend chuyển tiếp sang Cloudinary.
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB tối đa mỗi ảnh
  },
});

module.exports = {
  uploadSingle: upload.single('image'),
  uploadMultiple: upload.array('images', 10), // Tối đa 10 ảnh mỗi lần
};
