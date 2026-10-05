const mqtt = require('mqtt');
const { pool } = require('../db');

let mqttClient = null;
let ioInstance = null;

const initMQTT = (io) => {
  ioInstance = io;

  // Cấu hình broker (ở đây dùng public broker HiveMQ để test hoặc bạn thay bằng Adafruit IO)
  const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://broker.hivemq.com:1883';
  const options = {
    clientId: `yolohome_backend_${Math.random().toString(16).slice(3)}`,
    clean: true,
    connectTimeout: 4000,
    reconnectPeriod: 1000,
  };

  mqttClient = mqtt.connect(brokerUrl, options);

  mqttClient.on('connect', () => {
    console.log(`[MQTT] Đã kết nối thành công tới Broker: ${brokerUrl}`);

    // Đăng ký topic nhận dữ liệu telemetry cảm biến của các nhà: yolohome/+/sensors/+/telemetry
    mqttClient.subscribe('yolohome/+/sensors/+/telemetry', (err) => {
      if (!err) {
        console.log('[MQTT] Đã subscribe topic: yolohome/+/sensors/+/telemetry');
      }
    });

    // Đăng ký topic nhận trạng thái cửa: yolohome/+/doors/+/status
    mqttClient.subscribe('yolohome/+/doors/+/status');
  });

  mqttClient.on('message', async (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      console.log(`[MQTT IN] Topic: ${topic} - Data:`, payload);

      // Phân tích topic: yolohome/:homeId/sensors/:sensorId/telemetry
      const parts = topic.split('/');
      if (parts[2] === 'sensors' && parts[4] === 'telemetry') {
        const homeId = parseInt(parts[1], 10);
        const sensorId = parseInt(parts[3], 10);
        const { value, quality } = payload;

        if (value !== undefined) {
          // 1. Lưu số liệu vào DB (Sensor_Record)
          await pool.query(
            'INSERT INTO Sensor_Record (`Value`, Data_quality, Recorded_At, Sensor_ID) VALUES (?, ?, NOW(), ?)',
            [parseFloat(value), quality || 'GOOD', sensorId]
          );

          // 2. Bắn WebSocket tới Web/App client đang ở room của nhà này
          if (ioInstance) {
            ioInstance.to(`home_${homeId}`).emit('sensor_update', {
              sensorId,
              value: parseFloat(value),
              quality: quality || 'GOOD',
              timestamp: new Date(),
            });
          }
        }
      }
    } catch (err) {
      console.error('[MQTT Error] Lỗi xử lý message MQTT:', err.message);
    }
  });

  mqttClient.on('error', (err) => {
    console.error('[MQTT Error] Kết nối thất bại:', err.message);
  });
};

// Hàm gửi lệnh từ Backend xuống phần cứng qua MQTT
const publishCommand = (homeId, deviceId, command) => {
  if (!mqttClient || !mqttClient.connected) {
    console.error('[MQTT Error] Client chưa kết nối, không thể gửi lệnh');
    return false;
  }
  const topic = `yolohome/${homeId}/devices/${deviceId}/control`;
  mqttClient.publish(topic, JSON.stringify(command));
  console.log(`[MQTT OUT] Đã gửi lệnh tới ${topic}:`, command);
  return true;
};

module.exports = {
  initMQTT,
  publishCommand,
};