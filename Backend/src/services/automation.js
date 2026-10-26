// Cảnh báo ngưỡng + tự động hoá chạy trên SERVER (trước đây chạy trong trình duyệt: đóng tab là mất,
// nhiều tab cùng gửi lệnh, mỗi máy một bộ ngưỡng). Được gọi mỗi khi có số liệu cảm biến mới.
//  - Nhiệt độ > Temp_Max      : cảnh báo, (tự động) quạt 100% + bật còi
//  - Độ ẩm ngoài [min, max]   : cảnh báo
//  - Có chuyển động (PIR) hoặc ánh sáng < Light_Min : (tự động) bật đèn, ngược lại tắt đèn
const config = require('../config');
const { pool, callProc } = require('../db');
const bus = require('./bus');
const { sendDeviceCommand, findPrimaryDevice } = require('./deviceControl');
const assistant = require('./assistant');

const KIND_OF_TYPE = (t) => {
  const s = String(t || '').toUpperCase();
  if (s.includes('TEMP')) return 'temperature';
  if (s.includes('HUM')) return 'humidity';
  if (s.includes('LIGHT') || s.includes('LUX') || s.includes('LDR')) return 'light';
  if (s.includes('MOTION') || s.includes('PIR')) return 'motion';
  return null;
};

async function getSettings(homeId) {
  await pool.query('INSERT IGNORE INTO Home_Setting (Home_ID) VALUES (?)', [homeId]);
  const [rows] = await pool.query(
    'SELECT Temp_Max, Humidity_Min, Humidity_Max, Light_Min, Auto_Mode, Updated_At FROM Home_Setting WHERE Home_ID = ?',
    [homeId]
  );
  const r = rows[0];
  return {
    tempMax: Number(r.Temp_Max),
    humidityMin: Number(r.Humidity_Min),
    humidityMax: Number(r.Humidity_Max),
    lightMin: Number(r.Light_Min),
    autoMode: Boolean(r.Auto_Mode),
    updatedAt: r.Updated_At,
  };
}

// Giá trị mới nhất theo loại (cảm biến đầu tiên của mỗi loại) và còn "mới" hay không
async function readLatest(homeId) {
  const [rows] = await pool.query(
    `SELECT s.Sensor_Type, s.Current_Value, TIMESTAMPDIFF(SECOND, s.Last_Updated, NOW()) AS Age_S
     FROM Sensor s JOIN Device d ON d.Device_ID = s.Device_ID
     WHERE d.Home_ID = ? ORDER BY s.Sensor_ID`,
    [homeId]
  );
  const latest = {};
  for (const r of rows) {
    const kind = KIND_OF_TYPE(r.Sensor_Type);
    if (!kind || latest[kind]) continue;
    const fresh = r.Age_S != null && r.Age_S * 1000 <= config.automation.freshDataMs;
    latest[kind] = { value: r.Current_Value == null ? null : Number(r.Current_Value), fresh };
  }
  return latest;
}

function computeAlerts(s, latest) {
  const alerts = [];
  const t = latest.temperature;
  const h = latest.humidity;
  if (t?.fresh && t.value != null && t.value > s.tempMax) {
    alerts.push({ key: 'temp', level: 'critical', message: `Nhiệt độ ${t.value}°C vượt ngưỡng ${s.tempMax}°C`, short: 'Nhiet do cao!' });
  }
  if (h?.fresh && h.value != null && (h.value < s.humidityMin || h.value > s.humidityMax)) {
    alerts.push({ key: 'hum', level: 'warning', message: `Độ ẩm ${h.value}% ngoài khoảng ${s.humidityMin}–${s.humidityMax}%`, short: 'Do am bat thuong' });
  }
  return alerts;
}

const activeAlerts = new Map();   // homeId -> Set(key) đang cảnh báo (để chỉ báo khi MỚI vượt ngưỡng)
const backoff = new Map();        // deviceId -> thời điểm được thử lại
const queues = new Map();         // homeId -> Promise (xử lý tuần tự từng nhà, tránh gửi trùng lệnh)
const lastMotion = new Map();
const MOTION_COOLDOWN_MS = 30_000; 

async function ownerOf(homeId) {
  const [rows] = await pool.query('SELECT Owner_ID FROM Home WHERE Home_ID = ?', [homeId]);
  return rows[0]?.Owner_ID ?? null;
}

async function autoCommand(io, homeId, device, input, ownerId) {
  if (!device || (backoff.get(device.Device_ID) ?? 0) > Date.now()) return;
  try {
    const r = await sendDeviceCommand({ io, homeId, device, input, userId: ownerId, sourceType: 'SYSTEM' });
    if (!r.ok) backoff.set(device.Device_ID, Date.now() + config.automation.retryAfterMs);
  } catch (err) {
    backoff.set(device.Device_ID, Date.now() + config.automation.retryAfterMs);
    console.error(`[AUTO] Không điều khiển được "${device.Device_Name}":`, err.message);
  }
}

const isOn = (d) => /^on$/i.test(String(d.Available_working_State)) || parseInt(d.Available_working_State, 10) > 0;
const speedOf = (d) => parseInt(d.Available_working_State, 10) || (isOn(d) ? 100 : 0);

async function notifyMotion(io, homeId, motion) {
  const st = lastMotion.get(homeId) ?? { on: false, notifiedAt: 0 };
  const on = Boolean(motion?.fresh && motion.value > 0);
  const now = Date.now();

  if (on && !st.on && now - st.notifiedAt > MOTION_COOLDOWN_MS) {
    const message = 'Cảm biến PIR phát hiện chuyển động trong nhà';
    await callProc('sp_notify_home_owner', [homeId, 'Phát hiện chuyển động', 'sensor_alert', message, 'warning']);
    io?.to(`home_${homeId}`).emit('motion_detected', {
      homeId,
      message,
      timestamp: new Date().toISOString(),
    });
    st.notifiedAt = now;
  }
  st.on = on;
  lastMotion.set(homeId, st);
}

async function runEvaluation(io, homeId) {
  const settings = await getSettings(homeId);
  const latest = await readLatest(homeId);
  const alerts = computeAlerts(settings, latest);

  // 1. Cảnh báo: chỉ tạo thông báo khi một cảnh báo MỚI xuất hiện
  const before = activeAlerts.get(homeId) ?? new Set();
  for (const a of alerts) {
    if (before.has(a.key)) continue;
    await callProc('sp_notify_home_owner', [homeId, 'Cảnh báo môi trường', 'sensor_alert', a.message, a.level]);
    assistant.say(io, homeId, a.short).catch(() => {});
  }
  activeAlerts.set(homeId, new Set(alerts.map((a) => a.key)));
  io?.to(`home_${homeId}`).emit('alerts_updated', { homeId, alerts: alerts.map(({ short, ...a }) => a) });

  await notifyMotion(io, homeId, latest.motion);

  if (!settings.autoMode) return;

  // 2. Tự động hoá (chỉ dùng số liệu còn mới)
  const ownerId = await ownerOf(homeId);
  const { temperature: t, light: l, motion: m } = latest;

  const light = await findPrimaryDevice(homeId, 'light');
  if (light && (l?.fresh || m?.fresh)) {
    const want = Boolean((m?.fresh && m.value > 0) || (l?.fresh && l.value != null && l.value < settings.lightMin));
    if (isOn(light) !== want) await autoCommand(io, homeId, light, { action: want ? 'TURN_ON' : 'TURN_OFF' }, ownerId);
  }

  if (t?.fresh && t.value != null) {
    const hot = t.value > settings.tempMax;
    const fan = await findPrimaryDevice(homeId, 'fan');
    if (fan) {
      const want = hot ? 100 : 0;
      if (speedOf(fan) !== want) await autoCommand(io, homeId, fan, { action: 'SET_SPEED', speed: want }, ownerId);
    }
    const buzzer = await findPrimaryDevice(homeId, 'buzzer');
    if (buzzer && isOn(buzzer) !== hot) await autoCommand(io, homeId, buzzer, { action: hot ? 'TURN_ON' : 'TURN_OFF' }, ownerId);
  }
}

// Xếp hàng theo nhà để 3 giá trị (nhiệt độ, độ ẩm, ánh sáng) đến cùng lúc không sinh lệnh trùng
function evaluateHome(io, homeId) {
  const prev = queues.get(homeId) ?? Promise.resolve();
  const next = prev
    .then(() => runEvaluation(io, homeId))
    .catch((err) => console.error(`[AUTO] Lỗi đánh giá nhà #${homeId}:`, err.message));
  queues.set(homeId, next);
  return next;
}

async function currentAlerts(homeId) {
  const alerts = computeAlerts(await getSettings(homeId), await readLatest(homeId));
  return alerts.map(({ short, ...a }) => a);
}

async function setAutoMode(io, homeId, autoMode) {
  await getSettings(homeId);
  await pool.query('UPDATE Home_Setting SET Auto_Mode = ? WHERE Home_ID = ?', [autoMode ? 1 : 0, homeId]);
  const settings = await getSettings(homeId);
  io?.to(`home_${homeId}`).emit('settings_updated', { homeId, settings });
  if (autoMode) evaluateHome(io, homeId);
  return settings;
}

// Người dùng điều khiển tay (web / giọng nói) -> chuyển sang thủ công để tự động hoá không bật/tắt ngược lại
async function disableAutoOnManual(io, homeId) {
  const s = await getSettings(homeId);
  if (!s.autoMode) return false;
  await setAutoMode(io, homeId, false);
  return true;
}

function start() {
  bus.on('sensor_value', ({ io, homeId }) => { evaluateHome(io, homeId); });
}

module.exports = { start, getSettings, evaluateHome, currentAlerts, setAutoMode, disableAutoOnManual };
