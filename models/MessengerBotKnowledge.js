const mongoose = require('mongoose');

const faqSchema = new mongoose.Schema({
  question: { type: String, required: true, trim: true },
  answer: { type: String, required: true, trim: true },
}, { _id: false });

const exampleSchema = new mongoose.Schema({
  customer: { type: String, required: true, trim: true },
  assistant: { type: String, required: true, trim: true },
}, { _id: false });

const objectionSchema = new mongoose.Schema({
  objection: { type: String, required: true, trim: true },
  response: { type: String, required: true, trim: true },
}, { _id: false });

const schema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true, immutable: true },
  brand_voice: { type: String, default: 'Ấm áp, tinh tế, chân thành; xưng Candlet và gọi khách là bạn.' },
  greeting: { type: String, default: 'Candlet chào bạn. Mình có thể giúp bạn chọn mùi hương phù hợp nhé.' },
  shipping_policy: { type: String, default: '' },
  payment_policy: { type: String, default: '' },
  return_policy: { type: String, default: '' },
  processing_policy: { type: String, default: '' },
  gift_policy: { type: String, default: '' },
  active_promotion: { type: String, default: '' },
  sales_process: { type: String, default: '' },
  discovery_questions: { type: [String], default: [] },
  response_guidelines: { type: [String], default: [] },
  closing_rules: { type: [String], default: [] },
  objection_handlers: { type: [objectionSchema], default: [] },
  prohibited_claims: { type: [String], default: ['Không cam kết công dụng điều trị hoặc chữa bệnh', 'Không tự tạo giá hoặc khuyến mãi'] },
  handoff_topics: { type: [String], default: ['khiếu nại', 'hoàn tiền', 'đổi trả', 'biên lai chuyển khoản', 'vấn đề sức khỏe'] },
  faqs: { type: [faqSchema], default: [] },
  examples: { type: [exampleSchema], default: [] },
  version: { type: Number, default: 1, min: 1 },
  updated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

module.exports = mongoose.model('MessengerBotKnowledge', schema);
