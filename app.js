const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const errorHandler = require('./middlewares/errorHandler');

const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const materialRoutes = require('./routes/materialRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const adCostRoutes = require('./routes/adCostRoutes');
const importRoutes = require('./routes/importRoutes');
const inventoryCheckRoutes = require('./routes/inventoryCheckRoutes');
const inventorySyncRoutes = require('./routes/inventorySyncRoutes');
const shippingConfigRoutes = require('./routes/shippingConfigRoutes');
const systemConfigRoutes = require('./routes/systemConfigRoutes');
const couponRoutes = require('./routes/couponRoutes');
const fundRoutes = require('./routes/fundRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const aiRoutes = require('./routes/aiRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const shopRoutes = require('./routes/shopRoutes');
const cartRoutes = require('./routes/cartRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const postRoutes = require('./routes/postRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const sepayRoutes = require('./routes/sepayRoutes');
const app = express();

const configuredOrigins = String(process.env.CLIENT_URL || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;

  const normalizedOrigin = origin.replace(/\/$/, '');
  if (configuredOrigins.includes(normalizedOrigin)) return true;

  return process.env.NODE_ENV !== 'production'
    && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalizedOrigin);
};

// ── Middlewares ──────────────────────────────────────────────────
app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }

    const error = new Error('Origin is not allowed by CORS');
    error.statusCode = 403;
    callback(error);
  },
  credentials: true,
}));
// Must be registered before express.json(): SePay signs the unmodified body.
app.use('/api/sepay', sepayRoutes);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Phục vụ tệp tĩnh tải lên (ảnh sản phẩm, v.v.)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ── Routes ───────────────────────────────────────────────────────
app.use('/api/upload', uploadRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/ad-costs', adCostRoutes);
app.use('/api/imports', importRoutes);
app.use('/api/inventory-checks', inventoryCheckRoutes);
app.use('/api/inventory-syncs', inventorySyncRoutes);
app.use('/api/shipping-config', shippingConfigRoutes);
app.use('/api/system-configs', systemConfigRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/funds', fundRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api', postRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({ success: true, message: '🕯️ CandletShop Admin API is running!' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} không tồn tại` });
});

// ── Error Handler (phải đặt cuối cùng) ──────────────────────────
app.use(errorHandler);

module.exports = app;
