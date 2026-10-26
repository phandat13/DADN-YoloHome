// Các feed cố định trên Adafruit IO (gói miễn phí tối đa 10 feed) và cách ánh xạ thiết bị / cảm biến vào feed.
// Định dạng dữ liệu trên từng feed: xem Gateway/PROTOCOL.md
const ALLOWED_FEEDS = [
  'device-fan',          // "0".."100"            (V12 - tốc độ quạt)
  'device-light',        // "1" / "0" / "#RRGGBB" (V10 - bật tắt, V11 - màu đèn)
  'door-status',         // phần cứng báo cửa: "1" mở / "0" khoá
  'smart-door',          // lệnh cửa: "1" mở khoá / "0" khoá
  'hardware-log',        // lệnh phụ: "BUZZER:1" / "BUZZER:0", nhật ký phần cứng
  'assistant',           // V13 - câu trả lời của trợ lý ("Đèn đã bật", "Tôi không hiểu"...)
  'sensor-humidity',
  'sensor-light',
  'sensor-motion',       // PIR: "1" có người / "0"
  'sensor-temperature',
];

// Feed dữ liệu cảm biến -> Sensor_Type tương ứng trong bảng Sensor
const SENSOR_FEEDS = {
  'sensor-temperature': ['TEMPERATURE'],
  'sensor-humidity': ['HUMIDITY'],
  'sensor-light': ['LIGHT'],
  'sensor-motion': ['MOTION'],
};

const upper = (v) => String(v || '').toUpperCase();

// Sensor_Type (TEMPERATURE / HUMIDITY / LIGHT / MOTION...) -> feed, null nếu không có feed riêng
const feedForSensorType = (sensorType) => {
  const t = upper(sensorType);
  if (t.includes('TEMP')) return 'sensor-temperature';
  if (t.includes('HUM')) return 'sensor-humidity';
  if (t.includes('LIGHT') || t.includes('LUX') || t.includes('LDR')) return 'sensor-light';
  if (t.includes('MOTION') || t.includes('PIR')) return 'sensor-motion';
  return null;
};

// Loại thiết bị theo mã loại (ưu tiên) rồi theo tên: light | fan | buzzer | door | sensor | other
function deviceKind(typeCode, deviceName) {
  const type = upper(typeCode);
  const name = upper(deviceName);
  if (type.includes('SENSOR')) return 'sensor';
  if (type.includes('BUZZER')) return 'buzzer';
  if (type.includes('FAN')) return 'fan';
  if (type.includes('LIGHT') || type.includes('LED')) return 'light';
  if (type.includes('DOOR')) return 'door';
  if (name.includes('CÒI') || name.includes('BUZZER')) return 'buzzer';
  if (name.includes('QUẠT')) return 'fan';
  if (name.includes('ĐÈN')) return 'light';
  if (name.includes('CỬA')) return 'door';
  if (name.includes('CẢM BIẾN')) return 'sensor';
  return 'other';
}

// Ánh xạ chặt chẽ về đúng 1 trong các feed hợp lệ
const resolveValidFeedKey = (feedKey, typeCode, deviceName) => {
  if (feedKey && ALLOWED_FEEDS.includes(String(feedKey).trim())) return String(feedKey).trim();
  switch (deviceKind(typeCode, deviceName)) {
    case 'light': return 'device-light';
    case 'fan': return 'device-fan';
    case 'door': return 'smart-door';
    default: return 'hardware-log';   // cảm biến (dữ liệu đi theo feed của từng Sensor), còi, thiết bị khác
  }
};

const isFanDevice = (device, feedKey) =>
  feedKey === 'device-fan' || deviceKind(device?.Type_Code, device?.Device_Name) === 'fan';

module.exports = { ALLOWED_FEEDS, SENSOR_FEEDS, feedForSensorType, resolveValidFeedKey, isFanDevice, deviceKind };
