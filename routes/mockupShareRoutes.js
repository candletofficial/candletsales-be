const express = require('express');
const {
  createMockupShare,
  getPublicMockupShare,
  getAdminMockupShares,
  deleteMockupShare,
} = require('../controllers/mockupShareController');
const { protect, adminOnly } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/public/:token', getPublicMockupShare);
router.get('/', protect, adminOnly, getAdminMockupShares);
router.post('/', protect, adminOnly, createMockupShare);
router.delete('/:id', protect, adminOnly, deleteMockupShare);

module.exports = router;
