// 8 feed cố định trên Adafruit IO và cách ánh xạ thiết bị / cảm biến vào feed.
const ALLOWED_FEEDS = [
  'device-fan',
  'device-light',
  'door-status',
  'smart-door',
  'hardware-log',
  'sensor-humidity',
  'sensor-light',
  'sensor-temperature',
];

// Feed dữ liệu cảm biến -> Sensor_Type tương ứng trong bảng Sensor
const SENSOR_FEEDS = {
  'sensor-temperature': ['TEMPERATURE'],
  'sensor-humidity': ['HUMIDITY'],
  'sensor-light': ['LIGHT'],
};

const upper = (v) => String(v || '').toUpperCase();

// Sensor_Type (TEMPERATURE / HUMIDITY / LIGHT / MOTION...) -> feed, null nếu không có feed riêng
const feedForSensorType = (sensorType) => {
  const t = upper(sensorType);
  if (t.includes('TEMP')) return 'sensor-temperature';
  if (t.includes('HUM')) return 'sensor-humidity';
  if (t.includes('LIGHT') || t.includes('LUX') || t.includes('LDR')) return 'sensor-light';
  return null;
};

// Ánh xạ chặt chẽ về đúng 1 trong 8 feed hợp lệ
const resolveValidFeedKey = (feedKey, typeCode, deviceName) => {
  // 1. Client truyền feedKey hợp lệ thì ưu tiên
  if (feedKey && ALLOWED_FEEDS.includes(String(feedKey).trim())) {
    return String(feedKey).trim();
  }

  const type = upper(typeCode);
  const name = upper(deviceName);

  // 2. Theo mã loại. Cảm biến xét TRƯỚC đèn: LIGHT_SENSOR không được rơi vào feed điều khiển 'device-light'
  if (type.includes('HUM')) return 'sensor-humidity';
  if (type.includes('TEMP')) return 'sensor-temperature';
  if (type.includes('LIGHT_SENSOR') || type.includes('LDR') || type.includes('LUX')) return 'sensor-light';
  if (!type.includes('SENSOR')) {
    if (type.includes('LIGHT') || type.includes('LED')) return 'device-light';
    if (type.includes('FAN')) return 'device-fan';
    if (type.includes('DOOR')) return 'smart-door';
  }

  // 3. Theo tên thiết bị (khi mã loại không rõ ràng)
  if (name.includes('ĐỘ ẨM')) return 'sensor-humidity';
  if (name.includes('NHIỆT')) return 'sensor-temperature';
  if (name.includes('ÁNH SÁNG')) return 'sensor-light';
  if (type.includes('SENSOR')) return 'hardware-log';
  if (name.includes('ĐÈN')) return 'device-light';
  if (name.includes('QUẠT')) return 'device-fan';
  if (name.includes('CỬA')) return 'smart-door';

  // Fallback an toàn: đưa về hardware-log thay vì sinh feed lạ
  return 'hardware-log';
};

const isFanDevice = (device, feedKey) =>
  feedKey === 'device-fan' ||
  upper(device?.Type_Code).includes('FAN') ||
  upper(device?.Device_Name).includes('QUẠT');

module.exports = { ALLOWED_FEEDS, SENSOR_FEEDS, feedForSensorType, resolveValidFeedKey, isFanDevice };
