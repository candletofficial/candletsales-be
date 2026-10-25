const BotOrderDraft = require('../models/BotOrderDraft');
const MessengerConversation = require('../models/MessengerConversation');
const Order = require('../models/Order');
const { createOrder } = require('./orderController');
const { trackingPath } = require('../utils/orderTracking');
const { sendMetaText } = require('./metaMessengerController');

exports.getStatus = async (req, res, next) => {
  try {
    const [pendingDrafts, humanConversations] = await Promise.all([
      BotOrderDraft.countDocuments({ status: 'pending' }),
      MessengerConversation.countDocuments({ mode: 'human' }),
    ]);
    res.json({
      success: true,
      data: {
        configured: Boolean(process.env.OPENAI_API_KEY && process.env.META_PAGE_ACCESS_TOKEN && process.env.META_VERIFY_TOKEN && process.env.META_APP_SECRET),
        openai_configured: Boolean(process.env.OPENAI_API_KEY),
        meta_configured: Boolean(process.env.META_PAGE_ACCESS_TOKEN && process.env.META_VERIFY_TOKEN && process.env.META_APP_SECRET),
        model: process.env.OPENAI_SALES_MODEL || 'gpt-5.4-mini',
        pending_drafts: pendingDrafts,
        human_conversations: humanConversations,
      },
    });
  } catch (error) { next(error); }
};

exports.getConversations = async (req, res, next) => {
  try {
    const data = await MessengerConversation.find().sort({ last_activity_at: -1 }).limit(100).lean();
    res.json({ success: true, data });
  } catch (error) { next(error); }
};

exports.updateConversationMode = async (req, res, next) => {
  try {
    if (!['bot', 'human', 'paused'].includes(req.body.mode)) return res.status(400).json({ success: false, message: 'Chế độ không hợp lệ' });
    const data = await MessengerConversation.findByIdAndUpdate(
      req.params.id,
      { mode: req.body.mode, ...(req.body.mode === 'bot' ? { stage: 'consulting', handoff_reason: '' } : {}) },
      { new: true, runValidators: true },
    );
    if (!data) return res.status(404).json({ success: false, message: 'Không tìm thấy hội thoại' });
    res.json({ success: true, data });
  } catch (error) { next(error); }
};

exports.getDrafts = async (req, res, next) => {
  try {
    const query = req.query.status ? { status: req.query.status } : {};
    const data = await BotOrderDraft.find(query).populate('order_id', 'orderId').sort({ createdAt: -1 }).limit(100).lean();
    res.json({ success: true, data });
  } catch (error) { next(error); }
};

exports.rejectDraft = async (req, res, next) => {
  try {
    const data = await BotOrderDraft.findOneAndUpdate(
      { _id: req.params.id, status: 'pending' },
      { status: 'rejected', reviewed_by: req.user._id, reviewed_at: new Date(), note: req.body.reason ? `${req.body.reason}\n${req.body.note || ''}`.trim() : undefined },
      { new: true },
    );
    if (!data) return res.status(409).json({ success: false, message: 'Đơn nháp không còn ở trạng thái chờ duyệt' });
    res.json({ success: true, data });
  } catch (error) { next(error); }
};

exports.approveDraft = async (req, res, next) => {
  let draft;
  try {
    draft = await BotOrderDraft.findOneAndUpdate(
      { _id: req.params.id, status: 'pending' },
      { status: 'approving', reviewed_by: req.user._id, reviewed_at: new Date() },
      { new: true },
    );
    if (!draft) return res.status(409).json({ success: false, message: 'Đơn nháp không còn ở trạng thái chờ duyệt' });

    const body = {
      items: draft.items,
      total_price: draft.total_price,
      source: draft.source,
      pos_mode: 'online',
      customer_name: draft.customer_name,
      customer_phone: draft.customer_phone,
      customer_address: draft.customer_address,
      payment_method: req.body.payment_method || 'cash',
      shippingMethod: req.body.shippingMethod || 'standard',
      shipping_fee: Number(req.body.shipping_fee || 0),
      logistics_cost: Number(req.body.logistics_cost || 0),
      note: [draft.note, req.body.note].filter(Boolean).join('\n'),
      create_tracking_link: true,
    };
    body.total_price += body.shipping_fee;

    let statusCode = 200;
    let payload;
    let forwardedError;
    const responseAdapter = {
      status(code) { statusCode = code; return this; },
      json(value) { payload = value; return this; },
    };
    await createOrder({ body, user: req.user }, responseAdapter, (error) => { forwardedError = error; });
    if (forwardedError) throw forwardedError;
    if (statusCode >= 400 || !payload?.success) throw Object.assign(new Error(payload?.message || 'Không thể tạo đơn hàng'), { statusCode });

    const order = await Order.findOne({ orderId: payload.data.orderId });
    draft.status = 'approved';
    draft.order_id = order?._id || null;
    await draft.save();
    await MessengerConversation.findByIdAndUpdate(draft.conversation, { mode: 'human', stage: 'draft_ready', handoff_reason: `Đã duyệt thành đơn ${payload.data.orderId}` });
    const publicPath = payload.data.tracking_token ? trackingPath(payload.data.tracking_token) : '';
    const siteUrl = String(process.env.CLIENT_URL || 'https://candlet.shop').split(',')[0].replace(/\/$/, '');
    await sendMetaText(draft.psid, `Đơn ${payload.data.orderId} đã được Candlet xác nhận.${publicPath ? ` Bạn theo dõi đơn tại ${siteUrl}${publicPath}` : ''}`).catch((error) => {
      console.error('[meta-bot] Could not send order confirmation:', error.message);
    });
    res.status(201).json({ success: true, data: { draft, order: payload.data } });
  } catch (error) {
    if (draft?._id) await BotOrderDraft.findByIdAndUpdate(draft._id, { status: 'pending' }).catch(() => {});
    next(error);
  }
};
