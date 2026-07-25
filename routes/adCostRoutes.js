const express = require('express');
const router = express.Router();
const { getAdCosts, createAdCost, updateAdCost, deleteAdCost, getBalances, topupPlatform, getAffiliateFees, saveAffiliateFee, syncAdCost } = require('../controllers/adCostController');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/balances', getBalances);
router.post('/topup', topupPlatform);
router.post('/sync', syncAdCost);

router.get('/affiliate-fees', getAffiliateFees);
router.post('/affiliate-fees', saveAffiliateFee);

router.route('/').get(getAdCosts).post(createAdCost);
router.route('/:id').put(updateAdCost).delete(deleteAdCost);

module.exports = router;
