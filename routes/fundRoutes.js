const express = require('express');
const router = express.Router();
const fundController = require('../controllers/fundController');

router.get('/summary', fundController.getSummary);
router.get('/transactions', fundController.getTransactions);
router.post('/deposit', fundController.deposit);
router.post('/withdraw-revenue', fundController.withdrawRevenue);

module.exports = router;
