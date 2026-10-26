
# YoloHome - Smart Home IoT & AI

Hệ thống nhà thông minh **YoloHome** theo giáo trình *AI và IoT cho nhà thông minh* (OhStem). Gồm 4 phần:

| Thư mục | Vai trò |
|---|---|
| `Database/` | MySQL: bảng, stored procedure, trigger, event, dữ liệu demo |
| `Backend/` | Node.js (Express + Socket.IO): REST API, phân quyền, MQTT Adafruit IO, tự động hoá, giọng nói, FaceAI |
| `Frontend/` | Web dashboard (HTML + ES Modules) |
| `Gateway/` | Python: cầu nối Serial ⇄ MQTT giữa mạch Yolo:Bit và Adafruit IO ([giao thức](Gateway/PROTOCOL.md)) |

```
Yolo:Bit ⇄ Serial ⇄ Gateway ⇄ MQTT (Adafruit IO) ⇄ Backend ⇄ REST + Socket.IO ⇄ Frontend
                                                      ⇅
                                                    MySQL
```

---

## Mục lục
- [Kiến trúc & Công nghệ](#kiến-trúc--công-nghệ)
- [Cài đặt & Khởi chạy](#cài-đặt--khởi-chạy)
- [Danh sách API Endpoints](#danh-sách-api-endpoints)
- [Sự kiện Socket.IO](#sự-kiện-socketio)
- [Hướng dẫn kiểm thử qua Thunder Client](#hướng-dẫn-kiểm-thử-bằng-thunder-client)

---

## Kiến trúc & Công nghệ

* **Runtime:** Node.js 18+ (Express 5, Socket.IO)
* **Cơ sở dữ liệu:** MySQL 8 (MariaDB 10.6+ cũng chạy được)
* **Giao thức truyền thông IoT:** MQTT qua Adafruit IO. Định dạng các feed xem trong [Gateway/PROTOCOL.md](Gateway/PROTOCOL.md).
* **Bảo mật:** JWT, mật khẩu băm bằng bcrypt, PIN băm SHA-256 có muối, rate-limit, phân quyền RBAC (Owner / Member / Guest)
* **Kiểm tra dữ liệu đầu vào:** Zod (`middlewares/validate.js`)
* **Tự động hoá:** chạy trên server (`services/automation.js`) theo ngưỡng của từng nhà (bảng `Home_Setting`)

---

## Cài đặt & Khởi chạy

### 1. Cơ sở dữ liệu (MySQL)

Các file `.sql` dùng `SOURCE` với đường dẫn tương đối, nên **phải chạy từ trong thư mục `Database`**. Cần thêm `--default-character-set=utf8mb4` để tiếng Việt không bị lỗi font.

```bash
cd Database
mysql --default-character-set=utf8mb4 -u root -p < init.sql        # tạo lại DB smart_home (XOÁ dữ liệu cũ)
mysql --default-character-set=utf8mb4 -u root -p < seed_demo.sql   # (tuỳ chọn) dữ liệu demo
```

Dữ liệu demo gồm các tài khoản sau, mật khẩu đều là `123456`:

- `owner@yolohome.local` (chủ nhà)
- `member@yolohome.local` (thành viên)
- `guest@yolohome.local` (khách)

Ngoài ra có "Nhà Demo" với đèn RGB, quạt, còi, cụm cảm biến (nhiệt độ, độ ẩm, ánh sáng, PIR) kèm 24 giờ số liệu, và "Cửa chính" với PIN `1234`.

> Dùng MySQL Workbench: mở và chạy lần lượt `smart_home.sql`, `functions.sql`, `procedures.sql`, `triggers.sql`, `roles_permissions.sql`, `events.sql`, rồi `seed_demo.sql`.

### 2. Backend

```bash
cd Backend
cp .env.example .env      # rồi điền giá trị thật (xem chú thích trong file)
npm install
npm run dev               # tự reload khi sửa code; chạy thật: npm start
```

Các biến **bắt buộc** trong `.env`:

- `JWT_SECRET`
- `DB_PASSWORD`
- `MQTT_USERNAME`
- `MQTT_KEY`

Các biến quan trọng khác:

| Biến | Ý nghĩa |
|---|---|
| `IOT_API_KEY` | Khoá cho Gateway, camera hoặc bàn phím gọi API bằng header `x-iot-key`. Để trống thì tắt. |
| `MQTT_HOME_ID` | Nhà (Home_ID) gắn với phần cứng thật. Để trống thì lấy nhà có ID nhỏ nhất. Các nhà khác chạy **mô phỏng**: không gửi lệnh lên MQTT và không nhận số liệu MQTT. |
| `NODE_ENV` | `development` thì lỗi API trả kèm stack trace. Mặc định không trả. |
| `CORS_ORIGIN` | Danh sách origin của Frontend, cách nhau bằng dấu phẩy. |
| `DOOR_AUTO_LOCK_SECONDS` | Số giây cửa tự khoá lại sau khi mở. Mặc định 10, đặt 0 để tắt. |

Server chạy tại `http://localhost:3000` (kiểm tra: `GET /health`).

### 3. Frontend

```bash
cd Frontend
python3 -m http.server 8000      # mở http://localhost:8000
```

### 4. Gateway (khi có mạch Yolo:Bit)

```bash
cd Gateway
python -m venv .venv && .venv/Scripts/activate      # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env             # điền ADAFRUIT_AIO_USERNAME / ADAFRUIT_AIO_KEY, SERIAL_PORT
python main.py                   # chưa có mạch: đặt SIMULATE=1 trong .env để gửi số liệu ngẫu nhiên
```

Tạo đủ 10 feed trên Adafruit IO theo [Gateway/PROTOCOL.md](Gateway/PROTOCOL.md).

> ⚠️ **Không commit file `.env` hay khoá Adafruit.** Khoá cũ đã từng bị đẩy lên repo public, nên phải tạo khoá mới trên Adafruit IO và đổi `JWT_SECRET` / `IOT_API_KEY`.

---

# Danh sách API Endpoints

Mọi API (trừ đăng ký / đăng nhập) cần header `Authorization: Bearer <token>`, trừ khi có ghi chú khác. Owner luôn có toàn quyền trong nhà của mình.

## 1. Phân hệ Xác thực (Auth)

| Phương thức | Endpoint | Yêu cầu Auth | Mô tả |
|---|---|---|---|
| `POST` | `/api/auth/register` | ❌ | Đăng ký tài khoản mới (`email`, `password`, `name`, `displayName`). Mật khẩu được băm bằng bcrypt. |
| `POST` | `/api/auth/login` | ❌ | Đăng nhập bằng `email` và `password`. Trả về JWT có hạn 7 ngày. |
| `GET` | `/api/auth/me` | ✅ | Thông tin người dùng đang đăng nhập. |

## 2. Quản lý Nhà (Home)

| Phương thức | Endpoint | Quyền / Ghi chú | Mô tả |
|---|---|---|---|
| `POST` | `/api/homes` | Đã đăng nhập | Tạo nhà mới (`homeName`, `address`). Người tạo là **Owner**. |
| `GET` | `/api/homes` | Đã đăng nhập | Danh sách nhà đang tham gia và còn hiệu lực. |
| `GET` | `/api/homes/:homeId` | Thành viên | Chi tiết nhà. |
| `PUT` | `/api/homes/:homeId` | `HOME_UPDATE` | Cập nhật `homeName`, `address`, `state`. |
| `DELETE` | `/api/homes/:homeId` | Owner | Xoá nhà. |

## 3. Cài đặt ngưỡng & chế độ tự động

| Phương thức | Endpoint | Quyền hạn | Mô tả |
|---|---|---|---|
| `GET` | `/api/homes/:homeId/settings` | Thành viên | `tempMax`, `humidityMin`, `humidityMax`, `lightMin`, `autoMode` và `alerts` (cảnh báo đang hoạt động). |
| `PUT` | `/api/homes/:homeId/settings` | `DEVICE_MANAGE` | Cập nhật 4 ngưỡng. Điều kiện `humidityMin < humidityMax`. |
| `PUT` | `/api/homes/:homeId/settings/mode` | `DEVICE_CONTROL` | `{ "autoMode": true \| false }` |

Ở chế độ tự động, server thực hiện các quy tắc sau:

- Nhiệt độ vượt `tempMax`: cảnh báo, quạt chạy 100% và bật còi.
- PIR phát hiện có người hoặc ánh sáng dưới `lightMin`: bật đèn.

Mỗi cảnh báo mới tạo một thông báo cho chủ nhà và một câu trợ lý gửi xuống LCD. Khi người dùng điều khiển tay (trên web hoặc bằng giọng nói), nhà chuyển sang thủ công.

## 4. Quản lý Thành viên (Member)

| Phương thức | Endpoint | Quyền hạn | Mô tả |
|---|---|---|---|
| `GET` | `/api/homes/:homeId/members` | Thành viên | Danh sách thành viên. |
| `POST` | `/api/homes/:homeId/members` | `MEMBER_MANAGE` | Thêm thành viên (`email`, `roleName`: `Member` / `Guest`, `expired`). Khách bắt buộc có hạn. |
| `PUT` | `/api/homes/:homeId/members/:userId` | `MEMBER_MANAGE` | Đổi vai trò hoặc gia hạn. |
| `DELETE` | `/api/homes/:homeId/members/:userId` | `MEMBER_MANAGE` | Xoá thành viên, đồng thời thu hồi PIN và vô hiệu FaceAI của người đó. |

## 5. Quản lý Thiết bị (Device)

| Phương thức | Endpoint | Quyền hạn | Mô tả |
|---|---|---|---|
| `GET` | `/api/homes/:homeId/devices` | `DEVICE_VIEW` | Danh sách thiết bị, gồm `availableWorkingState` và `color` (màu đèn). |
| `POST` | `/api/homes/:homeId/devices` | `DEVICE_MANAGE` | Tạo thiết bị (`deviceName`, `typeCode`: `LIGHT` / `FAN` / `BUZZER` / `SENSOR`). |
| `PATCH` | `/api/homes/:homeId/devices/:deviceId` | `DEVICE_MANAGE` | Cập nhật `deviceName`, `connectionState`, `availableWorkingState`, `controllerId`, `feedKey`. |
| `DELETE` | `/api/homes/:homeId/devices/:deviceId` | `DEVICE_MANAGE` | Xoá thiết bị. |
| `POST` | `/api/homes/:homeId/devices/:deviceId/commands` | `DEVICE_CONTROL` | Gửi lệnh điều khiển (body ở bảng dưới). |

Body của lệnh điều khiển:

| Thiết bị | Body |
|---|---|
| Đèn | `{"action":"TURN_ON"}`, `{"action":"TURN_OFF"}` hoặc `{"action":"SET_COLOR","color":"#FF0000"}` |
| Quạt | `{"action":"SET_SPEED","speed":0..100}` (số nguyên), `TURN_ON` hoặc `TURN_OFF` |
| Còi | `TURN_ON` hoặc `TURN_OFF` |

Luồng xử lý một lệnh:

1. Ghi lệnh vào `Device_Command` với trạng thái `PENDING`.
2. Gửi lên MQTT và chờ broker xác nhận.
3. Đổi trạng thái lệnh thành `SUCCESS` hoặc `FAILED`; nếu `FAILED` thì trả HTTP 503.
4. Trigger cập nhật `Device_State`.

Nhà không gắn phần cứng (xem `MQTT_HOME_ID`) chỉ cập nhật trạng thái, không gửi MQTT. Khi đó phản hồi có `"simulated": true`.

## 6. Cửa thông minh (Smart Door)

Tên cửa chỉ cần **duy nhất trong một nhà**, nên nhà khác nhau đều đặt được "Cửa chính".

| Phương thức | Endpoint | Quyền hạn | Mô tả |
|---|---|---|---|
| `POST` | `/api/homes/:homeId/doors` | `DEVICE_MANAGE` | Tạo cửa (`doorName`). |
| `GET` | `/api/homes/:homeId/doors` | `DEVICE_VIEW` hoặc `DOOR_UNLOCK` | Danh sách cửa, gồm `doorId`, trạng thái khoá và `autoLockAt`. |
| `GET` | `/api/homes/:homeId/doors/:doorName/credentials` | `DOOR_MANAGE` | Danh sách PIN đã cấp. |
| `POST` | `/api/homes/:homeId/doors/:doorName/pins` | `DOOR_MANAGE` | Cấp PIN 4–8 chữ số (`pin`, `targetUserId`, `validFrom`, `validTo`). |
| `POST` | `/api/homes/:homeId/doors/:doorName/verify-pin` | `x-iot-key` **hoặc** `DOOR_UNLOCK` | Nhập PIN để mở cửa. Sai 5 lần trong 10 phút thì trả 429. |
| `PUT` | `/api/homes/:homeId/doors/:doorName/change-pin` | `DOOR_MANAGE` | Đổi PIN (`currentPin`, `newPin`, `confirmPin`). |
| `DELETE` | `/api/homes/:homeId/doors/:doorName/credentials/:credentialId` | `DOOR_MANAGE` | Thu hồi PIN. |
| `POST` | `/api/homes/:homeId/doors/:doorName/unlock` | `DOOR_MANAGE` | Mở hoặc khoá cửa từ xa (`state`: `locked` / `unlocked`). |
| `GET` | `/api/homes/:homeId/doors/:doorName/attempts` | `DOOR_MANAGE` | Lịch sử truy cập cửa. |

## 7. Phân hệ Trí tuệ Nhân tạo (AI)

| Phương thức | Endpoint | Quyền hạn | Mô tả |
|---|---|---|---|
| `POST` | `/api/homes/:homeId/ai/face-profiles` | `FACE_MANAGE` | Đăng ký khuôn mặt (`userId`, `faceData`: **đúng 128 số**, `validFrom`, `validTo`). |
| `GET` | `/api/homes/:homeId/ai/face-profiles` | `FACE_MANAGE` | Danh sách hồ sơ khuôn mặt. |
| `PUT` | `/api/homes/:homeId/ai/face-profiles/:profileId` | `FACE_MANAGE` | Đổi thời hạn. |
| `DELETE` | `/api/homes/:homeId/ai/face-profiles/:profileId` | `FACE_MANAGE` | Xoá hồ sơ. |
| `POST` | `/api/homes/:homeId/ai/doors/:doorName/face-recognition` | `x-iot-key` **hoặc** `DOOR_UNLOCK` | `inputFaceVector` gồm 128 số. Khoảng cách Euclid ≤ 0.55 (độ tin cậy ≥ 75%) thì mở cửa. |
| `POST` | `/api/homes/:homeId/ai/voice-commands` | `VOICE_USE` | Lệnh giọng nói tiếng Việt (`commandDetail`). Phản hồi có trường `reply`, đồng thời gửi lên feed `assistant`. |

Một số câu lệnh giọng nói được hiểu:

- "Ơi bật đèn giúp mình", "tắt đèn phòng ngủ"
- "Đổi đèn sang màu xanh dương"
- "Bật quạt 50%", "quạt mức 2", "tắt quạt"
- "Bật còi"

Lệnh mở cửa bằng giọng nói bị từ chối vì lý do an toàn.

## 8. Cảm biến & IoT (IoT Telemetry)

| Phương thức | Endpoint | Quyền hạn | Mô tả |
|---|---|---|---|
| `GET` | `/api/homes/:homeId/iot/sensors` | `SENSOR_VIEW` | Danh sách cảm biến và giá trị mới nhất. |
| `POST` | `/api/homes/:homeId/iot/sensors` | `DEVICE_MANAGE` | Thêm cảm biến (`deviceId`, `dataType`: `Temperature` / `Humidity` / `Light` / `Motion`, `unit`). |
| `GET` | `/api/homes/:homeId/iot/sensors/:sensorId/records` | `SENSOR_VIEW` | Lịch sử đo (`from`, `to`, `limit` ≤ 5000). |
| `POST` | `/api/homes/:homeId/iot/telemetry` | `x-iot-key` | Phần cứng gửi `{ sensorId, value, dataQuality }`. |
| `POST` | `/api/homes/:homeId/iot/sensors/:sensorId/telemetry` | `x-iot-key` hoặc `DEVICE_MANAGE` | Gửi giá trị thử (`value`, `dataQuality`). |

## 9. Nhật ký & Thông báo (Logs & Notifications)

| Phương thức | Endpoint | Quyền hạn | Mô tả |
|---|---|---|---|
| `GET` | `/api/homes/:homeId/activity-logs` | `LOG_VIEW_ALL` / `LOG_VIEW_OWN` | Nhật ký hoạt động. |
| `GET` | `/api/notifications` | ✅ | Thông báo của mình (lọc theo `status`: `Unread` / `Read`). |
| `PATCH` | `/api/notifications/:id/read` | ✅ | Đánh dấu một thông báo là đã đọc. |
| `PATCH` | `/api/notifications/read-all` | ✅ | Đánh dấu tất cả là đã đọc. |

---

# Sự kiện Socket.IO

Kết nối với `auth: { token }`, sau đó gửi `join_home` kèm `homeId`. Server phát các sự kiện sau tới phòng `home_<id>`:

| Sự kiện | Dữ liệu |
|---|---|
| `sensor_update` | `{ sensorId, type, value, unit, timestamp }` |
| `device_state_updated` | `{ deviceId, state, color, source }` |
| `door_state_updated` | `{ doorId, doorName, state, source, autoLockAt }` |
| `alerts_updated` | `{ alerts: [{ key, level, message }] }` |
| `settings_updated` | `{ settings }` |
| `assistant_message` | `{ text, timestamp }` |

---

# Hướng dẫn kiểm thử bằng Thunder Client

## 1. Đăng nhập lấy Token

Nếu đã chạy `seed_demo.sql` thì dùng luôn tài khoản demo. Nếu chưa, gọi `POST /api/auth/register` trước với body `{ "name", "email", "password" }`.

```http
POST http://localhost:3000/api/auth/login
```

```json
{
  "email": "owner@yolohome.local",
  "password": "123456"
}
```

Sao chép giá trị `token` trong JSON phản hồi.

## 2. Gắn Token vào các request cần xác thực

1. Tạo request trong Thunder Client.
2. Mở tab **Auth** và chọn loại **Bearer Token**.
3. Dán token vừa lấy được rồi gửi, ví dụ `GET http://localhost:3000/api/homes`.

## 3. Điều khiển thiết bị

```http
POST http://localhost:3000/api/homes/1/devices/2/commands
```

```json
{ "action": "SET_SPEED", "speed": 60 }
```

## 4. Đăng ký vector khuôn mặt (Face AI)

```http
POST http://localhost:3000/api/homes/1/ai/face-profiles
```

```json
{
  "userId": 2,
  "faceData": [0.0123, -0.0456, "... đủ 128 số ..."],
  "validTo": "2026-12-31"
}
```

| Field | Kiểu dữ liệu | Mô tả |
|---|---|---|
| `userId` | Integer | Thành viên được đăng ký khuôn mặt. |
| `faceData` | Array\<Number\> (128) | Descriptor của face-api.js (lấy ở trang "AI & Nhận diện"). |
| `validFrom` / `validTo` | `YYYY-MM-DD` hoặc ISO | Thời hạn của hồ sơ (có thể bỏ trống). |

## 5. Mở cửa bằng PIN từ phần cứng

```http
POST http://localhost:3000/api/homes/1/doors/C%E1%BB%ADa%20ch%C3%ADnh/verify-pin
x-iot-key: <IOT_API_KEY>
```

```json
{ "pin": "1234" }
```
