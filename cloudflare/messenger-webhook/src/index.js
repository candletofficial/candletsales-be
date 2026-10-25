const textResponse = (body, status = 200) => new Response(body, {
  status,
  headers: { 'content-type': 'text/plain; charset=utf-8' },
});

const hexToBytes = (hex) => {
  if (!/^[a-f0-9]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  return Uint8Array.from(hex.match(/.{2}/g), (byte) => Number.parseInt(byte, 16));
};

const verifyMetaSignature = async (rawBody, signature, appSecret) => {
  if (!signature?.startsWith('sha256=') || !appSecret) return false;
  const supplied = hexToBytes(signature.slice(7));
  if (!supplied) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, supplied, rawBody);
};

const handleVerification = (url, env) => {
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && env.META_VERIFY_TOKEN && token === env.META_VERIFY_TOKEN) {
    return textResponse(challenge || '');
  }
  return textResponse('Forbidden', 403);
};

const handleWebhook = async (request, env) => {
  const rawBody = await request.arrayBuffer();
  const signature = request.headers.get('x-hub-signature-256');
  if (!await verifyMetaSignature(rawBody, signature, env.META_APP_SECRET)) {
    return textResponse('Invalid signature', 401);
  }

  const rawText = new TextDecoder().decode(rawBody);
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    return textResponse('Invalid JSON', 400);
  }

  if (payload.object !== 'page') return textResponse('EVENT_RECEIVED');
  await env.MESSENGER_EVENTS.send({ rawBody: rawText, signature });
  return textResponse('EVENT_RECEIVED');
};

const deliverMessage = async (message, env) => {
  const response = await fetch(env.RENDER_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': message.body.signature,
      'x-candlet-queue-secret': env.META_QUEUE_SECRET,
    },
    body: message.body.rawBody,
  });

  if (!response.ok) throw new Error(`Render webhook returned ${response.status}`);
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET') return handleVerification(url, env);
    if (request.method === 'POST') return handleWebhook(request, env);
    return textResponse('Method not allowed', 405);
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await deliverMessage(message, env);
        message.ack();
      } catch (error) {
        console.error('Messenger delivery failed:', error.message || error);
        message.retry({ delaySeconds: 60 });
      }
    }
  },
};

export const _private = { hexToBytes, verifyMetaSignature, handleVerification, handleWebhook, deliverMessage };
