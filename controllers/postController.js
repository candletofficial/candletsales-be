const Post = require('../models/Post');

// Helper tạo slug tiếng Việt
function generateSlug(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// @desc    Lấy danh sách bài viết công khai (cho Shop)
// @route   GET /api/posts
// @access  Public
exports.getPublicPosts = async (req, res, next) => {
  try {
    const { category, search, page = 1, limit = 9 } = req.query;

    const query = { isPublished: true };

    if (category && category !== 'Tất cả') {
      query.category = category;
    }

    if (search && search.trim()) {
      const q = search.trim();
      query.$or = [
        { title: { $regex: q, $options: 'i' } },
        { summary: { $regex: q, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [posts, total] = await Promise.all([
      Post.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Post.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: posts,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
      message: 'Lấy danh sách bài viết thành công',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Xem chi tiết bài viết công khai theo slug
// @route   GET /api/posts/:slug
// @access  Public
exports.getPublicPostBySlug = async (req, res, next) => {
  try {
    // Tự động tăng 1 lượt xem thực tế trực tiếp trong MongoDB mỗi khi bài viết được mở xem
    const post = await Post.findOneAndUpdate(
      { slug: req.params.slug, isPublished: true },
      { $inc: { viewCount: 1 } },
      { new: true }
    );

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy bài viết hoặc bài viết đã bị ẩn',
      });
    }

    // Lấy thêm 3 bài viết liên quan cùng danh mục
    const relatedPosts = await Post.find({
      _id: { $ne: post._id },
      category: post.category,
      isPublished: true,
    })
      .sort({ createdAt: -1 })
      .limit(3)
      .select('title slug summary thumbnail readTime viewCount likesCount createdAt');

    res.status(200).json({
      success: true,
      data: {
        post,
        relatedPosts,
      },
      message: 'Lấy chi tiết bài viết thành công',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Ghi nhận lượt xem thực tế của bài viết
// @route   POST /api/posts/:slug/view
// @access  Public
exports.recordPostView = async (req, res, next) => {
  try {
    const post = await Post.findOneAndUpdate(
      { slug: req.params.slug, isPublished: true },
      { $inc: { viewCount: 1 } },
      { new: true }
    ).select('viewCount');

    if (!post) {
      return res.status(404).json({ success: false, message: 'Bài viết không tồn tại' });
    }

    res.status(200).json({
      success: true,
      data: { viewCount: post.viewCount },
      message: 'Ghi nhận lượt xem thành công',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Thả tim hoặc Bỏ thả tim bài viết thực tế vào Database
// @route   POST /api/posts/:slug/like
// @access  Public
exports.togglePostLike = async (req, res, next) => {
  try {
    const { action } = req.body; // 'like' | 'unlike'
    const incValue = action === 'unlike' ? -1 : 1;

    let post = await Post.findOne({ slug: req.params.slug, isPublished: true });
    if (!post) {
      return res.status(404).json({ success: false, message: 'Bài viết không tồn tại' });
    }

    // Đảm bảo không giảm xuống dưới 0
    let newLikes = Math.max(0, (post.likesCount || 0) + incValue);
    post.likesCount = newLikes;
    await post.save();

    res.status(200).json({
      success: true,
      data: {
        likesCount: post.likesCount,
        isLiked: action !== 'unlike',
      },
      message: action === 'unlike' ? 'Đã hủy thích câu chuyện' : 'Đã thả tim câu chuyện',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Lấy danh sách tất cả bài viết (dành cho Admin)
// @route   GET /api/admin/posts
// @access  Private/Admin
exports.getAdminPosts = async (req, res, next) => {
  try {
    const { category, search, isPublished, page = 1, limit = 20 } = req.query;

    const query = {};

    if (category && category !== 'Tất cả') {
      query.category = category;
    }

    if (isPublished !== undefined && isPublished !== '') {
      query.isPublished = isPublished === 'true';
    }

    if (search && search.trim()) {
      const q = search.trim();
      query.$or = [
        { title: { $regex: q, $options: 'i' } },
        { summary: { $regex: q, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [posts, total] = await Promise.all([
      Post.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Post.countDocuments(query),
    ]);

    // Thống kê nhanh
    const [totalPublished, totalDraft] = await Promise.all([
      Post.countDocuments({ isPublished: true }),
      Post.countDocuments({ isPublished: false }),
    ]);

    res.status(200).json({
      success: true,
      data: posts,
      stats: {
        total,
        totalPublished,
        totalDraft,
      },
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
      message: 'Lấy danh sách bài viết quản trị thành công',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Tạo bài viết mới
// @route   POST /api/admin/posts
// @access  Private/Admin
exports.createPost = async (req, res, next) => {
  try {
    const {
      title,
      summary,
      thumbnail,
      category,
      author,
      readTime,
      content,
      customDesign,
      tags,
      isPublished,
    } = req.body;

    if (!title || !summary || !content) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng điền đầy đủ tiêu đề, tóm tắt và nội dung bài viết',
      });
    }

    let baseSlug = generateSlug(title);
    let slug = baseSlug;
    let counter = 1;

    // Đảm bảo slug là duy nhất
    while (await Post.findOne({ slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    const post = await Post.create({
      title,
      slug,
      summary,
      thumbnail: thumbnail || '',
      category: category || 'Nghệ Thuật Mùi Hương',
      author: author || 'Nghệ nhân Candlet',
      readTime: readTime || '5 phút đọc',
      content,
      customDesign: customDesign || {},
      tags: tags || ['Nến Thơm', 'Chánh Niệm', 'Thủ Công'],
      isPublished: isPublished !== undefined ? isPublished : true,
    });

    res.status(201).json({
      success: true,
      data: post,
      message: 'Tạo bài viết mới thành công',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Cập nhật bài viết
// @route   PUT /api/admin/posts/:id
// @access  Private/Admin
exports.updatePost = async (req, res, next) => {
  try {
    const {
      title,
      summary,
      thumbnail,
      category,
      author,
      readTime,
      content,
      customDesign,
      tags,
      isPublished,
    } = req.body;

    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy bài viết cần cập nhật',
      });
    }

    if (title && title !== post.title) {
      let baseSlug = generateSlug(title);
      let slug = baseSlug;
      let counter = 1;
      while (await Post.findOne({ slug, _id: { $ne: post._id } })) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }
      post.title = title;
      post.slug = slug;
    }

    if (summary !== undefined) post.summary = summary;
    if (thumbnail !== undefined) post.thumbnail = thumbnail;
    if (category !== undefined) post.category = category;
    if (author !== undefined) post.author = author;
    if (readTime !== undefined) post.readTime = readTime;
    if (content !== undefined) post.content = content;
    if (customDesign !== undefined) post.customDesign = customDesign;
    if (tags !== undefined) post.tags = tags;
    if (isPublished !== undefined) post.isPublished = isPublished;

    await post.save();

    res.status(200).json({
      success: true,
      data: post,
      message: 'Cập nhật bài viết thành công',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Xóa bài viết
// @route   DELETE /api/admin/posts/:id
// @access  Private/Admin
exports.deletePost = async (req, res, next) => {
  try {
    const post = await Post.findByIdAndDelete(req.params.id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy bài viết cần xóa',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Đã xóa bài viết thành công',
    });
  } catch (error) {
    next(error);
  }
};
