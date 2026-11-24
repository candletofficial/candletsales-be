const crypto = require('crypto');
const MockupShare = require('../models/MockupShare');
const { deleteCloudinaryImage } = require('../config/cloudinary');

const numberInRange = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};

exports.createMockupShare = async (req, res) => {
  try {
    const labelUrl = String(req.body.label_url || '').trim();
    const previewUrl = String(req.body.preview_url || '').trim();
    if (!/^https:\/\//i.test(labelUrl)) {
      return res.status(400).json({ success: false, message: 'Ảnh tem chia sẻ không hợp lệ' });
    }
    if (previewUrl && !/^https:\/\//i.test(previewUrl)) {
      return res.status(400).json({ success: false, message: 'Ảnh banner chia sẻ không hợp lệ' });
    }
    const token = crypto.randomBytes(12).toString('base64url');
    const mockup = await MockupShare.create({
      token,
      label_url: labelUrl,
      preview_url: previewUrl,
      label_file_name: String(req.body.label_file_name || 'Tem custom').trim().slice(0, 180),
      finish: ['frosted', 'clear', 'amber', 'black'].includes(req.body.finish) ? req.body.finish : 'frosted',
      lid: ['none', 'gold', 'wood', 'black'].includes(req.body.lid) ? req.body.lid : 'none',
      label_width: numberInRange(req.body.label_width, 52, 10, 100),
      label_height: numberInRange(req.body.label_height, 42, 10, 80),
      label_top: numberInRange(req.body.label_top, 23, 2, 70),
      label_rotation: numberInRange(req.body.label_rotation, 0, -180, 180),
      created_by: req.user._id,
    });
    return res.status(201).json({ success: true, data: { id: mockup._id, token: mockup.token, createdAt: mockup.createdAt } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAdminMockupShares = async (req, res) => {
  try {
    const shares = await MockupShare.find({})
      .sort({ createdAt: -1 })
      .select('_id token label_url preview_url label_file_name label_width label_height view_count createdAt');
    return res.json({ success: true, data: shares });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteMockupShare = async (req, res) => {
  try {
    const mockup = await MockupShare.findById(req.params.id);
    if (!mockup) return res.status(404).json({ success: false, message: 'Link mockup không tồn tại' });

    const imageUrls = [...new Set([mockup.label_url, mockup.preview_url].filter(Boolean))];
    const imageResults = await Promise.all(imageUrls.map(imageUrl => deleteCloudinaryImage(imageUrl)));
    if (imageResults.some(result => !result)) {
      return res.status(502).json({
        success: false,
        message: 'Không thể xoá hết ảnh mockup trên Cloudinary. Link được giữ lại để admin kiểm tra.',
      });
    }

    await mockup.deleteOne();
    return res.json({ success: true, message: 'Đã xoá link chia sẻ và ảnh tem trên Cloudinary' });
  } catch (error) {
    if (error.name === 'CastError') return res.status(404).json({ success: false, message: 'Link mockup không tồn tại' });
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPublicMockupShare = async (req, res) => {
  try {
    const query = { token: req.params.token, is_active: true };
    const fields = '-_id token label_url preview_url label_file_name finish lid label_width label_height label_top label_rotation view_count createdAt';
    const mockup = req.query.preview === '1'
      ? await MockupShare.findOne(query).select(fields)
      : await MockupShare.findOneAndUpdate(query, { $inc: { view_count: 1 } }, { new: true }).select(fields);
    if (!mockup) return res.status(404).json({ success: false, message: 'Link mockup không tồn tại hoặc đã ngừng chia sẻ' });
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, data: mockup });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
