const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

const safeCustomerReturnPath = (value) => {
  const path = String(value || '/');
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/admin') ? path : '/';
};

const getFacebookConfig = () => {
  const appId = String(process.env.FACEBOOK_APP_ID || '').trim();
  const appSecret = String(process.env.FACEBOOK_APP_SECRET || '').trim();
  const redirectUri = String(process.env.FACEBOOK_REDIRECT_URI || '').trim();
  if (!appId || !appSecret || !redirectUri) return null;
  return { appId, appSecret, redirectUri };
};

const getGoogleConfig = () => {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const redirectUri = String(process.env.GOOGLE_REDIRECT_URI || '').trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
};

const getCookie = (req, name) => {
  const prefix = `${name}=`;
  return String(req.headers.cookie || '')
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length);
};

const getCustomerClientUrl = () => String(process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')[0]
  .trim()
  .replace(/\/+$/, '');

const getGoogleOAuthErrorMessage = (error) => {
  const code = String(error?.oauthCode || '').toLowerCase();
  const description = String(error?.oauthDescription || '').toLowerCase();

  if (code === 'redirect_uri_mismatch' || description.includes('redirect_uri')) {
    return 'URL callback Google chưa khớp với cấu hình của API. Vui lòng kiểm tra Authorized redirect URI.';
  }
  if (code === 'invalid_client') {
    return 'Cấu hình Google Client ID hoặc Client Secret của API chưa chính xác.';
  }
  if (code === 'invalid_grant') {
    return 'Phiên đăng nhập Google đã hết hạn hoặc URL callback không khớp. Vui lòng thử lại.';
  }
  return 'Không thể đăng nhập Google. Vui lòng thử lại.';
};

const redirectFacebookResult = (res, { token, error, returnTo = '/' }) => {
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  if (error) params.set('error', error);
  params.set('returnTo', safeCustomerReturnPath(returnTo));
  return res.redirect(`${getCustomerClientUrl()}/login/facebook/callback#${params.toString()}`);
};

const redirectGoogleResult = (res, { token, error, returnTo = '/' }) => {
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  if (error) params.set('error', error);
  params.set('returnTo', safeCustomerReturnPath(returnTo));
  return res.redirect(`${getCustomerClientUrl()}/login/google/callback#${params.toString()}`);
};

const findOrCreateSocialCustomer = async ({ provider, providerId, email, name }) => {
  const idField = provider === 'google' ? 'google_id' : 'facebook_id';
  const normalizedEmail = String(email).trim().toLowerCase();
  let user = await User.findOne({ [idField]: String(providerId) });

  if (!user) {
    user = await User.findOne({ email: normalizedEmail });
    if (user) {
      if (user.role !== 'customer') {
        const error = new Error('SOCIAL_LOGIN_ADMIN_ACCOUNT');
        error.code = 'SOCIAL_LOGIN_ADMIN_ACCOUNT';
        throw error;
      }
      user[idField] = String(providerId);
      await user.save();
    } else {
      user = await User.create({
        name: String(name || `Khách hàng ${provider === 'google' ? 'Google' : 'Facebook'}`).slice(0, 50),
        email: normalizedEmail,
        // Tài khoản mạng xã hội không sử dụng mật khẩu này; schema vẫn yêu cầu mật khẩu.
        password: crypto.randomBytes(32).toString('base64url'),
        [idField]: String(providerId),
        role: 'customer',
        status: 'active',
      });
    }
  }

  if (user.role !== 'customer') {
    const error = new Error('SOCIAL_LOGIN_ADMIN_ACCOUNT');
    error.code = 'SOCIAL_LOGIN_ADMIN_ACCOUNT';
    throw error;
  }
  if (user.status !== 'active') {
    const error = new Error('SOCIAL_LOGIN_INACTIVE_ACCOUNT');
    error.code = 'SOCIAL_LOGIN_INACTIVE_ACCOUNT';
    throw error;
  }
  return user;
};

// @desc    Bắt đầu Facebook OAuth dành riêng cho khách hàng shop
// @route   GET /api/auth/facebook
// @access  Public
exports.startFacebookLogin = (req, res) => {
  const config = getFacebookConfig();
  if (!config) {
    return res.status(503).send('Facebook Login chưa được cấu hình.');
  }

  const returnTo = safeCustomerReturnPath(req.query.returnTo);
  const state = jwt.sign(
    { nonce: crypto.randomBytes(24).toString('hex'), returnTo, purpose: 'facebook-oauth' },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
  res.cookie('facebook_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 1000,
    path: '/api/auth/facebook',
  });

  const authorizeUrl = new URL('https://www.facebook.com/dialog/oauth');
  authorizeUrl.searchParams.set('client_id', config.appId);
  authorizeUrl.searchParams.set('redirect_uri', config.redirectUri);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'public_profile,email');
  return res.redirect(authorizeUrl.toString());
};

// @desc    Nhận callback Facebook OAuth, tạo/ghép tài khoản customer và cấp JWT
// @route   GET /api/auth/facebook/callback
// @access  Public
exports.facebookCallback = async (req, res) => {
  const clearState = () => res.clearCookie('facebook_oauth_state', { path: '/api/auth/facebook' });
  let returnTo = '/';

  try {
    const config = getFacebookConfig();
    const stateFromCookie = getCookie(req, 'facebook_oauth_state');
    const stateFromQuery = String(req.query.state || '');
    if (!config || !stateFromCookie || !stateFromQuery || !crypto.timingSafeEqual(Buffer.from(stateFromCookie), Buffer.from(stateFromQuery))) {
      clearState();
      return redirectFacebookResult(res, { error: 'Phiên đăng nhập Facebook không hợp lệ hoặc đã hết hạn.' });
    }

    const state = jwt.verify(stateFromQuery, process.env.JWT_SECRET);
    if (state.purpose !== 'facebook-oauth') throw new Error('Invalid Facebook OAuth state');
    returnTo = safeCustomerReturnPath(state.returnTo);
    clearState();

    if (req.query.error) {
      return redirectFacebookResult(res, { error: 'Bạn đã huỷ hoặc từ chối đăng nhập bằng Facebook.', returnTo });
    }
    if (!req.query.code) {
      return redirectFacebookResult(res, { error: 'Facebook không trả về mã xác thực.', returnTo });
    }

    const accessTokenUrl = new URL('https://graph.facebook.com/oauth/access_token');
    accessTokenUrl.searchParams.set('client_id', config.appId);
    accessTokenUrl.searchParams.set('client_secret', config.appSecret);
    accessTokenUrl.searchParams.set('redirect_uri', config.redirectUri);
    accessTokenUrl.searchParams.set('code', String(req.query.code));
    const tokenResponse = await fetch(accessTokenUrl);
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error('Facebook token exchange failed');

    const profileUrl = new URL('https://graph.facebook.com/me');
    profileUrl.searchParams.set('fields', 'id,name,email');
    profileUrl.searchParams.set('access_token', tokenData.access_token);
    const profileResponse = await fetch(profileUrl);
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.id) throw new Error('Facebook profile lookup failed');
    if (!profile.email) {
      return redirectFacebookResult(res, { error: 'Facebook chưa cấp email. Hãy cấp quyền email hoặc đăng nhập bằng email.', returnTo });
    }

    let user;
    try {
      user = await findOrCreateSocialCustomer({ provider: 'facebook', providerId: profile.id, email: profile.email, name: profile.name });
    } catch (error) {
      if (error.code === 'SOCIAL_LOGIN_ADMIN_ACCOUNT') return redirectFacebookResult(res, { error: 'Facebook Login chỉ hỗ trợ tài khoản khách hàng.', returnTo });
      if (error.code === 'SOCIAL_LOGIN_INACTIVE_ACCOUNT') return redirectFacebookResult(res, { error: 'Tài khoản hiện chưa thể đăng nhập. Vui lòng liên hệ shop.', returnTo });
      throw error;
    }

    return redirectFacebookResult(res, { token: signToken(user._id), returnTo });
  } catch (error) {
    console.error('[facebook-login] OAuth failed:', error.message);
    clearState();
    return redirectFacebookResult(res, { error: 'Không thể đăng nhập Facebook. Vui lòng thử lại.', returnTo });
  }
};

// @desc    Bắt đầu Google OAuth dành riêng cho khách hàng shop
// @route   GET /api/auth/google
// @access  Public
exports.startGoogleLogin = (req, res) => {
  const config = getGoogleConfig();
  if (!config) return res.status(503).send('Google Login chưa được cấu hình.');

  const returnTo = safeCustomerReturnPath(req.query.returnTo);
  const state = jwt.sign(
    { nonce: crypto.randomBytes(24).toString('hex'), returnTo, purpose: 'google-oauth' },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
  res.cookie('google_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 1000,
    path: '/api/auth/google',
  });

  const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizeUrl.searchParams.set('client_id', config.clientId);
  authorizeUrl.searchParams.set('redirect_uri', config.redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'openid email profile');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('prompt', 'select_account');
  return res.redirect(authorizeUrl.toString());
};

// @desc    Nhận callback Google OAuth, tạo/ghép tài khoản customer và cấp JWT
// @route   GET /api/auth/google/callback
// @access  Public
exports.googleCallback = async (req, res) => {
  const clearState = () => res.clearCookie('google_oauth_state', { path: '/api/auth/google' });
  let returnTo = '/';

  try {
    const config = getGoogleConfig();
    const stateFromCookie = getCookie(req, 'google_oauth_state');
    const stateFromQuery = String(req.query.state || '');
    if (!config || !stateFromCookie || !stateFromQuery || !crypto.timingSafeEqual(Buffer.from(stateFromCookie), Buffer.from(stateFromQuery))) {
      clearState();
      return redirectGoogleResult(res, { error: 'Phiên đăng nhập Google không hợp lệ hoặc đã hết hạn.' });
    }

    const state = jwt.verify(stateFromQuery, process.env.JWT_SECRET);
    if (state.purpose !== 'google-oauth') throw new Error('Invalid Google OAuth state');
    returnTo = safeCustomerReturnPath(state.returnTo);
    clearState();

    if (req.query.error) return redirectGoogleResult(res, { error: 'Bạn đã huỷ hoặc từ chối đăng nhập bằng Google.', returnTo });
    if (!req.query.code) return redirectGoogleResult(res, { error: 'Google không trả về mã xác thực.', returnTo });

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code),
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.id_token) {
      const oauthError = new Error('Google token exchange failed');
      oauthError.stage = 'token_exchange';
      oauthError.oauthCode = tokenData?.error;
      oauthError.oauthDescription = tokenData?.error_description;
      throw oauthError;
    }

    const client = new OAuth2Client(config.clientId);
    const ticket = await client.verifyIdToken({ idToken: tokenData.id_token, audience: config.clientId });
    const profile = ticket.getPayload();
    if (!profile?.sub || !profile.email || !profile.email_verified) {
      return redirectGoogleResult(res, { error: 'Google không cung cấp email đã xác minh cho tài khoản này.', returnTo });
    }

    let user;
    try {
      user = await findOrCreateSocialCustomer({ provider: 'google', providerId: profile.sub, email: profile.email, name: profile.name });
    } catch (error) {
      if (error.code === 'SOCIAL_LOGIN_ADMIN_ACCOUNT') return redirectGoogleResult(res, { error: 'Google Login chỉ hỗ trợ tài khoản khách hàng.', returnTo });
      if (error.code === 'SOCIAL_LOGIN_INACTIVE_ACCOUNT') return redirectGoogleResult(res, { error: 'Tài khoản hiện chưa thể đăng nhập. Vui lòng liên hệ shop.', returnTo });
      throw error;
    }

    return redirectGoogleResult(res, { token: signToken(user._id), returnTo });
  } catch (error) {
    console.error('[google-login] OAuth failed:', {
      stage: error.stage || 'callback',
      code: error.oauthCode || error.code || error.name || 'unknown',
      message: error.message,
    });
    clearState();
    return redirectGoogleResult(res, { error: getGoogleOAuthErrorMessage(error), returnTo });
  }
};

// @desc    Đăng ký tài khoản mới
// @route   POST /api/auth/register
// @access  Public
// Lưu ý: tài khoản mới sẽ có status = 'pending', cần admin duyệt trước khi đăng nhập được
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập đầy đủ thông tin' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email đã được sử dụng' });
    }

    // Tài khoản mới luôn có status = 'pending'
    const user = await User.create({ name, email, password, status: 'pending' });

    res.status(201).json({
      success: true,
      message: 'Đăng ký thành công! Tài khoản của bạn đang chờ admin phê duyệt.',
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        status: user.status,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Đăng ký tài khoản khách hàng (Shop)
// @route   POST /api/auth/shop-register
// @access  Public
exports.shopRegister = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập đầy đủ thông tin' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email đã được sử dụng' });
    }

    // Tài khoản khách hàng thì status = 'active' luôn
    const user = await User.create({ name, email, password, role: 'customer', status: 'active' });
    const token = signToken(user._id);

    res.status(201).json({
      success: true,
      message: 'Đăng ký thành công!',
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
        }
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Đăng nhập
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập email và mật khẩu' });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Email hoặc mật khẩu không đúng' });
    }

    // Kiểm tra trạng thái tài khoản
    if (user.status === 'pending') {
      return res.status(403).json({
        success: false,
        message: 'Tài khoản đang chờ admin phê duyệt. Vui lòng liên hệ quản trị viên.',
        status: 'pending',
      });
    }

    if (user.status === 'rejected') {
      return res.status(403).json({
        success: false,
        message: 'Tài khoản của bạn đã bị từ chối. Vui lòng liên hệ quản trị viên.',
        status: 'rejected',
      });
    }

    const token = signToken(user._id);

    res.status(200).json({
      success: true,
      message: 'Đăng nhập thành công',
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          isDefaultAdmin: user.isDefaultAdmin,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Lấy thông tin tài khoản hiện tại
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Cập nhật thông tin hồ sơ
// @route   PUT /api/auth/profile
// @access  Private
exports.updateProfile = async (req, res) => {
  try {
    const { name, phone, address } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
    }

    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ success: false, message: 'Tên không được để trống' });
      }
      user.name = name.trim();
    }
    if (phone !== undefined) user.phone = phone.trim();
    if (address !== undefined) user.address = address.trim();

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Cập nhật thông tin thành công',
      data: {
        _id: user._id,
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        address: user.address,
        role: user.role,
        status: user.status
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Đổi mật khẩu
// @route   PUT /api/auth/change-password
// @access  Private
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập đầy đủ thông tin' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
    }

    const user = await User.findById(req.user.id).select('+password');
    if (!(await user.comparePassword(currentPassword))) {
      return res.status(400).json({ success: false, message: 'Mật khẩu hiện tại không đúng' });
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({ success: true, message: 'Đổi mật khẩu thành công' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
