const SystemConfig = require('../models/SystemConfig');
const ImportTicket = require('../models/ImportTicket');
const Material = require('../models/Material');

/**
 * Hàm này quét các nguyên vật liệu đang hết hàng (actualStock = 0)
 * và tự động duyệt các phiếu nhập (pending) có chứa chúng,
 * nếu cấu hình tự động duyệt được bật.
 */
const triggerAutoConfirmImports = async () => {
  try {
    const config = await SystemConfig.findOne({ key: 'auto_confirm_out_of_stock_imports' });
    if (!config || config.value !== true) return;

    // Tìm các nguyên vật liệu có actualStock = 0
    const outOfStockMaterials = await Material.find({ actualStock: 0 }).select('_id');
    if (outOfStockMaterials.length === 0) return;

    const outOfStockIds = outOfStockMaterials.map(m => m._id.toString());

    // Tìm các phiếu nhập pending có chứa nguyên liệu này
    const pendingTickets = await ImportTicket.find({ status: 'pending' });
    
    for (const ticket of pendingTickets) {
      let shouldConfirm = false;
      for (const item of ticket.items) {
        if (outOfStockIds.includes(item.material_id.toString())) {
          shouldConfirm = true;
          break;
        }
      }

      if (shouldConfirm) {
        ticket.status = 'completed';
        ticket.completed_at = new Date();
        
        // Cập nhật nguyên liệu
        for (const item of ticket.items) {
          const material = await Material.findById(item.material_id);
          if (material) {
            material.stock += item.quantity;
            material.actualStock += item.quantity;
            material.price = item.unit_price; 
            await material.save();
          }
        }
        await ticket.save();
        console.log(`[AutoConfirm] Đã tự động duyệt phiếu nhập ${ticket.code}`);
      }
    }
  } catch (err) {
    console.error('[AutoConfirm] Lỗi khi chạy trigger auto confirm:', err);
  }
};

module.exports = { triggerAutoConfirmImports };
