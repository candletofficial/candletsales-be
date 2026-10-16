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
const { getItemMaterials, updateItemMaterials } = require('../controllers/orderMaterialsController');

router.use(protect, adminOnly);

router.route('/').get(getOrders).post(createOrder);
router.route('/:id').get(getOrder).put(updateOrder).delete(deleteOrder);
router.route('/:id/items/:index/materials').get(getItemMaterials).put(updateItemMaterials);
router.route('/:id/return').patch(markAsReturned);
router.route('/:id/delivery-status').patch(updateDeliveryStatus);
router.route('/:id/refund').patch(markAsRefunded);

module.exports = router;
