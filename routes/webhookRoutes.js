const express = require('express');
const router = express.Router();
const { handlePancakeWebhook } = require('../controllers/webhookController');

router.post('/pancake', handlePancakeWebhook);

module.exports = router;
