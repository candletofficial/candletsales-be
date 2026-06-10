const express = require('express');
const router = express.Router();
const {
  getOrders,
  getOrder,
  createOrder,
  updateOrder,
  deleteOrder,
  markAsReturned,
} = require('../controllers/orderController');

const { protect } = require('../middlewares/authMiddleware');

router.use(protect);

router.route('/').get(getOrders).post(createOrder);
router.route('/:id').get(getOrder).put(updateOrder).delete(deleteOrder);
router.route('/:id/return').patch(markAsReturned);

module.exports = router;
