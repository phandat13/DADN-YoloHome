# Aetherium AIoT Dashboard

Chạy qua web server (ES Modules không chạy với file://):

    python3 -m http.server 8000     # mở http://localhost:8000

Trang (hash router `#/monitor`, `#/control`, `#/ai`, `#/history`, `#/settings`):
- `js/pages/monitoring.js` — Giám sát môi trường (UC 1.1/2.1)
- `js/pages/control.js`    — Đèn/quạt/cửa, cửa mật mã + đổi mật mã (UC 3.1, 3.2)
- `js/pages/ai.js`         — Giọng nói (UC 3.3) và FaceAI (UC 3.4)
- `js/pages/history.js`    — Cảnh báo & lịch sử theo ngày/tuần/tháng
- `js/pages/settings.js`   — Cài đặt ngưỡng

Logic nghiệp vụ + trạng thái chung: `js/store.js`. Cấu hình: `js/config.js`.
Nối MQTT thật: thay phần giả lập trong `tick()` của `js/store.js`.
Ngưỡng, mật mã, lịch sử được lưu trong localStorage.
