const express = require('express');
const controller = require('../controllers/messengerBotAdminController');
const { protect, adminOnly } = require('../middlewares/authMiddleware');

const router = express.Router();
router.use(protect, adminOnly);
router.get('/status', controller.getStatus);
router.get('/knowledge', controller.getKnowledge);
router.put('/knowledge', controller.updateKnowledge);
router.get('/product-profiles', controller.getProductProfiles);
router.put('/product-profiles/:productId', controller.updateProductProfile);
router.get('/media', controller.getMedia);
router.post('/media', controller.createMedia);
router.put('/media/:id', controller.updateMedia);
router.delete('/media/:id', controller.deleteMedia);
router.get('/conversations', controller.getConversations);
router.patch('/conversations/:id/mode', controller.updateConversationMode);
router.post('/conversations/:id/messages', controller.sendConversationMessage);
router.post('/conversations/:id/reset', controller.resetConversation);
router.get('/drafts', controller.getDrafts);
router.post('/drafts/:id/approve', controller.approveDraft);
router.post('/drafts/:id/reject', controller.rejectDraft);

module.exports = router;
