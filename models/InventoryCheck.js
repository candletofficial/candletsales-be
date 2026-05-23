const mongoose = require('mongoose');

const inventoryCheckSchema = new mongoose.Schema({
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
      difference: {
        type: Number,
        required: true
      }
    }
  ],
  note: {
    type: String,
    trim: true
  },
  checked_by: {
    type: String,
    required: true,
    default: 'Admin'
  },
  status: {
    type: String,
    enum: ['completed'],
    default: 'completed'
  }
}, { timestamps: true });

// Auto generate code before save if not provided
inventoryCheckSchema.pre('validate', async function(next) {
  if (!this.code) {
    const today = new Date();
    const dateStr = today.getFullYear().toString() + 
                    (today.getMonth() + 1).toString().padStart(2, '0') + 
                    today.getDate().toString().padStart(2, '0');
    
    // Tìm phiếu gần nhất trong ngày
    const lastCheck = await this.constructor.findOne(
      { code: new RegExp(`^KK-${dateStr}-`) },
      { code: 1 },
      { sort: { code: -1 } }
    );
    
    let sequence = 1;
    if (lastCheck && lastCheck.code) {
      const lastSeq = parseInt(lastCheck.code.split('-')[2]);
      if (!isNaN(lastSeq)) {
        sequence = lastSeq + 1;
      }
    }
    
    this.code = `KK-${dateStr}-${sequence.toString().padStart(2, '0')}`;
  }
  next();
});

module.exports = mongoose.model('InventoryCheck', inventoryCheckSchema);
