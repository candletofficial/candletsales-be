const express = require('express');
const router = express.Router();
const { handlePancakeWebhook } = require('../controllers/webhookController');
const { inspectPancakeWebhook, getInspectLog, clearInspectLog } = require('../controllers/webhookInspectController');

router.post('/pancake', handlePancakeWebhook);

// 🔍 DEBUG ONLY: Log payload từ Pancake mà không xử lý gì
router.post('/pancake-inspect', inspectPancakeWebhook);

// 👁️ Xem log trên browser
router.get('/pancake-inspect/clear', clearInspectLog);
router.get('/pancake-inspect', getInspectLog);

module.exports = router;
