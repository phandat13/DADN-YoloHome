// Đọc dữ liệu Backend theo kiểu "chịu lỗi": không phụ thuộc cách đặt tên trường
// (homeId / home_id / Home_ID đều khớp) và không phụ thuộc cách bọc phản hồi
// ([...], { data: [...] }, { homes: [...] }, { success, data: {...} }).

const normKey = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');

// Lấy giá trị đầu tiên khác rỗng theo danh sách tên trường.
export function pick(obj, ...names) {
  if (!obj || typeof obj !== 'object') return undefined;
  const map = new Map();
  for (const k of Object.keys(obj)) {
    const n = normKey(k);
    if (!map.has(n)) map.set(n, obj[k]);
  }
  for (const name of names) {
    const v = map.get(normKey(name));
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

// Trích mảng từ phản hồi.
export function asList(res, ...keys) {
  if (Array.isArray(res)) return res;
  if (!res || typeof res !== 'object') return [];
  for (const k of [...keys, 'data', 'items', 'results', 'rows', 'list']) {
    const v = pick(res, k);
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      const inner = asList(v, ...keys);
      if (inner.length) return inner;
    }
  }
  return Object.values(res).find(Array.isArray) ?? [];
}

// Trích object từ phản hồi.
export function asObject(res, ...keys) {
  if (!res || typeof res !== 'object' || Array.isArray(res)) return null;
  for (const k of [...keys, 'data', 'result']) {
    const v = pick(res, k);
    if (v && typeof v === 'object' && !Array.isArray(v)) return asObject(v, ...keys) ?? v;
  }
  return res;
}

// Tìm giá trị nguyên thuỷ theo tên ở mọi tầng (vd. token nằm trong data.token).
export function deepFind(obj, names, depth = 4) {
  if (!obj || typeof obj !== 'object' || depth < 0) return undefined;
  const direct = pick(obj, ...names);
  if (direct !== undefined && typeof direct !== 'object') return direct;
  for (const v of Object.values(obj)) {
    const found = deepFind(v, names, depth - 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

// Chuyển giá trị (có thể là object lồng, vd. role: { roleName }) thành chuỗi hiển thị.
export function label(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') {
    const inner = pick(v, 'name', 'displayName', 'roleName', 'typeCode', 'code', 'title', 'label', 'value');
    return inner !== undefined && typeof inner !== 'object' ? String(inner) : JSON.stringify(v);
  }
  return String(v);
}

export function toTs(v) {
  if (v === undefined || v === null || v === '') return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    const n = Number(v);
    return n < 1e12 ? n * 1000 : n;          // giây hoặc mili-giây
  }
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const normText = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[đĐ]/g, 'd').toLowerCase().trim();

const pad = (n) => String(n).padStart(2, '0');
export const hhmm = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fullTime = (ts) => {
  if (ts == null) return '—';
  const d = new Date(ts);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${hhmm(ts)}:${pad(d.getSeconds())}`;
};
export const fmtDate = (v) => {
  const t = toTs(v);
  if (t == null) return v ? String(v) : '—';
  const d = new Date(t);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};
export const toDateInput = (v) => {
  const t = toTs(v);
  if (t == null) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
// Chuỗi số → number (giữ nguyên nếu không phải số), để gửi id đúng kiểu cho BE.
export const idValue = (v) => (v !== '' && v != null && /^\d+$/.test(String(v)) ? Number(v) : v);

// Tìm trong phần dữ liệu đã bóc ({ data: {...} }) trước, rồi tới cấp ngoài cùng của phản hồi.
export function pickAny(res, ...names) {
  const inner = asObject(res);
  const v = inner && inner !== res ? pick(inner, ...names) : undefined;
  return v !== undefined ? v : pick(res, ...names);
}
