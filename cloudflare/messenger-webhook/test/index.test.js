import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import worker from '../src/index.js';

const sign = (body, secret) => `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

test('GET verifies the Meta callback token', async () => {
  const response = await worker.fetch(
    new Request('https://worker.example/?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=123'),
    { META_VERIFY_TOKEN: 'verify-me' },
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '123');
});

test('POST verifies Meta signature before adding an event to the queue', async () => {
  const body = JSON.stringify({ object: 'page', entry: [] });
  const queued = [];
  const env = {
    META_APP_SECRET: 'app-secret',
    MESSENGER_EVENTS: { async send(value) { queued.push(value); } },
  };
  const response = await worker.fetch(new Request('https://worker.example/', {
    method: 'POST',
    headers: { 'x-hub-signature-256': sign(body, env.META_APP_SECRET) },
    body,
  }), env);

  assert.equal(response.status, 200);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].rawBody, body);
});

test('POST rejects an invalid Meta signature', async () => {
  let queued = false;
  const response = await worker.fetch(new Request('https://worker.example/', {
    method: 'POST',
    headers: { 'x-hub-signature-256': 'sha256=bad' },
    body: JSON.stringify({ object: 'page' }),
  }), {
    META_APP_SECRET: 'app-secret',
    MESSENGER_EVENTS: { async send() { queued = true; } },
  });

  assert.equal(response.status, 401);
  assert.equal(queued, false);
});

test('queue acknowledges successful Render delivery and retries failed delivery', async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });

  const deliveries = [];
  globalThis.fetch = async (url, options) => {
    deliveries.push({ url, options });
    return { ok: deliveries.length === 1, status: deliveries.length === 1 ? 200 : 503 };
  };

  const state = { acked: 0, retried: 0 };
  const makeMessage = () => ({
    body: { rawBody: '{"object":"page"}', signature: 'sha256=abc' },
    ack() { state.acked += 1; },
    retry() { state.retried += 1; },
  });
  const env = {
    RENDER_WEBHOOK_URL: 'https://api.example/api/webhooks/meta/queued',
    META_QUEUE_SECRET: 'queue-secret',
  };

  await worker.queue({ messages: [makeMessage(), makeMessage()] }, env);
  assert.equal(state.acked, 1);
  assert.equal(state.retried, 1);
  assert.equal(deliveries[0].options.headers['x-candlet-queue-secret'], 'queue-secret');
});
