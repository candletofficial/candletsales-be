const Product = require('../models/Product');

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reply: { type: 'string' },
    intent: { type: 'string', enum: ['consult', 'buy', 'order_status', 'human', 'other'] },
    handoff: { type: 'boolean' },
    handoff_reason: { type: ['string', 'null'] },
    customer: {
      type: 'object', additionalProperties: false,
      properties: {
        name: { type: ['string', 'null'] },
        phone: { type: ['string', 'null'] },
        address: { type: ['string', 'null'] },
      },
      required: ['name', 'phone', 'address'],
    },
    cart: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          product_id: { type: 'string' },
          sku_id: { type: ['string', 'null'] },
          quantity: { type: 'integer', minimum: 1, maximum: 20 },
        },
        required: ['product_id', 'sku_id', 'quantity'],
      },
    },
    ready_for_draft: { type: 'boolean' },
  },
  required: ['reply', 'intent', 'handoff', 'handoff_reason', 'customer', 'cart', 'ready_for_draft'],
};

const extractText = (response) => {
  if (typeof response.output_text === 'string') return response.output_text;
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) return content.text;
    }
  }
  return '';
};

const productCatalog = async () => {
  const products = await Product.find()
    .select('productId name image description base_price category scent_group volume variant_groups skus')
    .limit(60)
    .lean();

  return products.map((product) => ({
    _id: String(product._id),
    productId: product.productId,
    name: product.name,
    description: String(product.description || '').slice(0, 500),
    base_price: product.base_price,
    category: product.category,
    scent_group: product.scent_group,
    volume: product.volume,
    variants: product.variant_groups,
    skus: (product.skus || []).map((sku) => ({ id: sku.id, price: sku.price, combination: sku.combination })),
  }));
};

async function generateSalesReply(conversation, incomingText) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  const catalog = await productCatalog();
  const history = conversation.history || [];
  const withoutCurrentMessage = history.at(-1)?.role === 'user' && history.at(-1)?.text === incomingText
    ? history.slice(0, -1) : history;
  const recentHistory = withoutCurrentMessage.slice(-12).map(({ role, text }) => ({ role, text }));

  const instructions = `Bạn là nhân viên tư vấn bán nến thơm Candlet trên Facebook Messenger.
Trả lời tiếng Việt, thân thiện, ngắn gọn, mỗi lượt chỉ hỏi tối đa một câu.
Chỉ tư vấn sản phẩm có trong CATALOG. Không bịa giá, khuyến mãi, tồn kho, công dụng y tế hoặc chính sách.
Ưu tiên hỏi mục đích, nhóm hương và ngân sách; đề xuất tối đa 3 sản phẩm.
Khi khách muốn mua, thu lần lượt sản phẩm/SKU/số lượng, họ tên, số điện thoại và địa chỉ.
Chỉ đặt ready_for_draft=true khi khách đã xác nhận rõ ràng toàn bộ đơn và đủ tên, số điện thoại, địa chỉ, ít nhất một sản phẩm.
Nếu khách khiếu nại, hoàn tiền, gửi biên lai, yêu cầu nhân viên, hỏi vấn đề sức khỏe hoặc yêu cầu ngoài dữ liệu thì handoff=true.
Giữ lại dữ liệu đã có trong CURRENT_STATE nếu khách không thay đổi. product_id và sku_id phải sao chép chính xác từ CATALOG.`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_SALES_MODEL || 'gpt-5.4-mini',
      instructions,
      input: JSON.stringify({
        current_state: {
          customer: conversation.customer,
          cart: conversation.cart,
          stage: conversation.stage,
          referral: conversation.referral,
        },
        history: recentHistory,
        customer_message: incomingText,
        catalog,
      }),
      text: { format: { type: 'json_schema', name: 'candlet_sales_reply', strict: true, schema: OUTPUT_SCHEMA } },
      max_output_tokens: 900,
      store: false,
    }),
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI request failed (${response.status})`);
  const text = extractText(payload);
  if (!text) throw new Error('OpenAI returned an empty response');
  return JSON.parse(text);
}

module.exports = { generateSalesReply };
