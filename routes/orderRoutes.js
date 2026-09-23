const express = require('express');
const router = express.Router();
const {
  getOrders,
  getOrder,
  createOrder,
  updateOrder,
  deleteOrder,
  markAsReturned,
  updateDeliveryStatus,
  markAsRefunded,
} = require('../controllers/orderController');

const { protect, adminOnly } = require('../middlewares/authMiddleware');

router.use(protect, adminOnly);

router.route('/').get(getOrders).post(createOrder);
router.route('/:id').get(getOrder).put(updateOrder).delete(deleteOrder);
router.route('/:id/return').patch(markAsReturned);
router.route('/:id/delivery-status').patch(updateDeliveryStatus);
router.route('/:id/refund').patch(markAsRefunded);

module.exports = router;
