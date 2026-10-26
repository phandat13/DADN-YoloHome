// Trợ lý ảo (kênh V13 trong giáo trình): câu phản hồi ngắn như "Đèn đã bật", "Tôi không hiểu".
// - Gửi lên feed 'assistant' (nhà gắn phần cứng) để Gateway chuyển xuống Yolo:Bit hiển thị trên LCD / dashboard.
// - Phát Socket.IO 'assistant_message' để web hiển thị ngay.
const { publishCommand } = require('./mqttService');
const { isHardwareHome } = require('./hardwareHome');

const ASSISTANT_FEED = 'assistant';
const MAX_LEN = 64;   // LCD 16x2 + giới hạn hợp lý cho 1 câu

async function say(io, homeId, text) {
  const message = String(text || '').trim().slice(0, MAX_LEN);
  if (!message) return false;
  io?.to(`home_${homeId}`).emit('assistant_message', { homeId, text: message, timestamp: new Date().toISOString() });
  if (!(await isHardwareHome(homeId))) return false;
  return publishCommand(ASSISTANT_FEED, message);
}

module.exports = { say, ASSISTANT_FEED };
