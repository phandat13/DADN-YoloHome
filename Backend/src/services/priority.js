// Độ ưu tiên giữa các nguồn điều khiển một thiết bị.
//
//   GIỌNG NÓI (4)  >  NGƯỜI DÙNG trên web / HẸN GIỜ / CHẾ ĐỘ NGỦ (3)  >  TỰ ĐỘNG theo cảm biến (1)
//
// Mỗi lệnh của người (giọng nói, web, hẹn giờ) "giữ" thiết bị trong Override_Minutes phút (mặc định 30).
// Trong thời gian đó, nguồn có độ ưu tiên THẤP HƠN không được đổi trạng thái thiết bị:
//   - "Tắt đèn" bằng giọng nói lúc 23h -> tự động hoá không bật lại đèn dù trời tối / có chuyển động,
//     hẹn giờ tạo trên web cũng không bật lại.
//   - Lệnh của người luôn được thực hiện (người dùng bấm trên web vẫn tắt được đèn vừa bật bằng giọng nói).
// Trạng thái giữ nằm trong bộ nhớ (khởi động lại server thì hết giữ, tự động hoá chạy lại bình thường).
const PRIORITY = { SYSTEM: 1, SCHEDULE: 3, SLEEP: 3, USER: 3, VOICE_COMMAND: 4 };
const LABEL = { SYSTEM: 'Tự động', SCHEDULE: 'Hẹn giờ', SLEEP: 'Chế độ ngủ', USER: 'Người dùng', VOICE_COMMAND: 'Giọng nói' };
const HUMAN = new Set(['USER', 'VOICE_COMMAND']);

const holds = new Map();   // deviceId -> { homeId, deviceId, source, priority, until }

const priorityOf = (source) => PRIORITY[source] ?? PRIORITY.SYSTEM;

function active(deviceId, now = Date.now()) {
  const h = holds.get(Number(deviceId));
  if (!h) return null;
  if (h.until <= now) { holds.delete(Number(deviceId)); return null; }
  return h;
}

/**
 * Nguồn `source` (với độ ưu tiên `priority`, mặc định theo bảng) có được điều khiển thiết bị không.
 * Người dùng (USER / VOICE_COMMAND) luôn được phép. Nguồn khác bị chặn khi đang có giữ ưu tiên cao hơn.
 * Trả về { allowed, blockedBy }.
 */
function check(deviceId, source, priority = priorityOf(source)) {
  if (HUMAN.has(source)) return { allowed: true, blockedBy: null };
  const h = active(deviceId);
  if (h && h.priority > priority) return { allowed: false, blockedBy: h };
  // Tự động hoá không chen vào khi người vừa điều khiển (kể cả cùng mức hẹn giờ)
  if (h && source === 'SYSTEM') return { allowed: false, blockedBy: h };
  return { allowed: true, blockedBy: null };
}

function claim({ homeId, deviceId, source, minutes, priority = priorityOf(source) }) {
  if (!minutes || minutes <= 0 || source === 'SYSTEM') return null;
  const h = { homeId: Number(homeId), deviceId: Number(deviceId), source, priority, until: Date.now() + minutes * 60_000 };
  holds.set(Number(deviceId), h);
  return h;
}

function release(deviceId) {
  return holds.delete(Number(deviceId));
}

const toJson = (h) => ({
  deviceId: h.deviceId,
  source: h.source,
  label: LABEL[h.source] ?? h.source,
  priority: h.priority,
  until: new Date(h.until).toISOString(),
});

function list(homeId) {
  const now = Date.now();
  const out = [];
  for (const h of [...holds.values()]) {
    if (h.homeId !== Number(homeId)) continue;
    if (h.until <= now) { holds.delete(h.deviceId); continue; }
    out.push(toJson(h));
  }
  return out;
}

const emit = (io, homeId) => io?.to(`home_${homeId}`).emit('overrides_updated', { homeId: Number(homeId), overrides: list(homeId) });

module.exports = { PRIORITY, LABEL, priorityOf, check, claim, release, list, emit, active };
