# Aetherium AIoT Dashboard (Frontend YoloHome)

Giao diện web thuần (HTML + ES Modules, Tailwind CDN), gọi Backend qua REST + Socket.IO.

## Chạy

ES Modules không chạy với `file://`, cần một web server tĩnh:

    cd Frontend
    python3 -m http.server 8000     # mở http://localhost:8000

Địa chỉ Backend sửa trong `js/config.js` (`API_BASE_URL`, `SOCKET_URL`). Origin của trang (VD `http://localhost:8000`)
phải nằm trong `CORS_ORIGIN` của Backend (mặc định đã có localhost:8000 và 5500).
Cần Internet để tải Tailwind, font, Socket.IO client và mô hình face-api.js từ CDN.

Tài khoản demo (sau khi chạy `Database/seed_demo.sql`): `owner@yolohome.local` / `123456`.

## Các trang (hash router)

| Route | File | Nội dung |
|---|---|---|
| `#/monitor` | `js/pages/monitoring.js` | Giám sát nhiệt độ, độ ẩm, ánh sáng, PIR; biểu đồ 24h; mô phỏng LCD |
| `#/control` | `js/pages/control.js` | Đèn (bật/tắt + màu RGB), quạt 0–100%, còi; chế độ tự động/thủ công |
| `#/door` | `js/pages/door.js` | Bàn phím PIN, đổi PIN, cấp/thu hồi PIN, mở từ xa, lịch sử truy cập |
| `#/ai` | `js/pages/ai.js` | Lệnh giọng nói tiếng Việt + phản hồi trợ lý, FaceAI (face-api.js) |
| `#/history` | `js/pages/history.js` | Cảnh báo đang hoạt động, nhật ký |
| `#/settings` | `js/pages/settings.js` | Ngưỡng cảnh báo (lưu ở Backend), đăng ký cảm biến, gửi telemetry thử |

## Nguyên tắc

- **Backend là nguồn trạng thái duy nhất.** Ngưỡng cảnh báo, chế độ tự động và việc tự bật/tắt thiết bị chạy ở
  Backend (`Backend/src/services/automation.js`), nên vẫn hoạt động khi không ai mở web và mọi thành viên thấy cùng một cấu hình.
- Trạng thái chung + kết nối Socket.IO: `js/store.js`. Sự kiện realtime: `sensor_update`, `device_state_updated`,
  `door_state_updated`, `alerts_updated`, `settings_updated`, `assistant_message`.
- localStorage chỉ dùng cho tiện ích của từng trình duyệt: token đăng nhập, nhà đang chọn, nhật ký nhanh, khoảng thời gian biểu đồ.
