const ImportTicket = require('../models/ImportTicket');
const Material = require('../models/Material');
const SystemConfig = require('../models/SystemConfig');

// Lấy danh sách phiếu nhập
exports.getImportTickets = async (req, res) => {
  try {
    const tickets = await ImportTicket.find()
      .populate('items.material_id', 'name sku unit price')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: tickets });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
};

// Tạo phiếu nhập (pending)
exports.createImportTicket = async (req, res) => {
  try {
    const { items, total_amount, note, imported_by } = req.body;
    
    // items: [{ material_id, quantity, total_price }]
    // Tính toán lại unit_price
    const formattedItems = items.map(item => ({
      ...item,
      unit_price: item.quantity > 0 ? (item.total_price / item.quantity) : 0
    }));

    // Generate random 7-digit code
    const random7Digits = Math.floor(1000000 + Math.random() * 9000000);
    const code = `PN-${random7Digits}`;

    const newTicket = new ImportTicket({
      code,
      items: formattedItems,
      total_amount,
      note,
      imported_by: imported_by || 'Admin',
      status: 'pending'
    });

    // --- LOGIC TỰ ĐỘNG DUYỆT (AUTO CONFIRM) ---
    let autoConfirm = false;
    const config = await SystemConfig.findOne({ key: 'auto_confirm_out_of_stock_imports' });
    if (config && config.value === true) {
      // Kiểm tra xem có nguyên liệu nào trong phiếu đang hết hàng (actualStock === 0) không
      for (const item of formattedItems) {
        const mat = await Material.findById(item.material_id);
        if (mat && mat.actualStock === 0) {
          autoConfirm = true;
          break;
        }
      }
    }

    if (autoConfirm) {
      newTicket.status = 'completed';
      newTicket.completed_at = new Date();
      
      // Cập nhật lại số lượng kho của các nguyên liệu
      for (let item of newTicket.items) {
        const material = await Material.findById(item.material_id);
        if (material) {
          material.stock += item.quantity;
          material.actualStock += item.quantity;
          material.price = item.unit_price; 
          await material.save();
        }
      }
    }

    await newTicket.save();
    res.status(201).json({ 
      success: true, 
      data: newTicket, 
      message: autoConfirm ? 'Tạo và tự động duyệt phiếu nhập (do có nguyên liệu hết kho)' : 'Tạo phiếu nhập thành công' 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Lỗi server khi tạo phiếu nhập' });
  }
};

// Xác nhận đẩy hàng (chuyển sang completed)
exports.completeImportTicket = async (req, res) => {
  try {
    const ticket = await ImportTicket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu nhập' });
    }
    if (ticket.status === 'completed') {
      return res.status(400).json({ success: false, message: 'Phiếu nhập này đã được xác nhận' });
    }

    // Cập nhật từng nguyên liệu
    for (let item of ticket.items) {
      const material = await Material.findById(item.material_id);
      if (material) {
        material.stock += item.quantity;
        material.actualStock += item.quantity;
        material.price = item.unit_price; // Cập nhật đơn giá mới
        
        // Lưu lại sẽ kích hoạt pre('save') để cập nhật status của Material
        await material.save();
      }
    }

    ticket.status = 'completed';
    ticket.completed_at = new Date();
    await ticket.save();

    res.json({ success: true, data: ticket, message: 'Đã xác nhận đẩy hàng thành công' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Lỗi khi xác nhận đẩy hàng' });
  }
};

// Xoá phiếu nhập
exports.deleteImportTicket = async (req, res) => {
  try {
    const ticket = await ImportTicket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy phiếu nhập' });
    }
    if (ticket.status === 'completed') {
      return res.status(400).json({ success: false, message: 'Không thể xóa phiếu đã hoàn thành' });
    }

    await ImportTicket.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Đã xóa phiếu nhập' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Lỗi khi xóa phiếu nhập' });
  }
};
