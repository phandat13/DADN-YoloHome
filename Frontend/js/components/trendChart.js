// Biểu đồ xu hướng TỰ VẼ từ dữ liệu cảm biến (GET /iot/sensors/:id/records + sự kiện sensor_update).
// - Khung thời gian tự co giãn theo khoảng dữ liệu thật ("Tự động"), hoặc chọn 1 / 6 / 24 giờ.
// - Mỗi đại lượng một biểu đồ nhỏ với thang đo riêng (nhiệt độ, độ ẩm, ánh sáng), dùng chung trục thời gian
//   — không vẽ °C và % chồng lên nhau trên 2 thang đo khác nhau vì rất dễ đọc nhầm.
// - Rê chuột (hoặc Tab + phím ←/→) để xem giá trị cả 3 đại lượng tại một thời điểm.
import { THRESHOLDS } from '../config.js';
import { esc } from '../utils/fields.js';
import { segmented, emptyState } from '../ui.js';

// Màu đã kiểm tra: tách biệt cho người mù màu và đủ tương phản trên nền trắng.
const SERIES = [
  { key: 'temperature', label: 'Nhiệt độ', unit: '°C', color: '#ea580c', digits: 1,
    ref: () => ({ line: THRESHOLDS.TEMP_MAX, text: `Ngưỡng ${THRESHOLDS.TEMP_MAX}°C` }) },
  { key: 'humidity', label: 'Độ ẩm', unit: '%', color: '#0284c7', digits: 0,
    ref: () => ({ band: [THRESHOLDS.HUMIDITY_MIN, THRESHOLDS.HUMIDITY_MAX], text: `Chuẩn ${THRESHOLDS.HUMIDITY_MIN}–${THRESHOLDS.HUMIDITY_MAX}%` }) },
  { key: 'light', label: 'Ánh sáng', unit: 'Lux', color: '#a16207', digits: 0,
    ref: () => ({ line: THRESHOLDS.LIGHT_MIN, text: `Tối thiểu ${THRESHOLDS.LIGHT_MIN} Lux` }) },
];

const RANGES = [['auto', 'Tự động'], ['1h', '1 giờ'], ['6h', '6 giờ'], ['24h', '24 giờ']];
const RANGE_MS = { '1h': 36e5, '6h': 216e5, '24h': 864e5 };
const MIN_SPAN = 10 * 60e3;          // dữ liệu quá ngắn vẫn hiển thị ít nhất 10 phút
const MAX_SPAN = 864e5;              // Frontend tải tối đa 24 giờ gần nhất
const MAX_POINTS = 240;              // nhiều hơn thì gom trung bình theo khoảng để đường gọn, không răng cưa
const LS_KEY = 'yolohome.chartRange';

const M = { left: 46, right: 70, top: 26 };
const PANEL_H = 88, PANEL_GAP = 40, AXIS_H = 22;
const INK = { primary: '#0f172a', secondary: '#475569', muted: '#94a3b8', grid: '#eef2f6', band: '#f1f5f9', ref: '#e11d48' };

let range = (() => { try { return localStorage.getItem(LS_KEY) || 'auto'; } catch { return 'auto'; } })();
if (!RANGES.some(([k]) => k === range)) range = 'auto';

// ---------- tiện ích ----------
const pad = (n) => String(n).padStart(2, '0');
const hm = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const hms = (ts) => { const d = new Date(ts); return `${hm(ts)}:${pad(d.getSeconds())}`; };
const dmhms = (ts) => { const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${hms(ts)}`; };
const dm = (ts) => { const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
// "08/10 00:16 – 09/10 00:16" khi khác ngày, "23:10 – 00:15" khi trong cùng ngày
const rangeLabel = (a, b) => (dm(a) === dm(b) ? `${hm(a)} – ${hm(b)}` : `${dm(a)} ${hm(a)} – ${dm(b)} ${hm(b)}`);
const fmt = (v, digits) => Number(v).toFixed(digits);
const withUnit = (s, v) => `${fmt(v, s.digits)}${s.unit === '°C' || s.unit === '%' ? '' : ' '}${s.unit}`;
const durationText = (ms) => {
  const min = Math.round(ms / 60e3);
  if (min < 60) return `${min} phút`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
};

const bucketText = (ms) => (ms < 60e3 ? `${Math.max(1, Math.round(ms / 1000))} giây` : durationText(ms));

// Gom điểm theo n khoảng đều nhau (trung bình); trả mảng n phần tử, khoảng trống là null.
function bucketize(points, start, end, n) {
  const size = (end - start) / n;
  const sum = new Array(n).fill(0), cnt = new Array(n).fill(0);
  for (const p of points) {
    if (p.ts < start || p.ts > end) continue;
    const i = Math.min(n - 1, Math.floor((p.ts - start) / size));
    sum[i] += p.value; cnt[i]++;
  }
  return sum.map((s, i) => (cnt[i] ? { ts: start + (i + 0.5) * size, value: s / cnt[i] } : null));
}

function pointsInWindow(all, start, end) {
  const pts = (all ?? []).filter((p) => p.ts >= start && p.ts <= end && Number.isFinite(p.value)).sort((a, b) => a.ts - b.ts);
  return pts.length <= MAX_POINTS ? pts : bucketize(pts, start, end, MAX_POINTS).filter(Boolean);
}

// Khoảng cách thời gian coi là "mất dữ liệu" -> ngắt đường thay vì nối thẳng qua chỗ trống.
function gapLimit(pts, span) {
  if (pts.length < 3) return Infinity;
  const d = [];
  for (let i = 1; i < pts.length; i++) d.push(pts[i].ts - pts[i - 1].ts);
  d.sort((a, b) => a - b);
  return Math.max(d[Math.floor(d.length / 2)] * 4, span / 40, 2 * 60e3);
}

function splitSegments(pts, limit) {
  const segs = [];
  let cur = [];
  for (const p of pts) {
    if (cur.length && p.ts - cur[cur.length - 1].ts > limit) { segs.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length) segs.push(cur);
  return segs;
}

const niceStep = (x) => {
  const e = Math.floor(Math.log10(x)), f = x / 10 ** e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * 10 ** e;
};

// Thang đo Y gồm cả dữ liệu lẫn mốc tham chiếu (ngưỡng / khoảng chuẩn), làm tròn số đẹp.
function yScale(pts, ref) {
  const vals = pts.map((p) => p.value).concat(ref.line != null ? [ref.line] : ref.band ?? []);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const step = niceStep((hi - lo) / 3);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi, ticks, step };
}

const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720].map((m) => m * 60e3);
function timeTicks(start, end, maxTicks) {
  const step = TIME_STEPS.find((s) => (end - start) / s <= maxTicks) ?? TIME_STEPS[TIME_STEPS.length - 1];
  const off = -new Date(start).getTimezoneOffset() * 60e3;          // canh mốc theo giờ địa phương
  const ticks = [];
  for (let t = Math.ceil((start + off) / step) * step - off; t <= end; t += step) ticks.push(t);
  return ticks;
}

// Khung thời gian: chọn sẵn (1/6/24 giờ) hoặc tự động theo dữ liệu có trong 24 giờ gần nhất.
function computeWindow(history, now) {
  if (range !== 'auto') return { start: now - RANGE_MS[range], end: now, auto: false };
  let first = Infinity, last = -Infinity;
  for (const s of SERIES) {
    for (const p of history[s.key] ?? []) {
      if (p.ts < now - MAX_SPAN || p.ts > now + 60e3 || !Number.isFinite(p.value)) continue;
      if (p.ts < first) first = p.ts;
      if (p.ts > last) last = p.ts;
    }
  }
  if (!Number.isFinite(first)) return null;
  const end = now - last < 15 * 60e3 ? Math.max(now, last) : last;   // dữ liệu còn mới thì neo ở "bây giờ"
  let start = Math.min(first, end - MIN_SPAN);
  start = Math.max(start - (end - start) * 0.02, end - MAX_SPAN);   // chừa lề trái, không vượt 24 giờ
  return { start, end, auto: true };
}

// ---------- vẽ ----------
function buildSvg(panels, win, width) {
  const plotW = Math.max(120, width - M.left - M.right);
  const span = win.end - win.start;
  const x = (ts) => M.left + ((ts - win.start) / span) * plotW;
  const bottom = M.top + panels.length * (PANEL_H + PANEL_GAP) - PANEL_GAP;
  const height = bottom + AXIS_H + 4;
  const tTicks = timeTicks(win.start, win.end, Math.max(3, Math.floor(plotW / 64)));
  const parts = [];

  panels.forEach((p, i) => {
    const top = M.top + i * (PANEL_H + PANEL_GAP);
    const ref = p.ref();
    const sc = yScale(p.pts, ref);
    const y = (v) => top + PANEL_H - ((v - sc.lo) / (sc.hi - sc.lo)) * PANEL_H;
    Object.assign(p, { top, y, sc });
    const vals = p.pts.map((q) => q.value);
    const last = p.pts[p.pts.length - 1];

    // Tiêu đề nhỏ: khoá màu + tên + thấp nhất / cao nhất trong khung
    parts.push(`<line x1="${M.left}" x2="${M.left + 14}" y1="${top - 14}" y2="${top - 14}" stroke="${p.color}" stroke-width="2" stroke-linecap="round"/>`);
    parts.push(`<text x="${M.left + 20}" y="${top - 10}" font-size="12"><tspan font-weight="600" fill="${INK.primary}">${esc(p.label)} (${esc(p.unit)})</tspan><tspan dx="10" fill="${INK.muted}">thấp nhất ${fmt(Math.min(...vals), p.digits)} · cao nhất ${fmt(Math.max(...vals), p.digits)}</tspan></text>`);

    // Khoảng chuẩn (nền nhạt) + lưới ngang + nhãn trục Y
    if (ref.band) {
      const [b0, b1] = ref.band.map(y);
      parts.push(`<rect x="${M.left}" y="${Math.min(b0, b1)}" width="${plotW}" height="${Math.abs(b0 - b1)}" fill="${INK.band}"/>`);
      parts.push(`<text x="${M.left + plotW - 4}" y="${Math.min(b0, b1) + 11}" text-anchor="end" font-size="10" fill="${INK.muted}">${esc(ref.text)}</text>`);
    }
    for (const t of sc.ticks) {
      parts.push(`<line x1="${M.left}" x2="${M.left + plotW}" y1="${y(t)}" y2="${y(t)}" stroke="${INK.grid}" stroke-width="1"/>`);
      parts.push(`<text x="${M.left - 6}" y="${y(t) + 3.5}" text-anchor="end" font-size="10" fill="${INK.muted}" class="font-mono-num">${fmt(t, sc.step < 1 ? 1 : 0)}</text>`);
    }
    for (const t of tTicks) parts.push(`<line x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${top + PANEL_H}" stroke="${INK.grid}" stroke-width="1"/>`);

    // Ngưỡng cảnh báo (nét đứt + chữ, không chỉ dựa vào màu)
    if (ref.line != null) {
      parts.push(`<line x1="${M.left}" x2="${M.left + plotW}" y1="${y(ref.line)}" y2="${y(ref.line)}" stroke="${INK.ref}" stroke-width="1.2" stroke-dasharray="4 4"/>`);
      parts.push(`<text x="${M.left + plotW - 4}" y="${y(ref.line) - 4}" text-anchor="end" font-size="10" font-weight="600" fill="${INK.secondary}">${esc(ref.text)}</text>`);
    }

    // Đường dữ liệu: ngắt tại chỗ mất dữ liệu, nền màu nhạt 10%
    const limit = gapLimit(p.pts, span);
    for (const seg of splitSegments(p.pts, limit)) {
      if (seg.length === 1) {
        parts.push(`<circle cx="${x(seg[0].ts)}" cy="${y(seg[0].value)}" r="3" fill="${p.color}"/>`);
        continue;
      }
      const d = seg.map((q, k) => `${k ? 'L' : 'M'}${x(q.ts).toFixed(1)},${y(q.value).toFixed(1)}`).join(' ');
      parts.push(`<path d="${d} L${x(seg[seg.length - 1].ts).toFixed(1)},${top + PANEL_H} L${x(seg[0].ts).toFixed(1)},${top + PANEL_H} Z" fill="${p.color}" fill-opacity="0.1"/>`);
      parts.push(`<path d="${d}" fill="none" stroke="${p.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
    p.limit = limit;

    // Điểm cuối + giá trị mới nhất ở cuối đường
    parts.push(`<circle cx="${x(last.ts)}" cy="${y(last.value)}" r="4" fill="${p.color}" stroke="#fff" stroke-width="2"/>`);
    parts.push(`<text x="${x(last.ts) + 9}" y="${y(last.value) + 4}" font-size="11" font-weight="700" fill="${INK.primary}" class="font-mono-num">${esc(withUnit(p, last.value))}</text>`);
  });

  // Trục thời gian chung
  for (const t of tTicks) {
    parts.push(`<text x="${x(t)}" y="${bottom + 16}" text-anchor="middle" font-size="10" fill="${INK.muted}" class="font-mono-num">${span <= 15 * 60e3 ? hms(t) : hm(t)}</text>`);
  }

  // Lớp tương tác: đường dọc + chấm trên từng biểu đồ
  parts.push(`<g data-role="cross" visibility="hidden">
    <line data-role="cross-line" y1="${M.top - 6}" y2="${bottom}" stroke="${INK.secondary}" stroke-width="1"/>
    ${panels.map((p, i) => `<circle data-role="cross-dot" data-i="${i}" r="4" fill="${p.color}" stroke="#fff" stroke-width="2"/>`).join('')}
  </g>`);
  parts.push(`<rect data-role="hit" x="${M.left}" y="${M.top - 20}" width="${plotW}" height="${bottom - M.top + 20}" fill="transparent"/>`);

  const svg = `<svg data-role="svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" tabindex="0" role="img"
      aria-label="Biểu đồ xu hướng ${esc(panels.map((p) => p.label).join(', '))} từ ${hm(win.start)} đến ${hm(win.end)}"
      style="display:block;outline:none;font-family:inherit">${parts.join('')}</svg>`;
  return { svg, x, plotW, height };
}

// Điểm gần thời điểm t nhất (tìm nhị phân trên mảng đã sắp xếp)
function nearest(pts, t) {
  let lo = 0, hi = pts.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid].ts < t) lo = mid + 1; else hi = mid; }
  const a = pts[lo], b = pts[lo - 1];
  return b && Math.abs(b.ts - t) < Math.abs(a.ts - t) ? b : a;
}

function renderTable(body, panels, win) {
  const n = Math.min(60, Math.max(...panels.map((p) => p.pts.length)));
  const cols = panels.map((p) => bucketize(p.pts, win.start, win.end, n));
  const rows = [];
  for (let i = n - 1; i >= 0; i--) {
    if (!cols.some((c) => c[i])) continue;
    const ts = cols.find((c) => c[i])[i].ts;
    rows.push(`<tr class="border-b border-slate-50"><td class="py-1.5 pr-4 font-mono text-xs text-slate-500 whitespace-nowrap">${dmhms(ts)}</td>${
      panels.map((p, k) => `<td class="py-1.5 pr-4 text-right font-mono text-xs text-slate-700">${cols[k][i] ? esc(fmt(cols[k][i].value, p.digits)) : '—'}</td>`).join('')}</tr>`);
  }
  body.innerHTML = `<table class="w-full text-sm"><thead><tr class="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
      <th class="py-1.5 pr-4 font-semibold">Thời gian</th>${panels.map((p) => `<th class="py-1.5 pr-4 font-semibold text-right">${esc(p.label)} (${esc(p.unit)})</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody></table>
    <p class="text-[11px] text-slate-400 mt-2">Giá trị trung bình theo từng khoảng ${bucketText((win.end - win.start) / n)}.</p>`;
}

function setup(el) {
  el.innerHTML = `
    <div class="flex flex-wrap items-start justify-between gap-3 pb-2">
      <div>
        <h2 class="text-base font-bold text-slate-900 font-['Space_Grotesk']">Xu hướng cảm biến</h2>
        <p data-role="subtitle" class="text-xs text-slate-400"></p>
      </div>
      <div data-role="ranges"></div>
    </div>
    <div data-role="plot" class="relative w-full min-h-[120px]"></div>
    <details data-role="table" class="mt-2">
      <summary class="text-[11px] font-semibold text-slate-400 cursor-pointer hover:text-slate-600">Bảng số liệu</summary>
      <div data-role="table-body" class="mt-2 max-h-64 overflow-auto"></div>
    </details>`;
  const q = (r) => el.querySelector(`[data-role="${r}"]`);
  const c = { root: el.firstElementChild, history: null, plot: q('plot'), tip: null, view: null };

  c.draw = () => {
    const history = c.history ?? {};
    const now = Date.now();
    q('ranges').innerHTML = segmented(RANGES, range, 'trend-range');
    const win = computeWindow(history, now);
    const panels = win ? SERIES.map((s) => ({ ...s, pts: pointsInWindow(history[s.key], win.start, win.end) })).filter((p) => p.pts.length) : [];
    q('table').classList.toggle('hidden', !panels.length);
    c.view = null;

    if (!panels.length) {
      q('subtitle').textContent = '';
      c.plot.innerHTML = win || range === 'auto'
        ? emptyState('show_chart', range === 'auto' ? 'Chưa có dữ liệu cảm biến trong 24 giờ qua' : `Không có dữ liệu trong ${RANGES.find(([k]) => k === range)[1]} qua`,
          range === 'auto' ? 'Biểu đồ tự vẽ khi cảm biến gửi số liệu (Gateway → Adafruit IO → Backend) hoặc khi gửi giá trị thử ở trang Cài đặt.' : 'Chọn "Tự động" để xem toàn bộ dữ liệu đã có.')
        : '';
      return;
    }

    const count = panels.reduce((n, p) => n + p.pts.length, 0);
    const missing = SERIES.filter((s) => !panels.some((p) => p.key === s.key)).map((s) => s.label.toLowerCase());
    q('subtitle').textContent = `${win.auto ? 'Tự co giãn theo dữ liệu' : 'Khung cố định'}: ${rangeLabel(win.start, win.end)} (${durationText(win.end - win.start)}) · ${count} điểm`
      + (missing.length ? ` · chưa có dữ liệu ${missing.join(', ')}` : '');

    const width = Math.floor(c.plot.clientWidth) || 640;
    const { svg, x } = buildSvg(panels, win, width);
    c.plot.innerHTML = `${svg}<div data-role="tip" class="pointer-events-none absolute z-10 hidden min-w-[150px] rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg"></div>`;
    c.tip = c.plot.querySelector('[data-role="tip"]');
    const times = [...new Set(panels.flatMap((p) => p.pts.map((pt) => pt.ts)))].sort((a, b) => a - b);
    c.view = { panels, win, x, width, times, idx: times.length - 1 };
    if (q('table').open) renderTable(q('table-body'), panels, win);
  };

  // Hiện giá trị tại mốc thời gian thứ idx (cả 3 đại lượng)
  c.show = (idx) => {
    const v = c.view;
    if (!v || !v.times.length) return;
    v.idx = Math.max(0, Math.min(v.times.length - 1, idx));
    const t = v.times[v.idx];
    const svg = c.plot.querySelector('[data-role="svg"]');
    const cross = svg.querySelector('[data-role="cross"]');
    const cx = v.x(t);
    cross.querySelector('[data-role="cross-line"]').setAttribute('x1', cx);
    cross.querySelector('[data-role="cross-line"]').setAttribute('x2', cx);
    cross.setAttribute('visibility', 'visible');

    const tol = Math.max(((v.win.end - v.win.start) / v.width) * 16, 60e3);
    const tip = c.tip;
    tip.replaceChildren();
    const head = document.createElement('div');
    head.className = 'font-mono text-[11px] text-slate-500 mb-1';
    head.textContent = dmhms(t);
    tip.appendChild(head);
    v.panels.forEach((p, i) => {
      const pt = nearest(p.pts, t);
      const ok = pt && Math.abs(pt.ts - t) <= tol;
      const dot = cross.querySelector(`[data-role="cross-dot"][data-i="${i}"]`);
      dot.setAttribute('visibility', ok ? 'visible' : 'hidden');
      if (ok) { dot.setAttribute('cx', v.x(pt.ts)); dot.setAttribute('cy', p.y(pt.value)); }
      const row = document.createElement('div');
      row.className = 'flex items-center gap-2 py-0.5';
      const key = document.createElement('span');
      key.style.cssText = `display:inline-block;width:12px;height:2px;border-radius:1px;background:${p.color}`;
      const val = document.createElement('b');
      val.className = 'font-mono text-slate-900';
      val.textContent = ok ? withUnit(p, pt.value) : '—';
      const name = document.createElement('span');
      name.className = 'text-slate-500';
      name.textContent = p.label;
      row.append(key, val, name);
      tip.appendChild(row);
    });
    tip.classList.remove('hidden');
    const w = tip.offsetWidth || 160;
    tip.style.left = `${cx + 14 + w > v.width ? cx - 14 - w : cx + 14}px`;
    tip.style.top = `${M.top - 6}px`;
  };

  c.hide = () => {
    c.plot.querySelector('[data-role="cross"]')?.setAttribute('visibility', 'hidden');
    c.tip?.classList.add('hidden');
  };

  // --- sự kiện (gắn 1 lần, phần tử con được vẽ lại) ---
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="trend-range"]');
    if (!b) return;
    range = b.dataset.val;
    try { localStorage.setItem(LS_KEY, range); } catch {}
    c.draw();
  });
  c.plot.addEventListener('pointermove', (e) => {
    const v = c.view;
    if (!v || !e.target.closest('[data-role="svg"]')) return;
    const rect = c.plot.querySelector('[data-role="svg"]').getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < M.left - 8 || px > v.width - M.right + 8) return c.hide();
    const t = v.win.start + ((px - M.left) / (v.width - M.left - M.right)) * (v.win.end - v.win.start);
    let lo = 0, hi = v.times.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (v.times[mid] < t) lo = mid + 1; else hi = mid; }
    c.show(lo > 0 && Math.abs(v.times[lo - 1] - t) < Math.abs(v.times[lo] - t) ? lo - 1 : lo);
  });
  c.plot.addEventListener('pointerleave', c.hide);
  c.plot.addEventListener('focusin', () => c.view && c.show(c.view.idx));
  c.plot.addEventListener('focusout', c.hide);
  c.plot.addEventListener('keydown', (e) => {
    if (!c.view) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      c.show(c.view.idx + (e.key === 'ArrowLeft' ? -1 : 1));
    } else if (e.key === 'Escape') c.hide();
  });
  q('table').addEventListener('toggle', () => {
    if (q('table').open && c.view) renderTable(q('table-body'), c.view.panels, c.view.win);
  });

  // Vẽ lại theo chiều rộng thật (chữ và điểm không bị kéo méo)
  let lastW = 0, raf = 0;
  const ro = new ResizeObserver(() => {
    if (!el.isConnected) { ro.disconnect(); return; }
    const w = Math.floor(c.plot.clientWidth);
    if (w && Math.abs(w - lastW) > 2) {
      lastW = w;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(c.draw);
    }
  });
  ro.observe(c.plot);
  return c;
}

export function renderTrendChart(el, history) {
  let c = el._trend;
  if (!c || !el.contains(c.root)) c = el._trend = setup(el);
  c.history = history;
  c.draw();
}