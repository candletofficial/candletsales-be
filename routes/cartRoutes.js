const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cartController');

router.get('/:sessionId', cartController.getCart);
router.post('/add', cartController.addToCart);
router.put('/:sessionId/update', cartController.updateCartItem);
router.delete('/:sessionId/remove', cartController.removeFromCart);
router.post('/:sessionId/remove-multiple', cartController.removeMultipleFromCart);
router.delete('/:sessionId/clear', cartController.clearCart);

module.exports = router;
