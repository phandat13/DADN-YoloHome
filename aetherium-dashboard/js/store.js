// Trạng thái dùng chung + logic nghiệp vụ (so sánh ngưỡng, tự động hoá, nhật ký).
import { THRESHOLDS, DEFAULT_THRESHOLDS } from './config.js';
import { sensorState } from './data/sensorData.js';

const KEY = 'aetherium.v1';
const AUTO = 'tự động';
const listeners = {};
export const on = (evt, fn) => { (listeners[evt] ??= new Set()).add(fn); return () => listeners[evt].delete(fn); };
export const emit = (evt) => listeners[evt]?.forEach((fn) => fn());

export const state = {
  sensor: sensorState,
  devices: { mode: 'auto', light: false, fan: 0, buzzer: false, door: false },
  password: '1234',
  logs: [],     // {ts, type: sensor|device|door|alert, message}
  alerts: [],   // cảnh báo đang hoạt động {key, message}
};

const pad = (n) => String(n).padStart(2, '0');
export const hhmm = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fullTime = (ts) => { const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${hhmm(ts)}:${pad(d.getSeconds())}`; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ thresholds: THRESHOLDS, password: state.password, logs: state.logs })); } catch {}
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (!d) return;
    Object.assign(THRESHOLDS, d.thresholds);
    state.password = d.password ?? state.password;
    state.logs = d.logs ?? [];
  } catch {}
}

const SEED = [
  ['sensor', 'Nhiệt độ 28.5°C, độ ẩm 64%, ánh sáng 420 Lux'],
  ['sensor', 'Nhiệt độ 31.2°C, độ ẩm 58%, ánh sáng 610 Lux'],
  ['door', 'Cửa mở lúc {t} bằng mật mã'],
  ['door', 'Cửa mở lúc {t} bằng FaceAI'],
  ['alert', 'Cảnh báo: Nhiệt độ 36°C lúc {t}'],
  ['device', 'Đèn BẬT (tự động)'],
  ['device', 'Quạt 100% (tự động)'],
  ['device', 'Đèn TẮT (giọng nói)'],
];
function seedLogs() {
  const now = Date.now();
  state.logs = Array.from({ length: 40 }, () => {
    const [type, m] = SEED[Math.floor(Math.random() * SEED.length)];
    const ts = now - Math.random() * 30 * 864e5;
    return { ts, type, message: m.replace('{t}', hhmm(ts)) };
  }).sort((a, b) => b.ts - a.ts);
}

export function addLog(type, message) {
  state.logs.unshift({ ts: Date.now(), type, message });
  if (state.logs.length > 500) state.logs.length = 500;
  save(); emit('logs');
}
export function clearLogs() { state.logs = []; save(); emit('logs'); }

// ---- Thiết bị ----
const LABEL = { light: (v) => `Đèn ${v ? 'BẬT' : 'TẮT'}`, fan: (v) => `Quạt ${v}%` };

export function setDevice(key, value, source = 'web') {
  const d = state.devices;
  if (source !== AUTO && d.mode === 'auto') { d.mode = 'manual'; addLog('device', 'Chuyển sang chế độ thủ công'); }
  if (d[key] !== value) { d[key] = value; addLog('device', `${LABEL[key](value)} (${source})`); }
  emit('devices');
}
export function setMode(mode) {
  state.devices.mode = mode;
  addLog('device', `Chế độ ${mode === 'auto' ? 'tự động' : 'thủ công'}`);
  applyAuto(); emit('devices');
}
export function openDoor(source) {
  const d = state.devices;
  d.door = true;
  addLog('door', `Cửa mở lúc ${hhmm(Date.now())} bằng ${source}`);
  emit('devices');
  setTimeout(() => { d.door = false; emit('devices'); }, 2000);   // Servo mở 2 giây
}
export function setPassword(p) { state.password = p; addLog('door', 'Đã đổi mật mã cửa'); save(); }

// ---- Tự động hoá + ngưỡng ----
function applyAuto() {
  const { sensor: s, devices: d } = state;
  if (d.mode !== 'auto') return;
  const light = s.motion || s.light < THRESHOLDS.LIGHT_MIN;
  const fan = state.alerts.some((a) => a.key === 'temp') ? 100 : 0;
  if (d.light !== light) { d.light = light; addLog('device', `${LABEL.light(light)} (${AUTO})`); }
  if (d.fan !== fan) { d.fan = fan; addLog('device', `${LABEL.fan(fan)} (${AUTO})`); }
}

export function evaluate() {
  const s = state.sensor, t = THRESHOLDS, issues = [];
  if (s.temperature > t.TEMP_MAX) issues.push({ key: 'temp', message: `Nhiệt độ ${s.temperature}°C vượt ngưỡng ${t.TEMP_MAX}°C` });
  if (s.humidity < t.HUMIDITY_MIN || s.humidity > t.HUMIDITY_MAX) issues.push({ key: 'hum', message: `Độ ẩm ${s.humidity}% ngoài khoảng ${t.HUMIDITY_MIN}–${t.HUMIDITY_MAX}%` });
  const before = new Set(state.alerts.map((a) => a.key));
  issues.forEach((i) => { if (!before.has(i.key)) addLog('alert', `Cảnh báo: ${i.message} lúc ${hhmm(Date.now())}`); });
  state.alerts = issues;
  state.devices.buzzer = issues.some((i) => i.key === 'temp');
  applyAuto();
  emit('alerts'); emit('devices');
}

export function applyThresholds(values) {
  Object.assign(THRESHOLDS, values);
  save(); addLog('device', 'Cập nhật ngưỡng cảnh báo');
  evaluate(); emit('sensor');
}
export const resetThresholds = () => applyThresholds(DEFAULT_THRESHOLDS);

// Mỗi 30s: giả lập đọc cảm biến (thay bằng dữ liệu MQTT thật ở đây)
export function tick() {
  const s = state.sensor;
  s.temperature = clamp(+(s.temperature + (Math.random() - 0.48) * 1.5).toFixed(1), 20, 45);
  s.humidity = clamp(Math.round(s.humidity + (Math.random() - 0.5) * 5), 30, 95);
  s.light = clamp(Math.round(s.light + (Math.random() - 0.5) * 120), 0, 1000);
  s.motion = Math.random() < 0.4;
  addLog('sensor', `Nhiệt độ ${s.temperature}°C, độ ẩm ${s.humidity}%, ánh sáng ${s.light} Lux`);
  evaluate(); emit('sensor');
}

export function initStore() {
  load();
  if (!state.logs.length) seedLogs();
  evaluate();
}
