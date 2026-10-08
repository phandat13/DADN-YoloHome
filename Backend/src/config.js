require('dotenv').config();

const requiredEnvVars = ['JWT_SECRET', 'DB_PASSWORD', 'MQTT_USERNAME', 'MQTT_KEY'];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`[CONFIG ERROR] Biến môi trường ${envVar} bắt buộc phải có trong file .env!`);
  }
}

// Các địa chỉ Frontend được gọi API (CORS). Có thể ghi đè bằng CORS_ORIGIN="http://a:1,http://b:2" trong .env.
// Mặc định gồm cả localhost lẫn 127.0.0.1 (là 2 origin khác nhau) và cổng 5500 của VS Code Live Server.
const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000', 'http://127.0.0.1:3000',
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:8000', 'http://127.0.0.1:8000',
  'http://localhost:5500', 'http://127.0.0.1:5500',
];

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET,
  iotApiKey: process.env.IOT_API_KEY || 'default_iot_key',
  // Số giây cửa tự khoá lại sau khi mở (PIN / FaceAI / từ xa). 0 = tắt. Mặc định 10.
  doorAutoLockSeconds: (() => {
    const n = parseInt(process.env.DOOR_AUTO_LOCK_SECONDS ?? '', 10);
    return Number.isNaN(n) ? 10 : Math.min(Math.max(n, 0), 300);
  })(),
  corsOrigins: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : DEFAULT_CORS_ORIGINS,
  db: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'smart_home',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    // DATETIME trong MySQL là "giờ địa phương" (NOW(), CURRENT_TIMESTAMP). Đọc/ghi theo giờ máy chạy Node
    // để thời gian trả cho Frontend đúng (trước đây dùng '+00:00' nên mọi mốc giờ bị lệch 7 tiếng).
    timezone: 'local',
    dateStrings: false,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  },
  mqtt: {
    brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://io.adafruit.com:1883',
    username: process.env.MQTT_USERNAME.trim(),
    key: process.env.MQTT_KEY.trim(),
  },
};

module.exports = config;
