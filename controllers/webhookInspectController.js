const fs = require('fs');
const path = require('path');
const LOG_PATH = path.join(__dirname, '../pancake_payload_log.json');

const readLog = () => {
  try {
    return JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8'));
  } catch (_) {
    return [];
  }
};

/**
 * GET /api/webhooks/pancake-inspect
 * Xem toàn bộ payload đã log — mở thẳng trên browser
 */
exports.getInspectLog = (req, res) => {
  const entries = readLog();
  if (entries.length === 0) {
    return res.send('<h2 style="font-family:sans-serif">Chưa có payload nào được log. Hãy thực hiện action trên Pancake trước.</h2>');
  }

  const html = `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Pancake Webhook Inspector</title>
  <style>
    body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 20px; }
    h1 { color: #38bdf8; margin-bottom: 4px; }
    .sub { color: #64748b; font-size: 13px; margin-bottom: 24px; }
    .entry { background: #1e293b; border: 1px solid #334155; border-radius: 10px; margin-bottom: 20px; overflow: hidden; }
    .entry-header { background: #0f172a; padding: 12px 16px; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
    .badge { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px; }
    .badge-status { background: #0369a1; color: #e0f2fe; }
    .badge-event { background: #065f46; color: #d1fae5; }
    .ts { color: #64748b; font-size: 12px; margin-left: auto; }
    .summary { padding: 12px 16px; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; border-bottom: 1px solid #334155; }
    .kv { font-size: 13px; } .kv span { color: #94a3b8; } .kv b { color: #f1f5f9; }
    details { padding: 0; }
    summary { padding: 10px 16px; cursor: pointer; color: #38bdf8; font-size: 13px; font-weight: 600; list-style: none; }
    summary:hover { background: #0f172a; }
    pre { margin: 0; padding: 16px; background: #020617; overflow-x: auto; font-size: 12px; color: #a5f3fc; line-height: 1.6; max-height: 500px; overflow-y: auto; }
    .count { color: #64748b; font-size: 13px; }
    a.clear { float: right; color: #f87171; font-size: 12px; text-decoration: none; margin-top: 4px; }
    a.clear:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>🔍 Pancake Webhook Inspector</h1>
  <p class="sub">${entries.length} payload gần nhất (mới nhất ở trên) &nbsp;·&nbsp; <a class="clear" href="/api/webhooks/pancake-inspect/clear">🗑 Xoá log</a></p>
  ${entries.map((e, i) => {
    const p = e.payload;
    return `
    <div class="entry">
      <div class="entry-header">
        <span style="color:#f1f5f9;font-weight:700;font-size:14px">#${entries.length - i} &nbsp; ${p.display_id || p.id || '—'}</span>
        <span class="badge badge-event">${p.event_type || 'unknown'}</span>
        <span class="badge badge-status">status ${p.status} · ${p.status_name || '—'}</span>
        ${p.partner?.partner_status ? `<span class="badge" style="background:#4c1d95;color:#ede9fe">partner: ${p.partner.partner_status}</span>` : ''}
        <span class="ts">${new Date(e.timestamp).toLocaleString('vi-VN')}</span>
      </div>
      <div class="summary">
        <div class="kv"><span>Khách hàng: </span><b>${p.customer?.name || '—'}</b></div>
        <div class="kv"><span>SĐT: </span><b>${p.customer?.phone_numbers?.[0] || '—'}</b></div>
        <div class="kv"><span>Tổng tiền: </span><b>${(p.total_price || 0).toLocaleString('vi-VN')}đ</b></div>
        <div class="kv"><span>Số sản phẩm: </span><b>${(p.items || []).length}</b></div>
        <div class="kv"><span>Nguồn: </span><b>${p.source || p.channel || '—'}</b></div>
        <div class="kv"><span>COD: </span><b>${(p.cod || p.money_to_collect || 0).toLocaleString('vi-VN')}đ</b></div>
      </div>
      <details>
        <summary>📦 Xem toàn bộ JSON payload</summary>
        <pre>${JSON.stringify(p, null, 2)}</pre>
      </details>
    </div>`;
  }).join('')}
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
};

/**
 * GET /api/webhooks/pancake-inspect/clear
 * Xoá toàn bộ log
 */
exports.clearInspectLog = (req, res) => {
  try {
    fs.writeFileSync(LOG_PATH, '[]', 'utf-8');
    res.send('<p style="font-family:sans-serif">✅ Đã xoá log. <a href="/api/webhooks/pancake-inspect">Quay lại</a></p>');
  } catch (e) {
    res.status(500).send('Lỗi khi xoá log: ' + e.message);
  }
};

/**
 * POST /api/webhooks/pancake-inspect
 * Nhận webhook từ Pancake và lưu payload vào file log
 */
exports.inspectPancakeWebhook = (req, res) => {
  const payload = req.body;
  const timestamp = new Date().toISOString();

  console.log('\n========================================');
  console.log(`[INSPECT] ${timestamp}`);
  console.log(`event_type : ${payload.event_type}`);
  console.log(`order_id   : ${payload.id}`);
  console.log(`display_id : ${payload.display_id}`);
  console.log(`status     : ${payload.status} (${payload.status_name})`);
  console.log(`partner    : ${payload.partner?.partner_status}`);
  console.log(`customer   : ${payload.customer?.name} - ${payload.customer?.phone_numbers?.[0]}`);
  console.log(`total      : ${payload.total_price}`);
  console.log('========================================\n');

  const existing = readLog();
  existing.unshift({ timestamp, payload });
  if (existing.length > 20) existing.splice(20);
  fs.writeFileSync(LOG_PATH, JSON.stringify(existing, null, 2), 'utf-8');

  res.status(200).json({
    success: true,
    message: 'Payload logged. Xem tại: /api/webhooks/pancake-inspect',
    summary: {
      event_type: payload.event_type,
      order_id: payload.id,
      display_id: payload.display_id,
      status_code: payload.status,
      status_name: payload.status_name,
      partner_status: payload.partner?.partner_status,
      total_price: payload.total_price,
      items_count: (payload.items || []).length,
    }
  });
};
