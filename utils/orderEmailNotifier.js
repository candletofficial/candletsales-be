const nodemailer = require('nodemailer');

let transporter;
let transporterKey;
let missingConfigLogged = false;

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const formatMoney = (amount) => Number(amount || 0).toLocaleString('vi-VN') + 'đ';

const getMailConfig = () => {
  const apiKey = String(process.env.BREVO_API_KEY || '').trim();
  const host = String(process.env.MAIL_SMTP_HOST || 'smtp.gmail.com').trim();
  const port = Number(process.env.MAIL_SMTP_PORT || 465);
  const secureValue = String(process.env.MAIL_SMTP_SECURE || '').trim().toLowerCase();
  const secure = secureValue ? secureValue === 'true' : port === 465;
  const user = String(process.env.MAIL_SMTP_USER || '').trim();
  const pass = String(process.env.MAIL_SMTP_PASSWORD || process.env.MAIL_SMTP_APP_PASSWORD || '').replace(/\s/g, '');
  const fromEmail = String(process.env.MAIL_FROM_EMAIL || user).trim();
  const recipients = String(process.env.MAIL_NOTIFICATION_TO || user)
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);

  const smtpConfigured = host && Number.isInteger(port) && port > 0 && port <= 65535 && user && pass;
  if ((!apiKey && !smtpConfigured) || !fromEmail || recipients.length === 0) return null;
  return { apiKey, host, port, secure, user, pass, fromEmail, recipients };
};

const getTransporter = (config) => {
  const key = [config.host, config.port, config.secure, config.user].join('|');
  if (!transporter || transporterKey !== key) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
    transporterKey = key;
  }
  return transporter;
};

const sendThroughBrevoApi = async (config, message) => {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': config.apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: message.shopName, email: config.fromEmail },
      to: config.recipients.map((email) => ({ email })),
      subject: message.subject,
      htmlContent: message.html,
      tags: ['order-notification'],
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`Brevo API HTTP ${response.status}${details ? `: ${details}` : ''}`);
  }

  return response.json();
};

// Gửi ngầm: email lỗi không được làm thất bại quá trình tạo đơn hàng.
exports.notifyNewWebsiteOrder = async (order) => {
  if (order?.source !== 'website') return false;

  const config = getMailConfig();
  if (!config) {
    if (!missingConfigLogged) {
      missingConfigLogged = true;
      console.warn('[order-email] Chưa cấu hình BREVO_API_KEY hoặc SMTP; bỏ qua email đơn mới.');
    }
    return false;
  }

  const items = Array.isArray(order.items) ? order.items : [];
  const itemText = items.map((item) => `- ${item.product_name}${item.sku_label ? ` (${item.sku_label})` : ''} × ${item.quantity}`).join('\n') || '- Không có sản phẩm';
  const itemRows = items.map((item) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eee;color:#292524">${escapeHtml(item.product_name)}${item.sku_label ? ` <span style="color:#78716c">(${escapeHtml(item.sku_label)})</span>` : ''}</td>
      <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;color:#292524">× ${Number(item.quantity || 0)}</td>
    </tr>`).join('') || '<tr><td colspan="2" style="padding:8px 0">Không có sản phẩm</td></tr>';
  const paymentLabel = order.payment_method === 'transfer'
    ? 'Chuyển khoản — đã xác nhận'
    : 'COD — thanh toán khi nhận hàng';
  const shopName = String(process.env.MAIL_FROM_NAME || 'CandletShop').trim();
  const subject = `[${shopName}] Đơn hàng mới #${order.orderId}`;
  const text = [
    `Có đơn hàng website mới: #${order.orderId}`,
    `Khách: ${order.customer_name || 'Khách Website'} — ${order.customer_phone || 'Chưa có SĐT'}`,
    `Địa chỉ: ${order.customer_address || 'Chưa có địa chỉ'}`,
    `Thanh toán: ${paymentLabel}`,
    `Tổng tiền: ${formatMoney(order.total_price)}`,
    '',
    'Sản phẩm:',
    itemText,
  ].join('\n');
  const html = `
    <div style="max-width:600px;margin:auto;font-family:Arial,sans-serif;color:#292524">
      <div style="background:#4a2c2a;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
        <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:.8">${escapeHtml(shopName)}</div>
        <h1 style="font-size:22px;margin:7px 0 0">Có đơn hàng website mới</h1>
      </div>
      <div style="padding:24px;border:1px solid #e7e5e4;border-top:0;border-radius:0 0 12px 12px">
        <p style="font-size:18px;font-weight:bold;margin-top:0">#${escapeHtml(order.orderId)}</p>
        <p><strong>Khách hàng:</strong> ${escapeHtml(order.customer_name || 'Khách Website')}<br>
        <strong>Số điện thoại:</strong> ${escapeHtml(order.customer_phone || 'Chưa có SĐT')}<br>
        <strong>Địa chỉ:</strong> ${escapeHtml(order.customer_address || 'Chưa có địa chỉ')}<br>
        <strong>Thanh toán:</strong> ${escapeHtml(paymentLabel)}</p>
        <table style="border-collapse:collapse;width:100%;margin:18px 0"><tbody>${itemRows}</tbody></table>
        <div style="font-size:18px;font-weight:bold;text-align:right">Tổng tiền: ${formatMoney(order.total_price)}</div>
      </div>
    </div>`;

  try {
    const provider = config.apiKey ? 'Brevo API' : 'SMTP';
    if (config.apiKey) {
      await sendThroughBrevoApi(config, { shopName, subject, html });
    } else {
      await getTransporter(config).sendMail({
        from: `"${shopName}" <${config.fromEmail}>`,
        to: config.recipients,
        subject,
        text,
        html,
      });
    }
    console.info(`[order-email] Đã gửi thông báo đơn #${order.orderId} qua ${provider}.`);
    return true;
  } catch (error) {
    console.error(`[order-email] Không gửi được email đơn #${order.orderId}:`, error.message);
    return false;
  }
};
