// Cảnh báo ngưỡng + tự động hoá chạy trên SERVER, mỗi khi có số liệu cảm biến mới và định kỳ 30 giây.
//
// Phân tích (chế độ tự động):
//  - Nhiệt độ  > Temp_Max      : quạt 50%;  > Temp_Max + 2: 75%;  > Temp_Max + 4: 100%; còi báo động.
//                ≤ Temp_Max - 1: tắt quạt (vùng trễ 1°C để quạt không bật/tắt liên tục quanh ngưỡng).
//  - Đèn chỉ bật khi TRỜI TỐI (< Light_Min) VÀ CÓ NGƯỜI (PIR). Không thấy người trong
//    LIGHT_NO_MOTION_MINUTES phút (mặc định 2) thì tắt, dù sáng hay tối. Có người mà trời sáng thì không bật.
//  - Chế độ ngủ (khung giờ Sleep_Start–Sleep_End hoặc lệnh "đi ngủ"): giữ đèn TẮT, không bật theo trời tối / PIR;
//    lúc bắt đầu giờ ngủ tắt toàn bộ đèn; còi chỉ kêu khi nóng nguy hiểm (> Temp_Max + 5).
//  - Lệnh của người (giọng nói > web / hẹn giờ) được ưu tiên: thiết bị vừa được điều khiển tay
//    sẽ không bị tự động hoá đảo lại trong Override_Minutes phút (services/priority.js).
const config = require('../config');
const { pool, callProc } = require('../db');
const bus = require('./bus');
const { sendDeviceCommand, findPrimaryDevice, findDevicesOfKind } = require('./deviceControl');
const assistant = require('./assistant');
const priority = require('./priority');
const { getSettings, isSleeping, nextSleepEnd, nextSleepStart } = require('./homeSettings');

const FAN_HYSTERESIS_C = 1;
const LIGHT_HYSTERESIS_RATIO = 1.25;
const SLEEP_BUZZER_MARGIN_C = 5;
const TICK_MS = 30_000;

const KIND_OF_TYPE = (t) => {
  const s = String(t || '').toUpperCase();
  if (s.includes('TEMP')) return 'temperature';
  if (s.includes('HUM')) return 'humidity';
  if (s.includes('LIGHT') || s.includes('LUX') || s.includes('LDR')) return 'light';
  if (s.includes('MOTION') || s.includes('PIR')) return 'motion';
  return null;
};

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

// ---------------- Phân tích: muốn thiết bị ở trạng thái nào (null = giữ nguyên) ----------------

// Tốc độ quạt theo mức vượt ngưỡng, có vùng trễ khi hạ nhiệt
function fanTarget(temp, tempMax) {
  if (temp > tempMax + 4) return 100;
  if (temp > tempMax + 2) return 75;
  if (temp > tempMax) return 50;
  if (temp <= tempMax - FAN_HYSTERESIS_C) return 0;
  return null;
}

// Đèn chỉ bật khi TRỜI TỐI VÀ CÓ NGƯỜI. Không có người (sáng hay tối) -> tắt.
//  occupied: có người (PIR báo, hoặc vừa báo trong vòng occupancyHoldMs) | false | null (nhà không có cảm biến PIR)
//  dark:     true (< Light_Min) | false (đủ sáng) | null (chưa có số liệu ánh sáng mới)
//  Đèn đang bật mà vẫn có người thì giữ bật: ánh sáng của chính bóng đèn làm cảm biến sáng hơn,
//  nếu tắt theo độ sáng thì đèn sẽ nhấp nháy.
// true = bật, false = tắt, null = giữ nguyên
function lightTarget({ sleeping, occupied, dark, lightOn }) {
  if (sleeping) return false;
  if (occupied === false) return false;
  if (occupied === null) return dark;          // không có PIR: chỉ theo ánh sáng
  if (lightOn) return true;                    // có người + đèn đang bật -> giữ bật
  return dark === true ? true : dark === false ? false : null;
}

const isOn = (d) => /^on$/i.test(String(d.Available_working_State)) || parseInt(d.Available_working_State, 10) > 0;
const speedOf = (d) => parseInt(d.Available_working_State, 10) || (isOn(d) ? 100 : 0);
const clock = (iso) => new Date(iso).toTimeString().slice(0, 5);

// ---------------- Trạng thái trong bộ nhớ ----------------
const activeAlerts = new Map();   // homeId -> Set(key) đang cảnh báo (để chỉ báo khi MỚI vượt ngưỡng)
const lastAlertsJson = new Map(); // homeId -> chuỗi JSON cảnh báo lần trước (vòng quét chỉ phát khi đổi)
const backoff = new Map();        // deviceId -> thời điểm được thử lại
const queues = new Map();         // homeId -> Promise (xử lý tuần tự từng nhà, tránh gửi trùng lệnh)
const lastMotion = new Map();
const lastSeen = new Map();       // homeId -> thời điểm PIR thấy người gần nhất
const lastSleeping = new Map();   // homeId -> boolean (phát hiện lúc bắt đầu / kết thúc giờ ngủ)
const insights = new Map();       // homeId -> { at, sleeping, items: [...] }
const MOTION_COOLDOWN_MS = 30_000;

async function ownerOf(homeId) {
  const [rows] = await pool.query('SELECT Owner_ID FROM Home WHERE Home_ID = ?', [homeId]);
  return rows[0]?.Owner_ID ?? null;
}

// Gửi lệnh tự động. Trả về mô tả ngắn cho phần phân tích.
async function autoCommand(io, homeId, device, input, ownerId, holdSource) {
  if (!device) return 'không có thiết bị';
  if ((backoff.get(device.Device_ID) ?? 0) > Date.now()) return 'đang chờ thử lại sau lỗi';
  try {
    const r = await sendDeviceCommand({ io, homeId, device, input, userId: ownerId, sourceType: 'SYSTEM', holdSource });
    if (r.skipped) return `bỏ qua: ${priority.LABEL[r.blockedBy.source]} đang ưu tiên đến ${clock(r.blockedBy.until)}`;
    if (!r.ok) {
      backoff.set(device.Device_ID, Date.now() + config.automation.retryAfterMs);
      return 'gửi lệnh lỗi';
    }
    return 'đã thực hiện';
  } catch (err) {
    backoff.set(device.Device_ID, Date.now() + config.automation.retryAfterMs);
    console.error(`[AUTO] Không điều khiển được "${device.Device_Name}":`, err.message);
    return 'gửi lệnh lỗi';
  }
}

async function notifyMotion(io, homeId, motion, sleeping) {
  const st = lastMotion.get(homeId) ?? { on: false, notifiedAt: 0 };
  const on = Boolean(motion?.fresh && motion.value > 0);
  const now = Date.now();

  if (on && !st.on && now - st.notifiedAt > MOTION_COOLDOWN_MS) {
    const message = sleeping
      ? 'Cảm biến PIR phát hiện chuyển động trong giờ ngủ'
      : 'Cảm biến PIR phát hiện chuyển động trong nhà';
    await callProc('sp_notify_home_owner', [homeId, 'Phát hiện chuyển động', 'sensor_alert', message, 'warning']);
    io?.to(`home_${homeId}`).emit('motion_detected', { homeId, message, timestamp: new Date().toISOString() });
    st.notifiedAt = now;
  }
  st.on = on;
  lastMotion.set(homeId, st);
}

// Bắt đầu giờ ngủ (hoặc lệnh "đi ngủ"): tắt mọi đèn. source = 'SLEEP' (tự động) hoặc 'VOICE_COMMAND' / 'USER'.
async function turnOffLightsForSleep(io, homeId, { source = 'SLEEP', userId } = {}) {
  const lights = await findDevicesOfKind(homeId, 'light');
  const actor = userId ?? (await ownerOf(homeId));
  const results = [];
  for (const light of lights) {
    if (!isOn(light)) { results.push({ device: light.Device_Name, result: 'đã tắt sẵn' }); continue; }
    let result;
    try {
      const r = source === 'SLEEP'
        ? await sendDeviceCommand({ io, homeId, device: light, input: { action: 'TURN_OFF' }, userId: actor, sourceType: 'SYSTEM', holdSource: 'SLEEP' })
        : await sendDeviceCommand({ io, homeId, device: light, input: { action: 'TURN_OFF' }, userId: actor, sourceType: source });
      result = r.skipped ? `giữ nguyên (${priority.LABEL[r.blockedBy.source]} ưu tiên)` : r.ok ? 'đã tắt' : 'lỗi';
    } catch (err) {
      result = 'lỗi';
      console.error(`[SLEEP] Không tắt được "${light.Device_Name}":`, err.message);
    }
    results.push({ device: light.Device_Name, result });
  }
  return results;
}

async function runEvaluation(io, homeId, { fromTick = false } = {}) {
  const settings = await getSettings(homeId);
  const latest = await readLatest(homeId);
  const alerts = computeAlerts(settings, latest);
  const sleeping = settings.sleeping;

  // 1. Cảnh báo: chỉ tạo thông báo khi một cảnh báo MỚI xuất hiện
  const before = activeAlerts.get(homeId) ?? new Set();
  for (const a of alerts) {
    if (before.has(a.key)) continue;
    await callProc('sp_notify_home_owner', [homeId, 'Cảnh báo môi trường', 'sensor_alert', a.message, a.level]);
    assistant.say(io, homeId, a.short).catch(() => {});
  }
  activeAlerts.set(homeId, new Set(alerts.map((a) => a.key)));
  const publicAlerts = alerts.map(({ short, ...a }) => a);
  const alertsJson = JSON.stringify(publicAlerts);
  if (!fromTick || lastAlertsJson.get(homeId) !== alertsJson) {
    io?.to(`home_${homeId}`).emit('alerts_updated', { homeId, alerts: publicAlerts });
  }
  lastAlertsJson.set(homeId, alertsJson);

  if (!fromTick) await notifyMotion(io, homeId, latest.motion, sleeping);

  // 2. Chuyển sang / ra khỏi giờ ngủ (chạy cả khi đang thủ công: chế độ ngủ là cài đặt riêng)
  const items = [];
  const wasSleeping = lastSleeping.get(homeId);
  lastSleeping.set(homeId, sleeping);
  if (sleeping && wasSleeping === false) {
    const res = await turnOffLightsForSleep(io, homeId);
    items.push({ key: 'sleep', text: `Bắt đầu giờ ngủ → tắt đèn (${res.map((r) => `${r.device}: ${r.result}`).join(', ') || 'không có đèn'})` });
    assistant.say(io, homeId, 'Chuc ngu ngon').catch(() => {});
  } else if (!sleeping && wasSleeping === true) {
    items.push({ key: 'sleep', text: 'Kết thúc giờ ngủ → đèn chạy theo ánh sáng / chuyển động' });
  } else if (sleeping) {
    items.push({ key: 'sleep', text: `Đang giờ ngủ (${settings.sleepStart}–${settings.sleepEnd}) → giữ đèn tắt` });
  }

  if (!settings.autoMode) {
    items.push({ key: 'mode', text: 'Chế độ thủ công → không tự điều khiển thiết bị' });
    publishInsights(io, homeId, sleeping, items);
    return;
  }

  // 3. Tự động hoá (chỉ dùng số liệu còn mới)
  const ownerId = await ownerOf(homeId);
  const { temperature: t, light: l, motion: m } = latest;

  const light = await findPrimaryDevice(homeId, 'light');
  if (light) {
    // Có người: PIR đang báo 1, hoặc vừa báo trong vòng occupancyHoldMs (PIR về 0 khi người ngồi yên)
    const now = Date.now();
    if (m?.fresh && m.value > 0) lastSeen.set(homeId, now);
    const holdMs = config.automation.occupancyHoldMs;
    const seenAgo = lastSeen.has(homeId) ? now - lastSeen.get(homeId) : Infinity;
    const occupied = m === undefined ? null : seenAgo <= holdMs;
    const lux = l?.fresh && l.value != null ? l.value : null;
    const dark = lux == null ? (l === undefined ? true : null)
      : lux < settings.lightMin ? true : lux > settings.lightMin * LIGHT_HYSTERESIS_RATIO ? false : null;
    const want = lightTarget({ sleeping, occupied, dark, lightOn: isOn(light) });
    const luxText = lux == null ? 'chưa có số liệu ánh sáng' : `${lux} lux, ngưỡng ${settings.lightMin}`;
    const holdMin = Math.round(holdMs / 60000);
    const why = sleeping ? 'giờ ngủ'
      : occupied === false ? `không có người ${Number.isFinite(seenAgo) ? `${holdMin} phút qua` : ''}`.trim()
        : occupied === null ? `nhà không có cảm biến PIR, ${luxText}`
          : `có người, ${dark ? 'trời tối' : dark === false ? 'trời sáng' : 'độ sáng vừa'} (${luxText})`;
    if (want === null) {
      items.push({ key: 'light', text: `Đèn: giữ nguyên (${why})` });
    } else if (isOn(light) === want) {
      items.push({ key: 'light', text: `Đèn: ${want ? 'BẬT' : 'TẮT'} đúng trạng thái (${why})` });
    } else {
      const r = await autoCommand(io, homeId, light, { action: want ? 'TURN_ON' : 'TURN_OFF' }, ownerId);
      items.push({ key: 'light', text: `Đèn → ${want ? 'BẬT' : 'TẮT'} vì ${why}: ${r}` });
    }
  }

  if (t?.fresh && t.value != null) {
    const fan = await findPrimaryDevice(homeId, 'fan');
    if (fan) {
      const want = fanTarget(t.value, settings.tempMax);
      if (want === null) {
        items.push({ key: 'fan', text: `Quạt: giữ ${speedOf(fan)}% (${t.value}°C sát ngưỡng ${settings.tempMax}°C)` });
      } else if (speedOf(fan) === want) {
        items.push({ key: 'fan', text: `Quạt: ${want}% đúng mức (${t.value}°C, ngưỡng ${settings.tempMax}°C)` });
      } else {
        const r = await autoCommand(io, homeId, fan, { action: 'SET_SPEED', speed: want }, ownerId);
        items.push({ key: 'fan', text: `Quạt → ${want}% vì ${t.value}°C (ngưỡng ${settings.tempMax}°C): ${r}` });
      }
    }
    const buzzer = await findPrimaryDevice(homeId, 'buzzer');
    if (buzzer) {
      const limit = settings.tempMax + (sleeping ? SLEEP_BUZZER_MARGIN_C : 0);
      const want = t.value > limit;
      if (isOn(buzzer) !== want) {
        const r = await autoCommand(io, homeId, buzzer, { action: want ? 'TURN_ON' : 'TURN_OFF' }, ownerId);
        items.push({ key: 'buzzer', text: `Còi → ${want ? 'BẬT' : 'TẮT'} (${t.value}°C, ngưỡng còi ${limit}°C): ${r}` });
      }
    }
  } else {
    items.push({ key: 'fan', text: 'Quạt: chưa có số liệu nhiệt độ mới (≤ 10 phút)' });
  }

  publishInsights(io, homeId, sleeping, items);
}

function publishInsights(io, homeId, sleeping, items) {
  const data = { homeId, at: new Date().toISOString(), sleeping, items };
  const prev = insights.get(homeId);
  insights.set(homeId, data);
  if (!prev || JSON.stringify(prev.items) !== JSON.stringify(items) || prev.sleeping !== sleeping) {
    io?.to(`home_${homeId}`).emit('automation_insight', data);
  }
}

// Xếp hàng theo nhà để 3 giá trị (nhiệt độ, độ ẩm, ánh sáng) đến cùng lúc không sinh lệnh trùng
function evaluateHome(io, homeId, opts) {
  const prev = queues.get(homeId) ?? Promise.resolve();
  const next = prev
    .then(() => runEvaluation(io, homeId, opts))
    .catch((err) => console.error(`[AUTO] Lỗi đánh giá nhà #${homeId}:`, err.message));
  queues.set(homeId, next);
  return next;
}

async function currentAlerts(homeId) {
  const alerts = computeAlerts(await getSettings(homeId), await readLatest(homeId));
  return alerts.map(({ short, ...a }) => a);
}

const currentInsights = (homeId) => insights.get(Number(homeId)) ?? null;

async function setAutoMode(io, homeId, autoMode) {
  await getSettings(homeId);
  await pool.query('UPDATE Home_Setting SET Auto_Mode = ? WHERE Home_ID = ?', [autoMode ? 1 : 0, homeId]);
  const settings = await getSettings(homeId);
  io?.to(`home_${homeId}`).emit('settings_updated', { homeId, settings });
  if (autoMode) evaluateHome(io, homeId);
  return settings;
}

// Giữ cho tương thích: trước đây điều khiển tay tắt cả chế độ tự động.
// Nay chỉ "giữ" đúng thiết bị đó trong Override_Minutes phút (services/priority.js) -> không tắt chế độ tự động nữa.
async function disableAutoOnManual() {
  return false;
}

/**
 * Đi ngủ ngay / thức dậy / theo lịch. Dùng chung cho nút trên web và lệnh giọng nói.
 * sleep: tắt đèn, giữ chế độ ngủ tới giờ thức dậy; awake: bỏ chế độ ngủ tới giờ ngủ kế tiếp; auto: theo khung giờ.
 */
async function applySleepNow(io, homeId, mode, { userId, source = 'USER' } = {}) {
  const s = await getSettings(homeId);
  const manual = { sleep: 'SLEEP', awake: 'AWAKE', auto: 'NONE' }[mode];
  const until = mode === 'sleep' ? nextSleepEnd(s) : mode === 'awake' ? nextSleepStart(s) : null;
  await pool.query('UPDATE Home_Setting SET Sleep_Manual = ?, Sleep_Manual_Until = ? WHERE Home_ID = ?', [manual, until, homeId]);
  const lights = mode === 'sleep' ? await turnOffLightsForSleep(io, homeId, { source, userId }) : [];
  const settings = await getSettings(homeId);
  lastSleeping.set(Number(homeId), settings.sleeping);   // đã tự tắt đèn ở trên, vòng phân tích không tắt lần nữa
  io?.to(`home_${homeId}`).emit('settings_updated', { homeId, settings });
  await evaluateHome(io, homeId, { fromTick: true });
  return { settings, lights, until };
}

let ticker = null;
function start(io) {
  bus.on('sensor_value', ({ io: busIo, homeId }) => { evaluateHome(busIo ?? io, homeId); });
  // Quét định kỳ: phát hiện bắt đầu/kết thúc giờ ngủ, hết thời gian ưu tiên của lệnh tay khi không có số liệu mới
  ticker = setInterval(async () => {
    try {
      const [homes] = await pool.query('SELECT Home_ID FROM Home');
      for (const h of homes) await evaluateHome(io, h.Home_ID, { fromTick: true });
    } catch (err) {
      console.error('[AUTO] Lỗi vòng quét định kỳ:', err.message);
    }
  }, TICK_MS);
  ticker.unref?.();
}

function stop() {
  if (ticker) clearInterval(ticker);
}

module.exports = {
  start, stop, getSettings, isSleeping, evaluateHome, currentAlerts, currentInsights, setAutoMode,
  disableAutoOnManual, turnOffLightsForSleep, applySleepNow, fanTarget, lightTarget,
};
