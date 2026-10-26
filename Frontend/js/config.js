// Cấu hình tập trung: sửa ở đây thay vì tìm trong HTML/JS.

const DEV_STATIC_PORTS = ['8000', '5500', '5173'];
const BACKEND_ORIGIN = DEV_STATIC_PORTS.includes(location.port) || location.protocol === 'file:'
  ? 'http://localhost:3000'
  : location.origin;

export const CONFIG = {
  // Mở qua Backend (http://localhost:3000) thì gọi API cùng địa chỉ; mở qua server tĩnh riêng (8000, 5500...) thì gọi cổng 3000
  API_BASE_URL: `${BACKEND_ORIGIN}/api`,
  SOCKET_URL: BACKEND_ORIGIN,
};

// Ngưỡng cảnh báo: giá trị thật được tải từ Backend (GET /homes/:homeId/settings) và ghi đè vào THRESHOLDS.
// DEFAULT_THRESHOLDS dùng cho nút "Khôi phục mặc định" (trùng giá trị mặc định của bảng Home_Setting).
export const DEFAULT_THRESHOLDS = Object.freeze({
  TEMP_MAX: 35,            // °C - vượt ngưỡng: cảnh báo + quạt 100% (chế độ tự động)
  HUMIDITY_MIN: 40,        // %
  HUMIDITY_MAX: 70,        // %
  LIGHT_MIN: 200,          // Lux - dưới mức này thì bật đèn (chế độ tự động)
});
export const THRESHOLDS = { ...DEFAULT_THRESHOLDS };

export const TIMING = {
  SYNC_INTERVAL_S: 30,          // chu kỳ làm mới dữ liệu qua REST (bổ trợ cho Socket.IO)
  FRESH_DATA_MS: 10 * 60e3,     // chỉ tự động hoá theo số liệu mới hơn 10 phút
  NTP_SYNC_S: 1,
  PIR_SCAN_S: 0.1,
};

export const DEVICE = {
  brand: 'Aetherium',
  platform: 'AIoT Platform',
  logo: 'assets/logo.svg',                      // lưu trong repo (link ảnh ngoài có thể hết hạn)
  board: 'Yolo:Bit',
  broker: 'io.adafruit.com',                    // Backend kết nối MQTT tới Adafruit IO
  lcdAddress: '0x27',
};

export const PIN_PATTERN = /^\d{4,8}$/;                 // mã PIN 4–8 chữ số
export const MEMBER_ROLES = ['Member', 'Guest'];         // vai trò có thể gán khi mời thành viên
export const DEVICE_TYPES = [['LIGHT', 'Đèn RGB'], ['FAN', 'Quạt'], ['SENSOR', 'Cụm cảm biến'], ['BUZZER', 'Còi']];
export const LIGHT_COLORS = [['#FFFFFF', 'Trắng'], ['#FF0000', 'Đỏ'], ['#00FF00', 'Xanh lá'], ['#0000FF', 'Xanh dương'], ['#FFFF00', 'Vàng'], ['#800080', 'Tím']];
export const SENSOR_TYPES = [                            // [dataType, đơn vị, nhãn]
  ['Temperature', '°C', 'Nhiệt độ'],
  ['Humidity', '%', 'Độ ẩm'],
  ['Light', 'Lux', 'Ánh sáng'],
  ['Motion', '', 'Chuyển động (PIR)'],
];
export const DATA_QUALITIES = ['GOOD', 'UNCERTAIN', 'BAD'];
export const FACE = { DEFAULT_THRESHOLD: 75, MATCH_DISTANCE: 0.55 };   // trùng với ngưỡng cố định ở Backend (routes/ai.js)

export const NAV_GROUPS = [
  { title: 'Giám sát & điều khiển', items: [
    { icon: 'monitoring',    label: 'Giám sát môi trường', route: 'monitor' },
    { icon: 'tune',          label: 'Điều khiển thiết bị', route: 'control' },
    { icon: 'door_front',    label: 'Cửa thông minh',      route: 'door' },
    { icon: 'neurology',     label: 'AI & Nhận diện',      route: 'ai' },
  ] },
  { title: 'Theo dõi', items: [
    { icon: 'history',       label: 'Cảnh báo & Lịch sử',  route: 'history' },
    { icon: 'notifications', label: 'Thông báo',           route: 'notifications', badge: 'unread' },
  ] },
  { title: 'Quản lý', items: [
    { icon: 'home_work',     label: 'Nhà của tôi',         route: 'homes' },
    { icon: 'group',         label: 'Thành viên',          route: 'members' },
    { icon: 'settings',      label: 'Cài đặt',             route: 'settings' },
  ] },
];


