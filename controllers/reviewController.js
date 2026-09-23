const Review = require('../models/Review');
const Order = require('../models/Order');
const User = require('../models/User');

exports.getReviewsByProduct = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const reviews = await Review.find({ product: productId })
      .populate('user', 'name')
      .sort({ createdAt: -1 });
    
    res.status(200).json({
      success: true,
      data: reviews,
      message: 'Lấy danh sách đánh giá thành công'
    });
  } catch (error) {
    next(error);
  }
};

exports.createReview = async (req, res, next) => {
  try {
    const { productId, rating, title, content, variant } = req.body;
    const userId = req.user._id;

    // Optional: check if user bought this product to set verified = true
    // This assumes order schema has items with product field
    let verified = false;
    const userOrders = await Order.find({ user: userId, status: { $in: ['completed', 'delivered', 'Thành công'] } });
    for (let order of userOrders) {
        if (order.items && order.items.some(item => item.product.toString() === productId)) {
            verified = true;
            break;
        }
    }

    const review = new Review({
      product: productId,
      user: userId,
      rating,
      title,
      content,
      variant,
      verified
    });

    await review.save();

    // Fetch the newly created review with populated user to return it
    const populatedReview = await Review.findById(review._id).populate('user', 'name');

    res.status(201).json({
      success: true,
      data: populatedReview,
      message: 'Đánh giá thành công'
    });
  } catch (error) {
    next(error);
  }
};
