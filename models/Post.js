const mongoose = require('mongoose');

const postSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Vui lòng nhập tiêu đề bài viết'],
      trim: true,
      maxlength: [200, 'Tiêu đề không được vượt quá 200 ký tự'],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    summary: {
      type: String,
      required: [true, 'Vui lòng nhập phần tóm tắt bài viết'],
      trim: true,
      maxlength: [500, 'Tóm tắt không được vượt quá 500 ký tự'],
    },
    thumbnail: {
      type: String,
      default: '',
    },
    category: {
      type: String,
      required: [true, 'Vui lòng chọn danh mục bài viết'],
      default: 'Nghệ Thuật Mùi Hương',
      enum: [
        'Nghệ Thuật Mùi Hương',
        'Chữa Lành & Cảm Xúc',
        'Liệu Pháp Thơm (Aromatherapy)',
        'Phong Cách Sống & Không Gian',
        'Hậu Trường Chế Tác',
      ],
    },
    author: {
      type: String,
      default: 'Nghệ nhân Candlet',
    },
    readTime: {
      type: String,
      default: '5 phút đọc',
    },
    content: {
      type: String,
      required: [true, 'Vui lòng nhập nội dung bài viết'],
    },
    // Tùy chỉnh sâu phong cách hiển thị bài viết (Custom Design & Deep Options)
    customDesign: {
      themeColor: {
        type: String,
        default: '#4A2C2A', // Màu điểm nhấn (Accent color)
      },
      fontStyle: {
        type: String,
        default: 'serif', // 'serif' | 'sans'
        enum: ['serif', 'sans'],
      },
      layoutStyle: {
        type: String,
        default: 'editorial', // 'standard' | 'editorial' | 'minimal'
      },
      quoteHighlight: {
        type: String,
        default: '',
      },
      authorRole: {
        type: String,
        default: 'Nghệ nhân chế tác nến & Chuyên gia khứu giác',
      },
      ambientMood: {
        type: String,
        default: 'Tiếng gỗ cháy lách tách trong lò sưởi',
      },
      enableDropCap: {
        type: Boolean,
        default: true,
      },
      productPairing: {
        name: { type: String, default: '' },
        scentNotes: { type: String, default: '' },
        link: { type: String, default: '/shop' },
        price: { type: String, default: '' },
        thumbnail: { type: String, default: '' },
      },
    },
    tags: {
      type: [String],
      default: ['Nến Thơm', 'Chánh Niệm', 'Thủ Công'],
    },
    isPublished: {
      type: Boolean,
      default: true,
      index: true,
    },
    viewCount: {
      type: Number,
      default: 0,
    },
    likesCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Tự động tạo slug nếu chưa có từ tiêu đề
postSchema.pre('validate', function (next) {
  if (this.title && !this.slug) {
    this.slug = this.title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }
  next();
});

module.exports = mongoose.model('Post', postSchema);
