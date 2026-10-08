// Tự động khoá cửa sau khi mở (PIN, FaceAI, mở từ xa) và LUÔN báo lên feed Adafruit IO 'smart-door'.
// Thời gian chờ: DOOR_AUTO_LOCK_SECONDS trong .env (mặc định 10 giây, 0 = tắt tự khoá).
const config = require('../config');
const { pool } = require('../db');
const { publishCommand } = require('./mqttService');

const DOOR_FEED = 'smart-door';
const RETRY_MS = 5000;     // MQTT mất kết nối lúc cần khoá -> thử lại mỗi 5 giây
const MAX_RETRIES = 24;    // tối đa ~2 phút

const timers = new Map();  // doorName -> { timer, lockAt }

const iso = (ts) => (ts ? new Date(ts).toISOString() : null);
const emitDoor = (io, homeId, payload) => io?.to(`home_${homeId}`).emit('door_state_updated', { homeId, ...payload });

function cancelAutoLock(doorName) {
  const t = timers.get(doorName);
  if (t) {
    clearTimeout(t.timer);
    timers.delete(doorName);
  }
}

const getAutoLockAt = (doorName) => timers.get(doorName)?.lockAt ?? null;

function scheduleAutoLock(io, homeId, doorName, delayMs = config.doorAutoLockSeconds * 1000, attempt = 0) {
  cancelAutoLock(doorName);
  if (!config.doorAutoLockSeconds) return null;
  const lockAt = Date.now() + delayMs;
  const timer = setTimeout(() => {
    timers.delete(doorName);
    autoLock(io, homeId, doorName, attempt).catch((err) => console.error(`[AUTO-LOCK] Lỗi khi khoá "${doorName}":`, err));
  }, delayMs);
  timers.set(doorName, { timer, lockAt });
  return lockAt;
}

async function autoLock(io, homeId, doorName, attempt) {
  const [rows] = await pool.query(
    'SELECT Lock_Unlock_State FROM Smart_Door WHERE Smart_Door_Name = ? AND Home_ID = ? LIMIT 1',
    [doorName, homeId]
  );
  // Cửa đã bị xoá hoặc đã được khoá tay trước đó -> không làm gì
  if (!rows.length || String(rows[0].Lock_Unlock_State).toLowerCase() !== 'unlocked') return;

  // Gửi lệnh khoá lên Adafruit TRƯỚC; chỉ ghi "Locked" vào DB khi đã gửi được
  const published = publishCommand(DOOR_FEED, {
    action: 'LOCK_DOOR',
    doorName,
    source: 'auto',
    reason: `Tự khoá sau ${config.doorAutoLockSeconds} giây`,
  });
  if (!published) {
    if (attempt < MAX_RETRIES) {
      console.warn(`[AUTO-LOCK] MQTT chưa kết nối, thử khoá "${doorName}" lại sau ${RETRY_MS / 1000}s (lần ${attempt + 1})`);
      scheduleAutoLock(io, homeId, doorName, RETRY_MS, attempt + 1);
    } else {
      console.error(`[AUTO-LOCK] Không gửi được lệnh khoá "${doorName}" lên Adafruit IO sau ${MAX_RETRIES} lần thử`);
    }
    return;
  }

  await pool.query("UPDATE Smart_Door SET Lock_Unlock_State = 'Locked' WHERE Smart_Door_Name = ? AND Home_ID = ?", [doorName, homeId]);
  // Activity_Log cần User_ID: ghi dưới tên chủ nhà, nguồn 'auto'
  await pool.query(
    `INSERT INTO Activity_Log (Entity_Type, \`Action\`, \`Source\`, \`Result\`, User_ID, Home_ID)
     SELECT 'smart_door', 'auto_lock', 'auto', 'success', Owner_ID, Home_ID FROM Home WHERE Home_ID = ?`,
    [homeId]
  );
  emitDoor(io, homeId, { doorName, state: 'locked', source: 'auto' });
  console.log(`[AUTO-LOCK] Đã tự khoá "${doorName}" và gửi LOCK_DOOR lên feed ${DOOR_FEED}`);
}

/**
 * Gọi sau khi mở cửa thành công (DB đã ghi Unlocked): gửi UNLOCK_DOOR lên feed, hẹn giờ tự khoá,
 * báo cho các tab đang mở. Trả về thông tin để API phản hồi cho Frontend.
 */
function doorUnlocked({ io, homeId, doorName, source, userId = null }) {
  const autoLockSeconds = config.doorAutoLockSeconds;
  const published = publishCommand(DOOR_FEED, { action: 'UNLOCK_DOOR', doorName, source, userId, autoLockSeconds });
  const lockAt = scheduleAutoLock(io, homeId, doorName);
  emitDoor(io, homeId, { doorName, state: 'unlocked', source, autoLockSeconds, autoLockAt: iso(lockAt) });
  return { mqttPublished: published, autoLockSeconds, autoLockAt: iso(lockAt) };
}

// Khoá tay (từ xa): huỷ hẹn giờ tự khoá, gửi LOCK_DOOR lên feed
function doorLocked({ io, homeId, doorName, source }) {
  cancelAutoLock(doorName);
  const published = publishCommand(DOOR_FEED, { action: 'LOCK_DOOR', doorName, source });
  emitDoor(io, homeId, { doorName, state: 'locked', source });
  return { mqttPublished: published };
}

// Khởi động lại server khi còn cửa đang mở -> hẹn giờ khoá lại các cửa đó
async function resumeAutoLocks(io) {
  if (!config.doorAutoLockSeconds) return;
  const [rows] = await pool.query("SELECT Smart_Door_Name, Home_ID FROM Smart_Door WHERE LOWER(Lock_Unlock_State) = 'unlocked'");
  for (const r of rows) scheduleAutoLock(io, r.Home_ID, r.Smart_Door_Name);
  if (rows.length) console.log(`[AUTO-LOCK] ${rows.length} cửa đang mở sẽ tự khoá sau ${config.doorAutoLockSeconds}s`);
}

module.exports = { DOOR_FEED, doorUnlocked, doorLocked, cancelAutoLock, getAutoLockAt, resumeAutoLocks };
