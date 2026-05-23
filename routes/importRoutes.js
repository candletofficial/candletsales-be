const express = require('express');
const router = express.Router();
const importController = require('../controllers/importController');
const auth = require('../middlewares/authMiddleware'); // admin middleware if present

// router.use(auth); // Enable if auth is required

router.get('/', importController.getImportTickets);
router.post('/', importController.createImportTicket);
router.put('/:id/complete', importController.completeImportTicket);
router.delete('/:id', importController.deleteImportTicket);

module.exports = router;
