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

const PROCESSING_LEASE_MS = 2 * 60 * 1000;

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

exports.verifyQueueSecret = (req, res, next) => {
  const configured = process.env.META_QUEUE_SECRET;
  const supplied = req.get('x-candlet-queue-secret');
  if (!configured) return res.status(503).json({ success: false, message: 'Messenger queue secret is not configured' });
  if (!supplied || !safeEqual(supplied, configured)) return res.sendStatus(401);
  return next();
};

const sendMessage = async (psid, message) => {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error('META_PAGE_ACCESS_TOKEN is not configured');
  const version = process.env.META_GRAPH_VERSION || 'v24.0';
  const response = await fetch(`https://graph.facebook.com/${version}/me/messages?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_type: 'RESPONSE',
      recipient: { id: psid },
      message,
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || `Meta Send API failed (${response.status})`);
  return payload;
};

const sendText = (psid, text) => sendMessage(psid, { text: String(text).slice(0, 1900) });

const buildProductCardsMessage = (products) => {
  const siteUrl = String(process.env.CLIENT_URL || 'https://candlet.shop').split(',')[0].replace(/\/$/, '');
  const elements = (products || []).filter((product) => {
    try { return new URL(product.image).protocol === 'https:'; } catch { return false; }
  }).slice(0, 3).map((product) => ({
    title: String(product.name || 'Sản phẩm Candlet').slice(0, 80),
    image_url: product.image,
    subtitle: `${Number(product.base_price || 0).toLocaleString('vi-VN')}đ${product.scent_group ? ` · ${product.scent_group}` : ''}`.slice(0, 80),
    default_action: {
      type: 'web_url', url: `${siteUrl}/product/${product._id}`, webview_height_ratio: 'full',
    },
    buttons: [{ type: 'web_url', url: `${siteUrl}/product/${product._id}`, title: 'Xem sản phẩm' }],
  }));
  if (!elements.length) return null;
  return { attachment: { type: 'template', payload: { template_type: 'generic', elements } } };
};

const sendProductCards = async (psid, products) => {
  const message = buildProductCardsMessage(products);
  if (!message) return [];
  await sendMessage(psid, message);
  return message.attachment.payload.elements.map((element) => element.default_action.url.split('/').pop());
};

const buildMediaImageMessage = (item) => {
  try {
    if (new URL(item?.image_url).protocol !== 'https:') return null;
  } catch { return null; }
  return { attachment: { type: 'image', payload: { url: item.image_url, is_reusable: true } } };
};

const sendMediaImages = async (psid, items) => {
  const sentIds = [];
  for (const item of (items || []).slice(0, 3)) {
    const message = buildMediaImageMessage(item);
    if (!message) continue;
    await sendMessage(psid, message);
    sentIds.push(String(item._id));
  }
  return sentIds;
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
    let customerLabel = '';
    for (const optionId of sku?.combination || []) {
      for (const group of product.variant_groups || []) {
        const option = (group.options || []).find((item) => item.id === optionId);
        if (!option) continue;
        if (/\b(mui|huong)\b/.test(normalizedMessage(group.name))) customerLabel = option.label;
        break;
      }
    }
    result.push({
      product_id: product._id,
      productId: product.productId,
      product_name: product.name,
      product_image: product.image,
      sku_id: sku?.id || null,
      sku_label: labels.join(' - '),
      customer_label: customerLabel || labels.join(' - '),
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

const normalizedMessage = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const isExplicitConfirmation = (value) => {
  const text = normalizedMessage(value);
  if (!text || /\b(khong|chua|sua|doi|huy|nham)\b/.test(text)) return false;
  return /\b(xac nhan|chot don|dat hang|dong y|dung roi|ok|oke|okay)\b/.test(text);
};

const confirmationSummary = (conversation) => {
  const lines = conversation.cart.map((item) => `• ${item.customer_label || item.sku_label || item.product_name} × ${item.quantity}: ${(Number(item.unit_price || 0) * Number(item.quantity || 0)).toLocaleString('vi-VN')}đ`);
  const total = conversation.cart.reduce((sum, item) => sum + Number(item.unit_price || 0) * Number(item.quantity || 0), 0);
  return `Candlet xin xác nhận thông tin đặt hàng:\n${lines.join('\n')}\nTạm tính: ${total.toLocaleString('vi-VN')}đ\nNgười nhận: ${conversation.customer.name}\nSố điện thoại: ${conversation.customer.phone}\nĐịa chỉ: ${conversation.customer.address}\n\nBạn kiểm tra lại và trả lời “Xác nhận” nếu mọi thông tin đã đúng nhé.`;
};

const draftSummary = (draft) => {
  const lines = draft.items.map((item) => `• ${item.customer_label || item.sku_label || item.product_name} × ${item.quantity}`);
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

const claimEvent = async ({ eventId, pageId, psid }) => {
  try {
    return await MessengerEvent.create({ event_id: eventId, page_id: pageId, psid });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }

  const staleBefore = new Date(Date.now() - PROCESSING_LEASE_MS);
  return MessengerEvent.findOneAndUpdate(
    {
      event_id: eventId,
      $or: [
        { status: 'failed' },
        { status: 'processing', updatedAt: { $lte: staleBefore } },
      ],
    },
    {
      $set: { status: 'processing', error: '', processed_at: null, page_id: pageId, psid },
      $inc: { attempts: 1 },
    },
    { new: true },
  );
};

const processMessage = async (pageId, event, { retryFailures = false } = {}) => {
  const psid = event.sender?.id;
  const text = event.message?.text?.trim() || event.postback?.title?.trim();
  const eventId = event.message?.mid || event.postback?.mid || `${pageId}:${psid}:${event.timestamp}`;
  if (!psid || !text || event.message?.is_echo) return;

  const eventRecord = await claimEvent({ eventId, pageId, psid });
  if (!eventRecord) {
    if (retryFailures) {
      const existing = await MessengerEvent.findOne({ event_id: eventId }).select('status').lean();
      if (existing?.status === 'processing') throw new Error(`Messenger event ${eventId} is still processing`);
    }
    return;
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

    if (conversation.stage === 'confirming' && isExplicitConfirmation(text) && validLead(conversation)) {
      const draft = await createDraft(conversation);
      conversation.stage = 'draft_ready';
      conversation.mode = 'human';
      conversation.handoff_reason = 'Đơn nháp đang chờ nhân viên duyệt';
      const reply = draftSummary(draft);
      conversation.history.push({ role: 'assistant', text: reply });
      if (conversation.history.length > 30) conversation.history = conversation.history.slice(-30);
      await conversation.save();
      await sendText(psid, reply);
      eventRecord.status = 'processed';
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
        conversation.stage = 'confirming';
        reply = confirmationSummary(conversation);
      } else {
        conversation.stage = conversation.cart.length ? 'collecting' : 'consulting';
      }

      conversation.history.push({ role: 'assistant', text: reply });
      if (conversation.history.length > 30) conversation.history = conversation.history.slice(-30);
      await conversation.save();
      await sendText(psid, reply);
      const shown = new Set((conversation.shown_product_ids || []).map(String));
      const recommended = (decision.recommended_products || []).filter((product) => !shown.has(String(product._id)));
      if (recommended.length) {
        const sentIds = await sendProductCards(psid, recommended).catch((error) => {
          console.error('[meta-bot] Could not send product cards:', error.message || error);
          return [];
        });
        if (sentIds.length) {
          await MessengerConversation.findByIdAndUpdate(
            conversation._id, { $addToSet: { shown_product_ids: { $each: sentIds } } },
          ).catch((error) => console.error('[meta-bot] Could not remember product cards:', error.message || error));
        }
      }
      const shownMedia = new Set((conversation.shown_media_ids || []).map(String));
      const recommendedMedia = (decision.recommended_media || []).filter((item) => !shownMedia.has(String(item._id)));
      if (recommendedMedia.length) {
        const sentIds = await sendMediaImages(psid, recommendedMedia).catch((error) => {
          console.error('[meta-bot] Could not send media images:', error.message || error);
          return [];
        });
        if (sentIds.length) {
          await MessengerConversation.findByIdAndUpdate(
            conversation._id, { $addToSet: { shown_media_ids: { $each: sentIds } } },
          ).catch((error) => console.error('[meta-bot] Could not remember media images:', error.message || error));
        }
      }
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
    if (retryFailures) throw error;
    await sendText(psid, 'Candlet đang chuyển tin nhắn của bạn cho nhân viên hỗ trợ. Bạn vui lòng chờ một chút nhé.').catch(() => {});
  }
};

const processWebhook = async (body, options = {}) => {
  if (body.object !== 'page') return;
  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) await processMessage(entry.id, event, options);
  }
};

exports.receiveWebhook = (req, res) => {
  res.sendStatus(200);
  setImmediate(() => processWebhook(req.body).catch((error) => console.error('[meta-bot] Webhook failed:', error.message || error)));
};

exports.receiveQueuedWebhook = async (req, res) => {
  try {
    await processWebhook(req.body, { retryFailures: true });
    return res.sendStatus(200);
  } catch (error) {
    console.error('[meta-bot] Queued webhook failed:', error.message || error);
    return res.status(503).json({ success: false, message: 'Messenger event processing failed' });
  }
};

module.exports._private = { resolveCart, validLead, processWebhook, claimEvent, isExplicitConfirmation, confirmationSummary, buildProductCardsMessage, buildMediaImageMessage };
