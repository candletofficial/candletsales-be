// POS order statuses (not the separate return/exchange-order enum):
// https://docs.pancake.biz/pos/st-f13/st-p3?lang=en
const normalize = value => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
  .toLowerCase().trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

const returnNames = new Set([
  'returning', 'returned', 'dang hoan', 'dang hoan hang', 'da hoan',
  'da hoan hang', 'hoan', 'hoan hang', 'chuyen hoan', 'dang chuyen hoan',
]);
const cancelNames = new Set(['canceled', 'cancelled', 'cancel', 'huy', 'da huy', 'huy don', 'huy don hang']);
const removedNames = new Set(['removed', 'deleted', 'xoa gan day', 'da xoa']);
const activeNames = new Set([
  'new', 'submitted', 'shipped', 'delivered', 'pending', 'packing', 'printed',
  'waitting', 'wait submit', 'completed', 'done', 'paid', 'received money',
  'moi', 'da xac nhan', 'da gui hang', 'da nhan', 'cho chuyen hang',
  'dang dong hang', 'hoan thanh', 'da hoan thanh', 'da thu tien', 'da doi soat',
]);
const knownCodes = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 15, 16, 17, 20]);

function classifyPancakeStatus(payload) {
  const rawCode = payload.status;
  const code = rawCode !== null && rawCode !== undefined && String(rawCode).trim() !== ''
    ? Number(rawCode) : NaN;
  const name = normalize(payload.status_name);

  // A partial return must not refund every item in the order.
  if (code === 15 || name === 'part returned' || name === 'hoan mot phan') return 'other';
  // Keep the application's existing mapping of both returning/returned to Hoàn hàng.
  // Return evidence on the POS order takes priority over cancellation metadata.
  if (code === 4 || code === 5 || returnNames.has(name)) return 'returned';
  if (code === 6 || cancelNames.has(name)) return 'cancelled';
  if (code === 7 || removedNames.has(name)) return 'removed';

  // Carrier cancellation may mean cancelling a shipment, not the POS order.
  // Use partner status only if the POS status itself is unavailable/unrecognized.
  if (knownCodes.has(code) || activeNames.has(name)) return 'other';
  const partner = normalize(payload.partner?.partner_status);
  if (returnNames.has(partner)) return 'returned';
  if (cancelNames.has(partner)) return 'cancelled';
  return 'other';
}

module.exports = { classifyPancakeStatus };
