# Giao thức Yolo:Bit ⇄ Gateway ⇄ Adafruit IO

Tài liệu này dành cho người lập trình mạch Yolo:Bit. Firmware của mạch **chưa có trong repo**. Mạch chỉ cần làm đúng hai việc dưới đây là chạy được với Gateway và Backend.

```
Yolo:Bit ──Serial 115200──► Gateway (main.py) ──MQTT──► Adafruit IO ──► Backend (Node.js) ──► Web
Yolo:Bit ◄──Serial───────── Gateway ◄──────────MQTT──── Adafruit IO ◄── Backend / dashboard Adafruit
```

Mọi khung dữ liệu đều có dạng `!...#`. Gateway bỏ qua phần rác nằm giữa các khung.

## 1. Mạch gửi lên (Yolo:Bit → Gateway)

Khung có dạng `!ID:LOAI:GIA_TRI#`. `ID` là số thứ tự của mạch (để `1`).

| Khung ví dụ | Ý nghĩa | Feed Adafruit IO |
|---|---|---|
| `!1:TEMP:28.5#` | Nhiệt độ DHT20 (°C) | `sensor-temperature` |
| `!1:HUMI:65#` | Độ ẩm DHT20 (%) | `sensor-humidity` |
| `!1:LIGHT:320#` | Cảm biến ánh sáng | `sensor-light` |
| `!1:MOTION:1#` | PIR: `1` là có người, `0` là không có | `sensor-motion` |
| `!1:DOOR:1#` | Trạng thái cửa thật: `1` đang mở, `0` đã khoá | `door-status` |
| `!1:LOG:text#` | Ghi nhật ký tự do | `hardware-log` |

Gợi ý: gửi nhiệt độ, độ ẩm và ánh sáng mỗi 10–30 giây. Gói Adafruit IO miễn phí chỉ cho **30 điểm dữ liệu/phút** cho tất cả các feed cộng lại. Chỉ gửi PIR và cửa khi giá trị **thay đổi**.

## 2. Gateway gửi xuống (Gateway → Yolo:Bit)

| Khung | Xử lý trên mạch | Đến từ feed |
|---|---|---|
| `!LIGHT:1#` / `!LIGHT:0#` | Bật / tắt đèn RGB (V10) | `device-light` = `1` / `0` |
| `!COLOR:FF0000#` | Đổi màu đèn RGB, mã hex **không có `#`** (V11) | `device-light` = `#FF0000` |
| `!FAN:60#` | Đặt tốc độ quạt từ 0 đến 100 (V12) | `device-fan` |
| `!DOOR:1#` / `!DOOR:0#` | Servo mở khoá / khoá cửa | `smart-door` |
| `!BUZZER:1#` / `!BUZZER:0#` | Bật / tắt còi cảnh báo | `hardware-log` = `BUZZER:1` |
| `!MSG:Den da bat#` | Hiện câu của trợ lý lên LCD 16x2 (V13), đã bỏ dấu tiếng Việt | `assistant` |

Sau khi tự mở hoặc khoá cửa (ví dụ bằng remote hồng ngoại), mạch nên gửi lại `!1:DOOR:x#` để web cập nhật theo.

## 3. Các feed cần tạo trên Adafruit IO (10 feed, đúng giới hạn gói miễn phí)

`sensor-temperature`, `sensor-humidity`, `sensor-light`, `sensor-motion`, `door-status`,
`device-light`, `device-fan`, `smart-door`, `hardware-log`, `assistant`

Dashboard Adafruit có thể dùng thẳng các widget sau, vì giá trị trên feed là chuỗi đơn giản:

- Toggle `1`/`0` gắn vào `device-light`
- Color picker gắn vào `device-light`
- Slider 0–100 gắn vào `device-fan`
- Text gắn vào `assistant`

## 4. Lưu ý về các nhà trong hệ thống

Hệ thống dùng chung một tài khoản Adafruit, nên **chỉ một nhà gắn với phần cứng thật**. Nhà đó được chọn bằng `MQTT_HOME_ID` trong `Backend/.env`. Nếu để trống, hệ thống lấy nhà có ID nhỏ nhất.

Các nhà khác vẫn dùng được trên web ở chế độ mô phỏng: lệnh không được gửi lên MQTT, và nhà đó không nhận số liệu cảm biến từ MQTT.

Mỗi loại thiết bị chỉ có một feed. Vì vậy với nhà gắn phần cứng, nên có đúng 1 đèn, 1 quạt và 1 còi, giống mô hình trong giáo trình.
