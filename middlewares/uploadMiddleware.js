const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Đường dẫn lưu trữ ảnh sản phẩm
const uploadDir = path.join(__dirname, '..', 'uploads', 'products');

// Đảm bảo thư mục lưu trữ luôn tồn tại
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Cấu hình lưu trữ vào đĩa cứng (DiskStorage)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const uniqueName = `prod-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  },
});

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
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB tối đa mỗi ảnh
  },
});

module.exports = {
  uploadSingle: upload.single('image'),
  uploadMultiple: upload.array('images', 10), // Tối đa 10 ảnh mỗi lần
};
