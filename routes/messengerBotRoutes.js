const express = require('express');
const controller = require('../controllers/messengerBotAdminController');
const { protect, adminOnly } = require('../middlewares/authMiddleware');

const router = express.Router();
router.use(protect, adminOnly);
router.get('/status', controller.getStatus);
router.get('/conversations', controller.getConversations);
router.patch('/conversations/:id/mode', controller.updateConversationMode);
router.get('/drafts', controller.getDrafts);
router.post('/drafts/:id/approve', controller.approveDraft);
router.post('/drafts/:id/reject', controller.rejectDraft);

module.exports = router;
