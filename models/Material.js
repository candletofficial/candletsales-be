const mongoose = require('mongoose');

const materialSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  sku: {
    type: String,
    required: true,
    unique: true,
  },
  unit: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  supplier: {
    type: String,
    required: true,
  },
  stock: {
    type: Number,
    required: true,
    default: 0,
  },
  minStock: {
    type: Number,
    required: true,
    min: 0,
    default: 10,
  },
  status: {
    type: String,
    enum: ['in_stock', 'low_stock', 'out_of_stock'],
    default: 'in_stock',
  },
  actualStock: {
    type: Number,
    default: function() {
      return this.stock;
    },
    description: 'Tồn kho thực tế khi kiểm kho. Mặc định bằng số lượng tồn kho ban đầu.',
  },
}, { timestamps: true });

// Tự động tính toán trạng thái trước khi lưu (chỉ dùng actualStock vs minStock)
materialSchema.pre('save', function (next) {
  const actualStock = Number(this.actualStock);
  const minStock = Number(this.minStock);
  if (actualStock === 0) {
    this.status = 'out_of_stock';
  } else if (actualStock <= minStock) {
    this.status = 'low_stock';
  } else {
    this.status = 'in_stock';
  }
  next();
});

module.exports = mongoose.model('Material', materialSchema);
