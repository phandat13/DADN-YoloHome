// Đọc / ghi bảng Home_Setting (ngưỡng, chế độ tự động, chế độ ngủ, thời gian ưu tiên lệnh của người).
const { pool } = require('../db');

const hhmm = (t) => String(t ?? '').slice(0, 5);                 // '22:30:00' -> '22:30'
const minutesOf = (t) => {
  const [h, m] = hhmm(t).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

async function getSettings(homeId) {
  await pool.query('INSERT IGNORE INTO Home_Setting (Home_ID) VALUES (?)', [homeId]);
  const [rows] = await pool.query('SELECT * FROM Home_Setting WHERE Home_ID = ?', [homeId]);
  const r = rows[0];
  const s = {
    tempMax: Number(r.Temp_Max),
    humidityMin: Number(r.Humidity_Min),
    humidityMax: Number(r.Humidity_Max),
    lightMin: Number(r.Light_Min),
    autoMode: Boolean(r.Auto_Mode),
    // DB cũ chưa chạy migrations/2026-11-05_sleep_schedule.sql -> dùng giá trị mặc định
    sleepEnabled: r.Sleep_Enabled === undefined ? true : Boolean(r.Sleep_Enabled),
    sleepStart: hhmm(r.Sleep_Start ?? '22:30'),
    sleepEnd: hhmm(r.Sleep_End ?? '06:00'),
    sleepManual: r.Sleep_Manual ?? 'NONE',
    sleepManualUntil: r.Sleep_Manual_Until ?? null,
    overrideMinutes: r.Override_Minutes == null ? 30 : Number(r.Override_Minutes),
    updatedAt: r.Updated_At,
  };
  s.sleeping = isSleeping(s);
  return s;
}

// Giờ hiện tại có nằm trong khung ngủ [start, end) không (khung có thể vắt qua nửa đêm: 22:30 -> 06:00)
function inWindow(start, end, now = new Date()) {
  const cur = now.getHours() * 60 + now.getMinutes();
  const a = minutesOf(start);
  const b = minutesOf(end);
  if (a === b) return false;
  return a < b ? cur >= a && cur < b : cur >= a || cur < b;
}

// Ưu tiên: lệnh "đi ngủ"/"thức dậy" còn hiệu lực > khung giờ ngủ
function isSleeping(s, now = new Date()) {
  const until = s.sleepManualUntil ? new Date(s.sleepManualUntil) : null;
  if (s.sleepManual !== 'NONE' && until && until > now) return s.sleepManual === 'SLEEP';
  return Boolean(s.sleepEnabled) && inWindow(s.sleepStart, s.sleepEnd, now);
}

// Thời điểm kết thúc giấc ngủ gần nhất (để lệnh "đi ngủ" có hiệu lực tới sáng)
function nextSleepEnd(s, now = new Date()) {
  const d = new Date(now);
  const m = minutesOf(s.sleepEnd);
  d.setHours(Math.floor(m / 60), m % 60, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d;
}

// Thời điểm bắt đầu khung ngủ kế tiếp (để lệnh "thức dậy" có hiệu lực tới tối)
function nextSleepStart(s, now = new Date()) {
  const d = new Date(now);
  const m = minutesOf(s.sleepStart);
  d.setHours(Math.floor(m / 60), m % 60, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d;
}

module.exports = { getSettings, isSleeping, inWindow, nextSleepEnd, nextSleepStart, hhmm };
