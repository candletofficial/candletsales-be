const express = require('express');
const router = express.Router();
const inventorySyncController = require('../controllers/inventorySyncController');

router.post('/', inventorySyncController.syncInventory);
router.get('/', inventorySyncController.getSyncHistory);

module.exports = router;
