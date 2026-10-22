const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const authController = require('../controllers/authController');
const User = require('../models/User');

const makeResponse = () => {
  const result = { location: '' };
  return {
    result,
    clearCookie() {},
    redirect(location) {
      result.location = location;
      return location;
    },
  };
};

test('social login redirects use the first configured CLIENT_URL origin', async () => {
  const originalClientUrl = process.env.CLIENT_URL;
  const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;

  process.env.CLIENT_URL = 'https://candlet.shop,https://www.candlet.shop';
  delete process.env.GOOGLE_CLIENT_ID;

  try {
    const response = makeResponse();
    await authController.googleCallback(
      { headers: {}, query: {} },
      response
    );

    assert.match(
      response.result.location,
      /^https:\/\/candlet\.shop\/login\/google\/callback#/
    );
    assert.equal(response.result.location.includes(','), false);
  } finally {
    if (originalClientUrl === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = originalClientUrl;

    if (originalGoogleClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = originalGoogleClientId;
  }
});

test('Google token exchange errors return a safe, actionable message', async () => {
  const originalEnv = {
    CLIENT_URL: process.env.CLIENT_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    JWT_SECRET: process.env.JWT_SECRET,
  };
  const originalFetch = global.fetch;

  process.env.CLIENT_URL = 'https://candlet.shop';
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_REDIRECT_URI = 'https://api.example.com/api/auth/google/callback';
  process.env.JWT_SECRET = 'test-jwt-secret';

  const state = jwt.sign(
    { purpose: 'google-oauth', returnTo: '/' },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
  global.fetch = async () => ({
    ok: false,
    json: async () => ({ error: 'invalid_grant', error_description: 'Bad Request' }),
  });

  try {
    const response = makeResponse();
    await authController.googleCallback(
      {
        headers: { cookie: `google_oauth_state=${state}` },
        query: { state, code: 'expired-code' },
      },
      response
    );

    const fragment = new URL(response.result.location).hash.slice(1);
    const message = new URLSearchParams(fragment).get('error');
    assert.match(message, /hết hạn|callback/);
    assert.equal(message.includes('test-secret'), false);
  } finally {
    global.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('new users do not store null social IDs in sparse unique indexes', () => {
  const user = new User({
    name: 'Test Customer',
    email: 'test-social-id@example.com',
    password: 'strong-password',
    role: 'customer',
    status: 'active',
  });

  const object = user.toObject();
  assert.equal(Object.hasOwn(object, 'google_id'), false);
  assert.equal(Object.hasOwn(object, 'facebook_id'), false);
});
