const mqtt = require('mqtt');
const config = require('../config');
const { pool } = require('../db');
const { SENSOR_FEEDS } = require('../utils/feeds');
const { recordSensorValue } = require('./sensorIngest');

let client = null;

// Feed dữ liệu mà Gateway / Yolo:Bit đẩy lên. 'sensor-temp-humid' giữ lại cho firmware cũ gửi JSON gộp.
const SUBSCRIBED_FEEDS = ['sensor-temperature', 'sensor-humidity', 'sensor-light', 'sensor-temp-humid', 'door-status'];

// Adafruit IO gửi giá trị dạng chuỗi: "31.5", "1", hoặc JSON {"value": 31.5} / {"temperature": 30, "humidity": 60}
function parsePayload(text) {
  const raw = String(text).trim();
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'number' || typeof parsed === 'boolean') return { value: Number(parsed) };
    if (typeof parsed === 'string') return parsePayload(parsed);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    /* không phải JSON */
  }
  if (/^(on|true)$/i.test(raw)) return { value: 1 };
  if (/^(off|false)$/i.test(raw)) return { value: 0 };
  const n = Number(raw);
  return Number.isFinite(n) ? { value: n } : {};
}

const pickNumber = (obj, ...keys) => {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '' && Number.isFinite(Number(obj[k]))) return Number(obj[k]);
  }
  return undefined;
};

/**
 * Tìm các cảm biến nhận dữ liệu của 1 feed:
 *  1) cảm biến khai báo Sensor.Feed_Key đúng feed này, hoặc
 *  2) (nếu chưa có) cảm biến đúng loại (TEMPERATURE/HUMIDITY/LIGHT) chưa gắn feed nào,
 *  3) cách cũ: cảm biến của thiết bị có Device.Feed_Key / Hardware_ID trùng feed.
 */
async function findSensorsForFeed(feedKey, sensorTypes) {
  const [byFeed] = await pool.query('SELECT Sensor_ID FROM Sensor WHERE Feed_Key = ?', [feedKey]);
  if (byFeed.length) return byFeed.map((r) => r.Sensor_ID);

  if (sensorTypes?.length) {
    const [byType] = await pool.query(
      'SELECT Sensor_ID FROM Sensor WHERE Feed_Key IS NULL AND UPPER(Sensor_Type) IN (?)',
      [sensorTypes]
    );
    if (byType.length) return byType.map((r) => r.Sensor_ID);
  }

  const [byDevice] = await pool.query(
    `SELECT s.Sensor_ID FROM Device d JOIN Sensor s ON d.Device_ID = s.Device_ID
     WHERE d.Feed_Key = ? OR d.Hardware_ID = ?`,
    [feedKey, feedKey]
  );
  return byDevice.map((r) => r.Sensor_ID);
}

async function handleMessage(io, feedKey, data) {
  if (feedKey === 'sensor-temp-humid') {
    // JSON gộp: tách thành 2 feed logic
    const t = pickNumber(data, 'temperature', 'temp', 't');
    const h = pickNumber(data, 'humidity', 'humid', 'hum', 'h');
    if (t !== undefined) await handleMessage(io, 'sensor-temperature', { value: t });
    if (h !== undefined) await handleMessage(io, 'sensor-humidity', { value: h });
    return;
  }

  const value = pickNumber(data, 'value', 'data', 'last_value');
  if (value === undefined) return;

  const sensorIds = await findSensorsForFeed(feedKey, SENSOR_FEEDS[feedKey]);
  for (const sensorId of sensorIds) {
    await recordSensorValue({ sensorId, value, quality: data.quality || 'good', io });
  }
}

const initMQTT = (io) => {
  const brokerUrl = config.mqtt.brokerUrl || 'mqtts://io.adafruit.com:8883';

  client = mqtt.connect(brokerUrl, {
    username: config.mqtt.username,
    password: config.mqtt.key,
    reconnectPeriod: 5000,
  });

  client.on('connect', () => {
    console.log(`[MQTT] Kết nối broker thành công (${brokerUrl})`);
    const username = config.mqtt.username;
    for (const feed of SUBSCRIBED_FEEDS) client.subscribe(`${username}/feeds/${feed}`);
  });

  client.on('error', (err) => {
    console.error('[MQTT] Lỗi kết nối:', err.message);
  });

  client.on('message', async (topic, message) => {
    try {
      const feedKey = topic.split('/').pop();
      await handleMessage(io, feedKey, parsePayload(message.toString()));
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

const isMqttConnected = () => Boolean(client && client.connected);

module.exports = { initMQTT, publishCommand, parsePayload, isMqttConnected };
