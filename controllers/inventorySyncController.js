const InventorySync = require('../models/InventorySync');
const Material = require('../models/Material');

// [POST] /api/inventory-syncs
exports.syncInventory = async (req, res) => {
  try {
    const { checked_by } = req.body;
    
    // actualStock của dữ liệu cũ có thể chưa tồn tại; khi đó xem như bằng stock.
    const materials = await Material.find({
      isTrackingEnabled: { $ne: false },
      $expr: {
        $ne: ['$stock', { $ifNull: ['$actualStock', '$stock'] }]
      }
    });
    
    if (materials.length === 0) {
      return res.status(400).json({ success: false, message: 'Không có nguyên liệu nào bị lệch kho' });
    }
    
    let totalDiscrepancyValue = 0;
    const ticketItems = materials.map(m => {
      const systemStock = Number(m.stock);
      const actualStock = Number(m.actualStock ?? m.stock);
      const price = Number(m.price) || 0;
      const difference = actualStock - systemStock;
      totalDiscrepancyValue += difference * price;
      
      return {
        material_id: m._id,
        system_stock: systemStock,
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
      const actualStock = Number(m.actualStock ?? m.stock);
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
    const message = error?.code === 11000
      ? 'Mã phiếu cân bằng kho bị trùng, vui lòng thử lại'
      : error?.name === 'ValidationError'
        ? `Dữ liệu cân bằng kho không hợp lệ: ${Object.values(error.errors || {}).map(item => item.message).join(', ')}`
        : 'Không thể cân bằng kho, vui lòng thử lại';
    res.status(500).json({ success: false, message });
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
