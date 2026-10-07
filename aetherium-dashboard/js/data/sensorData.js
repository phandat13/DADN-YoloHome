// Dữ liệu giả lập. Khi nối MQTT/API thật, chỉ cần thay file này
// (hoặc cập nhật `sensorState` rồi gọi lại render trong main.js).
export const sensorState = {
  temperature: 28.5,
  humidity: 64,
  light: 420,
  motion: true,
  ping: 24,
  nodes: { online: 12, total: 12 },
  controlMode: 'Tự động (Auto)',
  boardOnline: true,
};

// 25 điểm theo giờ: 00:00 -> 24:00
export const history24h = {
  temperature: [24.5,24,23.6,23.4,23.2,23.5,24.5,26,27.5,29,30.5,32,33.5,34.3,34.8,34.2,33.3,32,30.5,29,28,27,26,25.3,24.8],
  humidity:    [78,79,80,81,82,80,77,73,69,65,61,58,56,55,54,55,57,60,63,66,69,72,74,76,77],
};
