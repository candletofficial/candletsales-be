const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const systemConfigController = require('../controllers/systemConfigController');

router.get('/:key', protect, systemConfigController.getConfig);
router.put('/:key', protect, systemConfigController.updateConfig);

module.exports = router;
