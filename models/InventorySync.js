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
        required: true,
        min: 0
      },
      actual_stock: {
        type: Number,
        required: true,
        min: 0
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

// Auto-generate code before saving
inventorySyncSchema.pre('validate', async function (next) {
  if (!this.code) {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
    const count = await mongoose.model('InventorySync').countDocuments({
      createdAt: {
        $gte: new Date(today.setHours(0, 0, 0, 0)),
        $lt: new Date(today.setHours(23, 59, 59, 999))
      }
    });
    this.code = `SYNC${dateStr}${(count + 1).toString().padStart(3, '0')}`;
  }
  next();
});

module.exports = mongoose.model('InventorySync', inventorySyncSchema);
