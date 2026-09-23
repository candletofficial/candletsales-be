const express = require('express');
const router = express.Router();
const inventorySyncController = require('../controllers/inventorySyncController');
const { protect, adminOnly } = require('../middlewares/authMiddleware');

router.use(protect, adminOnly);

router.post('/', inventorySyncController.syncInventory);
router.get('/', inventorySyncController.getSyncHistory);

module.exports = router;
