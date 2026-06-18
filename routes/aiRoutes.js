const express = require('express');
const router = express.Router();
const { chat, getSuggestions, getSmartAlerts } = require('../controllers/aiController');
const { protect } = require('../middlewares/authMiddleware');

// Tất cả routes AI đều yêu cầu đăng nhập
router.use(protect);

router.get('/suggestions', getSuggestions);
router.get('/smart-alerts', getSmartAlerts);
router.post('/chat', chat);

module.exports = router;
