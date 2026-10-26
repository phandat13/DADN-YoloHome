// Chuẩn hoá dữ liệu Backend về một dạng thống nhất cho giao diện.
import { pick, label, toTs, clamp, normText, asList } from './utils/fields.js';

// ---- Phân loại ----
export function sensorKind(dataType = '', unit = '') {
  const s = normText(`${dataType} ${unit}`);
  if (/temp|nhiet|°c|celsius/.test(s)) return 'temperature';
  if (/hum|do am|\bam\b|%/.test(s)) return 'humidity';
  if (/light|lux|anh sang|ldr|illum/.test(s)) return 'light';
  if (/motion|pir|chuyen dong/.test(s)) return 'motion';
  return null;
}

const KIND_RE = {
  buzzer: /buzzer|\bcoi\b/,
  sensor: /sensor|dht|ldr|pir|cam bien/,
  door: /door|servo|lock|\bcua\b/,
  light: /light|lamp|led|\bden\b/,
  fan: /fan|\bquat\b/,
};
// typeCode được ưu tiên (LIGHT_SENSOR → cảm biến); nếu không rõ mới xét tên (Quạt cửa sổ → quạt).
export function deviceKind(typeCode = '', name = '') {
  const t = normText(typeCode);
  for (const k of ['buzzer', 'sensor', 'door', 'light', 'fan']) if (t && KIND_RE[k].test(t)) return k;
  const n = normText(name);
  for (const k of ['buzzer', 'light', 'fan', 'sensor', 'door']) if (n && KIND_RE[k].test(n)) return k;
  return 'other';
}

// Trạng thái hoạt động từ BE → { on, speed } (null nếu không suy ra chắc chắn được).
export function parseWorking(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return { on: v, speed: v ? 100 : 0 };
  if (typeof v === 'number') return { on: v > 0, speed: clamp(v, 0, 100) };
  if (typeof v === 'object') {
    const st = parseWorking(pick(v, 'state', 'status', 'power'));
    const sp = Number(pick(v, 'speed', 'level'));
    if (Number.isFinite(sp)) return { on: sp > 0, speed: clamp(sp, 0, 100) };
    return st;
  }
  const s = String(v).trim();
  if (s.startsWith('{')) { try { return parseWorking(JSON.parse(s)); } catch { return null; } }
  if (/[,;/|]/.test(s)) return null;                         // giống danh sách trạng thái → bỏ qua
  if (/^-?\d+(\.\d+)?$/.test(s)) { const n = Number(s); return { on: n > 0, speed: clamp(n, 0, 100) }; }
  if (/^(on|true|bat|bật|open|opened|unlocked|running|active|1)$/i.test(s)) return { on: true, speed: 100 };
  if (/^(off|false|tat|tắt|closed|locked|idle|stopped|inactive|0)$/i.test(s)) return { on: false, speed: 0 };
  return null;
}

export function parseOnline(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (/off|disconn|lost|inactive|error|fail|down/.test(s)) return false;
  if (/on|connect|active|ok|alive|up/.test(s)) return true;
  return null;
}

export function parseMotion(v) {
  if (typeof v === 'boolean') return v;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 0;
  return /true|yes|detect|on|co/.test(normText(v));
}

// ---- Thực thể ----
export const normUser = (u) => ({
  id: pick(u, 'userId', 'id'),
  name: label(pick(u, 'displayName', 'name', 'userName', 'fullName')) || label(pick(u, 'email')) || 'Người dùng',
  email: label(pick(u, 'email')),
  raw: u,
});

export const normHome = (h) => ({
  id: pick(h, 'homeId', 'id'),
  name: label(pick(h, 'homeName', 'name')) || 'Nhà chưa đặt tên',
  address: label(pick(h, 'address')),
  state: label(pick(h, 'state', 'status', 'homeState')),
  role: label(pick(h, 'roleName', 'role', 'memberRole')),
  raw: h,
});

export function normDevice(d) {
  const id = pick(d, 'deviceId', 'id');
  const typeCode = label(pick(d, 'typeCode', 'deviceType', 'type', 'typeName')).toUpperCase();
  const name = label(pick(d, 'deviceName', 'name')) || `Thiết bị #${id}`;
  const kind = deviceKind(typeCode, name);
  const workingRaw = pick(d, 'availableWorkingState', 'workingState', 'currentState', 'state');
  const connRaw = pick(d, 'connectionState', 'connectionStatus', 'connection');
  // Backend là nguồn trạng thái duy nhất (đã đồng bộ cả thay đổi từ dashboard Adafruit / phần cứng)
  const st = parseWorking(workingRaw) ?? { on: false, speed: 0 };
  const speed = kind === 'fan' ? clamp(Number(st.speed ?? (st.on ? 100 : 0)) || 0, 0, 100) : (st.on ? 100 : 0);
  return {
    id, name, typeCode, kind,
    on: kind === 'fan' ? speed > 0 : !!st.on,
    speed,
    online: parseOnline(connRaw),
    connection: label(connRaw),
    working: label(workingRaw),
    color: label(pick(d, 'color')).toUpperCase() || null,   // đèn RGB: #RRGGBB
    controllerId: label(pick(d, 'controllerId', 'controller')),
    raw: d,
  };
}

export function normSensor(s) {
  const dataType = label(pick(s, 'dataType', 'sensorType', 'type'));
  const unit = label(pick(s, 'unit'));
  return {
    id: pick(s, 'sensorId', 'id'),
    deviceId: pick(s, 'deviceId'),
    dataType, unit,
    kind: sensorKind(dataType, unit) ?? sensorKind(label(pick(s, 'feed', 'feedKey', 'sensorName', 'name'))),
    raw: s,
  };
}

export const normRecord = (r) => ({
  ts: toTs(pick(r, 'recordedAt', 'recordTime', 'timestamp', 'createdAt', 'measuredAt', 'time', 'date')),
  value: pick(r, 'value', 'recordValue', 'dataValue', 'reading'),
  quality: label(pick(r, 'dataQuality', 'quality')),
});

export const normCredential = (c) => ({
  id: pick(c, 'credentialId', 'id'),
  type: label(pick(c, 'credentialType', 'type', 'method')) || 'PIN',
  status: label(pick(c, 'status', 'state', 'credentialState')),
  ts: toTs(pick(c, 'createdAt', 'issuedAt', 'created', 'validFrom')),
  expired: pick(c, 'expired', 'expiresAt', 'expiredAt', 'validTo'),
  owner: label(pick(c, 'displayName', 'userName')),
});

export const normDoor = (d) => ({
  id: pick(d, 'doorId', 'id'),
  name: label(pick(d, 'doorName', 'name')),
  state: label(pick(d, 'state', 'status', 'lockState', 'doorState')),
  autoLockAt: toTs(pick(d, 'autoLockAt')),           // thời điểm Backend sẽ tự khoá (khi cửa đang mở)
  autoLockSeconds: Number(pick(d, 'autoLockSeconds')) || 0,
  credentials: asList(pick(d, 'credentials', 'pins', 'accessCredentials') ?? []).map(normCredential),
  raw: d,
});

export function normMember(m) {
  const u = pick(m, 'user');
  const src = u && typeof u === 'object' ? { ...u, ...m } : m;
  return {
    userId: pick(src, 'userId', 'id'),
    name: label(pick(src, 'displayName', 'name', 'userName', 'fullName')),
    email: label(pick(src, 'email')),
    role: label(pick(src, 'roleName', 'role')),
    expired: pick(src, 'expired', 'expiredAt', 'expiresAt', 'expiry'),
    state: label(pick(src, 'memberState', 'state', 'status')),
    raw: m,
  };
}

const detailText = (v) => (v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function normLog(l) {
  const user = pick(l, 'user', 'actor');
  const uid = pick(l, 'userId', 'actorId');
  return {
    ts: toTs(pick(l, 'createdAt', 'timestamp', 'logTime', 'actionTime', 'time', 'date')),
    actor: label(pick(l, 'userName', 'displayName', 'actorName', 'email'))
      || (user && typeof user === 'object' ? label(user) : label(user))
      || (uid != null ? `Người dùng #${uid}` : 'Hệ thống'),
    action: label(pick(l, 'action', 'actionType', 'activityType', 'event', 'type')),
    target: label(pick(l, 'targetName', 'deviceName', 'doorName', 'targetType', 'entity', 'entityType')),
    detail: detailText(pick(l, 'detail', 'details', 'description', 'message', 'content', 'metadata'))
      || [label(pick(l, 'source')), label(pick(l, 'result'))].filter(Boolean).join(' · '),
    raw: l,
  };
}

export function normAttempt(a) {
  const result = pick(a, 'accessResult', 'result', 'status', 'success', 'isSuccess', 'granted');
  const r = normText(label(result));
  return {
    ts: toTs(pick(a, 'attemptTime', 'attemptedAt', 'createdAt', 'timestamp', 'time')),
    ok: result === true || /success|ok|granted|thanh cong|true|unlock|allow/.test(r) ? true
      : result === false || /fail|denied|lock|sai|false|reject|block/.test(r) ? false : null,
    result: label(result),
    method: label(pick(a, 'verifyMethod', 'method', 'accessMethod', 'credentialType', 'type')),
    actor: label(pick(a, 'userName', 'displayName', 'userId')),
    detail: detailText(pick(a, 'failureReason', 'detail', 'reason', 'message', 'note')),
    raw: a,
  };
}

export function normNotification(n) {
  const status = label(pick(n, 'unreadRead', 'status', 'state'));   // BE: Unread_Read = 'Unread' | 'Read'
  return {
    id: pick(n, 'notificationId', 'id'),
    title: label(pick(n, 'title', 'subject', 'notificationType', 'type')) || 'Thông báo',
    content: detailText(pick(n, 'content', 'message', 'body', 'detail')),
    status,
    read: status ? /^(read|da doc|seen)$/i.test(normText(status)) : !!pick(n, 'isRead', 'read'),
    ts: toTs(pick(n, 'createdAt', 'timestamp', 'sentAt', 'time')),
    raw: n,
  };
}

export const normFaceProfile = (f) => {
  const data = pick(f, 'faceData', 'vector', 'faceVector');
  let dims = Number(pick(f, 'faceDims')) || null;
  if (Array.isArray(data)) dims = data.length;
  else if (typeof data === 'string' && data.startsWith('[')) { try { dims = JSON.parse(data).length; } catch {} }
  return {
    id: pick(f, 'faceProfileId', 'profileId', 'faceId', 'id'),
    userId: pick(f, 'userId'),
    name: label(pick(f, 'displayName', 'userName', 'name')),
    dims,
    expired: pick(f, 'expired', 'expiresAt', 'expiredAt', 'validTo'),
    ts: toTs(pick(f, 'createdAt', 'registeredAt')),
    raw: f,
  };
};
