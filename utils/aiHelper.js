/**
 * aiHelper.js
 * Build context prompt từ dữ liệu kinh doanh thực tế để đưa vào Gemini AI
 */

const formatCurrency = (n) =>
  Math.round(n || 0).toLocaleString('vi-VN') + ' ₫';

const formatPct = (n) => (n != null ? `${Number(n).toFixed(1)}%` : 'N/A');

/**
 * Xây dựng system prompt chứa dữ liệu kinh doanh hiện tại
 * @param {Object} dashboardData - Dữ liệu từ getDashboardStats
 * @param {string} periodLabel - Nhãn kỳ (VD: "Tháng này")
 */
const buildBusinessContext = (dashboardData, periodLabel = 'kỳ hiện tại') => {
  if (!dashboardData) {
    return `Bạn là AI Business Analyst cho cửa hàng nến thơm handmade "Candlet Sales".
Hiện chưa có dữ liệu kinh doanh. Hãy trả lời các câu hỏi chung về kinh doanh nến thơm.`;
  }

  const d = dashboardData;

  // Metrics chính
  const mainMetrics = `
## KẾT QUẢ KINH DOANH (${periodLabel})
- Doanh thu: ${formatCurrency(d.totalRevenue)} (tăng trưởng: ${formatPct(d.revenueGrowth)})
- Số đơn hàng: ${d.newOrders} đơn (tăng trưởng: ${formatPct(d.ordersGrowth)})
- Lợi nhuận thực tế: ${formatCurrency(d.realProfit)} (tăng trưởng: ${formatPct(d.realProfitGrowth)})
- Đơn bị hoàn: ${d.returnedOrders || 0} đơn (tỷ lệ hoàn: ${formatPct(d.returnRate)}, phí hoàn: ${formatCurrency(d.returnCost)})
- Chi phí vốn hàng bán (COGS): ${formatCurrency(d.cogs)}
- Chi phí quảng cáo: ${formatCurrency(d.adCost)} (tăng trưởng: ${formatPct(d.adCostGrowth)})
- Chi phí logistics: ${formatCurrency(d.logisticsCost)}
- Đơn thay thế: ${d.replacementOrders || 0} đơn (chi phí: ${formatCurrency(d.replacementCost)})
- Chi phí seeding: ${formatCurrency(d.seedingCost)}
- Giá trị tồn kho NVL: ${formatCurrency(d.inventoryValue)}
`;

  // Cơ cấu chi phí
  const costStructure = d.costStructure
    ? `
## CƠ CẤU CHI PHÍ
- Quảng cáo: ${formatPct(d.costStructure.ads)}
- Kho & Vận hành (COGS): ${formatPct(d.costStructure.inventory)}
- Logistics & Hoàn hàng: ${formatPct(d.costStructure.logistics)}
`
    : '';

  // Hiệu suất theo nền tảng
  let platformSection = '';
  if (d.platformStats && d.platformStats.length > 0) {
    const rows = d.platformStats.map(
      (p) =>
        `  - ${p.source}: ${p.orders} đơn, doanh thu ${formatCurrency(p.revenue)}, hoàn ${p.returned} đơn, thay thế ${p.replacements} đơn`
    );
    platformSection = `
## HIỆU SUẤT THEO NỀN TẢNG
${rows.join('\n')}
`;
  }

  // Hiệu suất sản phẩm
  let productSection = '';
  if (d.productStats && d.productStats.length > 0) {
    const top5 = d.productStats.slice(0, 5);
    const rows = top5.map(
      (p) =>
        `  - "${p.product_name}": ${p.totalQty} cái, DT ${formatCurrency(p.totalRevenue)}, biên gộp ${formatPct(p.grossMargin)}, lợi nhuận ròng ${formatCurrency(p.netProfit)}, tỷ lệ hoàn ${formatPct(p.returnRate)}`
    );
    productSection = `
## HIỆU SUẤT SẢN PHẨM (Top ${top5.length})
${rows.join('\n')}
`;
  }

  return `Bạn là AI Business Analyst thông minh cho cửa hàng nến thơm handmade "Candlet Sales".
Nhiệm vụ của bạn là phân tích dữ liệu kinh doanh và trả lời các câu hỏi của chủ shop một cách rõ ràng, thực tế, hữu ích.

NGUYÊN TẮC TRẢ LỜI:
- Luôn trả lời bằng tiếng Việt, thân thiện nhưng chuyên nghiệp
- Dựa vào DỮ LIỆU THỰC bên dưới để trả lời, không bịa số liệu
- Nếu câu hỏi ngoài phạm vi dữ liệu, hãy nói rõ và gợi ý cách tìm thêm thông tin
- Khi phân tích, hãy đưa ra nhận xét cụ thể và gợi ý hành động thực tế
- Sử dụng emoji phù hợp để câu trả lời sinh động hơn
- Định dạng số tiền theo kiểu Việt Nam (VD: 1.500.000 ₫)
- Khi thấy vấn đề, hãy nêu rõ và đưa ra giải pháp cụ thể
${mainMetrics}${costStructure}${platformSection}${productSection}`;
};

/**
 * Câu hỏi gợi ý mặc định cho người dùng
 */
const SUGGESTED_QUESTIONS = [
  'Tháng này kinh doanh thế nào?',
  'Sản phẩm nào đang bán chạy nhất?',
  'Chi phí quảng cáo có đang quá cao không?',
  'Tỷ lệ hoàn hàng có ổn không?',
  'Lợi nhuận thực tế của mình là bao nhiêu?',
  'Nền tảng nào đang hiệu quả nhất?',
  'Mình nên cải thiện gì để tăng lợi nhuận?',
];

/**
 * Xây dựng prompt cho tính năng Smart Alerts
 * Bắt buộc AI trả về mảng JSON chứa tối đa 3 cảnh báo/insight
 */
const buildSmartAlertsPrompt = (dashboardData) => {
  const baseContext = buildBusinessContext(dashboardData, 'kỳ hiện tại');
  return `${baseContext}

NHIỆM VỤ CỦA BẠN:
Phân tích dữ liệu trên và đưa ra TỐI ĐA 3 cảnh báo hoặc điểm sáng quan trọng nhất về tình hình kinh doanh.
Hãy chú ý đến:
- Lợi nhuận âm hoặc giảm sút
- Chi phí quảng cáo quá cao so với doanh thu
- Tỷ lệ hoàn hàng cao
- Sản phẩm bán rất chạy hoặc mang lại lợi nhuận tốt
- Sản phẩm bị hoàn hàng nhiều

YÊU CẦU ĐẦU RA BẮT BUỘC:
Trả về DUY NHẤT một mảng JSON hợp lệ với định dạng sau (không bao gồm text markdown nào khác):
[
  {
    "type": "danger" | "warning" | "success" | "info",
    "title": "Tiêu đề ngắn gọn (VD: Phí quảng cáo cao)",
    "message": "Nội dung giải thích ngắn gọn (VD: Chi phí quảng cáo chiếm 45% doanh thu, cần tối ưu lại chiến dịch để đảm bảo lợi nhuận.)"
  }
]
`;
};

module.exports = { buildBusinessContext, SUGGESTED_QUESTIONS, buildSmartAlertsPrompt };
