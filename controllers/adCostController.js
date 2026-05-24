const AdCost = require('../models/AdCost');

// GET /api/ad-costs?year=2025&month=5
// Trả về tất cả bản ghi trong tháng
exports.getAdCosts = async (req, res, next) => {
  try {
    const { year, month } = req.query;

    let filter = {};
    if (year && month) {
      const y = parseInt(year);
      const m = parseInt(month) - 1; // JS months 0-indexed
      const start = new Date(y, m, 1);
      const end   = new Date(y, m + 1, 0, 23, 59, 59, 999);
      filter.date = { $gte: start, $lte: end };
    }

    const records = await AdCost.find(filter).sort({ date: 1 });
    res.status(200).json({ success: true, data: records });
  } catch (error) {
    next(error);
  }
};

// POST /api/ad-costs
exports.createAdCost = async (req, res, next) => {
  try {
    const { date, platform, base_amount, vat, amount, note } = req.body;
    const record = await AdCost.create({ date, platform, base_amount, vat, amount, note: note || '' });
    res.status(201).json({ success: true, data: record, message: 'Đã thêm chi phí quảng cáo' });
  } catch (error) {
    next(error);
  }
};

// PUT /api/ad-costs/:id
exports.updateAdCost = async (req, res, next) => {
  try {
    const { date, platform, base_amount, vat, amount, note } = req.body;
    const record = await AdCost.findByIdAndUpdate(
      req.params.id,
      { date, platform, base_amount, vat, amount, note },
      { new: true, runValidators: true }
    );
    if (!record) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy bản ghi' });
    }
    res.status(200).json({ success: true, data: record, message: 'Đã cập nhật chi phí' });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/ad-costs/:id
exports.deleteAdCost = async (req, res, next) => {
  try {
    const record = await AdCost.findByIdAndDelete(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy bản ghi' });
    }
    res.status(200).json({ success: true, message: 'Đã xóa chi phí' });
  } catch (error) {
    next(error);
  }
};
