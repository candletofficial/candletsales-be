const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { handlePancakeWebhook } = require('../controllers/webhookController');
const { inspectPancakeWebhook, getInspectLog, clearInspectLog } = require('../controllers/webhookInspectController');
const { protect, adminOnly } = require('../middlewares/authMiddleware');

const verifyPancakeWebhook = (req, res, next) => {
  const secret = process.env.PANCAKE_WEBHOOK_SECRET;

  // Existing local integrations remain usable; production must explicitly configure a secret.
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({ success: false, message: 'Webhook secret is not configured' });
    }
    return next();
  }

  const suppliedSecret = req.get('x-webhook-secret') || req.query.secret;
  if (!suppliedSecret) {
    return res.status(401).json({ success: false, message: 'Webhook authentication failed' });
  }

  const expected = Buffer.from(secret);
  const actual = Buffer.from(suppliedSecret);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return res.status(401).json({ success: false, message: 'Webhook authentication failed' });
  }

  next();
};

router.post('/pancake', verifyPancakeWebhook, handlePancakeWebhook);

// Inspection endpoints expose customer payloads and are therefore admin-only.
router.post('/pancake-inspect', protect, adminOnly, inspectPancakeWebhook);
router.get('/pancake-inspect/clear', protect, adminOnly, clearInspectLog);
router.get('/pancake-inspect', protect, adminOnly, getInspectLog);

module.exports = router;