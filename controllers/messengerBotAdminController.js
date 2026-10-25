const BotOrderDraft = require('../models/BotOrderDraft');
const MessengerConversation = require('../models/MessengerConversation');
const MessengerBotKnowledge = require('../models/MessengerBotKnowledge');
const MessengerProductProfile = require('../models/MessengerProductProfile');
const MessengerBotMedia = require('../models/MessengerBotMedia');
const MessengerEvent = require('../models/MessengerEvent');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { createOrder } = require('./orderController');
const { trackingPath } = require('../utils/orderTracking');
const { sendMetaText, fetchMetaProfile } = require('./metaMessengerController');
const { deleteCloudinaryImage } = require('../config/cloudinary');

exports.getStatus = async (req, res, next) => {
  try {
    const recentSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const staleSince = new Date(Date.now() - 2 * 60 * 1000);
    const [pendingDrafts, humanConversations, botConversations, pausedConversations, recentConversations, knowledge, profileCount, mediaCount, failedEvents, stuckEvents] = await Promise.all([
      BotOrderDraft.countDocuments({ status: 'pending' }),
      MessengerConversation.countDocuments({ mode: 'human', archived: { $ne: true } }),
      MessengerConversation.countDocuments({ mode: 'bot', archived: { $ne: true } }),
      MessengerConversation.countDocuments({ mode: 'paused', archived: { $ne: true } }),
      MessengerConversation.countDocuments({ archived: { $ne: true }, last_activity_at: { $gte: recentSince } }),
      MessengerBotKnowledge.findOne({ key: 'default' }).select('bot_enabled version updatedAt').lean(),
      MessengerProductProfile.countDocuments({ enabled: true }),
      MessengerBotMedia.countDocuments({ enabled: true }),
      MessengerEvent.countDocuments({ status: 'failed', updatedAt: { $gte: recentSince } }),
      MessengerEvent.countDocuments({ status: 'processing', updatedAt: { $lte: staleSince } }),
    ]);
    res.json({
      success: true,
      data: {
        configured: Boolean(process.env.OPENAI_API_KEY && process.env.META_PAGE_ACCESS_TOKEN && process.env.META_VERIFY_TOKEN && process.env.META_APP_SECRET),
        bot_enabled: knowledge?.bot_enabled !== false,
        openai_configured: Boolean(process.env.OPENAI_API_KEY),
        meta_configured: Boolean(process.env.META_PAGE_ACCESS_TOKEN && process.env.META_VERIFY_TOKEN && process.env.META_APP_SECRET),
        model: process.env.OPENAI_SALES_MODEL || 'gpt-5.4-mini',
        pending_drafts: pendingDrafts,
        human_conversations: humanConversations,
        bot_conversations: botConversations,
        paused_conversations: pausedConversations,
        recent_conversations: recentConversations,
        knowledge_version: knowledge?.version || 1,
        knowledge_updated_at: knowledge?.updatedAt || null,
        trained_products: profileCount,
        enabled_media: mediaCount,
        failed_events_24h: failedEvents,
        stuck_events: stuckEvents,
      },
    });
  } catch (error) { next(error); }
};

exports.updateBotStatus = async (req, res, next) => {
  try {
    if (typeof req.body.enabled !== 'boolean') return res.status(400).json({ success: false, message: 'Trạng thái bot không hợp lệ' });
    const data = await MessengerBotKnowledge.findOneAndUpdate(
      { key: 'default' },
      { $set: { bot_enabled: req.body.enabled, updated_by: req.user._id }, $setOnInsert: { key: 'default' } },
      { new: true, upsert: true, runValidators: true },
    );
    return res.json({ success: true, data: { bot_enabled: data.bot_enabled }, message: data.bot_enabled ? 'Bot AI đã hoạt động' : 'Bot AI đã chuyển sang ngoại tuyến' });
  } catch (error) { return next(error); }
};

const defaultKnowledge = () => ({
  key: 'default',
  bot_enabled: true,
  brand_voice: 'Ấm áp, tinh tế, chân thành; xưng Candlet và gọi khách là bạn.',
  greeting: 'Candlet chào bạn. Mình có thể giúp bạn chọn mùi hương phù hợp nhé.',
  shipping_policy: '', payment_policy: '', return_policy: '', processing_policy: '', gift_policy: '', active_promotion: '',
  sales_process: '', discovery_questions: [], response_guidelines: [], closing_rules: [], objection_handlers: [],
  prohibited_claims: ['Không cam kết công dụng điều trị hoặc chữa bệnh', 'Không tự tạo giá hoặc khuyến mãi'],
  handoff_topics: ['khiếu nại', 'hoàn tiền', 'đổi trả', 'biên lai chuyển khoản', 'vấn đề sức khỏe'],
  faqs: [], examples: [], version: 1,
});

exports.getKnowledge = async (req, res, next) => {
  try {
    const data = await MessengerBotKnowledge.findOne({ key: 'default' }).lean();
    res.json({ success: true, data: data || defaultKnowledge() });
  } catch (error) { next(error); }
};

exports.updateKnowledge = async (req, res, next) => {
  try {
    const allowed = [
      'brand_voice', 'greeting', 'shipping_policy', 'payment_policy', 'return_policy', 'processing_policy',
      'gift_policy', 'active_promotion', 'prohibited_claims', 'handoff_topics', 'faqs', 'examples',
      'sales_process', 'discovery_questions', 'response_guidelines', 'closing_rules', 'objection_handlers',
    ];
    const update = {};
    for (const key of allowed) if (Object.hasOwn(req.body, key)) update[key] = req.body[key];
    update.updated_by = req.user._id;
    const data = await MessengerBotKnowledge.findOneAndUpdate(
      { key: 'default' },
      { $set: update, $inc: { version: 1 }, $setOnInsert: { key: 'default' } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: false },
    );
    res.json({ success: true, data, message: 'Đã cập nhật kiến thức bot' });
  } catch (error) { next(error); }
};

exports.getProductProfiles = async (req, res, next) => {
  try {
    const [products, profiles] = await Promise.all([
      Product.find().select('productId name image description base_price scent_group category volume').sort({ name: 1 }).lean(),
      MessengerProductProfile.find().lean(),
    ]);
    const byProduct = new Map(profiles.map((profile) => [String(profile.product), profile]));
    const data = products.map((product) => ({ product, profile: byProduct.get(String(product._id)) || null }));
    res.json({ success: true, data });
  } catch (error) { next(error); }
};

exports.updateProductProfile = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.productId).select('_id');
    if (!product) return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm' });
    const allowed = ['enabled', 'scent_notes', 'intensity', 'suitable_spaces', 'occasions', 'moods', 'audiences', 'burn_time', 'selling_points', 'keywords', 'advice_notes'];
    const update = { product: product._id, updated_by: req.user._id };
    for (const key of allowed) if (Object.hasOwn(req.body, key)) update[key] = req.body[key];
    const data = await MessengerProductProfile.findOneAndUpdate(
      { product: product._id }, { $set: update }, { new: true, upsert: true, runValidators: true },
    ).populate('product', 'productId name image');
    res.json({ success: true, data, message: 'Đã cập nhật hồ sơ tư vấn sản phẩm' });
  } catch (error) { next(error); }
};

const mediaPayload = (body) => {
  const allowed = ['name', 'image_url', 'description', 'trigger_keywords', 'usage_notes', 'linked_products', 'enabled', 'priority'];
  const update = {};
  for (const key of allowed) if (Object.hasOwn(body, key)) update[key] = body[key];
  return update;
};

const validMediaUrl = (value) => {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
};

exports.getMedia = async (req, res, next) => {
  try {
    const data = await MessengerBotMedia.find().populate('linked_products', 'productId name image').sort({ priority: -1, updatedAt: -1 }).lean();
    res.json({ success: true, data });
  } catch (error) { next(error); }
};

exports.createMedia = async (req, res, next) => {
  try {
    const payload = mediaPayload(req.body);
    if (!validMediaUrl(payload.image_url)) return res.status(400).json({ success: false, message: 'Ảnh phải có URL HTTPS công khai' });
    payload.created_by = req.user._id;
    payload.updated_by = req.user._id;
    const data = await MessengerBotMedia.create(payload);
    res.status(201).json({ success: true, data, message: 'Đã thêm ảnh vào thư viện bot' });
  } catch (error) { next(error); }
};

exports.updateMedia = async (req, res, next) => {
  try {
    const payload = mediaPayload(req.body);
    if (payload.image_url && !validMediaUrl(payload.image_url)) return res.status(400).json({ success: false, message: 'Ảnh phải có URL HTTPS công khai' });
    payload.updated_by = req.user._id;
    const previous = await MessengerBotMedia.findById(req.params.id).select('image_url').lean();
    if (!previous) return res.status(404).json({ success: false, message: 'Không tìm thấy ảnh' });
    const data = await MessengerBotMedia.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
    if (payload.image_url && previous.image_url !== payload.image_url) {
      await deleteCloudinaryImage(previous.image_url).catch((error) => console.error('[meta-bot] Could not delete replaced media image:', error.message));
    }
    res.json({ success: true, data, message: 'Đã cập nhật ảnh' });
  } catch (error) { next(error); }
};

exports.deleteMedia = async (req, res, next) => {
  try {
    const data = await MessengerBotMedia.findByIdAndDelete(req.params.id);
    if (!data) return res.status(404).json({ success: false, message: 'Không tìm thấy ảnh' });
    await deleteCloudinaryImage(data.image_url).catch((error) => console.error('[meta-bot] Could not delete media image:', error.message));
    res.json({ success: true, message: 'Đã xóa ảnh khỏi thư viện bot' });
  } catch (error) { next(error); }
};

exports.getConversations = async (req, res, next) => {
  try {
    const archived = req.query.archived;
    const query = archived === 'all' ? {} : archived === 'true' ? { archived: true } : { archived: { $ne: true } };
    const conversations = await MessengerConversation.find(query).sort({ last_activity_at: -1 }).limit(100);
    const staleBefore = Date.now() - 24 * 60 * 60 * 1000;
    const missingProfiles = process.env.META_PAGE_ACCESS_TOKEN
      ? conversations.filter((item) => !item.profile_name
        && (!item.profile_lookup_at || new Date(item.profile_lookup_at).getTime() < staleBefore)).slice(0, 20)
      : [];
    await Promise.all(missingProfiles.map(async (conversation) => {
      const profile = await fetchMetaProfile(conversation.psid);
      conversation.profile_lookup_at = new Date();
      if (profile?.name) conversation.profile_name = profile.name;
      if (profile?.picture) conversation.profile_picture = profile.picture;
      await conversation.save();
    }));
    res.json({ success: true, data: conversations.map((item) => item.toObject()) });
  } catch (error) { next(error); }
};

exports.archiveConversation = async (req, res, next) => {
  try {
    if (typeof req.body.archived !== 'boolean') return res.status(400).json({ success: false, message: 'Trạng thái lưu trữ không hợp lệ' });
    const data = await MessengerConversation.findByIdAndUpdate(
      req.params.id,
      req.body.archived
        ? { $set: { archived: true, archived_at: new Date(), archived_by: req.user._id } }
        : { $set: { archived: false, archived_at: null, archived_by: null } },
      { new: true, runValidators: true },
    );
    if (!data) return res.status(404).json({ success: false, message: 'Không tìm thấy hội thoại' });
    return res.json({ success: true, data, message: data.archived ? 'Đã lưu trữ hội thoại' : 'Đã khôi phục hội thoại' });
  } catch (error) { return next(error); }
};

exports.deleteConversation = async (req, res, next) => {
  try {
    const data = await MessengerConversation.findByIdAndDelete(req.params.id);
    if (!data) return res.status(404).json({ success: false, message: 'Không tìm thấy hội thoại' });
    return res.json({ success: true, message: 'Đã xóa hội thoại' });
  } catch (error) { return next(error); }
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

exports.sendConversationMessage = async (req, res, next) => {
  try {
    const text = String(req.body.text || '').trim();
    if (!text) return res.status(400).json({ success: false, message: 'Nội dung tin nhắn không được để trống' });
    if (text.length > 1900) return res.status(400).json({ success: false, message: 'Tin nhắn tối đa 1900 ký tự' });
    const conversation = await MessengerConversation.findById(req.params.id);
    if (!conversation) return res.status(404).json({ success: false, message: 'Không tìm thấy hội thoại' });
    await sendMetaText(conversation.psid, text);
    conversation.mode = 'human';
    conversation.archived = false;
    conversation.archived_at = null;
    conversation.archived_by = null;
    conversation.handoff_reason = 'Nhân viên đang trực tiếp xử lý';
    conversation.last_activity_at = new Date();
    conversation.history.push({ role: 'assistant', text });
    if (conversation.history.length > 60) conversation.history = conversation.history.slice(-60);
    await conversation.save();
    return res.json({ success: true, data: conversation, message: 'Đã gửi tin nhắn' });
  } catch (error) { return next(error); }
};

exports.resetConversation = async (req, res, next) => {
  try {
    const now = new Date();
    const data = await MessengerConversation.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          mode: 'bot', stage: 'consulting', customer: { name: '', phone: '', address: '' }, cart: [],
          shown_product_ids: [], shown_media_ids: [], memory_summary: '', handoff_reason: '', context_started_at: now, last_activity_at: now,
        },
      },
      { new: true, runValidators: true },
    );
    if (!data) return res.status(404).json({ success: false, message: 'Không tìm thấy hội thoại' });
    return res.json({ success: true, data, message: 'Đã bắt đầu phiên tư vấn mới' });
  } catch (error) { return next(error); }
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
