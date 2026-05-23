const express = require('express');
const router = express.Router();
const inventoryCheckController = require('../controllers/inventoryCheckController');

router.post('/', inventoryCheckController.createTicket);
router.get('/', inventoryCheckController.getTickets);

module.exports = router;
