const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const errorHandler = require('./middlewares/errorHandler');

const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const materialRoutes = require('./routes/materialRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const adCostRoutes = require('./routes/adCostRoutes');
const importRoutes = require('./routes/importRoutes');
const inventoryCheckRoutes = require('./routes/inventoryCheckRoutes');
const shippingConfigRoutes = require('./routes/shippingConfigRoutes');
const systemConfigRoutes = require('./routes/systemConfigRoutes');
const couponRoutes = require('./routes/couponRoutes');
const app = express();

// ── Middlewares ──────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ── Routes ───────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/ad-costs', adCostRoutes);
app.use('/api/imports', importRoutes);
app.use('/api/inventory-checks', inventoryCheckRoutes);
app.use('/api/shipping-config', shippingConfigRoutes);
app.use('/api/system-configs', systemConfigRoutes);
app.use('/api/coupons', couponRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({ success: true, message: '🕯️ Candlet Sales Admin API is running!' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} không tồn tại` });
});

// ── Error Handler (phải đặt cuối cùng) ──────────────────────────
app.use(errorHandler);

module.exports = app;
