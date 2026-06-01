const ShippingConfig = require('../models/ShippingConfig');

// GET /api/shipping-config
exports.getAllConfigs = async (req, res, next) => {
  try {
    const configs = await ShippingConfig.find().populate('materials.material_id', 'name unit');
    res.status(200).json({ success: true, data: configs });
  } catch (error) {
    next(error);
  }
};

// PUT /api/shipping-config/:method
exports.updateConfig = async (req, res, next) => {
  try {
    const { method } = req.params;
    const { materials } = req.body;

    if (!['standard', 'express'].includes(method)) {
      return res.status(400).json({ success: false, message: 'Phương thức vận chuyển không hợp lệ' });
    }

    let config = await ShippingConfig.findOne({ method });
    
    if (config) {
      config.materials = materials;
      await config.save();
    } else {
      config = await ShippingConfig.create({ method, materials });
    }

    // Populate để trả về FE đầy đủ data
    await config.populate('materials.material_id', 'name unit');

    res.status(200).json({ success: true, data: config, message: 'Cập nhật cấu hình thành công' });
  } catch (error) {
    next(error);
  }
};
