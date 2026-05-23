const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  productId: { type: String, required: true },
  name: { type: String, required: true },
  image: { type: String, default: null },
  description: { type: String, default: '' },
  base_price: { type: Number, default: 0 },

  base_ingredients: [{
    ingredient_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
    quantity: { type: Number, required: true, min: 0 }
  }],

  variant_groups: [{
    id: { type: String, required: true }, // e.g. "g1"
    name: { type: String, required: true }, // e.g. "Mùi Hương"
    options: [{
      id: { type: String, required: true }, // e.g. "g1-RBY"
      label: { type: String, required: true } // e.g. "Rosy Berry"
    }]
  }],

  skus: [{
    id: { type: String, required: true }, // e.g. "SP-1054537"
    price: { type: Number, default: 0 }, // Selling price for this specific SKU
    combination: [{ type: String }], // Array of option ids, e.g. ["g1-RBY", "g2-LRG"]
    extra_ingredients: [{
      ingredient_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
      quantity: { type: Number, required: true, min: 0 }
    }]
  }]
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);
