const ExpenseTicket = require('../models/ExpenseTicket');
const FundTransaction = require('../models/FundTransaction');

// Lấy danh sách phiếu chi
exports.getExpenses = async (req, res) => {
  try {
    const expenses = await ExpenseTicket.find().sort({ createdAt: -1 });
    res.json({ success: true, data: expenses });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
};

// Tạo phiếu chi mới
exports.createExpense = async (req, res) => {
  try {
    const { title, category, amount, note } = req.body;

    if (!title || !amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Dữ liệu không hợp lệ' });
    }

    // Kiểm tra số dư quỹ
    const fundAgg = await FundTransaction.aggregate([
      { $group: { _id: null, totalBalance: { $sum: '$fund_change' } } }
    ]);
    const totalFundBalance = fundAgg.length > 0 ? fundAgg[0].totalBalance : 0;

    if (totalFundBalance < amount) {
      return res.status(400).json({ 
        success: false, 
        message: 'Tài sản chung không đủ tiền để thực hiện phiếu chi này.'
      });
    }

    // Tạo mã phiếu chi ngẫu nhiên
    const random7Digits = Math.floor(1000000 + Math.random() * 9000000);
    const code = `PC-${random7Digits}`;

    const newTicket = new ExpenseTicket({
      code,
      title,
      category: category || 'Khác',
      amount,
      note,
      created_by: req.user ? req.user.name : 'Admin',
      status: 'completed'
    });

    await newTicket.save();

    // Tạo giao dịch trừ quỹ
    const fundTx = new FundTransaction({
      type: 'expense_payment',
      amount: amount,
      fund_change: -amount,
      expense_ticket_id: newTicket._id,
      note: `Chi tiêu: ${title} (${code})`,
      created_by: req.user ? req.user.name : 'Admin'
    });

    await fundTx.save();

    res.json({ success: true, data: newTicket, message: 'Đã tạo phiếu chi thành công' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Lỗi khi tạo phiếu chi' });
  }
};

// Xóa phiếu chi (hoàn tiền vào quỹ)
exports.deleteExpense = async (req, res) => {
  try {
    const ticket = await ExpenseTicket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu chi' });
    }

    // Xoá giao dịch quỹ liên quan
    await FundTransaction.findOneAndDelete({ expense_ticket_id: ticket._id });

    // Xoá phiếu chi
    await ExpenseTicket.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: 'Đã xóa phiếu chi và hoàn lại tiền vào quỹ' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Lỗi khi xóa phiếu chi' });
  }
};
