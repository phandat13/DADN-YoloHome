// Cả hệ thống chỉ dùng MỘT tài khoản Adafruit IO, nên chỉ MỘT nhà được gắn với phần cứng thật.
// - Dữ liệu cảm biến từ MQTT chỉ ghi vào nhà này (trước đây ghi vào cảm biến của mọi nhà).
// - Lệnh điều khiển chỉ được gửi lên MQTT khi thao tác trên nhà này; các nhà khác chạy ở chế độ mô phỏng.
// Chọn nhà bằng MQTT_HOME_ID trong .env; để trống thì lấy nhà có Home_ID nhỏ nhất.
const config = require('../config');
const { pool } = require('../db');

const CACHE_MS = 30 * 1000;
let cached = { id: null, at: 0 };
let warned = false;

async function getHardwareHomeId() {
  if (config.mqtt.homeId) return config.mqtt.homeId;
  if (Date.now() - cached.at < CACHE_MS) return cached.id;
  const [rows] = await pool.query('SELECT MIN(Home_ID) AS id FROM Home');
  cached = { id: rows[0]?.id ?? null, at: Date.now() };
  if (!warned && cached.id != null) {
    warned = true;
    console.warn(`[MQTT] Chưa đặt MQTT_HOME_ID -> dùng nhà #${cached.id} làm nhà gắn phần cứng Adafruit IO.`);
  }
  return cached.id;
}

async function isHardwareHome(homeId) {
  const id = await getHardwareHomeId();
  return id != null && Number(id) === Number(homeId);
}

module.exports = { getHardwareHomeId, isHardwareHome };
