// Cấu hình tập trung: sửa ở đây thay vì tìm trong HTML.
export const THRESHOLDS = {
  TEMP_MAX: 35,            // °C - vượt ngưỡng: bật còi + quạt
  HUMIDITY_MIN: 40,        // %
  HUMIDITY_MAX: 70,        // %
  LIGHT_MIN: 200,          // Lux - dưới mức này thì bật đèn
};

export const TIMING = {
  SYNC_INTERVAL_S: 30,     // chu kỳ cập nhật cảm biến
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
  operator: { initials: 'OP', role: 'Kỹ sư điều hành', id: 'OP-9842' },
};

export const NAV_ITEMS = [
  { icon: 'monitoring',    label: 'Giám sát môi trường', route: 'monitor' },
  { icon: 'tune',          label: 'Điều khiển thiết bị', route: 'control' },
  { icon: 'neurology',     label: 'AI & Nhận diện',      route: 'ai' },
  { icon: 'notifications', label: 'Cảnh báo & Lịch sử',  route: 'history' },
  { icon: 'settings',      label: 'Cài đặt ngưỡng',      route: 'settings' },
];

export const DEFAULT_THRESHOLDS = { ...THRESHOLDS };

// FaceAI: nhãn -> mã gửi lên kênh V14 (A = mở cửa, B = gửi thông báo, null = bỏ qua)
export const FACE_ACTIONS = { NHAN: 'A', NHUNG: 'B', ANH_NEN: null };
export const FACE_MIN_PROB = 70;   // %
export const FACE_HOLD_SECONDS = 3;
