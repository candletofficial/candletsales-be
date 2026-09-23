const path = require('path');
const fs = require('fs');

const uploadsBaseDir = path.join(__dirname, '..', 'uploads');

/**
 * Xóa một file vật lý trên đĩa nếu file đó thuộc thư mục uploads của hệ thống
 * @param {string} filePathOrUrl - Đường dẫn tương đối (/uploads/products/...) hoặc URL đầy đủ
 * @returns {boolean} true nếu đã xóa thành công, false nếu không phải local file hoặc không tồn tại
 */
const removeFileIfLocal = (filePathOrUrl) => {
  if (!filePathOrUrl || typeof filePathOrUrl !== 'string') return false;

  try {
    // Trích xuất phần đường dẫn sau /uploads/
    let relativePath = filePathOrUrl;

    // Nếu là URL đầy đủ (ví dụ http://localhost:5000/uploads/products/abc.jpg)
    const uploadsIndex = filePathOrUrl.indexOf('/uploads/');
    if (uploadsIndex !== -1) {
      relativePath = filePathOrUrl.substring(uploadsIndex);
    } else if (!relativePath.startsWith('/uploads/') && !relativePath.startsWith('uploads/')) {
      // Không phải file nội bộ được upload lên server
      return false;
    }

    // Chuẩn hóa đường dẫn bắt đầu từ uploads/
    const cleanRelPath = relativePath.replace(/^\/+/, '');
    const absoluteFilePath = path.join(__dirname, '..', cleanRelPath);

    // Kiểm tra an toàn: ngăn chặn Path Traversal (phải nằm trong thư mục uploads)
    const resolvedPath = path.resolve(absoluteFilePath);
    const resolvedUploadsDir = path.resolve(uploadsBaseDir);

    if (!resolvedPath.startsWith(resolvedUploadsDir)) {
      console.warn(`[Security Warning] Cố gắng truy cập ngoài thư mục uploads: ${filePathOrUrl}`);
      return false;
    }

    // Nếu file tồn tại thì xóa khỏi ổ cứng
    if (fs.existsSync(resolvedPath)) {
      fs.unlinkSync(resolvedPath);
      console.log(`[File Deleted] Đã xóa vĩnh viễn file trên máy chủ: ${resolvedPath}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`[Delete File Error] Lỗi khi xóa file ${filePathOrUrl}:`, error.message);
    return false;
  }
};

/**
 * Upload 1 ảnh đại diện chính của sản phẩm
 */
const uploadProductImage = (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn một tệp ảnh để tải lên' });
    }

    const relativePath = `/uploads/products/${req.file.filename}`;
    const fullUrl = `${req.protocol}://${req.get('host')}${relativePath}`;

    res.status(200).json({
      success: true,
      message: 'Tải ảnh sản phẩm lên thành công',
      data: {
        path: relativePath,
        url: fullUrl,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Upload nhiều ảnh cho bộ sưu tập sản phẩm (Gallery)
 */
const uploadProductImages = (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất một tệp ảnh' });
    }

    const filesData = req.files.map((file) => {
      const relativePath = `/uploads/products/${file.filename}`;
      const fullUrl = `${req.protocol}://${req.get('host')}${relativePath}`;
      return {
        path: relativePath,
        url: fullUrl,
        filename: file.filename,
        size: file.size,
        mimetype: file.mimetype,
      };
    });

    res.status(200).json({
      success: true,
      message: `Đã tải lên thành công ${filesData.length} ảnh`,
      data: filesData,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Xóa file ảnh trên máy chủ theo yêu cầu của client (khi bấm nút Xóa ảnh)
 */
const deleteFile = (req, res) => {
  try {
    const targetPath = req.body.path || req.query.path;

    if (!targetPath) {
      return res.status(400).json({ success: false, message: 'Thiếu đường dẫn tệp cần xóa (path)' });
    }

    const isDeleted = removeFileIfLocal(targetPath);

    res.status(200).json({
      success: true,
      message: isDeleted
        ? 'Đã xóa tệp ảnh thành công khỏi máy chủ'
        : 'Tệp không tồn tại hoặc đã được xóa trước đó',
      data: { path: targetPath, deleted: isDeleted },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  uploadProductImage,
  uploadProductImages,
  deleteFile,
  removeFileIfLocal,
};
