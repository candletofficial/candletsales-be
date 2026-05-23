const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');

// Quản lý sản phẩm (Các route này sẽ được protect bởi auth middleware nếu cần, 
// hiện tại cứ gọi trực tiếp theo thiết kế hiện có)
router.get('/', productController.getProducts);
router.post('/', productController.createProduct);
router.put('/:id', productController.updateProduct);
router.delete('/:id', productController.deleteProduct);

module.exports = router;
