const express = require('express');
const router = express.Router();
const {
  chat,
  getSuggestions,
  getSmartAlerts,
  getAiConfig,
  updateAiConfig,
  testAiConfig,
} = require('../controllers/aiController');
const { protect, adminOnly } = require('../middlewares/authMiddleware');

// Tất cả routes AI đều yêu cầu đăng nhập quyền Admin
router.use(protect, adminOnly);

router.get('/config', getAiConfig);
router.put('/config', updateAiConfig);
router.post('/test-config', testAiConfig);
router.get('/suggestions', getSuggestions);
router.get('/smart-alerts', getSmartAlerts);
router.post('/chat', chat);

module.exports = router;
