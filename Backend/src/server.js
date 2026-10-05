const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const config = require('./config');
const { initMQTT } = require('./services/mqttService');

// 1. Khởi tạo HTTP server bọc Express App
const server = http.createServer(app);

// 2. Cấu hình WebSocket (Socket.IO) với CORS
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: true,
  },
});

// 3. Quản lý kết nối thời gian thực qua Socket.IO
io.on('connection', (socket) => {
  console.log(`[Socket.IO] Client kết nối thành công: ${socket.id}`);

  // Client tham gia phòng theo từng nhà (ví dụ: client gửi sự kiện join_home với homeId = 1)
  socket.on('join_home', (homeId) => {
    const roomName = `home_${homeId}`;
    socket.join(roomName);
    console.log(`[Socket.IO] Socket ${socket.id} đã vào phòng: ${roomName}`);
  });

  // Client rời phòng khi thoát màn hình nhà
  socket.on('leave_home', (homeId) => {
    const roomName = `home_${homeId}`;
    socket.leave(roomName);
    console.log(`[Socket.IO] Socket ${socket.id} đã rời phòng: ${roomName}`);
  });

  socket.on('disconnect', (reason) => {
    console.log(`[Socket.IO] Client ngắt kết nối: ${socket.id} (Lý do: ${reason})`);
  });
});

// 4. Khởi động MQTT Service và truyền instance socket.io vào để broadcast dữ liệu telemetry
initMQTT(io);

// 5. Khởi chạy Server
const PORT = config.port || 3000;
server.listen(PORT, () => {
  console.log(`Server YoloHome đang chạy tại: http://localhost:${PORT}`);
  console.log(`Health check sẵn sàng tại: http://localhost:${PORT}/health`);
});

// 6. Xử lý tắt ứng dụng an toàn (Graceful Shutdown)
const handleShutdown = () => {
  console.log('\nĐang đóng các kết nối và dừng server...');
  server.close(() => {
    console.log('Server đã dừng an toàn.');
    process.exit(0);
  });
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);