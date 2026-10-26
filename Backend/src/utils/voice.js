// Phân tích câu lệnh giọng nói tiếng Việt (văn bản từ Web Speech API) thành ý định điều khiển.
// Hỗ trợ: "bật/mở/tắt/dừng" ở BẤT KỲ vị trí nào trong câu ("Ơi bật đèn giúp mình"),
// tốc độ quạt "50%", "50 phần trăm", "mức 1/2/3", màu đèn "đổi đèn màu đỏ", còi, và nhận biết lệnh mở cửa.
const { deviceKind } = require('./feeds');

const strip = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .toLowerCase().replace(/\s+/g, ' ').trim();

const COLORS = [
  [/\bxanh (la|la cay|luc)\b/, '#00FF00'],
  [/\bxanh (duong|da troi|lam|nuoc bien)\b/, '#0000FF'],
  [/\bdo\b/, '#FF0000'],
  [/\bvang\b/, '#FFFF00'],
  [/\btrang\b/, '#FFFFFF'],
  [/\btim\b/, '#800080'],
  [/\bhong\b/, '#FF69B4'],
  [/\bcam\b/, '#FFA500'],
  [/\bxanh\b/, '#00FF00'],
];

const KIND_WORDS = { light: /\bden\b/, fan: /\bquat\b/, buzzer: /\b(coi|bao dong)\b/, door: /\bcua\b/ };
const ON_RE = /\b(bat|mo|chay|kich hoat)\b/;
const OFF_RE = /\b(tat|dung|ngung|dong)\b/;

function parseVoice(text) {
  const t = strip(text);
  const kind = Object.keys(KIND_WORDS).find((k) => KIND_WORDS[k].test(t)) ?? null;
  const onIdx = t.search(ON_RE);
  const offIdx = t.search(OFF_RE);
  // Động từ xuất hiện TRƯỚC quyết định (VD: "tắt đèn rồi mở quạt" -> tắt)
  const verb = onIdx === -1 && offIdx === -1 ? null
    : offIdx === -1 ? 'on' : onIdx === -1 ? 'off' : offIdx < onIdx ? 'off' : 'on';

  const pct = t.match(/(\d{1,3})\s*(%|phan tram)/);
  const level = t.match(/\b(muc|so|toc do)\s*(\d)\b/);
  let speed = pct ? Number(pct[1]) : level ? Math.round((Number(level[2]) / 3) * 100) : null;

  if (kind === 'door') return { intent: 'door', kind, normalized: t };

  if (/\bmau\b/.test(t) && (kind === 'light' || kind === null)) {
    const c = COLORS.find(([re]) => re.test(t.slice(t.indexOf('mau'))));
    if (c) return { intent: 'color', kind: 'light', color: c[1], normalized: t };
  }

  if (speed !== null && (kind === 'fan' || kind === null)) {
    if (verb === 'off') speed = 0;
    return { intent: 'speed', kind: 'fan', speed, normalized: t };
  }
  if (!verb || !kind) return { intent: 'unknown', kind, normalized: t };
  return { intent: verb, kind, normalized: t };
}

// Chọn thiết bị phù hợp nhất: đúng loại, ưu tiên thiết bị có nhiều từ trong tên xuất hiện trong câu
// ("bật đèn phòng ngủ" -> "Đèn phòng ngủ" thay vì luôn lấy đèn đầu tiên).
function resolveDevice(devices, parsed) {
  const candidates = devices.filter((d) => deviceKind(d.Type_Code, d.Device_Name) === parsed.kind);
  if (!candidates.length) return null;
  const words = new Set(parsed.normalized.split(' '));
  let best = candidates[0];
  let bestScore = -1;
  for (const d of candidates) {
    const score = strip(d.Device_Name).split(' ').filter((w) => w.length > 1 && words.has(w)).length;
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

module.exports = { parseVoice, resolveDevice, strip };
