/**
 * aiHelper.js
 * Xây dựng ngữ cảnh dữ liệu kinh doanh đồng bộ toàn hệ thống cho AI Business Analyst (OpenAI GPT / Gemini)
 */

const formatCurrency = (n) =>
  Math.round(Number(n) || 0).toLocaleString('vi-VN') + ' ₫';

const formatPct = (n) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return 'Chưa có kỳ trước để so sánh';
  const val = Number(n);
  return `${val > 0 ? '+' : ''}${val.toFixed(1)}%`;
};

const formatRatioPct = (n) => (n != null && !Number.isNaN(Number(n)) ? `${Number(n).toFixed(1)}%` : '0.0%');

/**
 * Xây dựng system prompt chứa toàn bộ dữ liệu kinh doanh thực tế đã đồng bộ
 * @param {Object} dashboardData - Dữ liệu tổng hợp toàn hệ thống
 * @param {string} periodLabel - Nhãn kỳ (VD: "Tháng này", "Hôm nay", "Tuần này"...)
 * @param {string} currentPage - Trang admin hiện tại người dùng đang xem (tùy chọn)
 */
const buildBusinessContext = (dashboardData, periodLabel = 'Tháng này', currentPage = '') => {
  if (!dashboardData) {
    return `Bạn là AI Business Analyst cấp cao cho cửa hàng nến thơm handmade "CandletShop".
Hiện chưa có dữ liệu kinh doanh. Hãy trả lời các câu hỏi chung về kinh doanh nến thơm.`;
  }

  const d = dashboardData;
  const dateRangeText = d.dateRange
    ? `${d.dateRange.startDate} đến ${d.dateRange.endDate} (${d.dateRange.days} ngày)`
    : periodLabel;

  const aov = d.newOrders > 0 ? d.totalRevenue / d.newOrders : 0;
  const netMargin = d.totalRevenue > 0 ? (d.realProfit / d.totalRevenue) * 100 : 0;
  const cogsRatio = d.totalRevenue > 0 ? (d.cogs / d.totalRevenue) * 100 : 0;
  const adRatio = d.totalRevenue > 0 ? (d.adCost / d.totalRevenue) * 100 : 0;
  const roas = d.adCost > 0 ? (d.totalRevenue / d.adCost).toFixed(2) : null;

  // 1. Kết quả kinh doanh kỳ đang chọn (đồng bộ 100% với Dashboard)
  const mainMetrics = `
## 1. KẾT QUẢ KINH DOANH KỲ ĐANG XEM: "${periodLabel}" (${dateRangeText})
- Doanh thu thuần (đơn hoạt động/hoàn tất, không tính đơn hoàn/hủy/đền bù/seeding): ${formatCurrency(d.totalRevenue)} (So với kỳ trước: ${formatPct(d.revenueGrowth)})
- Số đơn hàng tính doanh thu: ${d.newOrders} đơn (So với kỳ trước: ${formatPct(d.ordersGrowth)})
- Giá trị đơn hàng trung bình (AOV): ${formatCurrency(aov)}
- Lợi nhuận thực tế (Real Profit = Doanh thu - COGS - Ads - Logistics - Phí hoàn - Đơn đền bù - Seeding - Affiliate): ${formatCurrency(d.realProfit)} (Biên lợi nhuận ròng: ${formatRatioPct(netMargin)}, So với kỳ trước: ${formatPct(d.realProfitGrowth)})
- Giá vốn hàng bán & đóng gói (COGS): ${formatCurrency(d.cogs)} (Chiếm ${formatRatioPct(cogsRatio)} doanh thu)
- Chi phí quảng cáo (Ads): ${formatCurrency(d.adCost)} (Chiếm ${formatRatioPct(adRatio)} doanh thu${roas ? `, ROAS tổng: ${roas}x` : ''}, So với kỳ trước: ${formatPct(d.adCostGrowth)})
- Phí Affiliate phân bổ trong kỳ: ${formatCurrency(d.affiliateFee)}
- Chi phí vận chuyển (Logistics đơn bán): ${formatCurrency(d.logisticsCost)}
- Đơn bị hoàn trả / giao thất bại: ${d.returnedOrders || 0} đơn (Tỷ lệ hoàn/đơn bán: ${formatRatioPct(d.returnRate)}, Tổng phí phạt hoàn hàng: ${formatCurrency(d.returnCost)})
- Đơn bị hủy: ${d.cancelledOrders || 0} đơn
- Đơn gửi bù / thay thế: ${d.replacementOrders || 0} đơn (Chi phí đền bù: ${formatCurrency(d.replacementCost)})
- Đơn Seeding / tặng KOL: ${d.seedingOrders || 0} đơn (Chi phí seeding ròng: ${formatCurrency(d.seedingCost)}, So với kỳ trước: ${formatPct(d.seedingCostGrowth)})
`;

  // 2. Cơ cấu chi phí & trạng thái vận đơn
  const costStructure = d.costStructure
    ? `
## 2. CƠ CẤU CHI PHÍ & TRẠNG THÁI ĐƠN HÀNG TRONG KỲ
- Tỷ trọng cơ cấu chi phí vận hành:
  + Quảng cáo (Ads): ${formatRatioPct(d.costStructure.ads)}
  + Giá vốn nguyên liệu & đóng gói (COGS): ${formatRatioPct(d.costStructure.inventory)}
  + Logistics & Phí hoàn hàng: ${formatRatioPct(d.costStructure.logistics)}
  + Phí Affiliate: ${formatRatioPct(d.costStructure.affiliate)}
${d.deliveryBreakdown ? `- Trạng thái giao hàng toàn bộ ${d.deliveryBreakdown.total} đơn phát sinh trong kỳ:
  + Đã giao / Hoàn tất: ${d.deliveryBreakdown.delivered} đơn
  + Đang giao / Đang vận chuyển: ${d.deliveryBreakdown.shipping} đơn
  + Chờ xử lý / Đang chuẩn bị: ${d.deliveryBreakdown.pending} đơn
  + Đang hoàn / Đã hoàn / Giao thất bại: ${d.deliveryBreakdown.returned} đơn
  + Đã hủy: ${d.deliveryBreakdown.cancelled} đơn` : ''}
`
    : '';

  // 3. Quỹ tiền mặt, Số dư nền tảng, Công nợ & Chi tiêu ngoài (Real-time)
  let financeSection = '';
  if (d.fundSummary) {
    const f = d.fundSummary;
    const platformBalLines = (f.platformBalances || [])
      .filter((p) => Math.round(p.availableBalance || 0) !== 0 || Math.round(p.totalRevenue || 0) !== 0)
      .map(
        (p) =>
          `  + ${p.platform}: Số dư khả dụng chưa rút ${formatCurrency(p.availableBalance)} (Tổng thu: ${formatCurrency(p.totalRevenue)}, Đã rút về quỹ: ${formatCurrency(p.totalWithdrawn)})`
      );
    const expenseCategoryLines = (d.expenseSummary?.byCategory || []).map(
      (c) => `  + ${c.category}: ${formatCurrency(c.amount)} (${c.count} phiếu)`
    );
    const recentExpenseLines = (d.expenseSummary?.recent || []).slice(0, 5).map(
      (e) => `  + [${e.code}] ${e.title} (${e.category}): ${formatCurrency(e.amount)}`
    );

    financeSection = `
## 3. TÀI SẢN, QUỸ TIỀN MẶT, CÔNG NỢ & CHI TIÊU (ĐỒNG BỘ THỜI GIAN THỰC)
- Số dư Quỹ chung hiện tại (Tiền mặt / Ngân hàng đã đối soát): ${formatCurrency(f.totalFundBalance)}
- Tổng số dư doanh thu đang nằm trên các nền tảng / ĐVVC (chưa rút về quỹ): ${formatCurrency(f.totalPlatformAvailable)}
${platformBalLines.length > 0 ? platformBalLines.join('\n') : '  + Không có số dư treo trên nền tảng'}
- Tổng công nợ phiếu nhập kho chưa tất toán: ${formatCurrency(f.totalImportDebt)}
- TỔNG TÀI SẢN DỰ KIẾN THỰC TẾ (Quỹ hiện tại + Số dư nền tảng chưa rút - Nợ nhập kho): ${formatCurrency(f.expectedFund)}
- Phiếu chi tiêu ngoài trong kỳ (${periodLabel}): Tổng ${formatCurrency(d.expenseSummary?.totalInPeriod || 0)} (${d.expenseSummary?.countInPeriod || 0} phiếu chi)
${expenseCategoryLines.length > 0 ? `  Phân theo danh mục chi:\n${expenseCategoryLines.join('\n')}` : ''}
${recentExpenseLines.length > 0 ? `  Các khoản chi tiêu gần nhất:\n${recentExpenseLines.join('\n')}` : ''}
`;
  }

  // 4. Hiệu suất theo nền tảng bán hàng & Quảng cáo
  let platformSection = '';
  if (d.platformStats && d.platformStats.length > 0) {
    const rows = d.platformStats.map((p) => {
      const share = d.totalRevenue > 0 ? (p.revenue / d.totalRevenue) * 100 : 0;
      const platReturnRate = p.orders > 0 ? (p.returned / p.orders) * 100 : 0;
      const platRoas = p.ad_cost > 0 ? `${(p.revenue / p.ad_cost).toFixed(2)}x` : 'Không chạy Ads';
      return `  - Kênh "${p.source}": ${p.orders} đơn thành công, Doanh thu ${formatCurrency(p.revenue)} (${formatRatioPct(share)} tổng DT), Hoàn ${p.returned} đơn (${formatRatioPct(platReturnRate)}), Thay thế ${p.replacements} đơn, Chi phí Ads trong kỳ: ${formatCurrency(p.ad_cost || 0)} (ROAS: ${platRoas}), Phí Affiliate: ${formatCurrency(p.affiliate_fee || 0)}`;
    });
    const adBalanceLines = (d.adBalances || [])
      .filter((b) => Math.round(b.balance || 0) > 0 || Math.round(b.totalSpent || 0) > 0)
      .map((b) => `  + ${b.platform}: Số dư ví Ads còn lại ${formatCurrency(b.balance)} (Tổng đã chi lũy kế: ${formatCurrency(b.totalSpent)})`);

    platformSection = `
## 4. HIỆU SUẤT THEO KÊNH BÁN HÀNG & QUẢNG CÁO
${rows.join('\n')}
${adBalanceLines.length > 0 ? `- Số dư ví tài khoản quảng cáo hiện tại:\n${adBalanceLines.join('\n')}` : ''}
`;
  }

  // 5. Hiệu suất sản phẩm & phân loại mùi hương (SKU) trong kỳ
  let productSection = '';
  if (d.productStats && d.productStats.length > 0) {
    const topProducts = d.productStats.slice(0, 12);
    const rows = topProducts.map((p, idx) => {
      const topVariants = (p.variants || [])
        .slice(0, 5)
        .map((v) => `${v.sku_label}: ${v.totalQty} SP (DT ${formatCurrency(v.totalRevenue)}, LN ròng ${formatCurrency(v.netProfit)})`)
        .join(' | ');
      return `  ${idx + 1}. "${p.product_name}" (${p.productId || 'N/A'}): Bán ${p.totalQty} SP, Doanh thu thực ${formatCurrency(p.totalRevenue)}, Giá vốn ${formatCurrency(p.totalCOGS)}, Biên gộp ${formatRatioPct(p.grossMargin)}, Ads phân bổ ${formatCurrency(p.adShare)}, Lợi nhuận ròng ${formatCurrency(p.netProfit)} (Biên ròng ${formatRatioPct(p.netMargin)}), Hoàn ${p.returnedQty || 0} SP (${formatRatioPct(p.returnRate)})${topVariants ? `\n     -> Chi tiết phân loại/mùi: ${topVariants}` : ''}`;
    });
    productSection = `
## 5. HIỆU SUẤT SẢN PHẨM & MÙI HƯƠNG TRONG KỲ (${d.productStats.length} sản phẩm có doanh thu)
${rows.join('\n')}
`;
  } else {
    productSection = `
## 5. HIỆU SUẤT SẢN PHẨM TRONG KỲ
- Chưa phát sinh sản phẩm bán hoàn tất trong kỳ "${periodLabel}".
`;
  }

  // 6. Danh mục sản phẩm & Năng lực sản xuất từ tồn kho nguyên liệu (BOM)
  let catalogSection = '';
  if (d.catalogSummary) {
    const c = d.catalogSummary;
    const productLines = (c.products || []).map(
      (p) =>
        `  - "${p.name}" (${p.productId}): Giá bán ${formatCurrency(p.base_price)}, Giá vốn BOM ${formatCurrency(p.minCost)}${p.maxCost > p.minCost ? ` - ${formatCurrency(p.maxCost)}` : ''}, Có thể sản xuất tối đa: ${p.stock != null ? `${p.stock} SP` : 'Chưa gắn BOM'}${p.outOfStockSkus?.length ? ` (Phân loại hết NL: ${p.outOfStockSkus.join(', ')})` : ''}`
    );
    catalogSection = `
## 6. DANH MỤC SẢN PHẨM & NĂNG LỰC SẢN XUẤT HIỆN TẠI (TÍNH TỪ BOM NGUYÊN LIỆU)
- Tổng số sản phẩm đang kinh doanh: ${c.totalSellable} sản phẩm (và ${c.totalSubFormulas} công thức phụ)
- Sản phẩm hết nguyên liệu sản xuất (stock = 0): ${c.outOfStockCount} sản phẩm
${productLines.join('\n')}
`;
  }

  // 7. Tồn kho Nguyên vật liệu, Tinh dầu & Nhập kho
  let inventorySection = '';
  if (d.inventorySummary) {
    const inv = d.inventorySummary;
    const lowStockLines = (inv.lowOrOutMaterials || []).slice(0, 15).map(
      (m) => `  - "${m.name}" (${m.category || 'NVL'}): Tồn thực tế ${m.actualStock} ${m.unit} (Khả dụng: ${m.stock} ${m.unit}, Đơn giá: ${formatCurrency(m.price)}/${m.unit})`
    );
    const topValueLines = (inv.topValueMaterials || []).slice(0, 10).map(
      (m) => `  - "${m.name}" (${m.category || 'NVL'}): Tồn ${m.actualStock} ${m.unit} × ${formatCurrency(m.price)} = ${formatCurrency(m.totalValue)}`
    );
    inventorySection = `
## 7. TỒN KHO NGUYÊN VẬT LIỆU, TINH DẦU & NHẬP KHO (THỜI GIAN THỰC)
- Tổng giá trị tồn kho nguyên vật liệu thực tế: ${formatCurrency(d.inventoryValue)} (${inv.totalMaterials} mã nguyên vật liệu)
- Tổng giá trị tồn kho khả dụng (sau khi trừ đơn đang giữ): ${formatCurrency(inv.availableInventoryValue)}
- Số nguyên vật liệu đã hết hàng (tồn <= 0): ${inv.outOfStockCount} mã | Sắp hết hàng (0 < tồn <= 10): ${inv.lowStockCount} mã
${lowStockLines.length > 0 ? `- Danh sách nguyên vật liệu hết hàng / sắp hết cần chú ý nhập:\n${lowStockLines.join('\n')}` : '- Toàn bộ nguyên vật liệu đều đang còn tồn kho ổn định.'}
${topValueLines.length > 0 ? `- Top nguyên vật liệu chiếm giá trị vốn tồn kho lớn nhất:\n${topValueLines.join('\n')}` : ''}
- Tình hình nhập kho trong kỳ (${periodLabel}): ${inv.importsInPeriodCount || 0} phiếu hoàn thành, tổng tiền nhập ${formatCurrency(inv.importsInPeriodAmount || 0)} (Phiếu nhập đang chờ duyệt: ${inv.pendingImportsCount || 0} phiếu)
`;
  }

  // 8. Xu hướng theo ngày trong kỳ
  let trendSection = '';
  if (d.trendSummary) {
    const t = d.trendSummary;
    trendSection = `
## 8. ĐIỂM NHẤN XU HƯỚNG THEO NGÀY TRONG KỲ
- Ngày có doanh thu cao nhất: ${t.peakRevenueDay?.date || 'N/A'} (${formatCurrency(t.peakRevenueDay?.revenue || 0)})
- Ngày có tổng chi phí cao nhất: ${t.peakCostDay?.date || 'N/A'} (${formatCurrency(t.peakCostDay?.cost || 0)})
- Số ngày có phát sinh doanh thu: ${t.activeSalesDays}/${t.totalDays} ngày
`;
  }

  return `Bạn là **AI Business Analyst & Cố vấn Tài chính - Vận hành cấp cao** của cửa hàng nến thơm handmade **"CandletShop"**.
Nhiệm vụ của bạn là phân tích sâu sắc dữ liệu kinh doanh thời gian thực của cửa hàng, phát hiện điểm nghẽn, cơ hội tăng trưởng và tư vấn chiến lược cụ thể cho chủ shop.
${currentPage ? `\nNgữ cảnh phiên làm việc: Chủ shop đang mở khung chat từ trang quản trị "${currentPage}".` : ''}

NGUYÊN TẮC PHÂN TÍCH & TRẢ LỜI:
1. **Chính xác tuyệt đối theo dữ liệu thực**: Luôn trích dẫn đúng con số từ dữ liệu hệ thống bên dưới (doanh thu, lợi nhuận thực tế, biên lợi nhuận, AOV, ROAS, phí hoàn, số dư quỹ, công nợ, tồn kho nguyên vật liệu, năng lực sản xuất BOM...). Tuyệt đối không tự bịa số liệu.
2. **Cấu trúc chuyên nghiệp, dễ đọc**:
   - Trình bày bằng tiếng Việt rõ ràng, súc tích, chia mục hợp lý, in đậm (**...**) các chỉ số quan trọng.
   - Luôn đi theo cấu trúc: **Số liệu thực tế** -> **Nhận định / Nguyên nhân cốt lõi** -> **Đề xuất hành động cụ thể cho CandletShop**.
3. **Tư duy CFO & Giám đốc Vận hành**:
   - Đánh giá mối tương quan giữa Doanh thu - Giá vốn (COGS) - Quảng cáo (Ads/ROAS) - Phí hoàn hàng - Dòng tiền thực trong quỹ.
   - Nếu thấy sản phẩm bán chạy nhưng nguyên vật liệu sắp hết hoặc năng lực sản xuất (stock BOM) thấp, hãy chủ động cảnh báo nhập kho.
   - Định dạng tiền tệ chuẩn Việt Nam (VD: 1.500.000 ₫).
${mainMetrics}${costStructure}${financeSection}${platformSection}${productSection}${catalogSection}${inventorySection}${trendSection}`;
};

/**
 * Câu hỏi gợi ý mặc định cho người dùng
 */
const SUGGESTED_QUESTIONS = [
  'Đánh giá tổng quan sức khỏe kinh doanh và dòng tiền hiện tại?',
  'Sản phẩm và mùi hương nào đang mang lại lợi nhuận ròng tốt nhất?',
  'Chi phí quảng cáo (ROAS) và tỷ lệ hoàn hàng từng kênh có ổn không?',
  'Tồn kho nguyên vật liệu nào sắp hết hoặc đang đọng nhiều vốn nhất?',
  'So sánh quỹ tiền mặt, số dư nền tảng chưa rút và công nợ nhập kho?',
  'Mình nên tối ưu gì ngay để tăng lợi nhuận thực tế trong kỳ này?',
];

/**
 * Xây dựng prompt cho tính năng Smart Alerts
 * Bắt buộc AI trả về mảng JSON chứa tối đa 3 cảnh báo/insight
 */
const buildSmartAlertsPrompt = (dashboardData) => {
  const baseContext = buildBusinessContext(dashboardData, 'Tháng này');
  return `${baseContext}

NHIỆM VỤ CỦA BẠN:
Phân tích dữ liệu thực tế trên và đưa ra TỐI ĐA 3 cảnh báo hoặc điểm sáng quan trọng nhất về tình hình kinh doanh, dòng tiền, quảng cáo hoặc tồn kho.
Hãy ưu tiên các vấn đề có số liệu cụ thể:
- Lợi nhuận âm, sụt giảm hoặc biên lợi nhuận thấp
- Chi phí quảng cáo cao so với doanh thu hoặc ROAS thấp
- Tỷ lệ hoàn hàng cao ở kênh hoặc sản phẩm cụ thể
- Sản phẩm chủ lực bán chạy / biên lợi nhuận tốt
- Nguyên vật liệu quan trọng sắp hết hàng hoặc công nợ nhập kho lớn

YÊU CẦU ĐẦU RA BẮT BUỘC:
Trả về DUY NHẤT một mảng JSON hợp lệ gồm tối đa 3 phần tử với định dạng sau (không bao gồm markdown hay giải thích ngoài JSON):
[
  {
    "type": "danger" | "warning" | "success" | "info",
    "title": "Tiêu đề ngắn gọn (VD: Phí quảng cáo cao)",
    "message": "Nội dung giải thích ngắn gọn kèm số liệu thực tế (VD: Chi phí quảng cáo chiếm 45% doanh thu, cần tối ưu lại chiến dịch để đảm bảo lợi nhuận.)"
  }
]
`;
};

module.exports = { buildBusinessContext, SUGGESTED_QUESTIONS, buildSmartAlertsPrompt };
