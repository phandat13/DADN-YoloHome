# Hardware YoloHome

## 1. Tổng quan

Hardware là firmware chạy trên mạch Yolo:Bit/HOME:BIT. Firmware trực tiếp
đọc cảm biến, điều khiển các thiết bị trong nhà và trao đổi dữ liệu với
Gateway qua UART Serial.

Hardware không kết nối MQTT trực tiếp. Gateway chịu trách nhiệm chuyển đổi
giữa giao tiếp Serial của mạch và MQTT/Adafruit IO.

```text
Cảm biến và thiết bị
          ↕
    Yolo:Bit Hardware
          ↕ UART 115200
        Gateway
          ↕ MQTT
 Adafruit IO / Backend / Web
```

## 2. Chức năng chính

### 2.1. Giám sát môi trường

- Đọc nhiệt độ và độ ẩm từ cảm biến DHT20.
- Đọc cường độ ánh sáng và quy đổi về khoảng `0–100`.
- Đọc trạng thái chuyển động từ cảm biến PIR.
- Hiển thị nhiệt độ, độ ẩm, ánh sáng và PIR trên LCD 16x2.

### 2.2. Điều khiển thiết bị

- Bật hoặc tắt đèn RGB.
- Đổi màu đèn RGB bằng mã màu hex.
- Điều chỉnh tốc độ quạt trong khoảng `0–100`.
- Mở hoặc khóa cửa bằng servo.
- Tự động đóng cửa sau 2 giây khi có yêu cầu mở.
- Hiển thị thông báo từ trợ lý trên LCD.

### 2.3. Cảnh báo

- So sánh nhiệt độ, độ ẩm và ánh sáng với các ngưỡng cấu hình.
- Hiển thị màu đỏ trên đèn RGB khi phát hiện cảnh báo.
- Gửi nội dung cảnh báo về Gateway dưới dạng log.
- Gửi `SENSOR_ERROR` nếu quá trình đọc cảm biến gặp lỗi.

## 3. Sơ đồ chân phần cứng

| Thành phần | Chân sử dụng |
|---|---|
| Đèn RGB | `pin0` |
| Cảm biến ánh sáng | `pin2` |
| Cảm biến PIR | `pin3` |
| Servo cửa | `pin4` |
| Quạt | `pin10` |
| DHT20 | Giao tiếp qua module `aiot_dht20` |
| LCD 16x2 | Giao tiếp qua module `aiot_lcd1602` |

Firmware hiện chưa định nghĩa chân GPIO cho buzzer.

## 4. Chu kỳ hoạt động

### Khởi động

1. Khởi tạo LCD, DHT20, đèn RGB và UART.
2. Tắt đèn và quạt.
3. Đưa servo về trạng thái đóng.
4. Đọc và gửi lần đầu dữ liệu môi trường.
5. Hiển thị màn hình chào mừng.

### Vòng lặp chính

Firmware lặp liên tục với chu kỳ khoảng `10 ms` để:

1. Đọc dữ liệu đến từ Gateway.
2. Phân tích các frame Serial hoàn chỉnh.
3. Thực thi lệnh điều khiển.
4. Kiểm tra thời gian tự đóng cửa.
5. Chạy các sự kiện định kỳ.

### Chu kỳ cảm biến

- Cảm biến môi trường được đọc mỗi `30 giây`.
- PIR được kiểm tra mỗi `100 ms`.
- Nhiệt độ, độ ẩm, ánh sáng và trạng thái PIR được gửi về Gateway
  mỗi chu kỳ cảm biến.
- Trạng thái PIR cũng được gửi ngay khi thay đổi.

## 5. Giao tiếp Serial

### Cấu hình

- Baud rate: `115200`
- ID mạch: `1`
- Ký tự bắt đầu frame: `!`
- Ký tự kết thúc frame: `#`

### Dữ liệu Hardware gửi lên

Định dạng:

```text
!ID:TYPE:VALUE#
```

Ví dụ:

```text
!1:TEMP:28.5#
!1:HUMI:65#
!1:LIGHT:72#
!1:MOTION:1#
!1:DOOR:1#
!1:LOG:ALERT|TEMPERATURE:36#
```

Gateway ánh xạ các loại dữ liệu vào các feed:

| Loại dữ liệu | Feed |
|---|---|
| `TEMP` | `sensor-temperature` |
| `HUMI` | `sensor-humidity` |
| `LIGHT` | `sensor-light` |
| `MOTION` | `sensor-motion` |
| `DOOR` | `door-status` |
| `LOG` | `hardware-log` |

### Lệnh Hardware nhận từ Gateway

```text
!LIGHT:1#
!COLOR:FF0000#
!FAN:60#
!DOOR:1#
!MSG:Den da bat#
```

| Lệnh | Xử lý |
|---|---|
| `LIGHT` | Bật/tắt đèn RGB |
| `COLOR` | Đặt màu RGB |
| `FAN` | Đặt tốc độ quạt `0–100` |
| `DOOR` | `1` mở cửa, `0` khóa cửa |
| `MSG` | Hiển thị thông báo trên LCD |

## 6. Luồng dữ liệu

### 6.1. Luồng dữ liệu cảm biến

```text
DHT20 / ánh sáng / PIR
          ↓
  Hardware đọc và chuẩn hóa
          ↓
 !1:TYPE:VALUE#
          ↓ UART
       Gateway
          ↓ MQTT
      Adafruit IO
          ↓
    Backend và Web
```

### 6.2. Luồng điều khiển thiết bị

```text
Web / Backend
      ↓ MQTT
  Adafruit IO
      ↓
    Gateway
      ↓ UART: !COMMAND:VALUE#
   Hardware
      ↓
Đèn / quạt / servo / LCD
```

### 6.3. Luồng cửa

1. Gateway gửi `!DOOR:1#`.
2. Hardware quay servo đến góc mở.
3. Hardware gửi `!1:DOOR:1#`.
4. Sau 2 giây, Hardware quay servo về góc đóng.
5. Hardware gửi `!1:DOOR:0#`.

## 7. Xử lý lỗi và giới hạn

- Frame Serial không đầy đủ được giữ lại cho đến khi nhận ký tự `#`.
- Dữ liệu rác giữa các frame được bỏ qua.
- Giá trị tốc độ quạt được giới hạn trong khoảng `0–100`.
- Lỗi đọc cảm biến được hiển thị bằng `SENSOR ERROR` trên LCD và gửi log.
- Khi có chuyển động, đèn được bật tự động.
- Lệnh `BUZZER` của Gateway chưa được xử lý vì Hardware chưa có chân buzzer.

## 8. Thành phần liên quan

- Firmware: [hardware.py](./hardware.py)
- Gateway: [../Gateway/main.py](../Gateway/main.py)
- Giao thức chi tiết: [../Gateway/PROTOCOL.md](../Gateway/PROTOCOL.md)
