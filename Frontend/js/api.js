// Lớp gọi HTTP API theo "TÀI LIỆU TÍCH HỢP FRONTEND - HỆ THỐNG API YOLOHOME".
// Mọi API có 🔒 tự động gắn header Authorization: Bearer <token>.
import { CONFIG } from './config.js';

const TOKEN_KEY = 'yolohome.token';
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t) => {
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch {}
};

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

const STATUS_TEXT = {
  400: 'Dữ liệu gửi lên không hợp lệ',
  401: 'Chưa đăng nhập hoặc phiên đã hết hạn',
  403: 'Bạn không có quyền thực hiện thao tác này',
  404: 'Không tìm thấy dữ liệu',
  409: 'Dữ liệu đã tồn tại',
  422: 'Dữ liệu không hợp lệ',
  429: 'Thao tác quá nhiều lần, vui lòng thử lại sau',
  500: 'Máy chủ gặp lỗi',
};

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

// 401 ở một API nghiệp vụ (vd. sai mã PIN cũ) chưa chắc là hết phiên → hỏi lại /auth/me.
let tokenCheck = null;
function verifySession() {
  tokenCheck ??= fetch(`${CONFIG.API_BASE_URL}/auth/me`, { headers: { Authorization: `Bearer ${getToken()}` } })
    .then((r) => { if (r.status === 401) onUnauthorized(); })
    .catch(() => {})
    .finally(() => { tokenCheck = null; });
}

function messageOf(body, status) {
  if (body && typeof body === 'object') {
    const m = body.message ?? body.error ?? body.msg ?? body.errors;
    if (typeof m === 'string' && m) return m;
    if (Array.isArray(m) && m.length) {
      return m.map((x) => (typeof x === 'string' ? x : x?.msg || x?.message || JSON.stringify(x))).join('; ');
    }
    if (m && typeof m === 'object') return m.message || JSON.stringify(m);
  }
  if (typeof body === 'string' && body && body.length < 200 && !body.trim().startsWith('<')) return body;
  return STATUS_TEXT[status] || `Lỗi HTTP ${status}`;
}

async function request(method, path, { body, query, auth = true } = {}) {
  const url = new URL(CONFIG.API_BASE_URL.replace(/\/$/, '') + path, location.href);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, `Không kết nối được tới Backend (${CONFIG.API_BASE_URL})`);
  }
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }

  if (!res.ok) {
    if (res.status === 401 && auth && token) {
      if (path === '/auth/me') onUnauthorized(); else verifySession();
    }
    throw new ApiError(res.status, messageOf(data, res.status), data);
  }
  // Một số BE trả HTTP 200 kèm { success: false } → coi như bị từ chối.
  if (data && typeof data === 'object' && data.success === false) {
    throw new ApiError(400, messageOf(data, 400), data);
  }
  return data;
}

const enc = encodeURIComponent;                       // "Cửa chính" → "C%E1%BB%ADa%20ch%C3%ADnh"
const H = (homeId) => `/homes/${enc(homeId)}`;
const DOOR = (homeId, doorName) => `${H(homeId)}/doors/${enc(doorName)}`;

export const api = {
  // Method gọi trực tiếp dự phòng
  request,
  patch: (path, options) => request('PATCH', path, options),
  post: (path, options) => request('POST', path, options),
  get: (path, options) => request('GET', path, options),
  delete: (path, options) => request('DELETE', path, options),

  // 3.1 Auth
  auth: {
    register: (body) => request('POST', '/auth/register', { body, auth: false }),
    login: (body) => request('POST', '/auth/login', { body, auth: false }),
    me: () => request('GET', '/auth/me'),
  },
  // 3.2 Homes
  homes: {
    list: () => request('GET', '/homes'),
    create: (body) => request('POST', '/homes', { body }),
    get: (homeId) => request('GET', H(homeId)),
    update: (homeId, body) => request('PUT', H(homeId), { body }),
    remove: (homeId) => request('DELETE', H(homeId)),
  },
  // 3.3 Members
  members: {
    list: (homeId) => request('GET', `${H(homeId)}/members`),
    add: (homeId, body) => request('POST', `${H(homeId)}/members`, { body }),
    update: (homeId, userId, body) => request('PUT', `${H(homeId)}/members/${enc(userId)}`, { body }),
    remove: (homeId, userId) => request('DELETE', `${H(homeId)}/members/${enc(userId)}`),
  },
  // 3.4 Devices
  devices: {
    list: (homeId) => request('GET', `${H(homeId)}/devices`),
    create: (homeId, body) => request('POST', `${H(homeId)}/devices`, { body }),
    update: (homeId, deviceId, body) => request('PATCH', `${H(homeId)}/devices/${enc(deviceId)}`, { body }),
    remove: (homeId, deviceId) => request('DELETE', `${H(homeId)}/devices/${enc(deviceId)}`),
    // body: { action: 'TURN_ON' | 'TURN_OFF' | 'SET_SPEED' | 'SET_COLOR', speed?, color? }
    command: (homeId, deviceId, body) => request('POST', `${H(homeId)}/devices/${enc(deviceId)}/commands`, { body }),
  },
  // Ngưỡng cảnh báo + chế độ tự động (lưu ở Backend, dùng chung cho mọi thành viên)
  settings: {
    get: (homeId) => request('GET', `${H(homeId)}/settings`),
    update: (homeId, body) => request('PUT', `${H(homeId)}/settings`, { body }),
    setMode: (homeId, autoMode) => request('PUT', `${H(homeId)}/settings/mode`, { body: { autoMode } }),
  },
  // 3.5 Smart door
  doors: {
    list: (homeId) => request('GET', `${H(homeId)}/doors`),
    create: (homeId, doorName) => request('POST', `${H(homeId)}/doors`, { body: { doorName } }),
    issuePin: (homeId, doorName, pin) => request('POST', `${DOOR(homeId, doorName)}/pins`, { body: { pin } }),
    credentials: (homeId, doorName) => request('GET', `${DOOR(homeId, doorName)}/credentials`),
    // Bàn phím đã tự kiểm tra 2 lần nhập mã mới; BE tìm mã PIN khớp với mã hiện tại trên cửa này
    changePin: (homeId, doorName, currentPin, newPin) => request('PUT', `${DOOR(homeId, doorName)}/change-pin`,
      { body: { currentPin, newPin, confirmPin: newPin } }),
    revoke: (homeId, doorName, credentialId) => request('DELETE', `${DOOR(homeId, doorName)}/credentials/${enc(credentialId)}`),
    unlock: (homeId, doorName, state = 'unlocked') => request('POST', `${DOOR(homeId, doorName)}/unlock`, { body: { state } }),
    attempts: (homeId, doorName) => request('GET', `${DOOR(homeId, doorName)}/attempts`),
    // Cần đăng nhập + quyền DOOR_UNLOCK (bàn phím thật dùng x-iot-key)
    verifyPin: (homeId, doorName, pin) => request('POST', `${DOOR(homeId, doorName)}/verify-pin`, { body: { pin } }),
  },
  // 3.6 AI
  ai: {
    listFaces: (homeId) => request('GET', `${H(homeId)}/ai/face-profiles`),
    addFace: (homeId, body) => request('POST', `${H(homeId)}/ai/face-profiles`, { body }),
    // Gửi kèm token: BE cho phép camera (x-iot-key) hoặc người dùng có quyền DOOR_UNLOCK. Ngưỡng do BE quyết định.
    recognize: (homeId, doorName, inputFaceVector) => request('POST',
      `${H(homeId)}/ai/doors/${enc(doorName)}/face-recognition`, { body: { inputFaceVector } }),
    voice: (homeId, commandDetail) => request('POST', `${H(homeId)}/ai/voice-commands`, { body: { commandDetail } }),
    removeFace: (homeId, profileId) => request('DELETE', `${H(homeId)}/ai/face-profiles/${enc(profileId)}`),
  },
  // 3.7 IoT telemetry
  iot: {
    sensors: (homeId) => request('GET', `${H(homeId)}/iot/sensors`),
    addSensor: (homeId, body) => request('POST', `${H(homeId)}/iot/sensors`, { body }),
    pushTelemetry: (homeId, sensorId, value, dataQuality = 'GOOD') => request('POST',
      `${H(homeId)}/iot/sensors/${enc(sensorId)}/telemetry`, { body: { value, dataQuality } }),
    records: (homeId, sensorId, query) => request('GET', `${H(homeId)}/iot/sensors/${enc(sensorId)}/records`, { query }),
  },
  // 3.8 Logs & notifications
  logs: {
    activity: (homeId) => request('GET', `${H(homeId)}/activity-logs`),
  },
  notifications: {
    list: (status) => request('GET', '/notifications', { query: { status } }),   // 'Unread' | 'Read' | undefined
    markRead: (id) => request('PATCH', `/notifications/${enc(id)}/read`),
    markAllRead: () => request('PATCH', '/notifications/read-all'), // Gọi thẳng route cập nhật hàng loạt
  },
};

