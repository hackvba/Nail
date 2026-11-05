# Website đặt lịch nail trực tuyến

**Chức năng:** Khách chọn thợ, ngày/giờ còn trống, dịch vụ checkbox (Manicure, Fill, Full Set, Pedicure + Full Set Toe/Color Change), nhập tên và số điện thoại; hệ thống lưu lịch vào PostgreSQL, tự chặn đặt chồng lịch cùng thợ; chủ tiệm xem/hủy lịch tại `/admin.html`. Nếu cấu hình Resend, tiệm sẽ nhận email khi có khách đặt lịch mới.

## Đưa website lên Internet

1. Tạo PostgreSQL database (ví dụ Neon tại https://neon.tech) và sao chép chuỗi kết nối `DATABASE_URL`.
2. Tạo tài khoản hosting Node.js (ví dụ Render tại https://render.com hoặc Railway tại https://railway.com), đưa toàn bộ thư mục này lên repo GitHub và triển khai loại **Web Service**. Build command `npm install`; start command `npm start`.
3. Trong môi trường hosting, thêm biến `DATABASE_URL`, `ADMIN_PASSWORD` (ít nhất 16 ký tự), `SHOP_NAME`, `STAFF_NAMES`, `SHOP_TIMEZONE=America/Los_Angeles`, `SHOP_EMAIL`.
4. Muốn nhận email: đăng ký https://resend.com, xác minh domain gửi, tạo `RESEND_API_KEY`, khai báo `MAIL_FROM` là email gửi thuộc domain đó, `SHOP_EMAIL` là email chủ tiệm nhận thông báo. Không có Resend, lịch vẫn được lưu và hiển thị trong dashboard nhưng **không có email**.
5. Mở địa chỉ hosting (ví dụ `https://your-site.onrender.com`) để khách đặt lịch. Mở `/admin.html` và nhập `ADMIN_PASSWORD` để xem danh sách lịch.

## Chạy trên máy tính

Cần Node.js >=20 và PostgreSQL. Sao chép `.env.example` thành `.env`, điền giá trị, chạy `npm install`, rồi `npm start`. Mở `http://localhost:3000`.

## Lưu ý vận hành

- Số điện thoại là trường liên hệ, **không phải xác minh OTP**. Có thể có khách nhập sai số. Hệ thống **không gửi SMS**; email thông báo cho tiệm là tùy chọn như trên.
- Để chủ tiệm luôn nhận lịch, nên mở `/admin.html` thường xuyên và thiết lập Resend. Nếu email lỗi, lịch vẫn lưu; dashboard hiển thị trạng thái `failed`.
- Thời gian làm dịch vụ chỉ là **giá trị mẫu**. Có thể sửa `SERVICES` trong `server.js`. Giờ tiệm mở 9:00–18:00, 30 phút một ô; sửa `OPEN`,`CLOSE` nếu cần. Hiện tại mặc định nhận lịch cả 7 ngày; chưa có lịch nghỉ/lễ riêng.
- Chỉ đặt trước tối đa 60 ngày. Không thu tiền cọc. Không có xác nhận tự động qua SMS hay email khách; chỉ có màn hình xác nhận.
- Không chia sẻ mật khẩu quản lý. Bật HTTPS (hosting công khai thường cung cấp sẵn). Nên thêm chính sách bảo mật ngắn gọn trước khi chính thức nhận dữ liệu khách hàng.
- Hệ thống kiểm tra lịch trùng khi khôi phục lịch đã hủy.
