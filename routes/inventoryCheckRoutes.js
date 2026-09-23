const express = require('express');
const router = express.Router();
const inventoryCheckController = require('../controllers/inventoryCheckController');
const { protect, adminOnly } = require('../middlewares/authMiddleware');

router.use(protect, adminOnly);

router.post('/', inventoryCheckController.createTicket);
router.get('/', inventoryCheckController.getTickets);

module.exports = router;
