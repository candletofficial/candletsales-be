const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mock = require('node:test').mock;
const Product = require('../models/Product');
const controller = require('../controllers/metaMessengerController');
const { generateSalesReply } = require('../utils/openaiSalesBot');

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  send(body) { this.body = body; return this; },
  sendStatus(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test('Meta webhook verification requires the configured private token', () => {
  const previous = process.env.META_VERIFY_TOKEN;
  delete process.env.META_VERIFY_TOKEN;
  try {
    const missing = response();
    controller.verifyWebhook({ query: { 'hub.mode': 'subscribe' } }, missing);
    assert.equal(missing.statusCode, 503);

    process.env.META_VERIFY_TOKEN = 'private-token';
    const valid = response();
    controller.verifyWebhook({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'private-token', 'hub.challenge': '12345' } }, valid);
    assert.equal(valid.statusCode, 200);
    assert.equal(valid.body, '12345');

    const invalid = response();
    controller.verifyWebhook({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong' } }, invalid);
    assert.equal(invalid.statusCode, 403);
  } finally {
    if (previous === undefined) delete process.env.META_VERIFY_TOKEN;
    else process.env.META_VERIFY_TOKEN = previous;
  }
});

test('Meta webhook validates the SHA-256 request signature', () => {
  const previousSecret = process.env.META_APP_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.META_APP_SECRET = 'app-secret';
  process.env.NODE_ENV = 'production';
  try {
    const rawBody = Buffer.from('{"object":"page"}');
    const signature = `sha256=${crypto.createHmac('sha256', 'app-secret').update(rawBody).digest('hex')}`;
    let called = false;
    const valid = response();
    controller.verifySignature({ rawBody, get: () => signature }, valid, () => { called = true; });
    assert.equal(called, true);

    const invalid = response();
    controller.verifySignature({ rawBody, get: () => 'sha256=bad' }, invalid, () => {});
    assert.equal(invalid.statusCode, 401);
  } finally {
    if (previousSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previousSecret;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('queued Meta webhook requires the private queue secret', () => {
  const previous = process.env.META_QUEUE_SECRET;
  process.env.META_QUEUE_SECRET = 'queue-secret';
  try {
    let called = false;
    const valid = response();
    controller.verifyQueueSecret({ get: () => 'queue-secret' }, valid, () => { called = true; });
    assert.equal(called, true);

    const invalid = response();
    controller.verifyQueueSecret({ get: () => 'wrong' }, invalid, () => {});
    assert.equal(invalid.statusCode, 401);
  } finally {
    if (previous === undefined) delete process.env.META_QUEUE_SECRET;
    else process.env.META_QUEUE_SECRET = previous;
  }
});

test('OpenAI sales bot uses a strict schema and does not expose the API key in input', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousModel = process.env.OPENAI_SALES_MODEL;
  process.env.OPENAI_API_KEY = 'test-secret-key';
  process.env.OPENAI_SALES_MODEL = 'test-model';

  mock.method(Product, 'find', () => ({
    select: () => ({
      limit: () => ({
        lean: async () => [{
          _id: '507f1f77bcf86cd799439011', productId: 'SP-1', name: 'Soft Healing',
          description: 'Mùi hương thư giãn', base_price: 149000, skus: [], variant_groups: [],
        }],
      }),
    }),
  }));

  let requestBody;
  mock.method(global, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, 'Bearer test-secret-key');
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return { output: [{ content: [{ type: 'output_text', text: JSON.stringify({
          reply: 'Bạn thích nhóm hương nào ạ?', intent: 'consult', handoff: false,
          handoff_reason: null, customer: { name: null, phone: null, address: null },
          cart: [], ready_for_draft: false,
        }) }] }] };
      },
    };
  });

  try {
    const result = await generateSalesReply({ history: [], customer: {}, cart: [], stage: 'consulting', referral: {} }, 'Tư vấn giúp mình');
    assert.equal(result.intent, 'consult');
    assert.equal(requestBody.model, 'test-model');
    assert.equal(requestBody.store, false);
    assert.equal(requestBody.text.format.type, 'json_schema');
    assert.equal(requestBody.text.format.strict, true);
    assert.equal(optionsContainSecret(requestBody, 'test-secret-key'), false);
  } finally {
    mock.restoreAll();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.OPENAI_SALES_MODEL;
    else process.env.OPENAI_SALES_MODEL = previousModel;
  }
});

function optionsContainSecret(value, secret) {
  return JSON.stringify(value).includes(secret);
}
