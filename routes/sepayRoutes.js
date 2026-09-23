const express = require('express');
const { receivePayment } = require('../controllers/sepayController');

const router = express.Router();

// Raw body is essential: SePay's HMAC is calculated from the original bytes.
router.post('/webhook', express.raw({ type: 'application/json', limit: '1mb' }), receivePayment);

module.exports = router;
