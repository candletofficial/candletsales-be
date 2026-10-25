const crypto = require('node:crypto');
const BotOrderDraft = require('../models/BotOrderDraft');
const MessengerConversation = require('../models/MessengerConversation');
const MessengerEvent = require('../models/MessengerEvent');
const Product = require('../models/Product');
const { generateSalesReply } = require('../utils/openaiSalesBot');

const HANDOFF_PATTERN = /(nhân viên|người thật|khiếu nại|hoàn tiền|đổi trả|biên lai|chuyển khoản rồi|dị ứng|bác sĩ|sức khỏe)/i;

const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

exports.verifyWebhook = (req, res) => {
  if (!process.env.META_VERIFY_TOKEN) return res.sendStatus(503);
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && safeEqual(token, process.env.META_VERIFY_TOKEN)) return res.status(200).send(challenge);
  return res.sendStatus(403);
};

exports.verifySignature = (req, res, next) => {
  const signature = req.get('x-hub-signature-256');
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    if (process.env.NODE_ENV === 'production') return res.status(503).json({ success: false, message: 'Meta app secret is not configured' });
    return next();
  }
  if (!signature || !req.rawBody) return res.sendStatus(401);
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex')}`;
  if (!safeEqual(signature, expected)) return res.sendStatus(401);
  next();
};

const sendText = async (psid, text) => {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error('META_PAGE_ACCESS_TOKEN is not configured');
  const version = process.env.META_GRAPH_VERSION || 'v24.0';
  const response = await fetch(`https://graph.facebook.com/${version}/me/messages?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_type: 'RESPONSE',
      recipient: { id: psid },
      message: { text: String(text).slice(0, 1900) },
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || `Meta Send API failed (${response.status})`);
  return payload;
};

exports.sendMetaText = sendText;

const referralFrom = (event) => {
  const referral = event.referral || event.postback?.referral || {};
  return {
    ad_id: referral.ad_id || undefined,
    ref: referral.ref || undefined,
    source: referral.source || undefined,
    type: referral.type || undefined,
  };
};

const resolveCart = async (requestedCart) => {
  if (!Array.isArray(requestedCart) || requestedCart.length === 0) return [];
  const ids = [...new Set(requestedCart.map((item) => item.product_id).filter(Boolean))];
  const products = await Product.find({ _id: { $in: ids } }).lean();
  const byId = new Map(products.map((product) => [String(product._id), product]));
  const result = [];

  for (const requested of requestedCart) {
    const product = byId.get(String(requested.product_id));
    if (!product) continue;
    const quantity = Math.max(1, Math.min(20, Number.parseInt(requested.quantity, 10) || 1));
    const sku = requested.sku_id ? (product.skus || []).find((item) => item.id === requested.sku_id) : null;
    if (requested.sku_id && !sku) continue;
    const labels = (sku?.combination || []).map((optionId) => {
      for (const group of product.variant_groups || []) {
        const option = (group.options || []).find((item) => item.id === optionId);
        if (option) return option.label;
      }
      return optionId;
    });
    result.push({
      product_id: product._id,
      productId: product.productId,
      product_name: product.name,
      product_image: product.image,
      sku_id: sku?.id || null,
      sku_label: labels.join(' - '),
      unit_price: sku?.price > 0 ? sku.price : product.base_price,
      quantity,
    });
  }
  return result;
};

const validLead = (conversation) => {
  const digits = String(conversation.customer?.phone || '').replace(/\D/g, '');
  return Boolean(conversation.customer?.name?.trim() && digits.length >= 9 && digits.length <= 12
    && conversation.customer?.address?.trim() && conversation.cart?.length);
};

const draftSummary = (draft) => {
  const lines = draft.items.map((item) => `• ${item.product_name}${item.sku_label ? ` (${item.sku_label})` : ''} × ${item.quantity}`);
  return `Candlet đã ghi nhận yêu cầu đặt hàng:\n${lines.join('\n')}\nTạm tính: ${draft.total_price.toLocaleString('vi-VN')}đ. Nhân viên sẽ kiểm tra và xác nhận đơn với bạn sớm nhất.`;
};

const createDraft = async (conversation) => {
  const total = conversation.cart.reduce((sum, item) => sum + Number(item.unit_price || 0) * Number(item.quantity || 0), 0);
  return BotOrderDraft.findOneAndUpdate(
    { conversation: conversation._id, status: 'pending' },
    {
      $set: {
        page_id: conversation.page_id,
        psid: conversation.psid,
        source: 'facebook',
        customer_name: conversation.customer.name.trim(),
        customer_phone: conversation.customer.phone.trim(),
        customer_address: conversation.customer.address.trim(),
        items: conversation.cart.map((item) => item.toObject?.() || item),
        total_price: total,
        note: `Đơn nháp từ Messenger${conversation.referral?.ad_id ? ` · quảng cáo ${conversation.referral.ad_id}` : ''}`,
      },
      $setOnInsert: { conversation: conversation._id },
    },
    { new: true, upsert: true, runValidators: true },
  );
};

const processMessage = async (pageId, event) => {
  const psid = event.sender?.id;
  const text = event.message?.text?.trim() || event.postback?.title?.trim();
  const eventId = event.message?.mid || event.postback?.mid || `${pageId}:${psid}:${event.timestamp}`;
  if (!psid || !text || event.message?.is_echo) return;

  let eventRecord;
  try {
    eventRecord = await MessengerEvent.create({ event_id: eventId, page_id: pageId, psid });
  } catch (error) {
    if (error.code === 11000) return;
    throw error;
  }

  try {
    const referral = referralFrom(event);
    const hasReferral = Object.values(referral).some(Boolean);
    let conversation = await MessengerConversation.findOneAndUpdate(
      { page_id: pageId, psid },
      {
        $setOnInsert: { page_id: pageId, psid },
        $set: { last_activity_at: new Date(), ...(hasReferral ? { referral } : {}) },
      },
      { new: true, upsert: true, runValidators: true },
    );

    conversation.history.push({ role: 'user', text });
    if (conversation.history.length > 30) conversation.history = conversation.history.slice(-30);

    if (conversation.mode !== 'bot') {
      await conversation.save();
      eventRecord.status = 'ignored';
      eventRecord.processed_at = new Date();
      await eventRecord.save();
      return;
    }

    if (HANDOFF_PATTERN.test(text)) {
      conversation.mode = 'human';
      conversation.stage = 'handoff';
      conversation.handoff_reason = 'Khách yêu cầu nội dung cần nhân viên xử lý';
      const reply = 'Candlet đã chuyển cuộc trò chuyện cho nhân viên hỗ trợ. Bạn vui lòng chờ một chút nhé.';
      conversation.history.push({ role: 'assistant', text: reply });
      await conversation.save();
      await sendText(psid, reply);
    } else {
      const decision = await generateSalesReply(conversation, text);
      if (decision.customer?.name) conversation.customer.name = decision.customer.name.trim();
      if (decision.customer?.phone) conversation.customer.phone = decision.customer.phone.trim();
      if (decision.customer?.address) conversation.customer.address = decision.customer.address.trim();
      if (Array.isArray(decision.cart) && decision.cart.length) conversation.cart = await resolveCart(decision.cart);

      let reply = decision.reply;
      if (decision.intent === 'order_status') {
        reply = `Bạn có thể tra cứu đơn tại ${String(process.env.CLIENT_URL || 'https://candlet.shop').split(',')[0].replace(/\/$/, '')}/order-lookup. Nếu cần nhân viên kiểm tra giúp, bạn gửi mã đơn và số điện thoại nhé.`;
      }
      if (decision.handoff) {
        conversation.mode = 'human';
        conversation.stage = 'handoff';
        conversation.handoff_reason = decision.handoff_reason || 'AI yêu cầu chuyển nhân viên';
      } else if (decision.ready_for_draft && validLead(conversation)) {
        const draft = await createDraft(conversation);
        conversation.stage = 'draft_ready';
        conversation.mode = 'human';
        conversation.handoff_reason = 'Đơn nháp đang chờ nhân viên duyệt';
        reply = draftSummary(draft);
      } else {
        conversation.stage = conversation.cart.length ? 'collecting' : 'consulting';
      }

      conversation.history.push({ role: 'assistant', text: reply });
      if (conversation.history.length > 30) conversation.history = conversation.history.slice(-30);
      await conversation.save();
      await sendText(psid, reply);
    }

    eventRecord.status = 'processed';
    eventRecord.processed_at = new Date();
    await eventRecord.save();
  } catch (error) {
    eventRecord.status = 'failed';
    eventRecord.error = String(error.message || error).slice(0, 500);
    eventRecord.processed_at = new Date();
    await eventRecord.save().catch(() => {});
    console.error('[meta-bot] Message processing failed:', error.message || error);
    await sendText(psid, 'Candlet đang chuyển tin nhắn của bạn cho nhân viên hỗ trợ. Bạn vui lòng chờ một chút nhé.').catch(() => {});
  }
};

const processWebhook = async (body) => {
  if (body.object !== 'page') return;
  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) await processMessage(entry.id, event);
  }
};

exports.receiveWebhook = (req, res) => {
  res.sendStatus(200);
  setImmediate(() => processWebhook(req.body).catch((error) => console.error('[meta-bot] Webhook failed:', error.message || error)));
};

module.exports._private = { resolveCart, validLead, processWebhook };
