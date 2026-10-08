const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('./config');
const { notFound, errorHandler } = require('./middlewares/errorMiddleware');

const authRoutes = require('./routes/auth');
const homeRoutes = require('./routes/home');
const memberRoutes = require('./routes/member');
const deviceRoutes = require('./routes/device');
const deviceTypeRoutes = require('./routes/deviceType'); // Thêm route danh mục thiết bị
const doorRoutes = require('./routes/door');
const iotRouter = require('./routes/iot');
const aiRouter = require('./routes/ai');
const notificationRouter = require('./routes/notification');
const activityLogRouter = require('./routes/activityLog');

const app = express();

// 1. Gắn các middleware chung
app.use(helmet());

// Cấu hình CORS an toàn hỗ trợ credentials cho Frontend (danh sách trong config.js / CORS_ORIGIN)
const allowedOrigins = config.corsOrigins;

app.use(
  cors({
    origin: (origin, callback) => {
      // Cho phép request không có origin (như curl, mobile apps, Postman) hoặc nằm trong whitelist
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`[CORS] Chặn origin ${origin}. Thêm vào CORS_ORIGIN trong .env nếu đây là Frontend của bạn.`);
        callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-iot-key'],
  })
);

app.use(express.json({ limit: '10mb' })); // Đặt limit 10mb để hỗ trợ mảng vector / ảnh AI
app.use(express.urlencoded({ extended: true }));

if (config.nodeEnv !== 'test') {
  app.use(morgan('dev'));
}

// 2. Endpoint kiểm tra sức khỏe hệ thống
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 3. Mount các routes chính
// Các router con /api/homes/:homeId/... được gắn TRƯỚC router /api/homes để request của phần cứng
// (x-iot-key, không có JWT) không bị chặn bởi bước đăng nhập của router nhà.
app.use('/api/auth', authRoutes);
app.use('/api/device-types', deviceTypeRoutes); // Danh mục thiết bị toàn hệ thống
app.use('/api/homes/:homeId/members', memberRoutes);
app.use('/api/homes/:homeId/devices', deviceRoutes);
app.use('/api/homes/:homeId/doors', doorRoutes);
app.use('/api/homes/:homeId/iot', iotRouter);
app.use('/api/homes/:homeId/ai', aiRouter);
app.use('/api/homes/:homeId/activity-logs', activityLogRouter);
app.use('/api/homes', homeRoutes);
app.use('/api/notifications', notificationRouter);

// 4. Xử lý 404 và Error Handler (bắt buộc đặt cuối cùng)
app.use(notFound);
app.use(errorHandler);

module.exports = app;

