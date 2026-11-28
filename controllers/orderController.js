const Order = require('../models/Order');
const Material = require('../models/Material');
const Product = require('../models/Product');
const ShippingConfig = require('../models/ShippingConfig');
const SystemConfig = require('../models/SystemConfig');
const FundTransaction = require('../models/FundTransaction');
const PaymentSession = require('../models/PaymentSession');
const { randomUUID } = require('crypto');
const { triggerAutoConfirmImports } = require('../utils/inventoryHelpers');
const { notifyNewWebsiteOrder } = require('../utils/orderEmailNotifier');
const { freeshipDiscount } = require('../utils/freeshipDiscount');
const { itemMaterials, materialId, preserveOrderMaterials } = require('../utils/orderItemMaterials');
const { newTrackingToken, trackingPath, trackingTransitionError } = require('../utils/orderTracking');
const { BASE_FUND_ACCOUNTS, getEnabledCarrierIds, resolveOrderRevenueAccount } = require('../utils/carrierCodAccounts');
const { returnedPaymentStatus, canRecordRefund } = require('../utils/orderPaymentStatus');

const revenueAccountForOrder = async order => {
  const snapshot = typeof order?.toObject === 'function' ? order.toObject() : { ...order };
  return resolveOrderRevenueAccount({ ...snapshot, revenue_account: '' }, await getEnabledCarrierIds());
};

const shouldAutoCollectToCommonFund = (order, revenueAccount) => {
  if (!revenueAccount || revenueAccount.startsWith('carrier_')) return false;
  return revenueAccount === 'common'
    || (order.source === 'pos' && order.payment_method === 'transfer');
};

const autoCollectionSource = (order, revenueAccount) => revenueAccount === 'common' ? 'common' : order.source;

const orderRevenueAmount = order => Math.max(
  0,
  Number(order?.total_price || 0) - (order?.custom_group ? Number(order?.custom_other_cost || 0) : 0),
);

const isRecognizedOrderRevenue = order => {
  if (!order || orderRevenueAmount(order) <= 0) return false;
  if (['cancelled', 'returned'].includes(order.status)) return false;
  if (['returning', 'returned', 'failed', 'cancelled'].includes(order.delivery_status)) return false;
  return order.status === 'completed'
    || (order.payment_method === 'transfer' && order.payment_status === 'paid');
};

const resolveCustomOtherCost = async (customGroup, items = []) => {
  const group = typeof customGroup === 'string' ? customGroup.trim() : '';
  const productIds = items.map(item => materialId(item.product_id)).filter(Boolean);
  if (!group || !productIds.length) return 0;
  const template = await Product.findOne({
    _id: { $in: productIds },
    product_type: 'custom',
    custom_group: group,
  }).select('custom_other_cost').lean();
  return Math.max(0, Number(template?.custom_other_cost) || 0);
};

const customItemUnitCost = product => {
  const tracked = itemMaterials({}, product).reduce((sum, entry) => (
    sum + (Number(entry?.ingredient_id?.price) || 0) * (Number(entry?.quantity) || 0)
  ), 0);
  const outsideStock = (product?.custom_cost_items || []).reduce((sum, entry) => (
    sum + (Number(entry?.unit_cost) || 0) * (Number(entry?.quantity) || 0)
  ), 0);
  return tracked + outsideStock;
};

const materialSnapshot = product => itemMaterials({}, product).map(entry => ({
  ingredient_id: entry.ingredient_id?._id || entry.ingredient_id,
  quantity: Number(entry.quantity) || 0,
  name: entry.ingredient_id?.name || '',
  unit: entry.ingredient_id?.unit || '',
  unit_cost: Number(entry.ingredient_id?.price) || 0,
}));

const prepareCustomOrderSnapshot = async (items = [], customGroup = '') => {
  const group = String(customGroup || '').trim();
  if (!group) return items;
  if (await Order.exists({ custom_group: group })) {
    const error = new Error('Đơn custom này đã được thêm vào một đơn hàng và không thể sử dụng lại.');
    error.statusCode = 409;
    throw error;
  }
  const products = await Product.find({ product_type: 'custom', custom_group: group })
    .populate('base_ingredients.ingredient_id')
    .populate('resolved_base_ingredients.ingredient_id');
  if (!products.length || products.some(product => product.custom_locked_at)) {
    const error = new Error('Đơn custom không tồn tại hoặc đã bị khóa.');
    error.statusCode = 409;
    throw error;
  }
  const byId = new Map(products.map(product => [String(product._id), product]));
  const customLines = items.filter(item => byId.has(String(item.product_id)));
  const incomingIds = new Set(customLines.map(item => String(item.product_id)));
  if (incomingIds.size !== products.length || customLines.length !== products.length) {
    const error = new Error('Đơn hàng phải chứa đầy đủ mỗi sản phẩm của đơn custom đúng một lần.');
    error.statusCode = 400;
    throw error;
  }
  return items.map(item => {
    const product = byId.get(String(item.product_id));
    if (!product) return item;
    return {
      ...item,
      productId: product.productId,
      product_name: product.name,
      product_image: product.image || null,
      sku_id: null,
      sku_label: '',
      unit_price: Number(product.base_price) || 0,
      unit_cost: customItemUnitCost(product),
      quantity: Math.max(1, Number(product.custom_quantity) || 1),
      material_overrides: materialSnapshot(product),
      materials_key: randomUUID(),
    };
  });
};

const backfillLegacyCustomSnapshots = async (orders = []) => {
  const customOrders = orders.filter(order => String(order?.custom_group || '').trim());
  if (!customOrders.length) return;
  const groups = [...new Set(customOrders.map(order => String(order.custom_group).trim()))];
  const productIds = [...new Set(customOrders.flatMap(order => (order.items || [])
    .filter(item => !Array.isArray(item.material_overrides))
    .map(item => item.product_id).filter(Boolean).map(String)))];
  const products = productIds.length ? await Product.find({ _id: { $in: productIds }, product_type: 'custom' })
    .populate('base_ingredients.ingredient_id')
    .populate('resolved_base_ingredients.ingredient_id') : [];
  const byId = new Map(products.map(product => [String(product._id), product]));
  for (const order of customOrders) {
    let changed = false;
    const items = (order.items || []).map(rawItem => {
      const item = typeof rawItem?.toObject === 'function' ? rawItem.toObject() : { ...rawItem };
      const product = byId.get(String(item.product_id));
      if (!product || Array.isArray(item.material_overrides)) return item;
      changed = true;
      return { ...item, material_overrides: materialSnapshot(product), materials_key: item.materials_key || randomUUID() };
    });
    if (changed) {
      await Order.updateOne({ _id: order._id }, { $set: { items } });
      order.items = items;
    }
  }
  await Product.updateMany({ product_type: 'custom', custom_group: { $in: groups }, custom_locked_at: null }, {
    $set: { custom_locked_at: new Date() },
  });
};

// Orders created before custom_other_cost existed need a one-time snapshot
// from their custom group. Updating the related ledger rows keeps assets in
// sync with the same net-revenue rule used for new orders.
const backfillLegacyCustomOtherCosts = async (orders = []) => {
  const ids = orders.map(order => order?._id).filter(Boolean);
  if (!ids.length) return;
  const legacyOrders = await Order.collection.find({
    _id: { $in: ids },
    custom_group: { $nin: ['', null] },
    custom_other_cost: { $exists: false },
  }).project({ _id: 1, custom_group: 1, total_price: 1 }).toArray();
  if (!legacyOrders.length) return;

  const groups = [...new Set(legacyOrders.map(order => order.custom_group).filter(Boolean))];
  const templates = await Product.find({ product_type: 'custom', custom_group: { $in: groups } })
    .select('custom_group custom_other_cost').lean();
  const costsByGroup = new Map();
  for (const template of templates) {
    if (!costsByGroup.has(template.custom_group)) {
      costsByGroup.set(template.custom_group, Math.max(0, Number(template.custom_other_cost) || 0));
    }
  }

  const documentsById = new Map(orders.map(order => [String(order._id), order]));
  for (const legacy of legacyOrders) {
    const customOtherCost = costsByGroup.get(legacy.custom_group) || 0;
    const revenueAmount = Math.max(0, Number(legacy.total_price || 0) - customOtherCost);
    await Order.updateOne({ _id: legacy._id }, { $set: { custom_other_cost: customOtherCost } });
    await FundTransaction.updateMany(
      { order_id: legacy._id, type: 'order_revenue' },
      { $set: { amount: revenueAmount, platform_change: revenueAmount } },
    );
    await FundTransaction.updateMany(
      { order_id: legacy._id, type: 'revenue_withdrawal', note: /^Tự động chuyển doanh thu / },
      { $set: { amount: revenueAmount, fund_change: revenueAmount } },
    );
    const document = documentsById.get(String(legacy._id));
    if (document) document.custom_other_cost = customOtherCost;
  }
};

// Helper tạo orderId ngẫu nhiên
const generateOrderId = () => `DH-${Math.floor(1000000 + Math.random() * 9000000)}`;

// Helper tính lại status từ actualStock vs minStock
const calcStatus = (actualStock, minStock) => {
  const actual = Number(actualStock);
  const min = Number(minStock);
  if (actual === 0) return 'out_of_stock';
  if (actual <= min) return 'low_stock';
  return 'in_stock';
};

/**
 * Tính toán lượng nguyên liệu cần trừ cho một item đơn hàng.
 * Trả về { deductions: Map<ingredient_id_string, totalQuantity>, packagingCost: Number }
 */
const buildMaterialDeductions = async (items, shippingMethod = 'standard', session = null) => {
  // Gom product_id cần fetch
  const productIds = [...new Set(items.map(i => i.product_id))];
  const productQuery = Product.find({ _id: { $in: productIds } });
  const products = await (session ? productQuery.session(session) : productQuery);
  const productMap = Object.fromEntries(products.map(p => [p._id.toString(), p]));
  const hasCustomProduct = products.some(product => product.product_type === 'custom');

  // Map: materialId -> tổng lượng cần trừ
  const deductions = new Map();

  const addDeduct = (ingredientId, qty) => {
    const key = ingredientId.toString();
    deductions.set(key, (deductions.get(key) || 0) + qty);
  };

  for (const item of items) {
    const product = productMap[materialId(item.product_id)];
    if (product?.product_type === 'sub_formula') {
      const error = new Error('Sản phẩm không tồn tại hoặc không thể đăng bán.');
      error.statusCode = 400;
      throw error;
    }

    const qty = item.quantity; // số lượng sản phẩm trong đơn

    // Use this item's saved recipe for edits, returns and deletions as well.
    for (const bi of itemMaterials(item, product)) {
      addDeduct(bi.ingredient_id, bi.quantity * qty);
    }
  }

  // 3. Trừ thêm nguyên liệu theo phương thức vận chuyển
  let packagingCost = 0;
  // Custom orders are production estimates and use their own complete recipe.
  // Do not add the store's standard packing materials or packing cost.
  if (shippingMethod && !hasCustomProduct) {
    const shippingQuery = ShippingConfig.findOne({ method: shippingMethod });
    const shippingConfig = await (session ? shippingQuery.session(session) : shippingQuery);
    if (shippingConfig && shippingConfig.materials && shippingConfig.materials.length > 0) {
      for (const sm of shippingConfig.materials) {
        addDeduct(sm.material_id, sm.quantity);
        const materialQuery = Material.findById(sm.material_id);
        const mat = await (session ? materialQuery.session(session) : materialQuery);
        if (mat) {
          packagingCost += (mat.price || 0) * sm.quantity;
        }
      }
    }
  }

  return { deductions, packagingCost };
};

const paymentSessionPayload = (session) => ({
  orderId: session.order_reference,
  payment_code: session.payment_code,
  total_price: session.amount,
  payment_method: 'transfer',
  payment_status: session.status === 'confirmed' ? 'paid' : 'pending',
  expires_at: session.expires_at,
  payment_session_status: session.status,
});

const qrExpiryMinutes = () => {
  const configured = Number(process.env.SEPAY_QR_EXPIRES_MINUTES || 15);
  return Number.isFinite(configured) ? Math.max(5, Math.min(60, configured)) : 15;
};

const createTransferPaymentSession = async (req, res, next) => {
  try {
    const { items, shippingMethod, discount_code, total_price } = req.body;
    if (!items || items.length === 0 || !Number.isFinite(Number(total_price)) || Number(total_price) <= 0) {
      return res.status(400).json({ success: false, message: 'Thông tin thanh toán không hợp lệ.' });
    }

    // Pre-flight inventory check. Nothing is deducted/reserved until the
    // matching payment is confirmed, and the final order checks again.
    const { deductions } = await buildMaterialDeductions(items, shippingMethod);
    for (const [materialId, deductQty] of deductions.entries()) {
      const material = await Material.findById(materialId);
      if (material && material.actualStock < deductQty) {
        return res.status(400).json({ success: false, message: `Nguyên liệu "${material.name}" không đủ hàng.` });
      }
    }

    if (discount_code) {
      const Coupon = require('../models/Coupon');
      const coupon = await Coupon.findOne({ code: discount_code, is_active: true });
      const now = new Date();
      if (!coupon || coupon.used_count >= coupon.quantity || now < new Date(coupon.start_date) || now > new Date(coupon.end_date)) {
        return res.status(400).json({ success: false, message: 'Mã giảm giá không còn hiệu lực.' });
      }
    }

    let session;
    for (let attempt = 0; attempt < 5 && !session; attempt += 1) {
      const orderReference = generateOrderId();
      const exists = await Promise.all([
        Order.exists({ orderId: orderReference }),
        PaymentSession.exists({ order_reference: orderReference }),
      ]);
      if (exists.some(Boolean)) continue;

      const expiresAt = new Date(Date.now() + qrExpiryMinutes() * 60 * 1000);
      try {
        session = await PaymentSession.create({
          order_reference: orderReference,
          payment_code: orderReference.replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
          amount: Number(total_price),
          expires_at: expiresAt,
          // Preserve the checkout snapshot; it becomes an Order only after
          // the verified SePay webhook reaches the server.
          order_data: { ...req.body, orderId: orderReference },
        });
      } catch (error) {
        if (error?.code !== 11000) throw error;
      }
    }

    if (!session) {
      return res.status(503).json({ success: false, message: 'Không thể tạo phiên thanh toán, vui lòng thử lại.' });
    }
    return res.status(201).json({ success: true, data: paymentSessionPayload(session), message: 'Đã tạo phiên thanh toán QR.' });
  } catch (error) {
    next(error);
  }
};

// GET /api/shop/payment-sessions/:orderReference
exports.getPaymentSession = async (req, res, next) => {
  try {
    const session = await PaymentSession.findOne({ order_reference: req.params.orderReference });
    if (!session) return res.status(404).json({ success: false, message: 'Không tìm thấy phiên thanh toán.' });

    if (session.status === 'pending' && session.expires_at <= new Date()) {
      session.status = 'expired';
      await session.save();
    }

    const data = paymentSessionPayload(session);
    if (session.status === 'confirmed' && session.order_id) {
      data.order = await Order.findById(session.order_id);
    }
    return res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// Used only by the authenticated SePay webhook after amount/account/code have
// been validated. Reuse the regular order creation path so inventory, coupons
// and accounting retain one source of truth.
exports.createConfirmedTransferOrder = async (session, transactionId) => {
  let result;
  let failure;
  const response = {
    status: () => response,
    json: (body) => { result = body; return body; },
  };
  await exports.createOrder({
    body: { ...session.order_data, orderId: session.order_reference },
    internalPaymentConfirmation: { transactionId },
  }, response, (error) => { failure = error; });
  if (failure) throw failure;
  if (!result?.success || !result.data) throw new Error(result?.message || 'Unable to create paid order');
  return result.data;
};

// GET /api/orders
exports.getOrders = async (req, res, next) => {
  try {
    const orders = await Order.find().select('+tracking_token').sort({ ordered_at: -1 });
    await backfillLegacyCustomOtherCosts(orders);
    await backfillLegacyCustomSnapshots(orders);
    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    next(error);
  }
};

// GET /api/orders/:id
exports.getOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id).select('+tracking_token');
    if (!order) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
    }
    await backfillLegacyCustomOtherCosts([order]);
    await backfillLegacyCustomSnapshots([order]);
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

// POST /api/orders
exports.createOrder = async (req, res, next) => {
  try {
    const createTracking = req.body.create_tracking_link === true;
    if (createTracking && req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Chỉ quản trị viên được tạo link theo dõi.' });
    }
    let { items, total_price, logistics_cost, shipping_fee, source, pos_mode, customer_name, customer_phone, customer_address, custom_group, user_id, payment_method, shippingMethod, shipping_carrier, tracking_number, tracking_url, note, ordered_at, orderId: clientOrderId, is_replacement, is_seeding, seeding_cost, discount_amount, discount_code } = req.body;
    if (Array.isArray(items)) items = preserveOrderMaterials(items);
    req.body.items = items;

    if (!is_seeding && (!items || items.length === 0)) {
      return res.status(400).json({ success: false, message: 'Đơn hàng phải có ít nhất 1 sản phẩm' });
    }
    const normalizedCustomGroup = typeof custom_group === 'string' ? custom_group.trim() : '';
    items = await prepareCustomOrderSnapshot(items, normalizedCustomGroup);
    req.body.items = items;

    // Xác định orderId: dùng từ client (nhập tay) hoặc tự sinh nếu không có
    let orderId;
    if (clientOrderId && clientOrderId.trim()) {
      orderId = clientOrderId.trim();
      // Kiểm tra trùng lặp
      const existing = await Order.findOne({ orderId });
      if (existing) {
        return res.status(400).json({ success: false, message: `Mã đơn hàng "${orderId}" đã tồn tại. Vui lòng nhập mã khác.` });
      }
    } else {
      orderId = generateOrderId();
    }

    // 0. Kiểm tra mã giảm giá
    if (discount_code) {
      const Coupon = require('../models/Coupon');
      const coupon = await Coupon.findOne({ code: discount_code, is_active: true });
      if (!coupon) {
        return res.status(400).json({ success: false, message: 'Mã giảm giá không tồn tại hoặc đã bị vô hiệu.' });
      }
      if (coupon.used_count >= coupon.quantity) {
        return res.status(400).json({ success: false, message: 'Mã giảm giá đã hết lượt sử dụng.' });
      }
      const now = new Date();
      if (now < new Date(coupon.start_date) || now > new Date(coupon.end_date)) {
        return res.status(400).json({ success: false, message: 'Mã giảm giá không trong thời gian hiệu lực.' });
      }

      // Nâng cao cho Website
      if (coupon.is_website_only || coupon.type === 'freeship') {
        if (source !== 'website') {
          return res.status(400).json({ success: false, message: 'Mã giảm giá này chỉ áp dụng khi đặt hàng trên Website.' });
        }
        
        if (coupon.usage_limit_per_user === 'once' || coupon.customer_condition !== 'all') {
          if (!user_id) {
            return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập để sử dụng mã giảm giá này.' });
          }
          
          if (coupon.usage_limit_per_user === 'once') {
            const usedOrder = await Order.findOne({ user_id, discount_code: coupon.code, status: { $ne: 'cancelled' } });
            if (usedOrder) {
              return res.status(400).json({ success: false, message: 'Tài khoản của bạn đã sử dụng mã giảm giá này.' });
            }
          }
          
          if (coupon.customer_condition === 'first_time') {
            const pastOrder = await Order.findOne({ user_id, status: 'completed' });
            if (pastOrder) {
              return res.status(400).json({ success: false, message: 'Mã giảm giá này chỉ dành cho tài khoản mua lần đầu.' });
            }
          }
          
          if (coupon.customer_condition === 'returning') {
            const pastOrder = await Order.findOne({ user_id, status: 'completed' });
            if (!pastOrder) {
              return res.status(400).json({ success: false, message: 'Mã giảm giá này chỉ dành cho tài khoản đã từng mua hàng.' });
            }
          }
        }
      }
    }

    // Recalculate freeship before creating either a COD order or a QR session.
    if (discount_code) {
      const Coupon = require('../models/Coupon');
      const coupon = await Coupon.findOne({ code: discount_code, is_active: true });
      if (coupon?.type === 'freeship') {
        if (source !== 'website' || is_seeding || is_replacement) {
          return res.status(400).json({ success: false, message: 'Mã freeship áp dụng cho đơn website có phí vận chuyển.' });
        }
        if (!req.internalPaymentConfirmation) {
          const products = await Product.find({ _id: { $in: items.map(item => item.product_id) }, product_type: { $nin: ['sub_formula', 'custom'] } });
          items = items.map(item => {
            const product = products.find(p => String(p._id) === String(item.product_id));
            const sku = product?.skus?.find(s => s.id === item.sku_id);
            if (!product || (item.sku_id && !sku) || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0) {
              const error = new Error('Sản phẩm hoặc số lượng trong đơn không hợp lệ.');
              error.statusCode = 400;
              throw error;
            }
            return { ...item, unit_price: sku?.price > 0 ? sku.price : product.base_price };
          });
          discount_amount = freeshipDiscount(coupon, items, shipping_fee);
          const subtotal = items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
          total_price = subtotal + Number(shipping_fee) - discount_amount;
        }
        // On payment confirmation, retain the already-paid session's price snapshot.
        Object.assign(req.body, { items, total_price, discount_amount });
      }
    }

    // A real QR order is created only by the verified payment webhook.
    if (source === 'website' && payment_method === 'transfer' && !req.internalPaymentConfirmation && !createTracking) {
      return createTransferPaymentSession(req, res, next);
    }

    // 1. Tính lượng nguyên liệu cần trừ & kiểm tra tồn kho & tính phí đóng gói
    const { deductions, packagingCost } = await buildMaterialDeductions(items, shippingMethod);
    
    // Kiểm tra xem số lượng nguyên liệu tồn kho có đủ đáp ứng không
    for (const [materialId, deductQty] of deductions.entries()) {
      const mat = await Material.findById(materialId);
      if (mat && mat.actualStock < deductQty) {
        return res.status(400).json({ 
          success: false, 
          message: `Không thể tạo đơn hàng vì nguyên liệu "${mat.name}" không đủ (yêu cầu: ${deductQty}, tồn kho: ${mat.actualStock}).` 
        });
      }
    }

    // Tính tổng số tiền cần thanh toán ngay: phí seeding + phí ship
    const seedingPayment = is_seeding && seeding_cost ? Number(seeding_cost) : 0;
    const shippingPayment = logistics_cost ? Number(logistics_cost) : 0;
    const totalRequired = seedingPayment + shippingPayment;

    if (totalRequired > 0) {
      const fundAgg = await FundTransaction.aggregate([
        { $group: { _id: null, totalBalance: { $sum: '$fund_change' } } }
      ]);
      const currentFund = fundAgg.length > 0 ? fundAgg[0].totalBalance : 0;
      if (currentFund < totalRequired) {
        return res.status(400).json({ 
          success: false, 
          code: 'INSUFFICIENT_FUND', 
          message: 'Tài sản chung không đủ để trả chi phí (Ship / Seeding).',
          requiredAmount: totalRequired - currentFund
        });
      }
    }

    const isWebsite = (source === 'website');
    const initialDeliveryStatus = createTracking ? 'pending' : req.body.delivery_status || (isWebsite ? 'pending' : 'delivered');
    const initialStatus = createTracking ? 'pending' : req.body.status || (isWebsite ? 'pending' : 'completed');
    const isWebsiteTransfer = isWebsite && payment_method === 'transfer';
    const confirmedPayment = req.internalPaymentConfirmation;
    const isManualTransfer = !isWebsite && payment_method === 'transfer';
    const isPaidPayment = Boolean(confirmedPayment) || isManualTransfer;
    // SePay extracts this exact code from the transfer description. Keep it
    // compact (DH + seven digits) so it matches the dashboard code pattern.
    const paymentCode = isWebsiteTransfer
      ? orderId.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
      : undefined;

    const customOtherCost = await resolveCustomOtherCost(normalizedCustomGroup, items);

    // 2. Tạo đơn hàng
    const order = await Order.create({
      orderId,
      tracking_enabled: createTracking,
      tracking_token: createTracking ? newTrackingToken() : undefined,
      items: items || [],
      total_price: total_price || 0,
      logistics_cost: logistics_cost || 0,
      total_excludes_logistics: source === 'website' ? undefined : true,
      source: source || 'khác',
      status: initialStatus,
      delivery_status: initialDeliveryStatus,
      pos_mode: pos_mode || 'offline',
      customer_name: customer_name || '',
      customer_phone: customer_phone || '',
      customer_address: customer_address || '',
      custom_group: normalizedCustomGroup,
      custom_other_cost: customOtherCost,
      user_id: user_id || null,
      payment_method: payment_method || 'cash',
      payment_status: isPaidPayment ? 'paid' : 'pending',
      payment_code: paymentCode,
      payment_transaction_id: confirmedPayment ? confirmedPayment.transactionId : null,
      paid_at: isPaidPayment ? new Date() : null,
      shippingMethod: shippingMethod || 'standard',
      shipping_carrier: typeof shipping_carrier === 'string' ? shipping_carrier.trim() : '',
      tracking_number: typeof tracking_number === 'string' ? tracking_number.trim() : '',
      tracking_url: typeof tracking_url === 'string' ? tracking_url.trim() : '',
      shipping_fee: shipping_fee || 0,
      packaging_cost: packagingCost,
      note: note || '',
      discount_amount: discount_amount || 0,
      discount_code: discount_code || null,
      is_replacement: is_replacement || false,
      is_seeding: is_seeding || false,
      seeding_cost: seeding_cost || 0,
      ordered_at: ordered_at || new Date(),
    });
    if (normalizedCustomGroup) {
      await Product.updateMany({ product_type: 'custom', custom_group: normalizedCustomGroup }, {
        $set: { custom_locked_at: new Date(), custom_order_id: order._id },
      });
    }

    // Tạo giao dịch trả phí seeding
    if (order.is_seeding && order.seeding_cost > 0) {
      await FundTransaction.create({
        type: 'seeding_payment',
        amount: order.seeding_cost,
        fund_change: -order.seeding_cost,
        order_id: order._id,
        note: `Chi phí đơn Seeding ${order.orderId}`,
        created_by: 'System'
      });
    }

    // Tạo giao dịch trả phí ship
    if (order.logistics_cost > 0) {
      await FundTransaction.create({
        type: 'shipping_payment',
        amount: order.logistics_cost,
        fund_change: -order.logistics_cost,
        order_id: order._id,
        note: `Phí ship đơn hàng ${order.orderId}`,
        created_by: 'System'
      });
    }

    const recognizesRevenue = isRecognizedOrderRevenue(order);
    const revenueAmount = orderRevenueAmount(order);
    const revenueAccount = recognizesRevenue ? await revenueAccountForOrder(order) : null;
    if (revenueAccount) {
      order.revenue_account = revenueAccount;
      await order.save();
    }

    const isAutoFund = shouldAutoCollectToCommonFund(order, revenueAccount);
    if (isAutoFund && recognizesRevenue) {
      await FundTransaction.create({
        type: 'revenue_withdrawal',
        amount: revenueAmount,
        fee: 0,
        fund_change: revenueAmount,
        source: autoCollectionSource(order, revenueAccount),
        order_id: order._id,
        note: `Tự động chuyển doanh thu đơn ${order.orderId} vào tài sản chung`,
        created_by: 'System'
      });
    }

    // Chuyển khoản đã xác nhận được ghi nhận ngay; COD vẫn chờ giao thành công.
    if (recognizesRevenue) {
      await FundTransaction.create({
        type: 'order_revenue',
        amount: revenueAmount,
        fund_change: 0,
        platform_change: revenueAmount,
        source: revenueAccount,
        order_id: order._id,
        note: `Doanh thu đơn hàng ${order.orderId}`,
        created_by: req.user?.username || 'System'
      });
    }

    // Cập nhật used_count của Coupon nếu có dùng mã giảm giá
    if (discount_code && discount_amount > 0) {
      const Coupon = require('../models/Coupon');
      await Coupon.findOneAndUpdate(
        { code: discount_code },
        { $inc: { used_count: 1 } }
      ).catch(err => console.error('[createOrder] Lỗi cập nhật used_count Coupon:', err.message));
    }

    // 3. Cập nhật kho nguyên liệu (trừ stock)
    try {
      const updatePromises = [];
      for (const [materialId, deductQty] of deductions.entries()) {
        updatePromises.push(
          (async () => {
            const mat = await Material.findById(materialId);
            if (!mat) return;

            const newStock = Number((mat.stock - deductQty).toFixed(4));
            const newActual = Number((mat.actualStock - deductQty).toFixed(4));
            const newStatus = calcStatus(newActual, mat.minStock);

            await Material.findByIdAndUpdate(materialId, {
              stock: newStock,
              actualStock: newActual,
              status: newStatus,
            });
          })()
        );
      }
      await Promise.all(updatePromises);
    } catch (deductErr) {
      // Không roll back đơn hàng, chỉ log lỗi trừ kho
      console.error('[createOrder] Lỗi khi trừ nguyên liệu:', deductErr.message);
    }
    // 6. Kích hoạt trigger auto confirm phiếu nhập (chạy ngầm)
    triggerAutoConfirmImports().catch(console.error);
    // Chỉ đến đây mới có Order thật. Với chuyển khoản, đoạn này chỉ chạy sau
    // webhook SePay xác thực; email lỗi không làm thất bại đơn hàng.
    // Complete the SMTP attempt before returning so a free host cannot suspend
    // the process while the notification is still in flight.
    await notifyNewWebsiteOrder(order);

    return res.status(201).json({ success: true, data: order, message: 'Đã tạo đơn hàng thành công' });
  } catch (error) {
    next(error);
  }
};

// PUT /api/orders/:id
exports.updateOrder = async (req, res, next) => {
  try {
    let { items, total_price, logistics_cost, source, pos_mode, customer_name, customer_phone, customer_address, custom_group, payment_method, shippingMethod, shipping_carrier, tracking_number, tracking_url, note, ordered_at, is_replacement, is_seeding, seeding_cost, discount_amount, discount_code, delivery_status, status } = req.body;

    if (!is_seeding && (!items || items.length === 0)) {
      return res.status(400).json({ success: false, message: 'Đơn hàng phải có ít nhất 1 sản phẩm' });
    }

    const oldOrder = await Order.findById(req.params.id);
    if (!oldOrder) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
    }
    if (oldOrder.custom_group) {
      return res.status(409).json({ success: false, message: 'Đơn hàng custom đã được chốt và không thể chỉnh sửa.' });
    }
    if (Array.isArray(items)) items = preserveOrderMaterials(items, oldOrder.items);
    const transitionError = trackingTransitionError(oldOrder, delivery_status);
    if (transitionError) return res.status(400).json({ success: false, message: transitionError });
    if (oldOrder.tracking_enabled && status && status !== oldOrder.status) {
      return res.status(400).json({ success: false, message: 'Hãy cập nhật đơn này bằng trạng thái giao hàng.' });
    }

    // Check the resulting channel before any inventory or accounting changes.
    if ((source || oldOrder.source) !== 'website' && discount_code) {
      const Coupon = require('../models/Coupon');
      const coupon = await Coupon.findOne({ code: discount_code });
      if (coupon && (coupon.type === 'freeship' || coupon.is_website_only)) {
        return res.status(400).json({ success: false, message: 'Mã giảm giá này chỉ áp dụng khi đặt hàng trên Website.' });
      }
    }

    // Nếu đơn hàng đã bị hoàn, chỉ cho phép cập nhật phí hoàn (return_cost) hoặc ghi chú
    if (oldOrder.status === 'returned') {
      let updated = false;
      if (req.body.return_cost !== undefined) {
        const newReturnCost = Number(req.body.return_cost);
        const oldReturnCost = oldOrder.return_cost || 0;
        
        if (newReturnCost !== oldReturnCost) {
          const FundTransaction = require('../models/FundTransaction');
          // Xóa giao dịch phí hoàn cũ
          await FundTransaction.deleteMany({
            order_id: oldOrder._id,
            note: { $regex: /Phí hoàn đơn hàng/i }
          });
          
          // Tạo giao dịch phí hoàn mới nếu > 0
          if (newReturnCost > 0) {
            const returnFundAccount = await revenueAccountForOrder(oldOrder);

            if (returnFundAccount.startsWith('carrier_') || BASE_FUND_ACCOUNTS.includes(returnFundAccount)) {
              await FundTransaction.create({
                type: 'revenue_withdrawal',
                amount: newReturnCost,
                fee: 0,
                fund_change: 0,
                source: returnFundAccount,
                order_id: oldOrder._id,
                note: `Phí hoàn đơn hàng ${oldOrder.orderId} (từ tài sản riêng)`,
                created_by: 'System'
              });
            } else {
              await FundTransaction.create({
                type: 'expense_payment',
                amount: newReturnCost,
                fee: 0,
                fund_change: -newReturnCost,
                order_id: oldOrder._id,
                note: `Phí hoàn đơn hàng ${oldOrder.orderId} (từ tài sản chung)`,
                created_by: 'System'
              });
            }
          }
          oldOrder.return_cost = newReturnCost;
          updated = true;
        }
      }
      
      if (req.body.note !== undefined && req.body.note !== oldOrder.note) {
        oldOrder.note = req.body.note;
        updated = true;
      }
      
      if (updated) {
        await oldOrder.save();
        return res.status(200).json({ success: true, message: 'Cập nhật đơn hàng hoàn thành công' });
      }
      
      return res.status(200).json({ success: true, message: 'Không có thay đổi nào được áp dụng.' });
    }

    if (discount_code) {
      const Coupon = require('../models/Coupon');
      const coupon = await Coupon.findOne({ code: discount_code });
      if (coupon?.type === 'freeship') {
        if ((source || oldOrder.source) !== 'website' || is_seeding || is_replacement) {
          return res.status(400).json({ success: false, message: 'Mã freeship áp dụng cho đơn website có phí vận chuyển.' });
        }
        discount_amount = freeshipDiscount(coupon, items, oldOrder.shipping_fee || 0);
        total_price = items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0)
          + Number(oldOrder.shipping_fee || 0) - discount_amount;
      }
    }

    const newSeedingCost = Number(seeding_cost || 0);
    const oldSeedingCost = Number(oldOrder.seeding_cost || 0);
    const newShippingCost = Number(logistics_cost || 0);
    const oldShippingCost = Number(oldOrder.logistics_cost || 0);

    const oldTotalDeduction = (oldOrder.is_seeding ? oldSeedingCost : 0) + oldShippingCost;
    const newTotalDeduction = (is_seeding ? newSeedingCost : 0) + newShippingCost;
    const delta = newTotalDeduction - oldTotalDeduction;

    // Kiểm tra số dư nếu tổng phí tăng lên
    if (delta > 0) {
      const fundAgg = await FundTransaction.aggregate([
        { $group: { _id: null, totalBalance: { $sum: '$fund_change' } } }
      ]);
      const currentFund = fundAgg.length > 0 ? fundAgg[0].totalBalance : 0;
      if (currentFund < delta) {
        return res.status(400).json({ 
          success: false, 
          code: 'INSUFFICIENT_FUND', 
          message: 'Tài sản chung không đủ để trả thêm chi phí (Ship / Seeding).',
          requiredAmount: delta - currentFund
        });
      }
    }

    // 1. Tính toán lượng nguyên liệu cũ và mới
    const oldResult = await buildMaterialDeductions(oldOrder.items, oldOrder.shippingMethod);
    const newResult = await buildMaterialDeductions(items, shippingMethod);
    
    const oldDeductions = oldResult.deductions;
    const newDeductions = newResult.deductions;
    const packagingCost = newResult.packagingCost;

    // 2. Tính sự chênh lệch (diff = new - old)
    // Nếu diff > 0 nghĩa là cần trừ thêm nguyên liệu. Nếu diff < 0 nghĩa là hoàn trả lại nguyên liệu.
    const diffDeductions = new Map();

    for (const [materialId, newQty] of newDeductions.entries()) {
      diffDeductions.set(materialId, newQty);
    }

    for (const [materialId, oldQty] of oldDeductions.entries()) {
      const currentDiff = diffDeductions.get(materialId) || 0;
      diffDeductions.set(materialId, currentDiff - oldQty);
    }

    // 3. Kiểm tra xem có đủ nguyên liệu để thêm (diff > 0) hay không
    for (const [materialId, diffQty] of diffDeductions.entries()) {
      if (diffQty > 0) {
        const mat = await Material.findById(materialId);
        if (mat && mat.actualStock < diffQty) {
          return res.status(400).json({ 
            success: false, 
            message: `Không thể cập nhật đơn hàng vì nguyên liệu "${mat.name}" không đủ (cần thêm: ${diffQty}, tồn kho: ${mat.actualStock}).` 
          });
        }
      }
    }

    // 4. Cập nhật kho nguyên liệu (trừ hoặc cộng thêm dựa trên diff)
    try {
      const updatePromises = [];
      for (const [materialId, diffQty] of diffDeductions.entries()) {
        if (diffQty === 0) continue;

        updatePromises.push(
          (async () => {
            const mat = await Material.findById(materialId);
            if (!mat) return;

            const newStock = Math.max(0, Number((mat.stock - diffQty).toFixed(4)));
            const newActual = Math.max(0, Number((mat.actualStock - diffQty).toFixed(4)));
            const newStatus = calcStatus(newActual, mat.minStock);

            await Material.findByIdAndUpdate(materialId, {
              stock: newStock,
              actualStock: newActual,
              status: newStatus,
            });
          })()
        );
      }
      await Promise.all(updatePromises);
    } catch (deductErr) {
      console.error('[updateOrder] Lỗi khi cập nhật nguyên liệu:', deductErr.message);
    }

    const resultingCustomGroup = typeof custom_group === 'string' ? custom_group.trim() : oldOrder.custom_group;
    const customOtherCost = await resolveCustomOtherCost(resultingCustomGroup, items);

    // 5. Cập nhật dữ liệu đơn hàng
    const updateData = { 
      items: items || [], 
      total_price: total_price || 0, 
      logistics_cost,
      total_excludes_logistics: (source || oldOrder.source) === 'website' ? undefined : true,
      source, 
      pos_mode, 
      customer_name, 
      customer_phone, 
      customer_address, 
      custom_group: resultingCustomGroup,
      custom_other_cost: customOtherCost,
      payment_method, 
      shippingMethod, 
      shipping_carrier: typeof shipping_carrier === 'string' ? shipping_carrier.trim() : oldOrder.shipping_carrier,
      tracking_number: typeof tracking_number === 'string' ? tracking_number.trim() : oldOrder.tracking_number,
      tracking_url: typeof tracking_url === 'string' ? tracking_url.trim() : oldOrder.tracking_url,
      packaging_cost: packagingCost, 
      note, 
      is_replacement: is_replacement || false, 
      is_seeding: is_seeding || false, 
      seeding_cost: newSeedingCost, 
      ordered_at, 
      discount_amount: discount_amount || 0, 
      discount_code: discount_code || null 
    };

    // SePay belongs only to website checkout. An admin-created transfer is
    // already confirmed by the admin and must never remain payment-pending.
    const resultingSource = source || oldOrder.source;
    const resultingPaymentMethod = payment_method || oldOrder.payment_method;
    if (resultingSource !== 'website' && resultingPaymentMethod === 'transfer') {
      updateData.payment_status = 'paid';
      updateData.paid_at = oldOrder.paid_at || new Date();
    }

    if (req.body.orderId && req.body.orderId.trim()) {
      const newOrderId = req.body.orderId.trim();
      if (newOrderId !== oldOrder.orderId) {
        const existingOrder = await Order.findOne({ 
          orderId: newOrderId, 
          _id: { $ne: oldOrder._id } 
        });
        if (existingOrder) {
          return res.status(400).json({ 
            success: false, 
            message: `Mã đơn "${newOrderId}" đã tồn tại ở một đơn hàng khác. Vui lòng kiểm tra lại.` 
          });
        }
        updateData.orderId = newOrderId;
      }
    }

    if (delivery_status) {
      // Ràng buộc: Không được huỷ nếu đã giao
      if (delivery_status === 'cancelled' && oldOrder.delivery_status !== 'cancelled') {
        if (oldOrder.delivery_status === 'shipping' || oldOrder.delivery_status === 'delivered') {
          return res.status(400).json({ 
            success: false, 
            message: 'Đơn hàng đã được giao cho đơn vị vận chuyển hoặc đã hoàn thành, không thể huỷ.' 
          });
        }

        // Hoàn lại toàn bộ nguyên liệu vào kho
        if (oldOrder.status !== 'cancelled' && oldOrder.status !== 'returned') {
          try {
            const { deductions: refunds } = await buildMaterialDeductions(oldOrder.tracking_enabled ? items : oldOrder.items, shippingMethod || oldOrder.shippingMethod);
            const updatePromises = [];
            for (const [materialId, refundQty] of refunds.entries()) {
              updatePromises.push((async () => {
                const mat = await Material.findById(materialId);
                if (!mat) return;
                const newStock = Number((mat.stock + refundQty).toFixed(4));
                const newActual = Number((mat.actualStock + refundQty).toFixed(4));
                const newMatStatus = calcStatus(newActual, mat.minStock);
                await Material.findByIdAndUpdate(materialId, {
                  stock: newStock,
                  actualStock: newActual,
                  status: newMatStatus,
                });
              })());
            }
            await Promise.all(updatePromises);
          } catch (refundErr) {
            console.error('[updateOrder] Lỗi hoàn nguyên liệu khi huỷ:', refundErr.message);
          }

          if (oldOrder.discount_code) {
            const Coupon = require('../models/Coupon');
            await Coupon.findOneAndUpdate(
              { code: oldOrder.discount_code, used_count: { $gt: 0 } },
              { $inc: { used_count: -1 } }
            ).catch(err => console.error('[updateOrder] Lỗi rollback coupon:', err.message));
          }

          await FundTransaction.deleteMany({ order_id: oldOrder._id, type: 'order_revenue' });
        }
        updateData.status = 'cancelled';
        updateData.cancelled_at = new Date();
      } else if (delivery_status === 'delivered') {
        updateData.status = 'completed';
      } else if (delivery_status === 'failed' && oldOrder.delivery_status !== 'failed') {
        const { updatedOrder } = await exports.processReturnOrder(oldOrder._id, req.body.return_cost || 0);
        return res.status(200).json({
          success: true,
          data: updatedOrder,
          message: 'Đã hoàn hàng, hoàn kho và cập nhật doanh thu.',
        });
      }
      updateData.delivery_status = delivery_status;
      if (oldOrder.tracking_enabled && ['pending', 'confirmed', 'shipping'].includes(delivery_status)) updateData.status = 'pending';
      if (oldOrder.tracking_enabled && delivery_status === 'cancelled') updateData.cancelled_reason = req.body.cancelled_reason || 'Đã huỷ theo yêu cầu';
    } else if (status) {
      updateData.status = status;
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    // Đồng bộ mã đơn trong các ghi chú giao dịch quỹ nếu orderId thay đổi
    if (updateData.orderId && updateData.orderId !== oldOrder.orderId) {
      try {
        const relatedTxs = await FundTransaction.find({ order_id: oldOrder._id });
        for (const tx of relatedTxs) {
          if (tx.note && tx.note.includes(oldOrder.orderId)) {
            tx.note = tx.note.split(oldOrder.orderId).join(updateData.orderId);
            await tx.save();
          }
        }
      } catch (txErr) {
        console.error('[updateOrder] Lỗi cập nhật orderId trong giao dịch quỹ:', txErr.message);
      }
    }

    // Xử lý FundTransaction cho seeding_payment
    if (order.is_seeding) {
      const existingTx = await FundTransaction.findOne({ order_id: order._id, type: 'seeding_payment' });
      if (newSeedingCost > 0) {
        if (existingTx) {
          existingTx.amount = newSeedingCost;
          existingTx.fund_change = -newSeedingCost;
          await existingTx.save();
        } else {
          await FundTransaction.create({
            type: 'seeding_payment',
            amount: newSeedingCost,
            fund_change: -newSeedingCost,
            order_id: order._id,
            note: `Chi phí đơn Seeding ${order.orderId}`,
            created_by: 'System'
          });
        }
      } else if (existingTx) {
        await existingTx.deleteOne(); // Xóa nếu phí về 0
      }
    } else {
      // Nếu không còn là đơn seeding, xóa seeding_payment nếu có
      await FundTransaction.deleteMany({ order_id: order._id, type: 'seeding_payment' });
    }

    // Xử lý FundTransaction cho shipping_payment
    const existingShipTx = await FundTransaction.findOne({ order_id: order._id, type: 'shipping_payment' });
    if (newShippingCost > 0) {
      if (existingShipTx) {
        existingShipTx.amount = newShippingCost;
        existingShipTx.fund_change = -newShippingCost;
        await existingShipTx.save();
      } else {
        await FundTransaction.create({
          type: 'shipping_payment',
          amount: newShippingCost,
          fund_change: -newShippingCost,
          order_id: order._id,
          note: `Phí ship đơn hàng ${order.orderId}`,
          created_by: 'System'
        });
      }
    } else if (existingShipTx) {
      await existingShipTx.deleteOne(); // Xóa nếu phí ship về 0
    }

    // Giữ quy tắc thu quỹ cũ; riêng Facebook COD có tài khoản hãng vận chuyển thì không tự thu về quỹ chung.
    const revenueAccount = await revenueAccountForOrder(order);
    const recognizesRevenue = isRecognizedOrderRevenue(order);
    const revenueAmount = orderRevenueAmount(order);
    if (recognizesRevenue && order.revenue_account !== revenueAccount) {
      order.revenue_account = revenueAccount;
      await order.save();
    }
    const isAutoFund = shouldAutoCollectToCommonFund(order, revenueAccount);
    const existingAutoTxList = await FundTransaction.find({
      order_id: order._id,
      type: 'revenue_withdrawal',
      note: /^Tự động chuyển doanh thu /,
    });
    
    if (isAutoFund && recognizesRevenue) {
      if (existingAutoTxList.length > 0) {
        const txToUpdate = existingAutoTxList[0];
        txToUpdate.amount = revenueAmount;
        txToUpdate.fund_change = revenueAmount;
        txToUpdate.source = autoCollectionSource(order, revenueAccount);
        txToUpdate.note = `Tự động chuyển doanh thu đơn ${order.orderId} vào tài sản chung`;
        await txToUpdate.save();
        
        // Xoá các tx thừa nếu có (do lỗi cũ)
        for (let i = 1; i < existingAutoTxList.length; i++) {
          await existingAutoTxList[i].deleteOne();
        }
      } else {
        await FundTransaction.create({
          type: 'revenue_withdrawal',
          amount: revenueAmount,
          fee: 0,
          fund_change: revenueAmount,
          source: autoCollectionSource(order, revenueAccount),
          order_id: order._id,
          note: `Tự động chuyển doanh thu đơn ${order.orderId} vào tài sản chung`,
          created_by: 'System'
        });
      }
    } else {
      for (const tx of existingAutoTxList) {
        await tx.deleteOne();
      }
    }

    // Xử lý FundTransaction cho order_revenue
    if (recognizesRevenue) {
      const existingRevTx = await FundTransaction.findOne({ order_id: order._id, type: 'order_revenue' });
      if (revenueAmount > 0) {
        if (existingRevTx) {
          existingRevTx.amount = revenueAmount;
          existingRevTx.platform_change = revenueAmount;
          existingRevTx.source = revenueAccount;
          await existingRevTx.save();
        } else {
          await FundTransaction.create({
            type: 'order_revenue',
            amount: revenueAmount,
            fund_change: 0,
            platform_change: revenueAmount,
            source: revenueAccount,
            order_id: order._id,
            note: `Doanh thu đơn hàng ${order.orderId}`,
            created_by: req.user?.username || 'System'
          });
        }
      } else if (existingRevTx) {
        await existingRevTx.deleteOne();
      }
    } else {
      await FundTransaction.deleteMany({ order_id: order._id, type: 'order_revenue' });
    }

    // 6. Kích hoạt trigger auto confirm phiếu nhập (chạy ngầm)
    triggerAutoConfirmImports().catch(console.error);

    res.status(200).json({ success: true, data: order, message: 'Đã cập nhật đơn hàng' });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/orders/:id
exports.deleteOrder = async (req, res, next) => {
  let session;
  try {
    const { restoreStock } = req.query;
    session = await Order.startSession();
    let order;
    let alreadyRefunded = false;
    await session.withTransaction(async () => {
      order = await Order.findById(req.params.id).session(session);
      if (!order) return;
      if (order.custom_group) {
        const error = new Error('Đơn hàng custom đã được chốt và không thể xóa.');
        error.statusCode = 409;
        throw error;
      }
      alreadyRefunded = ['returned', 'cancelled'].includes(order.status)
        || ['failed', 'cancelled'].includes(order.delivery_status);

      // Keep the order, ledger cleanup and optional stock refund in one commit.
      // A failure must not leave financial entries pointing at a deleted order.
      await Order.deleteOne({ _id: order._id }, { session });
      await FundTransaction.deleteMany({
        order_id: order._id,
        $or: [
          { type: { $in: ['order_revenue', 'seeding_payment', 'shipping_payment'] } },
          { type: 'revenue_withdrawal', note: /^Tự động chuyển doanh thu / },
        ],
      }, { session });

      if (restoreStock === 'true' && !alreadyRefunded) {
        const { deductions: refunds } = await buildMaterialDeductions(order.items, order.shippingMethod, session);
        for (const [materialId, refundQty] of refunds.entries()) {
          const mat = await Material.findById(materialId).session(session);
          if (!mat) continue;
          const newStock = Number((mat.stock + refundQty).toFixed(4));
          const newActual = Number((mat.actualStock + refundQty).toFixed(4));
          await Material.findByIdAndUpdate(materialId, {
            stock: newStock, actualStock: newActual,
            status: calcStatus(newActual, mat.minStock),
          }, { session });
        }
      }
    });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
    }
    const msg = alreadyRefunded
      ? 'Đã xóa đơn hàng (nguyên liệu đã được hoàn trước đó)'
      : 'Đã xóa đơn hàng' + (restoreStock === 'true' ? ' và hoàn lại nguyên liệu' : '');
    res.status(200).json({ success: true, message: msg });
  } catch (error) {
    next(error);
  } finally { if (session) await session.endSession(); }
};

exports.markOrderReturning = async (orderId) => {
  const session = await Order.startSession();
  let updatedOrder;
  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new Error('Không tìm thấy đơn hàng');
      if (['returned', 'cancelled'].includes(order.status)
        || ['returned', 'cancelled'].includes(order.delivery_status)) {
        updatedOrder = order;
        return;
      }

      await FundTransaction.deleteMany({
        order_id: order._id,
        $or: [
          { type: 'order_revenue' },
          { type: 'revenue_withdrawal', note: /^Tự động chuyển doanh thu / },
        ],
      }, { session });
      order.delivery_status = 'returning';
      await order.save({ session });
      updatedOrder = order;
    });
    return updatedOrder;
  } finally {
    await session.endSession();
  }
};

exports.processReturnOrder = async (orderId, explicitReturnCost = null) => {
  const SystemConfig = require('../models/SystemConfig');
  const FundTransaction = require('../models/FundTransaction');
  const Coupon = require('../models/Coupon');
  const session = await Order.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new Error('Không tìm thấy đơn hàng');
      if (order.status === 'returned' || order.delivery_status === 'returned') {
        throw new Error('Đơn hàng này đã được đánh dấu bị hoàn trước đó');
      }
      if (order.status === 'cancelled' || order.delivery_status === 'cancelled') {
        throw new Error('Đơn đã huỷ và hoàn kho trước đó, không thể hoàn lần hai');
      }

      let returnCost = 0;
      if (explicitReturnCost !== null && explicitReturnCost !== undefined) {
        returnCost = Number(explicitReturnCost);
      } else {
        const returnCostConfig = await SystemConfig.findOne({ key: 'return_cost_per_platform' }).session(session);
        let returnCosts = {};
        if (returnCostConfig?.value) {
          try { returnCosts = JSON.parse(returnCostConfig.value); } catch {}
        }
        returnCost = Number(returnCosts[order.source || 'khác'] || 0);
      }
      if (!Number.isFinite(returnCost) || returnCost < 0) throw new Error('Chi phí hoàn không hợp lệ');

      // Chỉ hoàn nguyên liệu thuộc sản phẩm; bao bì vận chuyển đã sử dụng không được hoàn.
      const { deductions: refunds } = await buildMaterialDeductions(order.items, null, session);
      for (const [materialId, refundQty] of refunds.entries()) {
        const mat = await Material.findById(materialId).session(session);
        if (!mat) throw new Error(`Không tìm thấy nguyên liệu ${materialId} để hoàn kho`);
        const newStock = Number((Number(mat.stock || 0) + refundQty).toFixed(4));
        const currentActual = mat.actualStock == null ? Number(mat.stock || 0) : Number(mat.actualStock);
        const newActual = Number((currentActual + refundQty).toFixed(4));
        await Material.findByIdAndUpdate(materialId, {
          stock: newStock,
          actualStock: newActual,
          status: calcStatus(newActual, mat.minStock),
        }, { session });
      }

      if (order.discount_code) {
        await Coupon.findOneAndUpdate(
          { code: order.discount_code, used_count: { $gt: 0 } },
          { $inc: { used_count: -1 } },
          { session }
        );
      }

      // Đơn hoàn không còn tạo doanh thu. Xóa cả dòng doanh thu hiển thị và
      // giao dịch tự động chuyển vào tài sản chung; các lần rút tiền thật vẫn giữ lại.
      await FundTransaction.deleteMany({
        order_id: order._id,
        $or: [
          { type: 'order_revenue' },
          { type: 'revenue_withdrawal', note: /^Tự động chuyển doanh thu / },
        ],
      }, { session });

      order.status = 'returned';
      order.delivery_status = 'returned';
      // Paid returns still require a real transfer back to the customer.
      // Unpaid/COD returns must no longer appear as awaiting payment.
      order.payment_status = returnedPaymentStatus(order.payment_status);
      order.return_cost = returnCost;
      order.returned_at = new Date();
      await order.save({ session });

      if (returnCost > 0) {
        const returnFundAccount = await revenueAccountForOrder(order);
        if (returnFundAccount.startsWith('carrier_') || BASE_FUND_ACCOUNTS.includes(returnFundAccount)) {
          await FundTransaction.create([{
            type: 'revenue_withdrawal', amount: returnCost, fee: 0, fund_change: 0,
            source: returnFundAccount, order_id: order._id,
            note: `Phí hoàn đơn hàng ${order.orderId} (từ tài sản riêng)`, created_by: 'System',
          }], { session });
        } else {
          await FundTransaction.create([{
            type: 'expense_payment', amount: returnCost, fee: 0, fund_change: -returnCost,
            order_id: order._id, note: `Phí hoàn đơn hàng ${order.orderId} (từ tài sản chung)`,
            created_by: 'System',
          }], { session });
        }
      }

      result = { updatedOrder: order, returnCost };
    });
    return result;
  } finally {
    await session.endSession();
  }
};

// PATCH /api/orders/:id/return
exports.markAsReturned = async (req, res, next) => {
  try {
    let explicitReturnCost = null;
    if (req.body && req.body.returnCost !== undefined && req.body.returnCost !== null) {
      explicitReturnCost = req.body.returnCost;
    }
    const { updatedOrder, returnCost } = await exports.processReturnOrder(req.params.id, explicitReturnCost);

    res.status(200).json({
      success: true,
      data: updatedOrder,
      message: `Đã đánh dấu đơn hàng bị hoàn. Chi phí hoàn: ${returnCost.toLocaleString('vi-VN')}đ`,
    });
  } catch (error) {
    if (error.message === 'Không tìm thấy đơn hàng') {
      return res.status(404).json({ success: false, message: error.message });
    }
    if ([
      'Đơn hàng này đã được đánh dấu bị hoàn trước đó',
      'Đơn đã huỷ và hoàn kho trước đó, không thể hoàn lần hai',
      'Chi phí hoàn không hợp lệ',
    ].includes(error.message)) {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
};

exports.buildMaterialDeductions = buildMaterialDeductions;
exports.orderRevenueAmount = orderRevenueAmount;
exports.prepareCustomOrderSnapshot = prepareCustomOrderSnapshot;

// PATCH /api/orders/:id/delivery-status
exports.updateDeliveryStatus = async (req, res, next) => {
  try {
    const { delivery_status, cancelled_reason, return_cost, orderId, logistics_cost, shipping_carrier, tracking_number, tracking_url } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
    }
    if (delivery_status && delivery_status !== order.delivery_status && ['returned', 'cancelled'].includes(order.status)) {
      return res.status(400).json({ success: false, message: 'Đơn đã hoàn hoặc huỷ không thể đổi trạng thái giao hàng vì nguyên liệu đã được hoàn kho.' });
    }
    const transitionError = trackingTransitionError(order, delivery_status);
    if (transitionError) return res.status(400).json({ success: false, message: transitionError });

    if (typeof shipping_carrier === 'string') order.shipping_carrier = shipping_carrier.trim();
    if (typeof tracking_number === 'string') order.tracking_number = tracking_number.trim();
    if (typeof tracking_url === 'string') order.tracking_url = tracking_url.trim();

    // Nếu có cập nhật orderId mới từ app giao vận bên ngoài
    if (orderId && orderId.trim() && orderId.trim() !== order.orderId) {
      const newOrderId = orderId.trim();
      const existing = await Order.findOne({ orderId: newOrderId, _id: { $ne: order._id } });
      if (existing) {
        return res.status(400).json({ 
          success: false, 
          message: `Mã đơn "${newOrderId}" đã tồn tại ở đơn hàng khác.` 
        });
      }
      const oldOrderId = order.orderId;
      order.orderId = newOrderId;

      try {
        const relatedTxs = await FundTransaction.find({ order_id: order._id });
        for (const tx of relatedTxs) {
          if (tx.note && tx.note.includes(oldOrderId)) {
            tx.note = tx.note.split(oldOrderId).join(newOrderId);
            await tx.save();
          }
        }
      } catch (txErr) {
        console.error('[updateDeliveryStatus] Lỗi sync orderId sang FundTransaction:', txErr.message);
      }
    }

    // Nếu có cập nhật phí ship thực tế mà shop phải chịu
    if (logistics_cost !== undefined) {
      const newShipCost = Number(logistics_cost || 0);
      order.logistics_cost = newShipCost;

      const existingShipTx = await FundTransaction.findOne({ order_id: order._id, type: 'shipping_payment' });
      if (newShipCost > 0) {
        if (existingShipTx) {
          existingShipTx.amount = newShipCost;
          existingShipTx.fund_change = -newShipCost;
          existingShipTx.note = `Phí ship đơn hàng ${order.orderId}`;
          await existingShipTx.save();
        } else {
          await FundTransaction.create({
            type: 'shipping_payment',
            amount: newShipCost,
            fund_change: -newShipCost,
            order_id: order._id,
            note: `Phí ship đơn hàng ${order.orderId}`,
            created_by: req.user?.username || 'System'
          });
        }
      } else if (existingShipTx) {
        await existingShipTx.deleteOne();
      }
    }

    const oldStatus = order.delivery_status || 'pending';
    const newStatus = delivery_status;

    if (!newStatus) {
      await order.save();
      return res.status(200).json({ success: true, data: order, message: 'Đã cập nhật thông tin vận chuyển thành công' });
    }

    // 1. Kiểm tra ràng buộc huỷ: Chỉ được huỷ khi chưa giao (pending hoặc confirmed)
    if (newStatus === 'cancelled') {
      if (oldStatus === 'shipping' || oldStatus === 'delivered') {
        return res.status(400).json({ 
          success: false, 
          message: 'Đơn hàng đã được giao cho đơn vị vận chuyển hoặc đã giao thành công, không thể huỷ.' 
        });
      }

      // Hoàn lại nguyên liệu vào kho nếu đơn chưa bị huỷ/hoàn trước đó
      if (order.status !== 'cancelled' && order.status !== 'returned') {
        try {
          const { deductions: refunds } = await buildMaterialDeductions(order.items, order.shippingMethod);
          const updatePromises = [];
          for (const [materialId, refundQty] of refunds.entries()) {
            updatePromises.push((async () => {
              const mat = await Material.findById(materialId);
              if (!mat) return;
              const newStock = Number((mat.stock + refundQty).toFixed(4));
              const newActual = Number((mat.actualStock + refundQty).toFixed(4));
              const newMatStatus = calcStatus(newActual, mat.minStock);
              await Material.findByIdAndUpdate(materialId, {
                stock: newStock,
                actualStock: newActual,
                status: newMatStatus,
              });
            })());
          }
          await Promise.all(updatePromises);
        } catch (refundErr) {
          console.error('[updateDeliveryStatus] Lỗi hoàn nguyên liệu khi huỷ:', refundErr.message);
        }

        // Hoàn lại lượt coupon nếu có dùng
        if (order.discount_code) {
          const Coupon = require('../models/Coupon');
          await Coupon.findOneAndUpdate(
            { code: order.discount_code, used_count: { $gt: 0 } },
            { $inc: { used_count: -1 } }
          ).catch(err => console.error('[updateDeliveryStatus] Lỗi rollback coupon:', err.message));
        }

        // Đảo toàn bộ phần tiền đã ghi nhận sớm của đơn chuyển khoản.
        await FundTransaction.deleteMany({
          order_id: order._id,
          $or: [
            { type: 'order_revenue' },
            { type: 'revenue_withdrawal', note: /^Tự động chuyển doanh thu / },
          ],
        });
      }

      order.delivery_status = 'cancelled';
      order.status = 'cancelled';
      order.cancelled_at = new Date();
      order.cancelled_reason = cancelled_reason || 'Đã huỷ theo yêu cầu';
      await order.save();

      return res.status(200).json({ 
        success: true, 
        data: order, 
        message: 'Đã chuyển trạng thái sang Đã huỷ và hoàn trả nguyên liệu vào kho.' 
      });
    }

    // 2. Chuyển sang Giao thành công (delivered)
    if (newStatus === 'delivered') {
      order.delivery_status = 'delivered';
      order.status = 'completed';
      order.revenue_account = await revenueAccountForOrder(order);
      await order.save();
      const revenueAmount = orderRevenueAmount(order);

      // Ghi nhận doanh thu nền tảng nếu chưa có
      if (revenueAmount > 0) {
        const revenueAccount = await revenueAccountForOrder(order);
        const existingRevTx = await FundTransaction.findOne({ order_id: order._id, type: 'order_revenue' });
        if (existingRevTx) {
          existingRevTx.amount = revenueAmount;
          existingRevTx.platform_change = revenueAmount;
          existingRevTx.source = revenueAccount;
          await existingRevTx.save();
        } else {
          await FundTransaction.create({
            type: 'order_revenue',
            amount: revenueAmount,
            fund_change: 0,
            platform_change: revenueAmount,
            source: revenueAccount,
            order_id: order._id,
            note: `Doanh thu đơn hàng ${order.orderId} (Giao thành công)`,
            created_by: req.user?.username || 'Admin'
          });
        }
      }

      // COD được ghi tiền khi giao thành công; chuyển khoản có thể đã được ghi
      // trước đó và truy vấn existingCollection bên dưới ngăn cộng hai lần.
      const revenueAccount = await revenueAccountForOrder(order);
      const collectToFund = shouldAutoCollectToCommonFund(order, revenueAccount) && revenueAmount > 0;
      if (collectToFund) {
        const existingCollection = await FundTransaction.findOne({
          order_id: order._id,
          type: 'revenue_withdrawal',
          note: /^Tự động chuyển doanh thu /,
        });
        if (!existingCollection) await FundTransaction.create({
          type: 'revenue_withdrawal', amount: revenueAmount, fee: 0,
          fund_change: revenueAmount, source: autoCollectionSource(order, revenueAccount), order_id: order._id,
          note: `Tự động chuyển doanh thu đơn ${order.orderId} vào tài sản chung`,
          created_by: req.user?.username || 'Admin',
        });
      }

      return res.status(200).json({ 
        success: true, 
        data: order, 
        message: 'Đã cập nhật: Giao thành công và ghi nhận doanh thu.' 
      });
    }

    // 3. Đơn bắt đầu chuyển hoàn: loại khỏi doanh thu nhưng chưa hoàn kho.
    if (newStatus === 'returning') {
      const updatedOrder = await exports.markOrderReturning(order._id);
      return res.status(200).json({
        success: true,
        data: updatedOrder,
        message: 'Đã cập nhật trạng thái đang hoàn hàng.',
      });
    }

    // 4. Giao thất bại/đã hoàn: kho, coupon và tài chính phải cùng thành công.
    if (newStatus === 'failed' || newStatus === 'returned') {
      const { updatedOrder } = await exports.processReturnOrder(order._id, return_cost);
      return res.status(200).json({
        success: true,
        data: updatedOrder,
        message: 'Đã hoàn hàng, hoàn kho và cập nhật doanh thu.',
      });
    }

    // 5. Các trạng thái khác (pending, confirmed, shipping)
    order.delivery_status = newStatus;
    if (newStatus === 'pending' || newStatus === 'confirmed' || newStatus === 'shipping') {
      order.status = 'pending';
    }
    await order.save();

    const statusLabels = {
      pending: 'Chờ xác nhận',
      confirmed: 'Đã chấp nhận',
      shipping: 'Đang giao hàng'
    };

    return res.status(200).json({ 
      success: true, 
      data: order, 
      message: `Đã cập nhật trạng thái: ${statusLabels[newStatus] || newStatus}` 
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/shop/orders (Dành cho khách hàng xem lịch sử đơn)
exports.getShopOrders = async (req, res, next) => {
  try {
    const userId = req.user?._id || req.query.user_id;
    const phone = req.query.phone;
    const orderId = req.query.orderId;

    const query = {};
    if (userId) {
      query.$or = [{ user_id: userId }];
      if (phone) query.$or.push({ customer_phone: phone });
    } else if (phone) {
      query.customer_phone = phone;
    } else if (orderId) {
      query.orderId = orderId;
    } else {
      return res.status(200).json({ success: true, data: [] });
    }

    const orders = await Order.find(query)
      .select('+tracking_token -items.material_overrides -items.materials_key -pancake_details')
      .sort({ ordered_at: -1 });

    const customerOrders = orders.map((order) => {
      const publicOrder = order.toObject();
      publicOrder.tracking_path = order.source !== 'website' && order.tracking_enabled && order.tracking_token
        ? trackingPath(order.tracking_token)
        : null;
      delete publicOrder.tracking_token;
      return publicOrder;
    });

    res.status(200).json({ success: true, data: customerOrders });
  } catch (error) {
    next(error);
  }
};

// GET /api/shop/orders/:id (Chi tiết đơn hàng cho khách xem)
exports.getShopOrderById = async (req, res, next) => {
  try {
    const id = req.params.id;
    const mongoose = require('mongoose');
    const order = await Order.findOne({
      $or: [
        { orderId: id },
        ...(mongoose.isValidObjectId(id) ? [{ _id: id }] : [])
      ]
    }).select('-items.material_overrides -items.materials_key -pancake_details');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
    }
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/orders/:id/refund
// Chỉ ghi nhận hoàn tiền sau khi quản trị viên đã chuyển tiền thật cho khách.
exports.markAsRefunded = async (req, res, next) => {
  try {
    const refundTransactionId = String(req.body?.refund_transaction_id || '').trim();
    if (refundTransactionId.length < 3 || refundTransactionId.length > 120) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập mã giao dịch hoàn tiền (từ 3 đến 120 ký tự).'
      });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
    }

    if (['shopee', 'tiktok'].includes(order.source)) {
      return res.status(400).json({
        success: false,
        message: 'Đơn sàn được hoàn tiền và đối soát trực tiếp trên sàn, không ghi nhận hoàn tiền thủ công tại đây.'
      });
    }

    const isPaidTransfer = order.payment_method === 'transfer'
      && ['paid', 'refund_pending'].includes(order.payment_status);
    if (!isPaidTransfer) {
      return res.status(400).json({
        success: false,
        message: 'Chỉ có thể hoàn tiền cho đơn chuyển khoản đã thanh toán.'
      });
    }

    if (!canRecordRefund(order)) {
      return res.status(400).json({
        success: false,
        message: 'Hãy huỷ hoặc hoàn đơn trước khi xác nhận đã hoàn tiền.'
      });
    }

    order.payment_status = 'refunded';
    order.refund_transaction_id = refundTransactionId;
    order.refunded_at = new Date();
    await order.save();

    return res.status(200).json({
      success: true,
      data: order,
      message: 'Đã ghi nhận hoàn tiền cho khách.'
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/shop/orders/:id/cancel (Khách tự huỷ đơn nếu chưa giao)
exports.cancelShopOrder = async (req, res, next) => {
  try {
    const id = req.params.id;
    const { reason } = req.body;
    const mongoose = require('mongoose');
    const order = await Order.findOne({
      $or: [
        { orderId: id },
        ...(mongoose.isValidObjectId(id) ? [{ _id: id }] : [])
      ]
    }).select('-pancake_details');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
    }

    // Tiền đã vào tài khoản thật thì khách không thể tự huỷ để tránh hoàn
    // kho/coupon nhưng chưa có thao tác hoàn tiền cho khách.
    if (order.payment_method === 'transfer' && order.payment_status === 'paid') {
      return res.status(409).json({
        success: false,
        code: 'PAID_TRANSFER_REQUIRES_REFUND_APPROVAL',
        message: 'Đơn đã thanh toán bằng chuyển khoản. Vui lòng liên hệ shop để yêu cầu huỷ và hoàn tiền.'
      });
    }

    if (order.delivery_status === 'shipping' || order.delivery_status === 'delivered') {
      return res.status(400).json({ 
        success: false, 
        message: 'Đơn hàng đã được bàn giao cho đơn vị vận chuyển hoặc đã hoàn tất, không thể huỷ đơn.' 
      });
    }

    if (order.delivery_status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Đơn hàng này đã được huỷ trước đó.' });
    }

    // Hoàn lại nguyên liệu vào kho
    try {
      const { deductions: refunds } = await buildMaterialDeductions(order.items, order.shippingMethod);
      const updatePromises = [];
      for (const [materialId, refundQty] of refunds.entries()) {
        updatePromises.push((async () => {
          const mat = await Material.findById(materialId);
          if (!mat) return;
          const newStock = Number((mat.stock + refundQty).toFixed(4));
          const newActual = Number((mat.actualStock + refundQty).toFixed(4));
          const newMatStatus = calcStatus(newActual, mat.minStock);
          await Material.findByIdAndUpdate(materialId, {
            stock: newStock,
            actualStock: newActual,
            status: newMatStatus,
          });
        })());
      }
      await Promise.all(updatePromises);
    } catch (refundErr) {
      console.error('[cancelShopOrder] Lỗi hoàn nguyên liệu:', refundErr.message);
    }

    // Hoàn lại coupon nếu có
    if (order.discount_code) {
      const Coupon = require('../models/Coupon');
      await Coupon.findOneAndUpdate(
        { code: order.discount_code, used_count: { $gt: 0 } },
        { $inc: { used_count: -1 } }
      ).catch(err => console.error('[cancelShopOrder] Lỗi rollback coupon:', err.message));
    }

    order.delivery_status = 'cancelled';
    order.status = 'cancelled';
    order.cancelled_at = new Date();
    order.cancelled_reason = reason || 'Khách hàng yêu cầu huỷ đơn';
    await order.save();

    res.status(200).json({ success: true, data: order, message: 'Đã huỷ đơn hàng thành công' });
  } catch (error) {
    next(error);
  }
};
