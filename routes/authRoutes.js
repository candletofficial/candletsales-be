const express = require('express');
const router = express.Router();
const { register, shopRegister, login, getMe, changePassword, updateProfile, startFacebookLogin, facebookCallback, startGoogleLogin, googleCallback } = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');

router.post('/register', register);
router.post('/shop-register', shopRegister);
router.post('/login', login);
router.get('/facebook', startFacebookLogin);
router.get('/facebook/callback', facebookCallback);
router.get('/google', startGoogleLogin);
router.get('/google/callback', googleCallback);
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);
router.put('/change-password', protect, changePassword);

module.exports = router;
