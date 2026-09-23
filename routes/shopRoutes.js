const express = require('express');
const router = express.Router();
const shopController = require('../controllers/shopController');
const orderController = require('../controllers/orderController');

router.get('/products', shopController.getShopProducts);
router.get('/products/:id', shopController.getShopProductById);
router.get('/coupons', shopController.getActiveCoupons);
router.post('/coupons/validate', shopController.validateCoupon);
router.post('/checkout', orderController.createOrder);
router.get('/payment-sessions/:orderReference', orderController.getPaymentSession);

// Customer Order Tracking & History
router.get('/orders', orderController.getShopOrders);
router.get('/orders/:id', orderController.getShopOrderById);
router.patch('/orders/:id/cancel', orderController.cancelShopOrder);

module.exports = router;
