const express = require('express');
const router = express.Router();
const { getAdCosts, createAdCost, updateAdCost, deleteAdCost } = require('../controllers/adCostController');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect);

router.route('/').get(getAdCosts).post(createAdCost);
router.route('/:id').put(updateAdCost).delete(deleteAdCost);

module.exports = router;
