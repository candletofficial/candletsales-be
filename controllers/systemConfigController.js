const SystemConfig = require('../models/SystemConfig');

exports.getConfig = async (req, res, next) => {
  try {
    const { key } = req.params;
    let config = await SystemConfig.findOne({ key });
    if (!config) {
      // Default to false if not found
      return res.status(200).json({ success: true, data: { key, value: false } });
    }
    res.status(200).json({ success: true, data: config });
  } catch (error) {
    next(error);
  }
};

exports.updateConfig = async (req, res, next) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    let config = await SystemConfig.findOne({ key });
    if (config) {
      config.value = value;
      await config.save();
    } else {
      config = await SystemConfig.create({ key, value });
    }
    res.status(200).json({ success: true, data: config, message: 'Cập nhật cấu hình thành công' });
  } catch (error) {
    next(error);
  }
};
