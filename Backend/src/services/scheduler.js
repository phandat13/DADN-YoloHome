// Hẹn giờ thiết bị (bảng Device_Schedule). Quét mỗi 15 giây, chạy các lịch đến hạn bằng sendDeviceCommand
// với Source_Type = 'SCHEDULE'. Lịch 1 lần tự tắt sau khi chạy; lịch lặp lại tính lần chạy kế tiếp.
//  - Độ ưu tiên: hẹn trên web = mức người dùng (3); hẹn bằng giọng nói = mức giọng nói (4).
//    Thiết bị đang được giữ bởi lệnh giọng nói thì lịch tạo trên web bị BỎ QUA (ghi SKIPPED).
//  - Server tắt lúc đến hạn: trễ ≤ 10 phút vẫn chạy, trễ hơn ghi MISSED (không bật/tắt bất ngờ khi khởi động lại).
const { pool, callProc } = require('../db');
const { sendDeviceCommand, loadDevice } = require('./deviceControl');
const priority = require('./priority');
const assistant = require('./assistant');

const TICK_MS = 15_000;
const LATE_LIMIT_MS = 10 * 60_000;
const DAY_NAMES = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

const pad = (n) => String(n).padStart(2, '0');
const toMysql = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

// Lần chạy kế tiếp (sau thời điểm `after`) của lịch lặp lại: giờ "HH:MM" + mặt nạ thứ (bit 0 = Chủ nhật)
function nextRepeat(timeOfDay, daysMask, after = new Date()) {
  const [h, m] = String(timeOfDay).split(':').map(Number);
  if (!daysMask) return null;
  for (let i = 0; i <= 7; i++) {
    const d = new Date(after);
    d.setDate(d.getDate() + i);
    d.setHours(h, m, 0, 0);
    if (d > after && (daysMask & (1 << d.getDay()))) return d;
  }
  return null;
}

const daysText = (mask) => (mask === 127 ? 'Hằng ngày'
  : mask === 62 ? 'T2–T6'
    : mask === 65 ? 'T7, CN'
      : DAY_NAMES.filter((_, i) => mask & (1 << i)).join(', '));

const actionText = (r) => ({
  TURN_ON: 'Bật', TURN_OFF: 'Tắt',
  SET_SPEED: `Tốc độ ${r.Speed ?? 0}%`, SET_COLOR: `Màu ${r.Color ?? ''}`,
}[r.Action] ?? r.Action);

const inputOf = (r) => ({ action: r.Action, speed: r.Speed ?? undefined, color: r.Color ?? undefined });

function toJson(r) {
  return {
    scheduleId: r.Schedule_ID,
    deviceId: r.Device_ID,
    deviceName: r.Device_Name ?? null,
    action: r.Action,
    speed: r.Speed,
    color: r.Color,
    actionText: actionText(r),
    repeat: r.Repeat_Type === 'REPEAT',
    time: r.Time_Of_Day ? String(r.Time_Of_Day).slice(0, 5) : null,
    daysMask: r.Days_Mask,
    daysText: r.Repeat_Type === 'REPEAT' ? daysText(r.Days_Mask) : 'Một lần',
    nextRunAt: r.Next_Run_At,
    enabled: Boolean(r.Enabled),
    createdVia: r.Created_Via,
    note: r.Note,
    lastRunAt: r.Last_Run_At,
    lastResult: r.Last_Result,
    createdBy: r.Created_By,
  };
}

async function listSchedules(homeId) {
  const [rows] = await pool.query(
    `SELECT s.*, d.Device_Name FROM Device_Schedule s JOIN Device d ON d.Device_ID = s.Device_ID
     WHERE s.Home_ID = ? ORDER BY s.Enabled DESC, s.Next_Run_At IS NULL, s.Next_Run_At, s.Schedule_ID`,
    [homeId]
  );
  return rows.map(toJson);
}

async function emitSchedules(io, homeId) {
  try {
    io?.to(`home_${homeId}`).emit('schedules_updated', { homeId: Number(homeId), schedules: await listSchedules(homeId) });
  } catch (err) {
    console.error('[SCHEDULE] Không đọc được danh sách lịch:', err.message);
  }
}

/**
 * Tạo lịch. spec: { deviceId, action, speed?, color?, repeat, runAt? (Date), time? 'HH:MM', daysMask?, note?, via? 'WEB'|'VOICE' }
 */
async function createSchedule(io, homeId, userId, spec) {
  const repeat = Boolean(spec.repeat);
  const daysMask = repeat ? (spec.daysMask ?? 127) : 127;
  const next = repeat ? nextRepeat(spec.time, daysMask) : spec.runAt;
  const [r] = await pool.query(
    `INSERT INTO Device_Schedule (Home_ID, Device_ID, \`Action\`, Speed, Color, Repeat_Type, Time_Of_Day, Days_Mask,
       Next_Run_At, Enabled, Created_Via, Note, Created_By)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [homeId, spec.deviceId, spec.action, spec.speed ?? null, spec.color ?? null, repeat ? 'REPEAT' : 'ONCE',
      repeat ? `${spec.time}:00` : null, daysMask, next ? toMysql(next) : null, spec.via === 'VOICE' ? 'VOICE' : 'WEB',
      spec.note ?? null, userId]
  );
  await emitSchedules(io, homeId);
  const [rows] = await pool.query(
    'SELECT s.*, d.Device_Name FROM Device_Schedule s JOIN Device d ON d.Device_ID = s.Device_ID WHERE s.Schedule_ID = ?',
    [r.insertId]
  );
  return toJson(rows[0]);
}

async function setEnabled(io, homeId, scheduleId, enabled) {
  const [rows] = await pool.query('SELECT * FROM Device_Schedule WHERE Schedule_ID = ? AND Home_ID = ?', [scheduleId, homeId]);
  const s = rows[0];
  if (!s) return null;
  let next = s.Next_Run_At;
  if (enabled) {
    if (s.Repeat_Type === 'REPEAT') next = nextRepeat(String(s.Time_Of_Day).slice(0, 5), s.Days_Mask);
    else if (!next || new Date(next) <= new Date()) return { error: 'Lịch một lần đã qua giờ chạy, hãy tạo lịch mới' };
  }
  await pool.query('UPDATE Device_Schedule SET Enabled = ?, Next_Run_At = ? WHERE Schedule_ID = ?',
    [enabled ? 1 : 0, next ? toMysql(new Date(next)) : null, scheduleId]);
  await emitSchedules(io, homeId);
  return { ok: true };
}

async function removeSchedule(io, homeId, scheduleId) {
  const [r] = await pool.query('DELETE FROM Device_Schedule WHERE Schedule_ID = ? AND Home_ID = ?', [scheduleId, homeId]);
  if (r.affectedRows) await emitSchedules(io, homeId);
  return r.affectedRows > 0;
}

async function finish(s, result, now) {
  const next = s.Repeat_Type === 'REPEAT' ? nextRepeat(String(s.Time_Of_Day).slice(0, 5), s.Days_Mask, now) : null;
  await pool.query(
    'UPDATE Device_Schedule SET Last_Run_At = ?, Last_Result = ?, Next_Run_At = ?, Enabled = ? WHERE Schedule_ID = ?',
    [toMysql(now), result, next ? toMysql(next) : null, next ? 1 : 0, s.Schedule_ID]
  );
}

async function runOne(io, s) {
  const now = new Date();
  const homeId = s.Home_ID;
  const late = now - new Date(s.Next_Run_At);
  const device = await loadDevice(homeId, s.Device_ID);

  if (!device) return finish(s, 'FAILED', now);
  if (late > LATE_LIMIT_MS) {
    console.warn(`[SCHEDULE] Lịch #${s.Schedule_ID} trễ ${Math.round(late / 60000)} phút (server tắt?) -> bỏ qua`);
    return finish(s, 'MISSED', now);
  }

  let result;
  try {
    const r = await sendDeviceCommand({
      io, homeId, device, input: inputOf(s), userId: s.Created_By, sourceType: 'SCHEDULE',
      level: s.Created_Via === 'VOICE' ? priority.PRIORITY.VOICE_COMMAND : priority.PRIORITY.SCHEDULE,
    });
    if (r.skipped) {
      result = 'SKIPPED';
      const msg = `Hẹn giờ "${actionText(s)} ${device.Device_Name}" bị bỏ qua vì ${priority.LABEL[r.blockedBy.source].toLowerCase()} đang được ưu tiên`;
      await callProc('sp_notify_home_owner', [homeId, 'Hẹn giờ bị bỏ qua', 'schedule', msg, 'info']).catch(() => {});
    } else {
      result = r.ok ? 'SUCCESS' : 'FAILED';
      if (r.ok) assistant.say(io, homeId, `Hen gio: ${actionText(s)} ${device.Device_Name}`).catch(() => {});
      else await callProc('sp_notify_home_owner', [homeId, 'Hẹn giờ thất bại', 'schedule',
        `Không gửi được lệnh "${actionText(s)}" tới ${device.Device_Name}`, 'warning']).catch(() => {});
    }
  } catch (err) {
    result = 'FAILED';
    console.error(`[SCHEDULE] Lịch #${s.Schedule_ID} lỗi:`, err.message);
  }
  await finish(s, result, now);
  return result;
}

let running = false;
async function tick(io) {
  if (running) return;
  running = true;
  try {
    const [due] = await pool.query(
      'SELECT * FROM Device_Schedule WHERE Enabled = 1 AND Next_Run_At IS NOT NULL AND Next_Run_At <= NOW() ORDER BY Next_Run_At LIMIT 50'
    );
    const homes = new Set();
    for (const s of due) {
      await runOne(io, s);
      homes.add(s.Home_ID);
    }
    for (const h of homes) await emitSchedules(io, h);
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') {
      console.error('[SCHEDULE] Chưa có bảng Device_Schedule: chạy Database/migrations/2026-11-05_sleep_schedule.sql');
      clearInterval(timer);
    } else {
      console.error('[SCHEDULE] Lỗi quét lịch:', err.message);
    }
  } finally {
    running = false;
  }
}

let timer = null;
function start(io) {
  timer = setInterval(() => tick(io), TICK_MS);
  timer.unref?.();
  tick(io);
}

module.exports = { start, tick, nextRepeat, listSchedules, createSchedule, setEnabled, removeSchedule, emitSchedules, daysText, toMysql };
