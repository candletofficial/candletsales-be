const InventoryCheck = require('../models/InventoryCheck');
const Material = require('../models/Material');
const { triggerAutoConfirmImports } = require('../utils/inventoryHelpers');

// [POST] /api/inventory-checks
exports.createTicket = async (req, res) => {
  try {
    const { items, note, checked_by } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Danh sách nguyên liệu kiểm kho không hợp lệ' });
    }

    // Prepare ticket items
    const ticketItems = [];

    for (const item of items) {
      const material = await Material.findById(item.material_id);
      if (!material) {
        return res.status(404).json({ success: false, message: `Không tìm thấy nguyên liệu có ID: ${item.material_id}` });
      }

      const actual_stock = Number(item.actual_stock);
      if (isNaN(actual_stock) || actual_stock < 0) {
        return res.status(400).json({ success: false, message: 'Tồn kho thực tế không hợp lệ' });
      }

      // Record difference
      const diff = actual_stock - material.actualStock;
      
      ticketItems.push({
        material_id: material._id,
        system_stock: material.actualStock,
        actual_stock: actual_stock,
        difference: diff
      });

      // Update material actual stock
      material.actualStock = actual_stock;
      await material.save();
    }

    // Create ticket
    const newCheck = new InventoryCheck({
      items: ticketItems,
      note: note || '',
      checked_by: checked_by || 'Admin'
    });

    await newCheck.save();

    // Kích hoạt trigger auto confirm
    triggerAutoConfirmImports().catch(console.error);

    res.status(201).json({
      success: true,
      message: 'Đã lưu phiếu kiểm kho thành công',
      data: newCheck
    });
  } catch (error) {
    console.error('Lỗi khi tạo phiếu kiểm kho:', error);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
};

// [GET] /api/inventory-checks
exports.getTickets = async (req, res) => {
  try {
    const checks = await InventoryCheck.find()
      .populate({
        path: 'items.material_id',
        select: 'name sku unit supplier'
      })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: checks
    });
  } catch (error) {
    console.error('Lỗi khi lấy danh sách kiểm kho:', error);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
};
