# Cloudinary cho ảnh sản phẩm

Backend tải ảnh lên Cloudinary bằng API có chữ ký. Không đưa `CLOUDINARY_API_SECRET` sang frontend hoặc GitHub.

## Biến môi trường

Thêm các biến này vào `.env` khi chạy local và Render Environment khi deploy:

```env
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```

Lấy cả ba giá trị từ Cloudinary Console > Dashboard > Product Environment Credentials.

## Hoạt động

- Chỉ admin đã đăng nhập được gọi API upload.
- Backend giữ ảnh trong RAM và chuyển tiếp sang thư mục `candletshop/products` trên Cloudinary.
- Database lưu URL HTTPS của Cloudinary, nên ảnh không phụ thuộc vào ổ đĩa local hoặc Render.
- Khi admin thay hoặc xóa ảnh đã upload, backend xóa asset Cloudinary tương ứng.

Ảnh cũ với URL `/uploads/...` vẫn tương thích ở local nếu file còn tồn tại. Chúng không tự được chuyển sang Cloudinary.
