const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const app = require('./app');
const config = require('./config');
const { pool } = require('./db');
const { initMQTT } = require('./services/mqttService');

// 1. Khởi tạo HTTP server bọc Express App
const server = http.createServer(app);

// 2. Cấu hình WebSocket (Socket.IO) an toàn, tránh CORS wildcard khi dùng credentials
const allowedOrigins = config.corsOrigin
  ? config.corsOrigin.split(',').map((o) => o.trim())
  : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:8000'];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  },
});

// GẮN INSTANCE IO VÀO APP ĐỂ CÁC ROUTE REST CÓ THỂ TRUY XUẤT req.app.get('io')
app.set('io', io);

// 3. Middleware xác thực JWT cho kết nối Socket.IO
io.use((socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

    if (!token) {
      return next(new Error('unauthorized: thiếu token xác thực'));
    }

    const decoded = jwt.verify(token, config.jwtSecret);
    socket.user = decoded;
    next();
  } catch {
    next(new Error('unauthorized: token không hợp lệ hoặc đã hết hạn'));
  }
});

// 4. Quản lý kết nối thời gian thực qua Socket.IO
io.on('connection', (socket) => {
  const userId = socket.user?.User_ID ?? socket.user?.userId;

  // Kiểm tra tư cách thành viên trước khi cho vào phòng của nhà
  socket.on('join_home', async (homeId) => {
    try {
      const parsedHomeId = parseInt(homeId, 10);
      if (Number.isNaN(parsedHomeId)) return;

      const [rows] = await pool.query(
        `SELECT 1 FROM Home_Member 
         WHERE User_ID = ? AND Home_ID = ? 
           AND (Expired IS NULL OR Expired >= NOW())
         LIMIT 1`,
        [userId, parsedHomeId]
      );

      if (rows.length > 0 || socket.user?.Role === 'ADMIN') {
        const roomName = `home_${parsedHomeId}`;
        socket.join(roomName);
        socket.emit('joined_home', { homeId: parsedHomeId, room: roomName });
      } else {
        socket.emit('error_message', 'Bạn không có quyền truy cập vào dữ liệu ngôi nhà này');
      }
    } catch (err) {
      console.error('[Socket.IO] Lỗi khi xử lý join_home:', err);
    }
  });

  socket.on('leave_home', (homeId) => {
    const roomName = `home_${homeId}`;
    socket.leave(roomName);
  });

  socket.on('disconnect', () => {});
});

// 5. Khởi động MQTT Service và truyền instance socket.io vào
let mqttClient = null;
try {
  mqttClient = initMQTT(io);
} catch (err) {
  console.error('[MQTT] Khởi động MQTT thất bại:', err);
}

// 6. Khởi chạy Server
const PORT = config.port || 3000;
server.listen(PORT, () => {
  console.log(`Server YoloHome đang chạy tại: http://localhost:${PORT}`);
  console.log(`Health check sẵn sàng tại: http://localhost:${PORT}/health`);
});

// 7. Xử lý tắt ứng dụng an toàn (Graceful Shutdown)
let isShuttingDown = false;

const handleShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Server] Nhận tín hiệu ${signal}. Đang tiến hành đóng an toàn...`);

  // Đóng tiếp nhận HTTP mới
  server.close(async () => {
    console.log('[Server] Đã dừng tiếp nhận HTTP requests.');

    // Đóng kết nối Socket.IO
    if (io) {
      io.close();
      console.log('[Socket.IO] Đã đóng toàn bộ kết nối WebSocket.');
    }

    // Đóng kết nối MQTT Broker
    if (mqttClient && typeof mqttClient.end === 'function') {
      await new Promise((resolve) => mqttClient.end(false, resolve));
      console.log('[MQTT] Đã ngắt kết nối MQTT Broker an toàn.');
    }

    // Đóng MySQL Connection Pool
    if (pool && typeof pool.end === 'function') {
      await pool.end();
      console.log('[Database] Đã giải phóng MySQL connection pool.');
    }

    console.log('[Server] Toàn bộ dịch vụ đã dừng an toàn.');
    process.exit(0);
  });

  // Tự động tắt sau 10 giây nếu có kết nối bị nghẽn
  setTimeout(() => {
    console.error('[Server] Tắt quá thời gian quy định, buộc dừng tiến trình.');
    process.exit(1);
  }, 10000);
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));