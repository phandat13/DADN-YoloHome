# YoloHome - Smart Home IoT & AI Backend System

Hệ thống máy chủ điều khiển và quản lý nhà thông minh **YoloHome**, tích hợp phân hệ trí tuệ nhân tạo (Nhận diện khuôn mặt & Giọng nói tiếng Việt) và giao thức truyền thông IoT thời gian thực.

---

## Mục lục
- [Giới thiệu hệ thống](#-giới-thiệu-hệ-thống)
- [Kiến trúc & Công nghệ](#-kiến-trúc--công-nghệ)
- [Cài đặt & Khởi chạy](#-cài-đặt--khởi-chạy)
- [Danh sách API Endpoints](#-danh-sách-api-endpoints)
  - [1. Phân hệ Xác thực](#1-phân-hệ-xác-thực-auth)
  - [2. Quản lý Nhà](#2-quản-lý-nhà-home)
  - [3. Quản lý Thành viên](#3-quản-lý-thành-viên-member)
  - [4. Quản lý Thiết bị](#4-quản-lý-thiết-bị-device)
  - [5. Cửa thông minh](#5-cửa-thông-minh-smart-door)
  - [6. Phân hệ Trí tuệ Nhân tạo](#6-phân-hệ-trí-tuệ-nhân-tạo-ai)
  - [7. Cảm biến & IoT](#7-cảm-biến--iot-iot-telemetry)
  - [8. Nhật ký & Thông báo](#8-nhật-ký--thông-báo-logs--notifications)
- [Hướng dẫn kiểm thử qua Thunder Client](#-hướng-dẫn-kiểm-thử-qua-thunder-client)

---

## Kiến trúc & Công nghệ

* **Runtime:** Node.js (Express Framework)
* **Cơ sở dữ liệu:** MySQL
* **Giao thức truyền thông IoT:** MQTT (Adafruit IO)
* **Bảo mật:** JWT (JSON Web Tokens), Bcrypt Password Hashing, Rate-limiting, RBAC Middleware
* **Kiểm thực dữ liệu:** Custom Middleware Validation (validate.js)

---

## Cài đặt & Khởi chạy

### 1. Chuẩn bị Cơ sở dữ liệu (MySQL)
Chạy script `init.sql` để khởi tạo database `smart_home` cùng toàn bộ bảng, stored procedures và triggers:
```bash
mysql -u root -p < Database/init.sql
```

### 2. Thiết lập biến môi trường (`.env`)

Tạo file `.env` tại thư mục `Backend/` với các thông số cấu hình:

```env
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=smart_home
DB_PORT=3306

JWT_SECRET=your_jwt_secret_key
MQTT_BROKER_URL=mqtt://broker.hivemq.com:1883
```

---

## 3. Cài đặt thư viện & Khởi động Server

Di chuyển vào thư mục Backend:

```bash
cd Backend
```

### Cài đặt thư viện

```bash
npm install
```

### Chạy server ở chế độ phát triển

Server sẽ tự động reload khi source code thay đổi:

```bash
npm run dev
```

### Chạy production

```bash
npm start
```

Server mặc định chạy tại:

```text
http://localhost:3000
```

# Danh sách API Endpoints

## 1. Phân hệ Xác thực (Auth)

| Phương thức | Endpoint | Yêu cầu Auth | Mô tả |
|---|---|---|---|
| `POST` | `/api/auth/register` | ❌ | Đăng ký tài khoản mới (`email`, `password`, `name`, `displayName`). Mật khẩu được băm bằng bcrypt và lưu thông qua `sp_register_user`. |
| `POST` | `/api/auth/login` | ❌ | Đăng nhập bằng `email` và `password`. Tài khoản phải ở trạng thái `active`. Trả về JWT Token có hạn sử dụng 7 ngày. |
| `GET` | `/api/auth/me` | ✅ | Lấy thông tin chi tiết của người dùng đang đăng nhập. |

---

## 2. Quản lý Nhà (Home)

| Phương thức | Endpoint | Quyền / Ghi chú | Mô tả |
|---|---|---|---|
| `POST` | `/api/homes` | Thành viên | Tạo nhà mới (`homeName`, `address`). Người tạo được tự động gán quyền **Owner**. |
| `GET` | `/api/homes` | Thành viên | Xem danh sách các ngôi nhà mà người dùng đang tham gia và còn hiệu lực. |
| `GET` | `/api/homes/:homeId` | `fn_is_home_member` | Lấy thông tin chi tiết của nhà. |
| `PUT` | `/api/homes/:homeId` | `HOME_UPDATE` | Cập nhật thông tin nhà (`homeName`, `address`, `state`). |
| `DELETE` | `/api/homes/:homeId` | Owner | Xóa nhà. Chỉ áp dụng cho chủ nhà. |

---

## 3. Quản lý Thành viên (Member)

| Phương thức | Endpoint | Quyền hạn | Mô tả |
|---|---|---|---|
| `GET` | `/api/homes/:homeId/members` | Thành viên nhà | Xem danh sách thành viên trong nhà. |
| `POST` | `/api/homes/:homeId/members` | `MEMBER_MANAGE` | Thêm thành viên mới (`email`, `roleName`: `Member` / `Guest`, `expired`). |
| `PUT` | `/api/homes/:homeId/members/:userId` | `MEMBER_MANAGE` | Cập nhật vai trò hoặc gia hạn thời gian truy cập của thành viên. |
| `DELETE` | `/api/homes/:homeId/members/:userId` | `MEMBER_MANAGE` | Xóa thành viên khỏi nhà. |

---

## 4. Quản lý Thiết bị (Device)

| Phương thức | Endpoint | Yêu cầu Auth | Mô tả |
|---|---|---|---|
| `GET` | `/api/homes/:homeId/devices` | ✅ | Xem danh sách thiết bị trong nhà. |
| `POST` | `/api/homes/:homeId/devices` | ✅ | Tạo thiết bị mới (`deviceName`, `typeCode`). |
| `PATCH` | `/api/homes/:homeId/devices/:deviceId` | ✅ | Cập nhật `deviceName`, `connectionState`, `availableWorkingState`, `controllerId`. |
| `DELETE` | `/api/homes/:homeId/devices/:deviceId` | ✅ | Xóa thiết bị khỏi hệ thống. |
| `POST` | `/api/homes/:homeId/devices/:deviceId/commands` | ✅ | Gửi lệnh điều khiển (`TURN_ON`, `TURN_OFF`, ...). Lệnh được ghi log vào `Device_Command` và phát qua MQTT. |

---

## 5. Cửa thông minh (Smart Door)

| Phương thức | Endpoint | Quyền hạn | Mô tả |
|---|---|---|---|
| `POST` | `/api/homes/:homeId/doors` | `DEVICE_MANAGE` | Tạo cửa thông minh mới. |
| `GET` | `/api/homes/:homeId/doors` | `DEVICE_VIEW` | Lấy danh sách cửa thông minh trong nhà. |
| `POST` | `/api/homes/:homeId/doors/:doorName/pins` | `DOOR_MANAGE` | Cấp mã PIN mới, độ dài từ 4–8 chữ số. |
| `POST` | `/api/homes/:homeId/doors/:doorName/verify-pin` | Public | Xác thực mã PIN mở cửa. Trả về `429 (locked_out)` nếu nhập sai quá 5 lần trong 10 phút. |
| `PUT` | `/api/homes/:homeId/doors/:doorName/change-pin` | `DOOR_MANAGE` | Đổi mã PIN mở cửa. |
| `DELETE` | `/api/homes/:homeId/doors/:doorName/credentials/:credentialId` | `DOOR_MANAGE` | Thu hồi mã PIN. |
| `POST` | `/api/homes/:homeId/doors/:doorName/unlock` | `DOOR_MANAGE` | Điều khiển đóng/mở cửa từ xa (`locked` / `unlocked`). |
| `GET` | `/api/homes/:homeId/doors/:doorName/attempts` | `DOOR_MANAGE` | Tra cứu lịch sử các lần truy cập vào cửa. |

---

## 6. Phân hệ Trí tuệ Nhân tạo (AI)

| Phương thức | Endpoint | Quyền hạn | Mô tả |
|---|---|---|---|
| `POST` | `/api/homes/:homeId/ai/face-profiles` | `FACE_MANAGE` | Đăng ký Face Profile mới với vector đặc trưng `faceData`. |
| `GET` | `/api/homes/:homeId/ai/face-profiles` | `FACE_MANAGE` | Xem danh sách Face Profile đã đăng ký. |
| `PUT` | `/api/homes/:homeId/ai/face-profiles/:profileId` | `FACE_MANAGE` | Cập nhật hạn sử dụng của Face Profile. |
| `DELETE` | `/api/homes/:homeId/ai/face-profiles/:profileId` | `FACE_MANAGE` | Xóa Face Profile. |
| `POST` | `/api/homes/:homeId/ai/doors/:doorName/face-recognition` | Public | Nhận diện khuôn mặt để mở cửa. Tính khoảng cách Euclidean; nếu `d < 0.6`, hệ thống tự động kích hoạt MQTT để mở chốt cửa. |
| `POST` | `/api/homes/:homeId/ai/voice-commands` | `VOICE_USE` | Xử lý giọng nói tiếng Việt (`commandDetail`). Tự bóc tách từ khóa `"bật/mở"` và `"tắt/đóng"` rồi gửi lệnh điều khiển. |

### Face Recognition

Hệ thống sử dụng vector đặc trưng khuôn mặt (`faceData`) để thực hiện nhận diện.

Nếu khoảng cách Euclidean thỏa mãn:

```text
d < 0.6
```

thì hệ thống xác nhận khuôn mặt hợp lệ và kích hoạt lệnh mở cửa thông qua MQTT.

---

## 7. Cảm biến & IoT (IoT Telemetry)

| Phương thức | Endpoint | Yêu cầu Auth | Mô tả |
|---|---|---|---|
| `GET` | `/api/homes/:homeId/iot/sensors` | ✅ | Lấy danh sách các cảm biến đang hoạt động. |
| `POST` | `/api/homes/:homeId/iot/sensors` | ✅ | Thêm cảm biến mới (`deviceId`, `dataType`, `unit`). |
| `POST` | `/api/homes/:homeId/iot/sensors/:sensorId/telemetry` | ✅ | Thu thập dữ liệu đo đạc (`value`, `dataQuality` mặc định là `GOOD`). |
| `GET` | `/api/homes/:homeId/iot/sensors/:sensorId/records` | ✅ | Xem lịch sử các bản ghi số liệu cảm biến. |

---

## 8. Nhật ký & Thông báo (Logs & Notifications)

| Phương thức | Endpoint | Quyền hạn | Mô tả |
|---|---|---|---|
| `GET` | `/api/homes/:homeId/activity-logs` | `LOG_VIEW_ALL` / `LOG_VIEW_OWN` | Tra cứu nhật ký hoạt động của hệ thống. |
| `GET` | `/api/notifications` | ✅ | Lấy danh sách thông báo, hỗ trợ lọc theo `status`: `Unread`, `Read`. |
| `PATCH` | `/api/notifications/:id/read` | ✅ | Đánh dấu thông báo đã đọc. |

# Hướng dẫn kiểm thử bằng Thunder Client

## 1. Đăng ký & Đăng nhập lấy Token

### Bước 1: Đăng ký tài khoản

Tạo request:

```http
POST http://localhost:3000/api/auth/register
```

Chọn **Body → JSON**:

```json
{
  "name": "Admin",
  "email": "admin@example.com",
  "password": "password123"
}
```

Gửi request và kiểm tra response.

### Bước 2: Đăng nhập

Tạo request:

```http
POST http://localhost:3000/api/auth/login
```

Body:

```json
{
  "email": "admin@example.com",
  "password": "password123"
}
```

Sao chép `token` trong JSON response.

---

## 2. Gắn Token vào Request bảo mật

Đối với các API yêu cầu xác thực:

1. Tạo request trong Thunder Client.
2. Chọn tab **Auth**.
3. Chọn loại xác thực **Bearer Token**.
4. Dán JWT Token đã lấy được từ API `/api/auth/login`.
5. Gửi request.

Ví dụ:

```http
GET http://localhost:3000/api/homes
```

---

## 3. Đăng ký Vector Khuôn mặt (Face AI)

Tạo request:

```http
POST http://localhost:3000/api/homes/1/ai/face-profiles
```

Chọn **Body → JSON**:

```json
{
  "userId": 1,
  "faceData": [
    0.123,
    0.456,
    0.789,
    -0.321,
    0.654
  ],
  "expired": "2026-12-31"
}
```

Trong đó:

| Field | Kiểu dữ liệu | Mô tả |
|---|---|---|
| `userId` | Integer | ID của người dùng được đăng ký khuôn mặt. |
| `faceData` | Array\<Number\> | Vector đặc trưng khuôn mặt. |
| `expired` | Date | Thời hạn sử dụng Face Profile. |

> **Lưu ý:** `faceData` trong ví dụ chỉ là vector mẫu để kiểm thử API. Trong hệ thống thực tế, vector này cần được sinh ra từ mô hình nhận diện khuôn mặt.