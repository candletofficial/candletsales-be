const express = require('express');
const router = express.Router();
const expenseController = require('../controllers/expenseController');
const { protect } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', expenseController.getExpenses);
router.post('/', expenseController.createExpense);
router.delete('/:id', expenseController.deleteExpense);

module.exports = router;
