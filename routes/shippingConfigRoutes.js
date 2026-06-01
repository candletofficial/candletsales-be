const express = require('express');
const router = express.Router();
const shippingConfigController = require('../controllers/shippingConfigController');

router.get('/', shippingConfigController.getAllConfigs);
router.put('/:method', shippingConfigController.updateConfig);

module.exports = router;
