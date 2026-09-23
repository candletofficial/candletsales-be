const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middlewares/authMiddleware');
const systemConfigController = require('../controllers/systemConfigController');

// GET config is public so storefront can read shipping fees, shop address, etc.
router.get('/:key', systemConfigController.getConfig);
router.put('/:key', protect, adminOnly, systemConfigController.updateConfig);

module.exports = router;
