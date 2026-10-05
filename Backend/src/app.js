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
const doorRoutes = require('./routes/door');
const iotRouter = require('./routes/iot');
const aiRouter = require('./routes/ai');
const notificationRouter = require('./routes/notification');
const activityLogRouter = require('./routes/activityLog');

const app = express();

// 1. Gắn các middleware chung
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


if (config.nodeEnv !== 'test') {
  app.use(morgan('dev'));
}

// 2. Endpoint kiểm tra sức khỏe hệ thống
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Sau này các route chính (/api/auth, /api/homes...) sẽ được mount tại đây
app.use('/api/auth', authRoutes);
app.use('/api/homes', homeRoutes);
app.use('/api/homes/:homeId/members', memberRoutes);
app.use('/api/homes/:homeId/devices', deviceRoutes);
app.use('/api/homes/:homeId/doors', doorRoutes);
app.use('/api/homes/:homeId/iot', iotRouter);
app.use('/api/homes/:homeId/ai', aiRouter);
app.use('/api/notifications', notificationRouter);
app.use('/api/homes/:homeId/activity-logs', activityLogRouter);
// 3. Xử lý 404 và Error Handler (bắt buộc đặt cuối cùng)
app.use(notFound);
app.use(errorHandler);

module.exports = app;