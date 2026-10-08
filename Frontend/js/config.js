// Cấu hình tập trung: sửa ở đây thay vì tìm trong HTML/JS.

export const CONFIG = {
  API_BASE_URL: 'http://localhost:3000/api',   // Base URL HTTP API (tài liệu BE mục 1)
  SOCKET_URL: 'http://localhost:3000',         // Base URL Socket.IO
  COMMAND_SOURCE: 'APP',                       // sourceType gửi kèm lệnh điều khiển thiết bị
};

// Ngưỡng cảnh báo. Backend chưa có API ngưỡng nên giá trị được lưu trong localStorage.
export const DEFAULT_THRESHOLDS = Object.freeze({
  TEMP_MAX: 35,            // °C - vượt ngưỡng: cảnh báo + quạt 100% (chế độ tự động)
  HUMIDITY_MIN: 40,        // %
  HUMIDITY_MAX: 70,        // %
  LIGHT_MIN: 200,          // Lux - dưới mức này thì bật đèn (chế độ tự động)
});
export const THRESHOLDS = { ...DEFAULT_THRESHOLDS };

export const TIMING = {
  SYNC_INTERVAL_S: 30,          // chu kỳ làm mới dữ liệu qua REST (bổ trợ cho Socket.IO)
  DOOR_OPEN_MS: 2000,           // servo mở cửa 2 giây
  FRESH_DATA_MS: 10 * 60e3,     // chỉ tự động hoá theo số liệu mới hơn 10 phút
  NTP_SYNC_S: 1,
  PIR_SCAN_S: 0.1,
};

export const DEVICE = {
  brand: 'Aetherium',
  platform: 'AIoT Platform',
  logo: 'https://lh3.googleusercontent.com/aida/AEtjO1VsqoZK3ugDy6qL5JEZHYI1KojDup7qthkuTb5wNH8_tzSQXeCswV53wBVAsXQykFVnIhqWLWPfQa_gJ8KGAnxoUvvVvQf71GHo4Qe2RZeSxs1DZMqMUY5GhfE1pLvBbWrxHIMJuP0JKxID1xVHwdN02dcc-m-trad8h2NqKCJRm1A99rz-uTvefdohh9TzXGS9c0Mu5MLe1NTE5XPhrdXrgPl1cF80zIKeestniksmUke631sbuuzKiw',
  board: 'Yolo:Bit',
  broker: 'mqtt.ohstem.vn',
  lcdAddress: '0x27',
};

export const PIN_PATTERN = /^\d{4,8}$/;                 // mã PIN 4–8 chữ số
export const MEMBER_ROLES = ['Member', 'Guest'];         // vai trò có thể gán khi mời thành viên
export const DEVICE_TYPES = [['LIGHT', 'Đèn'], ['FAN', 'Quạt'], ['SENSOR', 'Cụm cảm biến'], ['BUZZER', 'Còi']];
export const SENSOR_TYPES = [                            // [dataType, đơn vị, nhãn]
  ['Temperature', '°C', 'Nhiệt độ'],
  ['Humidity', '%', 'Độ ẩm'],
  ['Light', 'Lux', 'Ánh sáng'],
  ['Motion', '', 'Chuyển động (PIR)'],
];
export const DATA_QUALITIES = ['GOOD', 'UNCERTAIN', 'BAD'];
export const FACE = { DEFAULT_THRESHOLD: 75, MATCH_DISTANCE: 0.6 };

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
