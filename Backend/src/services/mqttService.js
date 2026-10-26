const mqtt = require('mqtt');
const config = require('../config');
const { pool } = require('../db');
const { SENSOR_FEEDS } = require('../utils/feeds');
const { recordSensorValue } = require('./sensorIngest');
const { getHardwareHomeId } = require('./hardwareHome');
const bus = require('./bus');

let client = null;

// Feed phần cứng đẩy lên. 'sensor-temp-humid' giữ lại cho firmware cũ gửi JSON gộp.
// device-light / device-fan cũng được nghe để đồng bộ khi bật tắt từ dashboard Adafruit hoặc nút trên mạch.
const SUBSCRIBED_FEEDS = [
  'sensor-temperature', 'sensor-humidity', 'sensor-light', 'sensor-motion', 'sensor-temp-humid',
  'device-light', 'device-fan', 'door-status',
];

// Adafruit IO gửi giá trị dạng chuỗi: "31.5", "1", "#FF0000", hoặc JSON {"value": 31.5} / {"temperature": 30, "humidity": 60}
function parsePayload(text) {
  const raw = String(text).trim();
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'number' || typeof parsed === 'boolean') return { value: Number(parsed), raw };
    if (typeof parsed === 'string') return parsePayload(parsed);
    if (parsed && typeof parsed === 'object') return { ...parsed, raw };
  } catch {
    /* không phải JSON */
  }
  if (/^(on|true)$/i.test(raw)) return { value: 1, raw };
  if (/^(off|false)$/i.test(raw)) return { value: 0, raw };
  const n = Number(raw);
  return Number.isFinite(n) && raw !== '' ? { value: n, raw } : { raw };
}

const pickNumber = (obj, ...keys) => {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '' && Number.isFinite(Number(obj[k]))) return Number(obj[k]);
  }
  return undefined;
};

// Cảm biến của NHÀ GẮN PHẦN CỨNG nhận dữ liệu của feed: khai báo đúng Feed_Key, hoặc đúng loại mà chưa gắn feed.
async function findSensorsForFeed(feedKey, sensorTypes) {
  const homeId = await getHardwareHomeId();
  if (homeId == null) return [];
  const [rows] = await pool.query(
    `SELECT s.Sensor_ID, s.Feed_Key FROM Sensor s JOIN Device d ON d.Device_ID = s.Device_ID
     WHERE d.Home_ID = ?
       AND (s.Feed_Key = ? OR (s.Feed_Key IS NULL AND UPPER(s.Sensor_Type) IN (?)))
     ORDER BY (s.Feed_Key = ?) DESC, s.Sensor_ID`,
    [homeId, feedKey, sensorTypes?.length ? sensorTypes : ['__none__'], feedKey]
  );
  const exact = rows.filter((r) => r.Feed_Key === feedKey);
  return (exact.length ? exact : rows).map((r) => r.Sensor_ID);
}

async function handleMessage(io, feedKey, data) {
  if (feedKey === 'sensor-temp-humid') {
    const t = pickNumber(data, 'temperature', 'temp', 't');
    const h = pickNumber(data, 'humidity', 'humid', 'hum', 'h');
    if (t !== undefined) await handleMessage(io, 'sensor-temperature', { value: t });
    if (h !== undefined) await handleMessage(io, 'sensor-humidity', { value: h });
    return;
  }

  if (feedKey === 'device-light' || feedKey === 'device-fan' || feedKey === 'door-status') {
    // deviceControl / doorAutoLock xử lý (qua bus để tránh require vòng)
    bus.emit(feedKey === 'door-status' ? 'door_feed' : 'device_feed', { io, feedKey, data });
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

/**
 * Gửi 1 giá trị lên feed. Trả về Promise<boolean>: true khi broker đã xác nhận (QoS 1 - PUBACK),
 * false khi chưa kết nối, broker từ chối hoặc quá thời gian chờ.
 */
const publishCommand = (feedKey, payload) => {
  if (!client || !client.connected) {
    console.warn(`[MQTT] Client chưa kết nối, không gửi được lên feed ${feedKey}`);
    return Promise.resolve(false);
  }
  const fullTopic = `${config.mqtt.username}/feeds/${feedKey}`;
  const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[MQTT] Hết thời gian chờ xác nhận khi gửi lên ${feedKey}`);
      resolve(false);
    }, config.mqtt.publishTimeoutMs);
    client.publish(fullTopic, message, { qos: 1 }, (err) => {
      clearTimeout(timer);
      if (err) console.error(`[MQTT] Gửi lên ${feedKey} thất bại:`, err.message);
      resolve(!err);
    });
  });
};

const isMqttConnected = () => Boolean(client && client.connected);

module.exports = { initMQTT, publishCommand, parsePayload, isMqttConnected };
