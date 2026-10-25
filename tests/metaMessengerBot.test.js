const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mock = require('node:test').mock;
const Product = require('../models/Product');
const MessengerBotKnowledge = require('../models/MessengerBotKnowledge');
const MessengerProductProfile = require('../models/MessengerProductProfile');
const MessengerBotMedia = require('../models/MessengerBotMedia');
const MessengerConversation = require('../models/MessengerConversation');
const MessengerEvent = require('../models/MessengerEvent');
const BotOrderDraft = require('../models/BotOrderDraft');
const controller = require('../controllers/metaMessengerController');
const adminController = require('../controllers/messengerBotAdminController');
const { generateSalesReply, _private: salesBotPrivate } = require('../utils/openaiSalesBot');

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
      populate: () => ({
        populate: () => ({
          limit: () => ({
            lean: async () => [{
              _id: '507f1f77bcf86cd799439011', productId: 'SP-1', name: 'Soft Healing',
              image: 'https://images.example.com/soft-healing.jpg', description: 'Mùi hương thư giãn',
              base_price: 149000, base_ingredients: [], skus: [], variant_groups: [],
            }],
          }),
        }),
      }),
    }),
  }));
  mock.method(MessengerProductProfile, 'find', () => ({ lean: async () => [] }));
  mock.method(MessengerBotKnowledge, 'findOne', () => ({ lean: async () => null }));
  mock.method(MessengerBotMedia, 'find', () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }));

  let requestBody;
  mock.method(global, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, 'Bearer test-secret-key');
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return { output: [{ content: [{ type: 'output_text', text: JSON.stringify({
          reply: 'Bạn thích nhóm hương nào ạ?', memory_summary: 'Khách đang tìm mùi hương phù hợp.', intent: 'consult', handoff: false,
          handoff_reason: null, customer: { name: null, phone: null, address: null },
          cart: [], recommended_product_ids: ['507f1f77bcf86cd799439011'], recommended_media_ids: [], ready_for_draft: false,
        }) }] }] };
      },
    };
  });

  try {
    const result = await generateSalesReply({ history: [], customer: {}, cart: [], stage: 'consulting', referral: {}, memory_summary: 'Khách thích hương gỗ.' }, 'Tư vấn giúp mình');
    assert.equal(result.intent, 'consult');
    assert.equal(result.memory_summary, 'Khách đang tìm mùi hương phù hợp.');
    assert.equal(requestBody.model, 'test-model');
    assert.equal(requestBody.store, false);
    assert.equal(requestBody.text.format.type, 'json_schema');
    assert.equal(requestBody.text.format.strict, true);
    assert.equal(JSON.parse(requestBody.input).current_state.memory_summary, 'Khách thích hương gỗ.');
    assert.equal(optionsContainSecret(requestBody, 'test-secret-key'), false);
    assert.equal(result.recommended_products[0].name, 'Soft Healing');
  } finally {
    mock.restoreAll();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.OPENAI_SALES_MODEL;
    else process.env.OPENAI_SALES_MODEL = previousModel;
  }
});

test('order confirmation requires an explicit positive message', () => {
  const { isExplicitConfirmation, confirmationSummary } = controller._private;
  assert.equal(isExplicitConfirmation('Xác nhận ạ'), true);
  assert.equal(isExplicitConfirmation('Oke chốt đơn giúp mình'), true);
  assert.equal(isExplicitConfirmation('Chưa, sửa lại địa chỉ giúp mình'), false);
  assert.equal(isExplicitConfirmation('Không đúng rồi'), false);

  const summary = confirmationSummary({
    customer: { name: 'An', phone: '0901234567', address: 'Hà Nội' },
    cart: [{ product_name: 'Nến hũ', sku_label: 'Soft Healing - 100 ml', customer_label: 'Soft Healing', quantity: 2, unit_price: 149000 }],
  });
  assert.match(summary, /Soft Healing/);
  assert.doesNotMatch(summary, /Nến hũ/);
  assert.match(summary, /298\.000/);
  assert.match(summary, /Xác nhận/);
});

test('cart keeps full SKU data but uses only the scent classification for customers', async () => {
  mock.method(Product, 'find', () => ({
    lean: async () => [{
      _id: '507f1f77bcf86cd799439011', productId: 'SP-1', name: 'Nến hũ', image: 'https://images.example.com/candle.jpg', base_price: 149000,
      variant_groups: [
        { name: 'Mùi hương', options: [{ id: 'scent-soft', label: 'Soft Healing' }] },
        { name: 'Kích thước', options: [{ id: 'size-large', label: 'Hũ lớn' }] },
      ],
      skus: [{ id: 'sku-1', price: 169000, combination: ['scent-soft', 'size-large'] }],
    }],
  }));
  try {
    const [item] = await controller._private.resolveCart([{
      product_id: '507f1f77bcf86cd799439011', sku_id: 'sku-1', quantity: 1,
    }]);
    assert.equal(item.sku_label, 'Soft Healing - Hũ lớn');
    assert.equal(item.customer_label, 'Soft Healing');
  } finally {
    mock.restoreAll();
  }
});

test('catalog retrieval prioritizes matching trained products and keeps cart products', () => {
  const products = [
    { _id: 'a', name: 'Soft Healing', description: 'thư giãn nhẹ nhàng' },
    { _id: 'b', name: 'Night Muse', description: 'hương gỗ đậm' },
    { _id: 'c', name: 'Hidden', description: 'hương gỗ' },
  ];
  const profiles = [
    { product: 'a', enabled: true, moods: ['thư giãn'] },
    { product: 'b', enabled: true, scent_notes: ['gỗ'] },
    { product: 'c', enabled: false, scent_notes: ['gỗ'] },
  ];
  const result = salesBotPrivate.selectRelevantProducts(products, profiles, 'Mình cần mùi thư giãn', {
    cart: [{ product_id: 'b' }],
  });
  assert.deepEqual(result.map((item) => item.product._id), ['b', 'a']);
});

test('Messenger product cards contain safe image and product links', () => {
  const previous = process.env.CLIENT_URL;
  process.env.CLIENT_URL = 'https://candlet.shop';
  try {
    const message = controller._private.buildProductCardsMessage([
      { _id: 'abc123', name: 'Soft Healing', image: 'https://images.example.com/soft.jpg', base_price: 149000, scent_group: 'Hoa cỏ' },
      { _id: 'ignored', name: 'Ảnh không an toàn', image: 'http://images.example.com/plain.jpg', base_price: 1 },
    ]);
    const [card] = message.attachment.payload.elements;
    assert.equal(message.attachment.payload.template_type, 'generic');
    assert.equal(message.attachment.payload.elements.length, 1);
    assert.equal(card.image_url, 'https://images.example.com/soft.jpg');
    assert.equal(card.default_action.url, 'https://candlet.shop/product/abc123');
    assert.equal(card.buttons[0].title, 'Xem sản phẩm');
  } finally {
    if (previous === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = previous;
  }
});

test('Messenger media images only accept public HTTPS URLs', () => {
  const { buildMediaImageMessage } = controller._private;
  assert.deepEqual(buildMediaImageMessage({ image_url: 'https://images.example.com/gift.jpg' }), {
    attachment: { type: 'image', payload: { url: 'https://images.example.com/gift.jpg', is_reusable: true } },
  });
  assert.equal(buildMediaImageMessage({ image_url: 'http://images.example.com/gift.jpg' }), null);
  assert.equal(buildMediaImageMessage({ image_url: 'not-a-url' }), null);
});

test('admin can reply manually and the conversation switches to human mode', async () => {
  const previousToken = process.env.META_PAGE_ACCESS_TOKEN;
  process.env.META_PAGE_ACCESS_TOKEN = 'page-token';
  const conversation = {
    psid: 'customer-1', mode: 'bot', history: [],
    async save() { this.saved = true; },
  };
  mock.method(MessengerConversation, 'findById', async () => conversation);
  let sentBody;
  mock.method(global, 'fetch', async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return { ok: true, async json() { return { recipient_id: 'customer-1' }; } };
  });
  try {
    const res = response();
    let forwarded;
    await adminController.sendConversationMessage({ params: { id: 'conversation-1' }, body: { text: 'Candlet hỗ trợ bạn ngay đây ạ.' } }, res, (error) => { forwarded = error; });
    assert.equal(forwarded, undefined);
    assert.equal(res.statusCode, 200);
    assert.equal(sentBody.message.text, 'Candlet hỗ trợ bạn ngay đây ạ.');
    assert.equal(conversation.mode, 'human');
    assert.equal(conversation.archived, false);
    assert.equal(conversation.history.at(-1).role, 'assistant');
    assert.equal(conversation.saved, true);
  } finally {
    mock.restoreAll();
    if (previousToken === undefined) delete process.env.META_PAGE_ACCESS_TOKEN;
    else process.env.META_PAGE_ACCESS_TOKEN = previousToken;
  }
});

test('admin can switch the AI bot offline persistently', async () => {
  let update;
  mock.method(MessengerBotKnowledge, 'findOneAndUpdate', async (_query, value) => {
    update = value;
    return { bot_enabled: value.$set.bot_enabled };
  });
  try {
    const res = response();
    await adminController.updateBotStatus({ body: { enabled: false }, user: { _id: 'admin-1' } }, res, assert.fail);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.bot_enabled, false);
    assert.equal(update.$set.bot_enabled, false);
    assert.equal(update.$set.updated_by, 'admin-1');
  } finally {
    mock.restoreAll();
  }
});

test('admin status exposes failed and stuck Messenger events', async () => {
  mock.method(BotOrderDraft, 'countDocuments', async () => 2);
  mock.method(MessengerConversation, 'countDocuments', async (query) => {
    if (query.mode === 'human') return 3;
    if (query.mode === 'bot') return 4;
    if (query.mode === 'paused') return 1;
    return 5;
  });
  mock.method(MessengerBotKnowledge, 'findOne', () => ({ select: () => ({ lean: async () => ({ bot_enabled: true, version: 7 }) }) }));
  mock.method(MessengerProductProfile, 'countDocuments', async () => 6);
  mock.method(MessengerBotMedia, 'countDocuments', async () => 8);
  mock.method(MessengerEvent, 'countDocuments', async (query) => query.status === 'failed' ? 2 : 1);
  try {
    const res = response();
    await adminController.getStatus({}, res, assert.fail);
    assert.equal(res.body.data.failed_events_24h, 2);
    assert.equal(res.body.data.stuck_events, 1);
    assert.equal(res.body.data.pending_drafts, 2);
  } finally {
    mock.restoreAll();
  }
});

test('admin can archive, restore and permanently delete a conversation', async () => {
  const updates = [];
  mock.method(MessengerConversation, 'findByIdAndUpdate', async (_id, value) => {
    updates.push(value);
    return { _id: 'conversation-1', archived: value.$set.archived };
  });
  mock.method(MessengerConversation, 'findByIdAndDelete', async () => ({ _id: 'conversation-1' }));
  try {
    const archived = response();
    await adminController.archiveConversation({ params: { id: 'conversation-1' }, body: { archived: true }, user: { _id: 'admin-1' } }, archived, assert.fail);
    assert.equal(archived.body.data.archived, true);
    assert.equal(updates[0].$set.archived_by, 'admin-1');

    const restored = response();
    await adminController.archiveConversation({ params: { id: 'conversation-1' }, body: { archived: false }, user: { _id: 'admin-1' } }, restored, assert.fail);
    assert.equal(restored.body.data.archived, false);
    assert.equal(updates[1].$set.archived_at, null);

    const deleted = response();
    await adminController.deleteConversation({ params: { id: 'conversation-1' } }, deleted, assert.fail);
    assert.equal(deleted.statusCode, 200);
  } finally {
    mock.restoreAll();
  }
});

test('starting a new consultation resets state while preserving history', async () => {
  let update;
  mock.method(MessengerConversation, 'findByIdAndUpdate', async (_id, value) => {
    update = value;
    return { _id: 'conversation-1', history: [{ role: 'user', text: 'Nội dung cũ' }] };
  });
  try {
    const res = response();
    await adminController.resetConversation({ params: { id: 'conversation-1' } }, res, assert.fail);
    assert.equal(res.statusCode, 200);
    assert.equal(update.$set.mode, 'bot');
    assert.equal(update.$set.stage, 'consulting');
    assert.deepEqual(update.$set.cart, []);
    assert.equal(update.$set.memory_summary, '');
    assert.ok(update.$set.context_started_at instanceof Date);
    assert.equal(Object.hasOwn(update.$set, 'history'), false);
  } finally {
    mock.restoreAll();
  }
});

function optionsContainSecret(value, secret) {
  return JSON.stringify(value).includes(secret);
}
