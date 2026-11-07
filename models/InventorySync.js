const mongoose = require('mongoose');

const inventorySyncSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true
  },
  items: [
    {
      material_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Material',
        required: true
      },
      system_stock: {
        type: Number,
        required: true
      },
      actual_stock: {
        type: Number,
        required: true
      },
      price: {
        type: Number,
        required: true,
        default: 0
      },
      difference: {
        type: Number,
        required: true
      }
    }
  ],
  total_discrepancy_value: {
    type: Number,
    required: true,
    default: 0
  },
  note: {
    type: String,
    trim: true
  },
  synced_by: {
    type: String,
    required: true,
    default: 'Admin'
  }
}, {
  timestamps: true
});

// Tạo mã theo số thứ tự lớn nhất để không bị trùng khi lịch sử từng bị xóa.
inventorySyncSchema.pre('validate', async function (next) {
  if (!this.code) {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
    const prefix = `SYNC${dateStr}`;
    const latestSync = await mongoose.model('InventorySync')
      .findOne({ code: new RegExp(`^${prefix}\\d+$`) }, { code: 1 })
      .sort({ code: -1 })
      .lean();
    const latestSequence = Number(latestSync?.code?.slice(prefix.length)) || 0;
    this.code = `${prefix}${String(latestSequence + 1).padStart(3, '0')}`;
  }
  next();
});

module.exports = mongoose.model('InventorySync', inventorySyncSchema);
