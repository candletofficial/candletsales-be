const express = require('express');
const router = express.Router();
const importController = require('../controllers/importController');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', importController.getImportTickets);
router.post('/', importController.createImportTicket);
router.put('/:id', importController.updateImportTicket);
router.put('/:id/complete', importController.completeImportTicket);
router.delete('/:id', importController.deleteImportTicket);
router.put('/:id/settle', importController.settleImportTicket);

module.exports = router;
