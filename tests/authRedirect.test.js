const test = require('node:test');
const assert = require('node:assert/strict');

const authController = require('../controllers/authController');

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
