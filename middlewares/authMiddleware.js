const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Xác thực JWT token và kiểm tra tài khoản đã được duyệt
exports.protect = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập để tiếp tục' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({ success: false, message: 'Token không hợp lệ' });
    }

    // Chỉ tài khoản active mới được truy cập
    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Tài khoản chưa được kích hoạt hoặc đã bị từ chối',
        status: user.status,
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Token không hợp lệ hoặc đã hết hạn' });
  }
};
