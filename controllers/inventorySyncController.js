const InventorySync = require('../models/InventorySync');
const Material = require('../models/Material');

// [POST] /api/inventory-syncs
exports.syncInventory = async (req, res) => {
  try {
    const { checked_by } = req.body;
    
    // Tìm các nguyên liệu có stock != actualStock
    const materials = await Material.find({ $expr: { $ne: ["$stock", "$actualStock"] } });
    
    if (materials.length === 0) {
      return res.status(400).json({ success: false, message: 'Không có nguyên liệu nào bị lệch kho' });
    }
    
    let totalDiscrepancyValue = 0;
    const ticketItems = materials.map(m => {
      const actualStock = m.actualStock !== null && m.actualStock !== undefined ? m.actualStock : m.stock;
      const difference = actualStock - m.stock;
      const price = m.price || 0;
      totalDiscrepancyValue += difference * price;
      
      return {
        material_id: m._id,
        system_stock: m.stock,
        actual_stock: actualStock,
        difference: difference,
        price: price
      };
    });
    
    // Create sync history record
    const newSync = new InventorySync({
      items: ticketItems,
      total_discrepancy_value: totalDiscrepancyValue,
      note: 'Cân bằng kho từ màn hình Quản lý Nguyên vật liệu',
      synced_by: checked_by || 'Admin'
    });
    
    await newSync.save();
    
    // Update materials (set stock = actualStock)
    const bulkOps = materials.map(m => {
      const actualStock = m.actualStock !== null && m.actualStock !== undefined ? m.actualStock : m.stock;
      return {
        updateOne: {
          filter: { _id: m._id },
          update: { $set: { stock: actualStock } }
        }
      };
    });
    
    if (bulkOps.length > 0) {
      await Material.bulkWrite(bulkOps);
    }
    
    res.status(200).json({
      success: true,
      message: 'Cân bằng kho thành công',
      data: newSync
    });
  } catch (error) {
    console.error('Lỗi khi cân bằng kho:', error);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
};

// [GET] /api/inventory-syncs
exports.getSyncHistory = async (req, res) => {
  try {
    const syncs = await InventorySync.find()
      .populate({
        path: 'items.material_id',
        select: 'name sku unit supplier'
      })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: syncs
    });
  } catch (error) {
    console.error('Lỗi khi lấy lịch sử cân bằng kho:', error);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
};
