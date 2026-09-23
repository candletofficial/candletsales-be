const express = require('express');
const router = express.Router();
const shippingConfigController = require('../controllers/shippingConfigController');
const { protect, adminOnly } = require('../middlewares/authMiddleware');

router.use(protect, adminOnly);

router.get('/', shippingConfigController.getAllConfigs);
router.put('/:method', shippingConfigController.updateConfig);

module.exports = router;
