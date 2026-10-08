const mqtt = require('mqtt');
const config = require('../config');
const { pool } = require('../db');

let client = null;

const initMQTT = (io) => {
  // Ưu tiên kết nối bảo mật mqtts cổng 8883
  const brokerUrl = config.mqtt.brokerUrl || `mqtts://${config.mqtt.host || 'io.adafruit.com'}:8883`;

  client = mqtt.connect(brokerUrl, {
    username: config.mqtt.username,
    password: config.mqtt.key,
    reconnectPeriod: 5000,
  });

  client.on('connect', () => {
    console.log('[MQTT] Kết nối Adafruit IO thành công');

    // Đăng ký nhận tin các feed
    const username = config.mqtt.username;
    client.subscribe(`${username}/feeds/sensor-temp-humid`);
    client.subscribe(`${username}/feeds/sensor-light`);
    client.subscribe(`${username}/feeds/door-status`);
  });

  client.on('message', async (topic, message) => {
    try {
      const payloadStr = message.toString();
      const feedKey = topic.split('/').pop();
      let rawData = {};
      try {
        rawData = JSON.parse(payloadStr);
      } catch {
        rawData = { value: parseFloat(payloadStr) };
      }

      // Xử lý động dựa vào Feed_Key đã cấu hình trong DB
      const [devices] = await pool.query(
        `SELECT d.Home_ID, s.Sensor_ID, s.Sensor_Type 
         FROM Device d 
         JOIN Sensor s ON d.Device_ID = s.Device_ID 
         WHERE d.Feed_Key = ? OR d.Hardware_ID = ?`,
        [feedKey, feedKey]
      );

      if (devices.length > 0) {
        for (const item of devices) {
          const val = rawData.value ?? rawData.data;
          if (val !== undefined && !Number.isNaN(Number(val))) {
            await pool.query(
              'INSERT INTO Sensor_Record (Sensor_ID, Sensor_Value, Data_Quality, Time_Stamp) VALUES (?, ?, "good", NOW())',
              [item.Sensor_ID, Number(val)]
            );
            await pool.query('UPDATE Sensor SET Current_Value = ? WHERE Sensor_ID = ?', [Number(val), item.Sensor_ID]);

            // Broadcast về UI Dashboard của đúng nhà
            if (io) {
              io.to(`home_${item.Home_ID}`).emit('sensor_update', {
                sensorId: item.Sensor_ID,
                value: Number(val),
                type: item.Sensor_Type,
                timestamp: new Date().toISOString(),
              });
            }
          }
        }
      }
    } catch (err) {
      console.error('[MQTT] Lỗi xử lý bản tin đến:', err);
    }
  });

  return client;
};

// Hàm gửi lệnh chuẩn hóa nhận (feedKey, payload)
const publishCommand = (feedKey, payload) => {
  if (!client || !client.connected) {
    console.warn('[MQTT] Client chưa kết nối, không thể publish lệnh');
    return false;
  }
  const fullTopic = `${config.mqtt.username}/feeds/${feedKey}`;
  client.publish(fullTopic, typeof payload === 'string' ? payload : JSON.stringify(payload), { qos: 1 });
  return true;
};

module.exports = { initMQTT, publishCommand };