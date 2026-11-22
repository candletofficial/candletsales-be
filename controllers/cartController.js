const Cart = require('../models/Cart');
const Product = require('../models/Product');

exports.getCart = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    let cart = await Cart.findOne({ sessionId }).populate('items.product_id');
    if (!cart) {
      cart = await Cart.create({ sessionId, items: [] });
    }
    res.status(200).json({ success: true, data: cart });
  } catch (error) {
    next(error);
  }
};

exports.addToCart = async (req, res, next) => {
  try {
    const { sessionId, product_id, sku_id, quantity } = req.body;

    let cart = await Cart.findOne({ sessionId });
    if (!cart) {
      cart = await Cart.create({ sessionId, items: [] });
    }

    // Check if item exists (same product, sku, and customMessage)
    const existingItemIndex = cart.items.findIndex(item => 
      item.product_id.toString() === product_id &&
      item.sku_id === sku_id
    );

    if (existingItemIndex > -1) {
      cart.items[existingItemIndex].quantity += (quantity || 1);
    } else {
      cart.items.push({
        product_id,
        sku_id: sku_id || null,
        quantity: quantity || 1
      });
    }

    await cart.save();
    
    // Populate before sending
    const populatedCart = await Cart.findById(cart._id).populate('items.product_id');
    res.status(200).json({ success: true, data: populatedCart });
  } catch (error) {
    next(error);
  }
};

exports.updateCartItem = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { product_id, sku_id, new_sku_id, quantity } = req.body;

    const cart = await Cart.findOne({ sessionId });
    if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });

    const itemIndex = cart.items.findIndex(item => 
      item.product_id.toString() === product_id &&
      item.sku_id === sku_id
    );

    if (itemIndex > -1 && new_sku_id && new_sku_id !== sku_id) {
      const product = await Product.findById(product_id);
      const targetSku = product?.skus?.find(sku => sku.id === new_sku_id);
      if (!targetSku) {
        return res.status(400).json({ success: false, message: 'Phân loại mới không tồn tại' });
      }
      if (targetSku.stock !== null && targetSku.stock !== undefined && Number(targetSku.stock) <= 0) {
        return res.status(400).json({ success: false, message: 'Phân loại mới đã hết hàng' });
      }

      const targetIndex = cart.items.findIndex((item, index) => (
        index !== itemIndex
        && item.product_id.toString() === product_id
        && item.sku_id === new_sku_id
      ));
      const nextQuantity = Number(quantity) > 0 ? Number(quantity) : cart.items[itemIndex].quantity;
      const mergedQuantity = targetIndex > -1
        ? cart.items[targetIndex].quantity + nextQuantity
        : nextQuantity;

      if (targetSku.stock !== null && targetSku.stock !== undefined
        && Number.isFinite(Number(targetSku.stock)) && mergedQuantity > Number(targetSku.stock)) {
        return res.status(400).json({ success: false, message: `Phân loại mới chỉ còn ${targetSku.stock} sản phẩm` });
      }

      if (targetIndex > -1) {
        cart.items[targetIndex].quantity = mergedQuantity;
        cart.items.splice(itemIndex, 1);
      } else {
        cart.items[itemIndex].sku_id = new_sku_id;
        cart.items[itemIndex].quantity = nextQuantity;
      }
      await cart.save();
    } else if (itemIndex > -1) {
      if (quantity <= 0) {
        cart.items.splice(itemIndex, 1);
      } else {
        cart.items[itemIndex].quantity = quantity;
      }
      await cart.save();
    }

    const populatedCart = await Cart.findById(cart._id).populate('items.product_id');
    res.status(200).json({ success: true, data: populatedCart });
  } catch (error) {
    next(error);
  }
};

exports.removeFromCart = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { product_id, sku_id } = req.body;

    const cart = await Cart.findOne({ sessionId });
    if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });

    cart.items = cart.items.filter(item => 
      !(item.product_id.toString() === product_id &&
        item.sku_id === sku_id)
    );

    await cart.save();
    const populatedCart = await Cart.findById(cart._id).populate('items.product_id');
    res.status(200).json({ success: true, data: populatedCart });
  } catch (error) {
    next(error);
  }
};

exports.removeMultipleFromCart = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { itemsToRemove } = req.body; // Array of { product_id, sku_id }

    const cart = await Cart.findOne({ sessionId });
    if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });

    cart.items = cart.items.filter(item => {
      const isRemoving = itemsToRemove.some(rItem => 
        rItem.product_id === item.product_id.toString() && rItem.sku_id === item.sku_id
      );
      return !isRemoving;
    });

    await cart.save();
    const populatedCart = await Cart.findById(cart._id).populate('items.product_id');
    res.status(200).json({ success: true, data: populatedCart });
  } catch (error) {
    next(error);
  }
};

exports.clearCart = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const cart = await Cart.findOne({ sessionId });
    if (cart) {
      cart.items = [];
      await cart.save();
    }
    res.status(200).json({ success: true, message: 'Cart cleared' });
  } catch (error) {
    next(error);
  }
};
