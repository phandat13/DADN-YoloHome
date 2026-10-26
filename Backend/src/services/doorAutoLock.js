// Tự động khoá cửa sau khi mở (PIN, FaceAI, mở từ xa) và báo lên feed Adafruit IO 'smart-door'
// ("1" = mở khoá, "0" = khoá; chỉ với nhà gắn phần cứng - xem services/hardwareHome.js).
// Thời gian chờ: DOOR_AUTO_LOCK_SECONDS trong .env (mặc định 10 giây, 0 = tắt tự khoá).
const config = require('../config');
const { pool } = require('../db');
const { publishCommand } = require('./mqttService');
const { isHardwareHome, getHardwareHomeId } = require('./hardwareHome');
const bus = require('./bus');

const DOOR_FEED = 'smart-door';
const RETRY_MS = 5000;     // MQTT mất kết nối lúc cần khoá -> thử lại mỗi 5 giây
const MAX_RETRIES = 24;    // tối đa ~2 phút

const timers = new Map();  // Smart_Door_ID -> { timer, lockAt }

const iso = (ts) => (ts ? new Date(ts).toISOString() : null);
const emitDoor = (io, homeId, payload) => io?.to(`home_${homeId}`).emit('door_state_updated', { homeId, ...payload });

// Gửi trạng thái cửa xuống phần cứng. Nhà mô phỏng (không gắn phần cứng) coi như đã gửi.
async function sendDoor(homeId, unlocked) {
  if (!(await isHardwareHome(homeId))) return { published: false, simulated: true, ok: true };
  const published = await publishCommand(DOOR_FEED, unlocked ? '1' : '0');
  return { published, simulated: false, ok: published };
}

function cancelAutoLock(doorId) {
  const t = timers.get(doorId);
  if (t) {
    clearTimeout(t.timer);
    timers.delete(doorId);
  }
}

const getAutoLockAt = (doorId) => timers.get(doorId)?.lockAt ?? null;

function scheduleAutoLock(io, homeId, door, delayMs = config.doorAutoLockSeconds * 1000, attempt = 0) {
  cancelAutoLock(door.id);
  if (!config.doorAutoLockSeconds) return null;
  const lockAt = Date.now() + delayMs;
  const timer = setTimeout(() => {
    timers.delete(door.id);
    autoLock(io, homeId, door, attempt).catch((err) => console.error(`[AUTO-LOCK] Lỗi khi khoá "${door.name}":`, err));
  }, delayMs);
  timers.set(door.id, { timer, lockAt });
  return lockAt;
}

async function autoLock(io, homeId, door, attempt) {
  const [rows] = await pool.query('SELECT Lock_Unlock_State FROM Smart_Door WHERE Smart_Door_ID = ? LIMIT 1', [door.id]);
  // Cửa đã bị xoá hoặc đã được khoá tay trước đó -> không làm gì
  if (!rows.length || String(rows[0].Lock_Unlock_State).toLowerCase() !== 'unlocked') return;

  // Gửi lệnh khoá TRƯỚC; chỉ ghi "Locked" vào DB khi đã gửi được
  const sent = await sendDoor(homeId, false);
  if (!sent.ok) {
    if (attempt < MAX_RETRIES) {
      console.warn(`[AUTO-LOCK] MQTT chưa kết nối, thử khoá "${door.name}" lại sau ${RETRY_MS / 1000}s (lần ${attempt + 1})`);
      scheduleAutoLock(io, homeId, door, RETRY_MS, attempt + 1);
    } else {
      console.error(`[AUTO-LOCK] Không gửi được lệnh khoá "${door.name}" sau ${MAX_RETRIES} lần thử`);
    }
    return;
  }

  await pool.query("UPDATE Smart_Door SET Lock_Unlock_State = 'Locked' WHERE Smart_Door_ID = ?", [door.id]);
  // Activity_Log cần User_ID: ghi dưới tên chủ nhà, nguồn 'auto'
  await pool.query(
    `INSERT INTO Activity_Log (Entity_Type, \`Action\`, \`Source\`, \`Result\`, User_ID, Home_ID)
     SELECT 'smart_door', 'auto_lock', 'auto', 'success', Owner_ID, Home_ID FROM Home WHERE Home_ID = ?`,
    [homeId]
  );
  emitDoor(io, homeId, { doorId: door.id, doorName: door.name, state: 'locked', source: 'auto' });
}

/**
 * Gọi sau khi mở cửa thành công (DB đã ghi Unlocked): gửi "1" lên feed, hẹn giờ tự khoá,
 * báo cho các tab đang mở. Trả về thông tin để API phản hồi cho Frontend.
 * door: { id, name }
 */
async function doorUnlocked({ io, homeId, door, source }) {
  const sent = await sendDoor(homeId, true);
  const lockAt = scheduleAutoLock(io, homeId, door);
  const autoLockSeconds = config.doorAutoLockSeconds;
  emitDoor(io, homeId, { doorId: door.id, doorName: door.name, state: 'unlocked', source, autoLockSeconds, autoLockAt: iso(lockAt) });
  return { mqttPublished: sent.published, simulated: sent.simulated, autoLockSeconds, autoLockAt: iso(lockAt) };
}

// Khoá tay (từ xa): huỷ hẹn giờ tự khoá, gửi "0" lên feed
async function doorLocked({ io, homeId, door, source }) {
  cancelAutoLock(door.id);
  const sent = await sendDoor(homeId, false);
  emitDoor(io, homeId, { doorId: door.id, doorName: door.name, state: 'locked', source });
  return { mqttPublished: sent.published, simulated: sent.simulated };
}

// Khởi động lại server khi còn cửa đang mở -> hẹn giờ khoá lại các cửa đó
async function resumeAutoLocks(io) {
  if (!config.doorAutoLockSeconds) return;
  const [rows] = await pool.query("SELECT Smart_Door_ID, Smart_Door_Name, Home_ID FROM Smart_Door WHERE LOWER(Lock_Unlock_State) = 'unlocked'");
  for (const r of rows) scheduleAutoLock(io, r.Home_ID, { id: r.Smart_Door_ID, name: r.Smart_Door_Name });
  if (rows.length) console.log(`[AUTO-LOCK] ${rows.length} cửa đang mở sẽ tự khoá sau ${config.doorAutoLockSeconds}s`);
}

// Phần cứng báo trạng thái cửa thật trên feed 'door-status' ("1" mở / "0" khoá) -> đồng bộ cửa đầu tiên của nhà
bus.on('door_feed', async ({ io, data }) => {
  try {
    const homeId = await getHardwareHomeId();
    if (homeId == null) return;
    const raw = String(data.raw ?? data.state ?? data.value ?? '').trim().toLowerCase();
    let unlocked;
    if (/^(1|open|opened|unlocked|on)$/.test(raw)) unlocked = true;
    else if (/^(0|close|closed|locked|off)$/.test(raw)) unlocked = false;
    else return;
    const [rows] = await pool.query(
      'SELECT Smart_Door_ID, Smart_Door_Name, Lock_Unlock_State FROM Smart_Door WHERE Home_ID = ? ORDER BY Smart_Door_ID LIMIT 1',
      [homeId]
    );
    const d = rows[0];
    if (!d) return;
    const door = { id: d.Smart_Door_ID, name: d.Smart_Door_Name };
    if ((String(d.Lock_Unlock_State).toLowerCase() === 'unlocked') === unlocked) return;
    await pool.query('UPDATE Smart_Door SET Lock_Unlock_State = ? WHERE Smart_Door_ID = ?', [unlocked ? 'Unlocked' : 'Locked', door.id]);
    if (unlocked) scheduleAutoLock(io, homeId, door); else cancelAutoLock(door.id);
    emitDoor(io, homeId, { doorId: door.id, doorName: door.name, state: unlocked ? 'unlocked' : 'locked', source: 'hardware', autoLockAt: iso(getAutoLockAt(door.id)) });
  } catch (err) {
    console.error('[MQTT] Không đồng bộ được trạng thái cửa:', err.message);
  }
});

module.exports = { DOOR_FEED, doorUnlocked, doorLocked, cancelAutoLock, getAutoLockAt, resumeAutoLocks };
