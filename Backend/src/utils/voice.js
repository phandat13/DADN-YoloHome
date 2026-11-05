// Phân tích câu lệnh giọng nói tiếng Việt (văn bản từ Web Speech API) thành ý định điều khiển.
// Hỗ trợ: "bật/mở/tắt/dừng" ở BẤT KỲ vị trí nào trong câu ("Ơi bật đèn giúp mình"),
// tốc độ quạt "50%", "50 phần trăm", "mức 1/2/3", màu đèn "đổi đèn màu đỏ", còi, và nhận biết lệnh mở cửa.
// Thêm: chế độ ngủ ("đi ngủ", "chúc ngủ ngon" / "thức dậy", "tắt chế độ ngủ") và hẹn giờ
// ("tắt quạt sau 30 phút", "bật đèn sau 1 tiếng", "hẹn giờ tắt đèn lúc 10 giờ tối", "lúc 6h30 sáng bật đèn").
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

const WAKE_RE = /\b(thuc day|day roi|chao buoi sang|tat che do ngu|huy che do ngu|thoat che do ngu)\b/;
const SLEEP_RE = /\b(di ngu|chuc ngu ngon|ngu ngon|che do ngu|toi ngu day|ngu thoi)\b/;
const AFTER_RE = /\bsau\s+(nua tieng|(\d{1,4})\s*(phut|p|tieng|gio|h)\b)/;
const AT_RE = /\b(?:luc|vao luc|vao)?\s*(\d{1,2})\s*(?:h|gio|:)\s*(\d{1,2})?\s*(?:phut)?\s*(sang|trua|chieu|toi|dem)?\b/;

/**
 * Tìm thời điểm hẹn trong câu. Trả về { runAt: Date, rest: câu đã bỏ phần thời gian } hoặc null.
 * Chỉ hiểu "lúc HH giờ MM" khi câu có "lúc" / "hẹn giờ" (tránh nhầm với "quạt mức 2").
 */
function parseTimer(t, now = new Date()) {
  const after = t.match(AFTER_RE);
  if (after) {
    const minutes = after[1] === 'nua tieng' ? 30
      : Number(after[2]) * (/^(tieng|gio|h)$/.test(after[3]) ? 60 : 1);
    if (minutes > 0) return { runAt: new Date(now.getTime() + minutes * 60_000), minutes, rest: t.replace(after[0], ' ').trim() };
  }
  if (!/\b(luc|hen gio|vao luc)\b/.test(t)) return null;
  const at = t.replace(/\bhen gio\b/, ' ').match(AT_RE);
  if (!at) return null;
  let h = Number(at[1]);
  const m = at[2] ? Number(at[2]) : 0;
  const part = at[3];
  if (h > 23 || m > 59) return null;
  if ((part === 'chieu' || part === 'toi') && h < 12) h += 12;
  if (part === 'dem') h = h === 12 ? 0 : h >= 6 && h < 12 ? h + 12 : h;
  if (part === 'trua' && h < 6) h += 12;
  if (part === 'sang' && h === 12) h = 0;
  const runAt = new Date(now);
  runAt.setHours(h, m, 0, 0);
  if (runAt <= now) runAt.setDate(runAt.getDate() + 1);
  const rest = t.replace(/\bhen gio\b/, ' ').replace(at[0], ' ').replace(/\s+/g, ' ').trim();
  return { runAt, rest };
}

function parseVoice(text, now = new Date()) {
  const full = strip(text);
  if (WAKE_RE.test(full)) return { intent: 'wake', kind: null, normalized: full };
  // "chúc ngủ ngon", "đi ngủ thôi", "tắt đèn đi ngủ" -> chế độ ngủ; "tắt quạt rồi đi ngủ" -> vẫn là lệnh quạt
  const rest = full.replace(SLEEP_RE, ' ');
  if (SLEEP_RE.test(full) && (!/\b(den|quat|coi)\b/.test(rest) || /^\s*(hay |oi )?tat (het )?(cac |tat ca )?den\b/.test(rest))) {
    return { intent: 'sleep', kind: null, normalized: full };
  }
  const timer = parseTimer(full, now);
  const wantsTimer = /\bhen gio\b/.test(full);
  const result = parseCommand(timer ? timer.rest : full);
  if (timer) result.timer = { runAt: timer.runAt, minutes: timer.minutes ?? null };
  else if (wantsTimer) result.timerMissing = true;
  result.normalized = full;
  return result;
}

function parseCommand(t) {
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

module.exports = { parseVoice, parseTimer, resolveDevice, strip };
