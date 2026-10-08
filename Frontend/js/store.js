// Trạng thái dùng chung + phiên đăng nhập + kết nối Socket.IO + logic ngưỡng/tự động hoá.
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js';
import { CONFIG, THRESHOLDS, DEFAULT_THRESHOLDS, TIMING } from './config.js';
import { pick, label, asList, asObject, deepFind, toTs, clamp, normText, hhmm } from './utils/fields.js';
import {
  normUser, normHome, normDevice, normSensor, normDoor, normRecord, normNotification,
  sensorKind, parseMotion, parseVoiceCommand,
} from './models.js';
import { toast } from './ui.js';

export { hhmm, fullTime } from './utils/fields.js';

// ---------------- Event bus ----------------
const listeners = {};
export const on = (evt, fn) => { (listeners[evt] ??= new Set()).add(fn); return () => listeners[evt].delete(fn); };
export const emit = (evt) => listeners[evt]?.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
// Chỉ gọi fn khi "chữ ký" dữ liệu thay đổi (tránh vẽ lại làm mất nội dung đang nhập trong form).
export function onChange(events, signature, fn) {
  let last = signature();
  const handler = () => { const s = signature(); if (s !== last) { last = s; fn(); } };
  const offs = [].concat(events).map((e) => on(e, handler));
  return () => offs.forEach((off) => off());
}

// ---------------- localStorage ----------------
const LS = {
  home: 'yolohome.homeId',
  thresholds: 'yolohome.thresholds',
  logs: (h) => `yolohome.logs.${h}`,
  mode: (h) => `yolohome.mode.${h}`,
  dev: (h) => `yolohome.devstate.${h}`,
};
const lsGet = (k, fallback) => { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// ---------------- State ----------------
export const AUTO = 'tự động';
const emptySensor = () => ({ temperature: null, humidity: null, light: null, motion: null, quality: {}, at: {}, updatedAt: null });
const HISTORY_SPAN_MS = 864e5;   // biểu đồ dùng dữ liệu 24 giờ gần nhất
const HISTORY_MAX = 5000;        // số điểm tối đa giữ cho mỗi đại lượng
const emptyHistory = () => ({ temperature: [], humidity: [], light: [] });

export const state = {
  ready: false,                 // đã khởi tạo phiên xong
  user: null,
  homes: [],
  homeId: null,
  home: null,
  sensors: [],                  // [{ id, deviceId, dataType, unit, kind }]
  devices: [],                  // [{ id, name, typeCode, kind, on, speed, online, ... }]
  doors: [],                    // [{ id, name, state, credentials }]
  sensor: emptySensor(),        // giá trị mới nhất theo loại
  history: emptyHistory(),      // chuỗi {ts, value} để vẽ biểu đồ
  mode: 'auto',
  buzzer: false,
  doorOpen: false,              // có cửa đang mở khoá (theo trạng thái Backend)
  doorLockAt: null,             // thời điểm Backend sẽ tự khoá cửa (ms)
  alerts: [],                   // cảnh báo ngưỡng đang hoạt động
  logs: [],                     // nhật ký cục bộ (cảnh báo, tự động hoá, thao tác)
  unread: 0,
  socketConnected: false,
  loading: false,
  errors: {},
};

let devCache = {};              // trạng thái lệnh gần nhất theo thiết bị (trình duyệt gửi)
let socket = null;
let doorTimer = null;
const autoBackoff = {};

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

// ---------------- Nhật ký cục bộ ----------------
function saveLogs() { if (state.homeId != null) lsSet(LS.logs(state.homeId), state.logs.slice(0, 300)); }
export function addLog(type, message) {
  state.logs.unshift({ ts: Date.now(), type, message });
  if (state.logs.length > 300) state.logs.length = 300;
  saveLogs();
  emit('logs');
}
export function clearLogs() { state.logs = []; saveLogs(); emit('logs'); }

// ---------------- Phiên đăng nhập ----------------
setUnauthorizedHandler(() => {
  if (!getToken()) return;
  toast('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại', 'amber');
  logout();
});

export async function login(email, password) {
  const res = await api.auth.login({ email, password });
  const token = deepFind(res, ['token', 'accessToken', 'jwt']);
  if (!token) throw new Error('Máy chủ không trả về token đăng nhập');
  setToken(token);
  await bootstrap();
}

export const register = (body) => api.auth.register(body);

export function logout() {
  if (socket) {
    if (state.homeId != null) socket.emit('leave_home', state.homeId);
    socket.disconnect();
    socket = null;
  }
  setToken(null);
  resetHomeState();
  Object.assign(state, { user: null, homes: [], homeId: null, home: null, logs: [], unread: 0, socketConnected: false, errors: {} });
  emit('auth'); emit('home'); emit('notifications'); emit('socket');
  if (location.hash !== '#/login') location.hash = '#/login';
}

export async function bootstrap() {
  if (!getToken()) { state.ready = true; emit('auth'); return; }
  try {
    state.user = normUser(asObject(await api.auth.me(), 'user'));
  } catch (e) {
    if (e.status === 401) return;           // handler đã đăng xuất
    console.warn('[auth/me]', e.message);
  }
  if (!getToken()) return;
  await loadHomes();
  connectSocket();
  const saved = lsGet(LS.home, null);
  const target = state.homes.find((h) => sameId(h.id, saved)) ?? state.homes[0];
  const loadingHome = selectHome(target ? target.id : null);   // phần đồng bộ đặt homeId ngay
  state.ready = true;
  emit('auth');
  refreshNotifications();
  await loadingHome;
}

// ---------------- Nhà ----------------
export async function loadHomes() {
  try {
    state.homes = asList(await api.homes.list(), 'homes').map(normHome);
    state.errors.homes = null;
  } catch (e) {
    state.errors.homes = e.message;
  }
  state.home = state.homes.find((h) => sameId(h.id, state.homeId)) ?? null;
  emit('homes');
}

function resetHomeState() {
  Object.assign(state, {
    sensors: [], devices: [], doors: [], sensor: emptySensor(), history: emptyHistory(),
    alerts: [], buzzer: false, doorOpen: false, doorLockAt: null, loading: false, errors: { homes: state.errors.homes },
  });
}

export async function selectHome(id) {
  const prev = state.homeId;
  if (prev != null && socket?.connected) socket.emit('leave_home', prev);
  const home = state.homes.find((h) => sameId(h.id, id));
  state.homeId = home ? home.id : (id ?? null);
  state.home = home ?? null;
  resetHomeState();
  if (state.homeId == null) {
    try { localStorage.removeItem(LS.home); } catch {}
    state.logs = [];
    emit('home');
    return;
  }
  lsSet(LS.home, state.homeId);
  state.mode = lsGet(LS.mode(state.homeId), 'auto');
  state.logs = lsGet(LS.logs(state.homeId), []);
  devCache = lsGet(LS.dev(state.homeId), {});
  if (socket?.connected) socket.emit('join_home', state.homeId);
  state.loading = true;
  emit('home');

  const hid = state.homeId;
  api.homes.get(hid).then((res) => {           // GET /homes/:homeId – cập nhật chi tiết
    const item = state.homes.find((h) => sameId(h.id, hid));
    if (!item) return;
    const detail = normHome(asObject(res, 'home'));
    for (const k of ['name', 'address', 'state', 'role']) {
      if (detail[k] && !(k === 'name' && detail[k] === 'Nhà chưa đặt tên')) item[k] = detail[k];
    }
    emit('homes');
  }).catch(() => {});
  await refreshHomeData();
}

// Tải thiết bị, cảm biến, cửa và số liệu mới nhất của nhà đang chọn.
export async function refreshHomeData({ silent = false } = {}) {
  const hid = state.homeId;
  if (hid == null || !getToken()) return;
  if (!silent) { state.loading = true; emit('loading'); }
  const [devs, sens, doors] = await Promise.allSettled([api.devices.list(hid), api.iot.sensors(hid), api.doors.list(hid)]);
  if (!sameId(hid, state.homeId)) return;
  const take = (r, key, norm) => {
    if (r.status === 'fulfilled') { state.errors[key] = null; return asList(r.value, key).map(norm); }
    state.errors[key] = r.reason?.message || 'Lỗi tải dữ liệu';
    return null;
  };
  const d = take(devs, 'devices', (x) => normDevice(x, devCache));
  if (d) {
    state.devices = d;
    // Đồng bộ lại devCache cục bộ để không đè ngược trạng thái cũ lên thiết bị
    d.forEach((item) => {
      devCache[String(item.id)] = { on: item.on, speed: item.speed };
    });
    if (state.homeId != null) lsSet(LS.dev(state.homeId), devCache);
  }
  const s = take(sens, 'sensors', normSensor);
  if (s) state.sensors = s;
  const dr = take(doors, 'doors', normDoor);
  if (dr) { state.doors = dr.filter((x) => x.name); syncDoorOpen(); scheduleDoorRefresh(); }
  await loadReadings(hid, { full: !silent });
  if (!sameId(hid, state.homeId)) return;
  state.loading = false;
  evaluate();
  ['devices', 'sensors', 'doors', 'door', 'sensor', 'history', 'loading'].forEach(emit);
}

// Gộp điểm mới vào chuỗi cũ (bỏ trùng theo thời điểm), giữ 24 giờ gần nhất.
function mergeSeries(oldPts, newPts) {
  const byTs = new Map();
  for (const p of oldPts) byTs.set(p.ts, p);
  for (const p of newPts) byTs.set(p.ts, p);
  const since = Date.now() - HISTORY_SPAN_MS;
  return [...byTs.values()].filter((p) => p.ts >= since).sort((a, b) => a.ts - b.ts).slice(-HISTORY_MAX);
}

// GET /iot/sensors/:sensorId/records → giá trị mới nhất + chuỗi lịch sử cho biểu đồ.
// full: tải lại toàn bộ 24 giờ (khi mở nhà / bấm Tải lại); ngược lại chỉ lấy bản ghi mới nhất rồi gộp vào.
async function loadReadings(hid, { full = true } = {}) {
  const jobs = ['temperature', 'humidity', 'light', 'motion'].map(async (kind) => {
    const sensor = state.sensors.find((x) => x.kind === kind);
    if (!sensor) return [kind, null];
    const needAll = kind in state.history && (full || !state.history[kind].length);
    const query = needAll
      ? { from: new Date(Date.now() - HISTORY_SPAN_MS).toISOString(), limit: HISTORY_MAX }
      : { limit: 100 };
    try { return [kind, asList(await api.iot.records(hid, sensor.id, query), 'records').map(normRecord), needAll]; }
    catch { return [kind, null]; }
  });
  for (const [kind, recs, replaced] of await Promise.all(jobs)) {
    if (!recs?.length || !sameId(hid, state.homeId)) continue;
    const timed = recs.filter((r) => r.ts != null).sort((a, b) => a.ts - b.ts);
    const latest = timed.length ? timed[timed.length - 1] : recs[recs.length - 1];
    if (kind in state.history && timed.length) {
      const pts = timed.map((r) => ({ ts: r.ts, value: Number(r.value) })).filter((p) => Number.isFinite(p.value));
      state.history[kind] = replaced ? pts.slice(-HISTORY_MAX) : mergeSeries(state.history[kind], pts);
    }
    const ts = latest.ts ?? Date.now();
    if (!state.sensor.at[kind] || ts >= state.sensor.at[kind]) setReading(kind, latest.value, latest.quality, latest.ts);
  }
}

function setReading(kind, raw, quality, ts) {
  let v;
  if (kind === 'motion') v = parseMotion(raw);
  else {
    v = Number(raw);
    if (!Number.isFinite(v)) return false;
    v = kind === 'light' ? Math.round(v) : Math.round(v * 10) / 10;
  }
  state.sensor[kind] = v;
  state.sensor.quality[kind] = String(quality || 'GOOD').toUpperCase();   // BE trả 'good' | 'bad' | 'uncertain'
  state.sensor.at[kind] = ts ?? null;
  state.sensor.updatedAt = Math.max(state.sensor.updatedAt ?? 0, ts ?? 0) || null;
  return true;
}

// ---------------- Socket.IO ----------------
export const getSocket = () => socket;

function connectSocket() {
  if (socket) return;
  if (typeof window.io !== 'function') { console.warn('[Socket.IO] Không tìm thấy thư viện socket.io client.'); return; }
  socket = window.io(CONFIG.SOCKET_URL, { auth: { token: getToken() } });
  socket.on('connect', () => {
    state.socketConnected = true;
    if (state.homeId != null) socket.emit('join_home', state.homeId);   // tự vào lại phòng sau khi reconnect
    emit('socket');
  });
  socket.on('disconnect', () => { state.socketConnected = false; emit('socket'); });
  socket.on('connect_error', () => { state.socketConnected = false; emit('socket'); });
  socket.on('sensor_update', onSensorUpdate);

  // LẮNG NGHE SỰ KIỆN ĐỒNG BỘ THIẾT BỊ TỪ BACKEND / CÁC CLIENT KHÁC
  socket.on('device_update', onDeviceUpdate);
  socket.on('device_state', onDeviceUpdate);
  socket.on('device_state_updated', onDeviceUpdate);   // tên sự kiện Backend thực sự phát (điều khiển + giọng nói)
  socket.on('door_state_updated', onDoorUpdate);       // mở khoá / khoá tay / tự khoá
}

// Payload: { deviceId, state, speed, working }
function onDeviceUpdate(data) {
  if (!data || state.homeId == null) return;
  if (data.homeId != null && !sameId(data.homeId, state.homeId)) return;
  const devId = data.deviceId || data.Device_ID || data.id;
  const target = state.devices.find((d) => String(d.id) === String(devId));
  if (!target) {
    refreshHomeData({ silent: true });
    return;
  }

  const rawState = String(data.state ?? data.working ?? data.Current_State ?? '').toLowerCase().trim();
  const rawSpeed = data.speed !== undefined ? Number(data.speed) : undefined;

  if (target.kind === 'fan') {
    if (rawSpeed !== undefined && !isNaN(rawSpeed)) {
      target.speed = rawSpeed;
      target.on = rawSpeed > 0;
      target.working = String(rawSpeed);
    } else {
      target.on = rawState === 'on' || (parseInt(rawState, 10) > 0);
      target.speed = target.on ? (parseInt(rawState, 10) || 100) : 0;
      target.working = String(target.speed);
    }
  } else {
    target.on = rawState === 'on' || rawState === '1';
    target.working = target.on ? 'on' : 'off';
  }

  rememberDevice(target);
  emit('devices');
}

// Payload: { feed: "sensor-temperature", sensorId, value, quality, timestamp }
function onSensorUpdate(data) {
  if (!data || state.homeId == null) return;
  const dataHome = pick(data, 'homeId');
  if (dataHome != null && !sameId(dataHome, state.homeId)) return;
  const sensor = state.sensors.find((s) => sameId(s.id, pick(data, 'sensorId')));
  const kind = sensor?.kind ?? sensorKind(label(pick(data, 'feed')));
  if (!kind) return;
  const ts = toTs(pick(data, 'timestamp')) ?? Date.now();
  if (!setReading(kind, pick(data, 'value'), label(pick(data, 'quality', 'dataQuality')), ts)) return;
  const series = state.history[kind];
  if (series) {
    series.push({ ts, value: Number(state.sensor[kind]) });
    if (series.length > HISTORY_MAX) series.splice(0, series.length - HISTORY_MAX);
  }
  evaluate();
  emit('sensor'); emit('history');
}

// ---------------- Thiết bị ----------------
const devLabel = (d) => (d.kind === 'fan' ? `${d.name} ${d.speed}%` : `${d.name} ${d.on ? 'BẬT' : 'TẮT'}`);

function rememberDevice(d) {
  devCache[String(d.id)] = { on: d.on, speed: d.speed };
  if (state.homeId != null) lsSet(LS.dev(state.homeId), devCache);
}

// Gửi lệnh qua POST /homes/:homeId/devices/:deviceId/commands
export async function controlDevice(dev, change, source = 'web') {
  if (state.homeId == null || !dev) return;
  if (source !== AUTO && state.mode === 'auto') setMode('manual', 'thao tác thủ công');
  const prev = { on: dev.on, speed: dev.speed };
  let action;
  let payload;
  if (dev.kind === 'fan') {
    const speed = clamp(Math.round(change.speed ?? (change.on ? (dev.speed || 100) : 0)), 0, 100);
    Object.assign(dev, { speed, on: speed > 0, working: String(speed) });
    [action, payload] = speed > 0 ? ['SET_SPEED', { state: 'ON', speed }] : ['TURN_OFF', { state: 'OFF', speed: 0 }];
  } else {
    const onv = !!change.on;
    Object.assign(dev, { on: onv, speed: onv ? 100 : 0, working: onv ? 'on' : 'off' });
    [action, payload] = onv ? ['TURN_ON', { state: 'ON' }] : ['TURN_OFF', { state: 'OFF' }];
  }
  emit('devices');
  try {
    await api.devices.command(state.homeId, dev.id, action, payload);
    rememberDevice(dev);
    addLog('device', `${devLabel(dev)} (${source})`);
  } catch (e) {
    Object.assign(dev, prev);
    emit('devices');
    addLog('device', `Lỗi gửi lệnh ${action} tới ${dev.name}: ${e.message}`);
    throw e;
  }
}

// Sau khi BE xử lý lệnh giọng nói thành công: phản ánh thay đổi lên giao diện (không gửi lệnh lần 2).
export function reflectVoiceCommand(text) {
  const cmd = parseVoiceCommand(text);
  if (!cmd) return null;
  const t = normText(text);
  const candidates = state.devices.filter((d) => d.kind === cmd.kind);
  const dev = candidates.find((d) => t.includes(normText(d.name))) ?? candidates[0];
  if (!dev) return null;
  if (state.mode === 'auto') setMode('manual', 'lệnh giọng nói');
  if (cmd.kind === 'fan') Object.assign(dev, { speed: cmd.speed, on: cmd.speed > 0, working: String(cmd.speed) });
  else Object.assign(dev, { on: cmd.on, speed: cmd.on ? 100 : 0, working: cmd.on ? 'on' : 'off' });
  rememberDevice(dev);
  addLog('device', `${devLabel(dev)} (giọng nói)`);
  emit('devices');
  return dev;
}

export function setMode(mode, reason = '') {
  if (state.mode === mode) return;
  state.mode = mode;
  if (state.homeId != null) lsSet(LS.mode(state.homeId), mode);
  addLog('device', `Chuyển sang chế độ ${mode === 'auto' ? 'tự động' : 'thủ công'}${reason ? ` (${reason})` : ''}`);
  emit('devices');
  applyAuto();
}

// ---------------- Cửa ----------------
// Backend tự khoá cửa sau DOOR_AUTO_LOCK_SECONDS (mặc định 10s) và gửi LOCK_DOOR lên feed Adafruit 'smart-door'.
// Giao diện chỉ hiển thị theo trạng thái Backend: sự kiện Socket.IO 'door_state_updated' hoặc tải lại.
function syncDoorOpen() {
  const open = state.doors.filter((d) => /unlocked/i.test(d.state));
  state.doorOpen = open.length > 0;
  const times = open.map((d) => d.autoLockAt).filter(Boolean);
  state.doorLockAt = times.length ? Math.min(...times) : null;
}

// Lỡ sự kiện socket (mất mạng...) -> tự tải lại trạng thái cửa sau thời điểm khoá dự kiến
function scheduleDoorRefresh() {
  clearTimeout(doorTimer);
  if (state.doorLockAt && state.doorLockAt > Date.now() - 1000) {
    doorTimer = setTimeout(() => refreshHomeData({ silent: true }), state.doorLockAt - Date.now() + 3000);
  }
}

function setDoorState(doorName, lockState, lockAt = null) {
  const d = state.doors.find((x) => x.name === doorName);
  if (d) {
    d.state = lockState === 'unlocked' ? 'Unlocked' : 'Locked';
    d.autoLockAt = lockState === 'unlocked' ? lockAt : null;
  }
  syncDoorOpen();
  scheduleDoorRefresh();
  emit('door'); emit('doors');
}

// info: phần data trong phản hồi API mở cửa ({ autoLockAt, autoLockSeconds, mqttPublished })
export function markDoorOpened(source, doorName = '', info = {}) {
  const lockAt = toTs(info?.autoLockAt);
  addLog('door', `Cửa${doorName ? ` "${doorName}"` : ''} mở lúc ${hhmm(Date.now())} bằng ${source}`
    + (lockAt ? ` — tự khoá sau ${Math.max(0, Math.round((lockAt - Date.now()) / 1000))}s` : ''));
  setDoorState(doorName, 'unlocked', lockAt);
}

export function markDoorLocked(doorName = '') {
  setDoorState(doorName, 'locked');
}

// Payload: { homeId, doorName, state: 'unlocked' | 'locked', source: 'pin' | 'face' | 'remote' | 'auto', autoLockAt }
function onDoorUpdate(data) {
  if (!data || state.homeId == null) return;
  if (data.homeId != null && !sameId(data.homeId, state.homeId)) return;
  const lockState = String(data.state).toLowerCase() === 'unlocked' ? 'unlocked' : 'locked';
  if (lockState === 'locked' && data.source === 'auto') {
    addLog('door', `Cửa "${data.doorName}" tự khoá lúc ${hhmm(Date.now())} (đã gửi LOCK_DOOR lên Adafruit)`);
  }
  setDoorState(data.doorName, lockState, toTs(data.autoLockAt));
}

// ---------------- Ngưỡng + tự động hoá ----------------
const fresh = (k) => state.sensor[k] != null && state.sensor.at[k] != null && Date.now() - state.sensor.at[k] < TIMING.FRESH_DATA_MS;

function autoSend(dev, change) {
  if ((autoBackoff[dev.id] ?? 0) > Date.now()) return;
  controlDevice(dev, change, AUTO).catch(() => { autoBackoff[dev.id] = Date.now() + 60e3; });
}

// Chế độ tự động: đèn theo PIR/ánh sáng, quạt theo nhiệt độ. Lệnh được gửi thật xuống BE.
function applyAuto() {
  if (state.mode !== 'auto' || state.homeId == null) return;
  const s = state.sensor;
  const light = state.devices.find((d) => d.kind === 'light');
  if (light && (fresh('light') || fresh('motion'))) {
    const want = (fresh('motion') && !!s.motion) || (fresh('light') && s.light < THRESHOLDS.LIGHT_MIN);
    if (light.on !== want) autoSend(light, { on: want });
  }
  const fan = state.devices.find((d) => d.kind === 'fan');
  if (fan && fresh('temperature')) {
    const want = s.temperature > THRESHOLDS.TEMP_MAX ? 100 : 0;
    if (fan.speed !== want) autoSend(fan, { speed: want });
  }
}

export function evaluate() {
  const s = state.sensor;
  const t = THRESHOLDS;
  const issues = [];
  if (s.temperature != null && s.temperature > t.TEMP_MAX) {
    issues.push({ key: 'temp', message: `Nhiệt độ ${s.temperature}°C vượt ngưỡng ${t.TEMP_MAX}°C` });
  }
  if (s.humidity != null && (s.humidity < t.HUMIDITY_MIN || s.humidity > t.HUMIDITY_MAX)) {
    issues.push({ key: 'hum', message: `Độ ẩm ${s.humidity}% ngoài khoảng ${t.HUMIDITY_MIN}–${t.HUMIDITY_MAX}%` });
  }
  const before = new Set(state.alerts.map((a) => a.key));
  issues.forEach((i) => { if (!before.has(i.key)) addLog('alert', `Cảnh báo: ${i.message} lúc ${hhmm(Date.now())}`); });
  state.alerts = issues;
  state.buzzer = issues.some((i) => i.key === 'temp');
  applyAuto();
  emit('alerts');
}

export function applyThresholds(values) {
  Object.assign(THRESHOLDS, values);
  lsSet(LS.thresholds, { ...THRESHOLDS });
  addLog('device', 'Cập nhật ngưỡng cảnh báo');
  evaluate();
  emit('sensor');
}
export const resetThresholds = () => applyThresholds({ ...DEFAULT_THRESHOLDS });

// ---------------- Thông báo ----------------
export async function refreshNotifications() {
  if (!getToken()) return;
  try {
    const list = asList(await api.notifications.list('Unread'), 'notifications').map(normNotification);
    state.unread = list.filter((n) => !n.read).length;
    emit('notifications');
  } catch { /* không chặn giao diện */ }
}

// ---------------- Khởi tạo ----------------
export async function initStore() {
  Object.assign(THRESHOLDS, lsGet(LS.thresholds, {}));
  await bootstrap();
}

