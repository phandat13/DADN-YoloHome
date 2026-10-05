require('dotenv').config();

const requiredEnvVars = ['JWT_SECRET', 'DB_PASSWORD'];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`[CONFIG ERROR] Biến môi trường ${envVar} bắt buộc phải có trong file .env!`);
  }
}

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET,
  iotApiKey: process.env.IOT_API_KEY || 'default_iot_key',
  db: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'smart_home',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    charset: 'utf8mb4',
    timezone: 'Z',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  }
};

module.exports = config;