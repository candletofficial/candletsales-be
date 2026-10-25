# Candlet Messenger AI bot

Bot nhận tin nhắn Facebook Page, tư vấn bằng OpenAI và chỉ tạo đơn nháp sau khi khách đã xác nhận đủ thông tin. Luồng production dùng Cloudflare Worker và Queue để việc nhận webhook không phụ thuộc vào trạng thái ngủ của Render.

```text
Meta Messenger
    -> Cloudflare Worker (xác thực chữ ký, trả 200 nhanh)
    -> Cloudflare Queue (lưu, retry, DLQ)
    -> Render /api/webhooks/meta/queued
    -> MongoDB + OpenAI + Meta Send API
```

## Biến môi trường trên Render

Thêm các giá trị sau vào **Render > candletshop-api > Environment**. Không đưa giá trị thật lên Git.

```env
OPENAI_API_KEY=
OPENAI_SALES_MODEL=gpt-5.4-mini
META_PAGE_ACCESS_TOKEN=
META_VERIFY_TOKEN=
META_APP_SECRET=
META_GRAPH_VERSION=v24.0
META_QUEUE_SECRET=
```

- `META_VERIFY_TOKEN`: chuỗi ngẫu nhiên dùng chung giữa Meta và Worker.
- `META_QUEUE_SECRET`: chuỗi ngẫu nhiên khác, dùng chung giữa Worker và Render.
- Có thể tạo từng chuỗi bằng lệnh:

  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Sau khi thêm biến, deploy backend trước. Endpoint dành cho Queue là:

`https://api.candlet.shop/api/webhooks/meta/queued`

## Triển khai Cloudflare Worker và Queue

Mở terminal tại `candletsales-be/cloudflare/messenger-webhook`, sau đó chạy:

```powershell
npx --yes wrangler@latest login
npx --yes wrangler@latest queues create candlet-messenger-events
npx --yes wrangler@latest queues create candlet-messenger-events-dlq
Copy-Item .dev.vars.example .dev.vars
```

Mở `.dev.vars`, điền bốn giá trị sau rồi lưu:

```env
META_VERIFY_TOKEN=<giống Render>
META_APP_SECRET=<giống Render>
META_QUEUE_SECRET=<giống Render>
RENDER_WEBHOOK_URL=https://api.candlet.shop/api/webhooks/meta/queued
```

Triển khai Worker cùng các secret:

```powershell
npm run deploy
```

File `.dev.vars` đã được Git bỏ qua. Không commit hoặc gửi file này cho người khác. Worker không cần `OPENAI_API_KEY` hoặc `META_PAGE_ACCESS_TOKEN`.

## Cấu hình Meta

1. Mở Meta for Developers và chọn Business app.
2. Thêm Messenger, kết nối Facebook Page Candlet và tạo Page Access Token.
3. Trong cấu hình Webhooks, đặt callback URL thành URL `workers.dev` do lệnh deploy trả về, ví dụ:

   `https://candlet-messenger-webhook.<account>.workers.dev`

4. Nhập `META_VERIFY_TOKEN` giống Worker và Render.
5. Subscribe Page vào tối thiểu sự kiện `messages` và `messaging_postbacks`.
6. Hoàn tất quyền và App Review của Meta trước khi phục vụ tài khoản không thuộc nhóm tester.

Không đặt callback Meta trực tiếp về Render khi dùng Queue. Route `/api/webhooks/meta` được giữ làm phương án chạy local hoặc khôi phục tạm thời.

## Thao tác trong trang quản trị

Mở `/admin/messenger-bot` để xem hội thoại cần người xử lý, tạm dừng hoặc tiếp tục bot theo từng khách, và duyệt hoặc từ chối đơn nháp. Khi duyệt, hệ thống tạo đơn Facebook có mã theo dõi, kiểm tra và trừ nguyên liệu, rồi gửi mã đơn cùng liên kết theo dõi cho khách.

### Huấn luyện chuyên sâu

Tab **Huấn luyện chuyên sâu** cho phép admin khai báo quy trình tư vấn, câu hỏi khám phá nhu cầu, nguyên tắc trả lời, quy tắc chốt đơn và cách xử lý từng phản đối. Mỗi tình huống phản đối nhập theo mẫu `Băn khoăn của khách | Cách xử lý mong muốn`. Bot kết hợp dữ liệu này với chính sách, FAQ, ví dụ hội thoại và hồ sơ từng sản phẩm; đây là cập nhật ngữ cảnh vận hành, không phải fine-tune mô hình.

### Thư viện ảnh AI

Tab **Thư viện ảnh** cho phép tải ảnh riêng ngoài ảnh sản phẩm, đặt tên, mô tả, từ khóa kích hoạt, ghi chú cách dùng, mức ưu tiên và liên kết với sản phẩm. Chỉ ảnh đang bật và có URL HTTPS công khai mới được đưa cho AI lựa chọn. AI chỉ trả về ID ảnh; backend kiểm tra ID với cơ sở dữ liệu rồi mới gửi qua Messenger và ghi nhớ ảnh đã gửi để tránh lặp trong cùng phiên tư vấn.

Nên dùng ảnh rõ nội dung và tách theo đúng mục đích, chẳng hạn mẫu gói quà, bảng kích thước, hướng dẫn sử dụng hoặc ảnh phối cảnh. Phần **Khi nào nên dùng** cần mô tả cụ thể yêu cầu của khách mà ảnh giải đáp. Không tải ảnh chứa giá hoặc khuyến mãi dễ hết hạn nếu chưa có quy trình cập nhật định kỳ.

Trang này có ba phần:

1. **Vận hành**: xem hội thoại, chuyển giữa bot/nhân viên/tạm dừng và duyệt đơn nháp.
2. **Kiến thức**: nhập giọng thương hiệu, lời chào, chính sách, khuyến mãi đang áp dụng, nội dung cấm, chủ đề cần chuyển nhân viên, FAQ và ví dụ hội thoại.
3. **Dạy theo sản phẩm**: bổ sung tầng hương, cường độ, không gian, dịp sử dụng, cảm xúc, đối tượng, thời gian đốt, điểm bán hàng và từ khóa cho từng sản phẩm.

Trong tab **Vận hành**, quản trị viên có thể tìm và lọc hội thoại, xem lịch sử chat, thông tin nhận hàng, nguồn quảng cáo và giỏ hàng; trả lời khách trực tiếp qua Messenger; chuyển quyền xử lý giữa bot và nhân viên; hoặc chọn **Phiên tư vấn mới** để xóa trạng thái bán hàng hiện tại. Lịch sử cũ vẫn được giữ để đối soát nhưng không còn được đưa vào ngữ cảnh AI của phiên mới. Khu vực đơn nháp hỗ trợ lọc theo trạng thái trước khi duyệt hoặc từ chối.

Nên hoàn thiện dữ liệu theo thứ tự trên, sau đó nhắn thử các nhóm tình huống: hỏi chung, tìm theo mùi/không gian/ngân sách, mua một sản phẩm, sửa thông tin nhận hàng, khiếu nại và hỏi ngoài dữ liệu. Bot chỉ gửi bản tóm tắt khi đã đủ sản phẩm, số lượng, họ tên, số điện thoại và địa chỉ. Khách phải gửi thêm một tin nhắn xác nhận rõ ràng như `Xác nhận` hoặc `Chốt đơn`; lúc đó hệ thống mới tạo đơn nháp để admin duyệt.

Khi bot đề xuất sản phẩm cụ thể, Messenger gửi thêm một carousel tối đa 3 thẻ gồm ảnh, tên, giá và nút mở trang sản phẩm. Ảnh sản phẩm phải là URL HTTPS công khai. Mỗi ảnh chỉ được gửi một lần trong cùng hội thoại để tránh làm phiền khách.

Khi cập nhật kiến thức, chỉ nhập chính sách đang có hiệu lực. Không đưa API key, mật khẩu hoặc dữ liệu riêng tư vào FAQ, ví dụ hội thoại hay ghi chú sản phẩm.

## Kiểm tra

1. Trong thư mục Worker, chạy `npm test`.
2. Nhắn thử vào Page sau khi Render đã ngủ hơn 15 phút.
3. Kiểm tra **Cloudflare > Workers & Pages > candlet-messenger-webhook > Logs**.
4. Kiểm tra **Queues > candlet-messenger-events**: backlog phải trở về 0 sau khi Render thức dậy.
5. Kiểm tra Render logs và trang `/admin/messenger-bot`.
6. Nếu một sự kiện thất bại 10 lần, kiểm tra queue `candlet-messenger-events-dlq`.

Queue ngăn tin nhắn bị mất trong thời gian Render cold-start và tự thử lại sau 60 giây. Gói Cloudflare Free lưu message tối đa 24 giờ, vì vậy vẫn cần theo dõi DLQ và cảnh báo vận hành.

## Quy tắc vận hành

- Bot không tạo đơn thật trước khi khách xác nhận và admin duyệt.
- Khiếu nại, hoàn tiền, biên lai chuyển khoản, nội dung sức khỏe và yêu cầu gặp người thật được chuyển cho nhân viên.
- Meta message ID đã xử lý được bỏ qua trong 30 ngày; sự kiện lỗi hoặc bị kẹt quá thời gian lease có thể được Queue thử lại.
- OpenAI nhận danh mục sản phẩm và phần hội thoại gần nhất; request dùng `store: false`.
