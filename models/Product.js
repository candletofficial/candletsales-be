const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  productId: { type: String, required: true },
  name: { type: String, required: true },
  product_type: {
    type: String,
    enum: ['sellable', 'sub_formula', 'custom'],
    default: 'sellable',
    index: true,
  },
  custom_group: {
    type: String,
    trim: true,
    default: '',
    index: true,
    description: 'Nhóm đại diện cho một đơn/dự án custom của khách hàng.',
  },
  custom_quantity: {
    type: Number,
    min: 1,
    default: 1,
    description: 'Số lượng sản phẩm mặc định trong nhóm custom.',
  },
  custom_discount_type: { type: String, enum: ['none', 'percent', 'fixed'], default: 'none' },
  custom_discount_value: { type: Number, min: 0, default: 0 },
  custom_other_cost: { type: Number, min: 0, default: 0 },
  custom_locked_at: { type: Date, default: null },
  custom_order_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  batch_yield: {
    type: Number,
    default: 1,
    min: 1,
    description: 'Số sản phẩm/phần thành phẩm thu được từ một mẻ công thức phụ.',
  },
  image: { type: String, default: null }, // Main/Thumbnail
  images: [{ type: String }], // Gallery
  description: { type: String, default: '' },
  base_price: { type: Number, default: 0 },
  original_price: { type: Number, default: 0 },
  tag: { type: String, default: '' },
  tag_color: { type: String, default: '' },
  shop_order: { type: Number, default: null, min: 1 },
  
  // Filtering fields
  scent_group: { type: String, default: null },
  category: { type: String, default: 'Nến Hũ Đơn' },
  volume: { type: String, default: '200g (~50 giờ đốt)' },
  wax_type: [{ type: String }],
  wick_type: [{ type: String }],

  base_ingredients: [{
    ingredient_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
    quantity: { type: Number, required: true, min: 0 },
    suspended: { type: Boolean, default: false },
    replacement_for: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', default: null }
  }],

  // Cost-only items used by custom products. They are intentionally not linked
  // to Material, so they never participate in stock checks or deductions.
  custom_cost_items: [{
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0.0001 },
    unit: { type: String, trim: true, default: '' },
    unit_cost: { type: Number, required: true, min: 0 },
    _id: false,
  }],

  // Công thức phụ được gắn theo số mẻ. Mỗi mẻ sẽ được bung thành nguyên liệu
  // thực tế trong resolved_base_ingredients để tính giá vốn và trừ kho.
  formula_components: [{
    formula_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 0.0001, default: 1 }
  }],
  resolved_base_ingredients: [{
    ingredient_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
    quantity: { type: Number, required: true, min: 0 },
    suspended: { type: Boolean, default: false },
    replacement_for: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', default: null }
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
    image: { type: String, default: '' }, // Optional image linked to this variant
    combination: [{ type: String }], // Array of option ids, e.g. ["g1-RBY", "g2-LRG"]
    extra_ingredients: [{
      ingredient_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
      quantity: { type: Number, required: true, min: 0 },
      suspended: { type: Boolean, default: false },
      replacement_for: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', default: null }
    }]
  }]
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);
