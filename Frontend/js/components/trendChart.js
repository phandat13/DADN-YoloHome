import { THRESHOLDS } from '../config.js';
import { hhmm } from '../utils/fields.js';
import { emptyState } from '../ui.js';

// Biểu đồ 24 giờ vẽ từ GET /iot/sensors/:sensorId/records + điểm mới từ sensor_update.
const W = 500, TOP = 30, BOTTOM = 165, SPAN = 864e5, BUCKETS = 96;   // 96 nhóm × 15 phút

// Gom điểm theo khoảng 15 phút (lấy trung bình) để biểu đồ gọn khi BE trả nhiều bản ghi.
function bucketize(points, start, end) {
  const size = (end - start) / BUCKETS;
  const sum = new Array(BUCKETS).fill(0), cnt = new Array(BUCKETS).fill(0);
  for (const p of points) {
    if (p.ts < start || p.ts > end || !Number.isFinite(p.value)) continue;
    const i = Math.min(BUCKETS - 1, Math.floor((p.ts - start) / size));
    sum[i] += p.value; cnt[i]++;
  }
  return sum.map((s, i) => (cnt[i] ? { ts: start + (i + 0.5) * size, value: s / cnt[i] } : null)).filter(Boolean);
}

function rangeOf(points, [lo, hi]) {
  if (!points.length) return [lo, hi];
  const vals = points.map((p) => p.value);
  return [Math.min(lo, Math.floor(Math.min(...vals) - 2)), Math.max(hi, Math.ceil(Math.max(...vals) + 2))];
}

const yOf = (v, [min, max]) => BOTTOM - ((v - min) / (max - min)) * (BOTTOM - TOP);

// Làm mượt đường bằng quadratic Bézier qua trung điểm
function smoothPath(pts) {
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], c = pts[i];
    d += ` Q${p.x.toFixed(1)},${p.y.toFixed(1)} ${((p.x + c.x) / 2).toFixed(1)},${((p.y + c.y) / 2).toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${last.x.toFixed(1)},${last.y.toFixed(1)}`;
}

function series(pts, color, width) {
  if (!pts.length) return '';
  if (pts.length === 1) return `<circle cx="${pts[0].x}" cy="${pts[0].y}" r="3" fill="${color}"/>`;
  return `<path d="${smoothPath(pts)}" fill="none" stroke="${color}" stroke-linecap="round" stroke-width="${width}" vector-effect="non-scaling-stroke"/>`;
}

const legend = (dot, text, cls = 'text-slate-600') =>
  `<div class="flex items-center gap-1.5">${dot}<span class="${cls}">${text}</span></div>`;

const header = () => `
  <div class="flex flex-wrap items-center justify-between gap-3 pb-3">
    <div>
      <h2 class="text-base font-bold text-slate-900 font-['Space_Grotesk']">Xu hướng 24 Giờ</h2>
      <p class="text-xs text-slate-400">Lịch sử từ API records, cập nhật trực tiếp qua Socket.IO</p>
    </div>
    <div class="flex items-center gap-4 text-xs font-medium">
      ${legend('<span class="w-2.5 h-2.5 rounded-full bg-sky-500"></span>', 'Nhiệt độ (°C)')}
      ${legend('<span class="w-2.5 h-2.5 rounded-full bg-teal-500"></span>', 'Độ ẩm (%)')}
      ${legend('<span class="w-3 border-b-2 border-dashed border-rose-400"></span>', `Ngưỡng ${THRESHOLDS.TEMP_MAX}°C`, 'text-rose-600 font-semibold')}
    </div>
  </div>`;

export function renderTrendChart(el, history) {
  const all = [...history.temperature, ...history.humidity];
  if (!all.length) {
    el.innerHTML = header() + emptyState('show_chart', 'Chưa có dữ liệu lịch sử',
      'Biểu đồ sẽ hiển thị khi cảm biến nhiệt độ/độ ẩm có bản ghi (records) hoặc khi nhận được sensor_update.');
    return;
  }
  const now = Date.now();
  const latest = all.reduce((m, p) => Math.max(m, p.ts), 0);
  const end = latest < now - SPAN ? latest : now;          // không có dữ liệu 24h gần nhất → lùi về mốc cuối
  const start = end - SPAN;
  const temp = bucketize(history.temperature, start, end);
  const hum = bucketize(history.humidity, start, end);
  const tRange = rangeOf(temp, [20, 40]);
  const hRange = rangeOf(hum, [40, 100]);
  const xOf = (ts) => ((ts - start) / SPAN) * W;
  const tempPts = temp.map((p) => ({ x: xOf(p.ts), y: yOf(p.value, tRange) }));
  const humPts = hum.map((p) => ({ x: xOf(p.ts), y: yOf(p.value, hRange) }));

  let peak = '';
  if (temp.length) {
    const i = temp.reduce((best, p, idx) => (p.value > temp[best].value ? idx : best), 0);
    const pt = tempPts[i];
    peak = `<circle cx="${pt.x}" cy="${pt.y}" r="4" fill="#0284c7"/>
      <circle cx="${pt.x}" cy="${pt.y}" r="8" fill="#0284c7" opacity="0.3"/>
      <text fill="#0f172a" font-family="Space Grotesk" font-size="10" font-weight="700" text-anchor="middle" x="${Math.min(W - 20, Math.max(20, pt.x))}" y="${pt.y - 10}">${temp[i].value.toFixed(1)}°C</text>`;
  }
  const yThreshold = yOf(THRESHOLDS.TEMP_MAX, tRange);
  const grid = [30, 75, 120].map((y) => `<line stroke="#f1f5f9" stroke-width="1" x1="0" x2="${W}" y1="${y}" y2="${y}"/>`).join('');
  const isNow = end === now;
  const ticks = Array.from({ length: 7 }, (_, i) => {
    const ts = start + (i * SPAN) / 6;
    return i === 6 && isNow ? '<span class="text-sky-600 font-semibold">Hiện tại</span>' : `<span>${hhmm(ts)}</span>`;
  }).join('');

  el.innerHTML = `${header()}
    <div class="relative w-full h-56 my-2">
      <svg class="w-full h-full" preserveAspectRatio="none" viewBox="0 0 ${W} 180">
        ${grid}
        <line stroke="#e2e8f0" stroke-width="1" x1="0" x2="${W}" y1="${BOTTOM}" y2="${BOTTOM}"/>
        ${yThreshold >= TOP && yThreshold <= BOTTOM ? `
          <line stroke="#f87171" stroke-dasharray="4 4" stroke-width="1.2" x1="0" x2="${W}" y1="${yThreshold}" y2="${yThreshold}"/>
          <text fill="#ef4444" font-family="Plus Jakarta Sans" font-size="9" font-weight="600" text-anchor="end" x="${W - 5}" y="${yThreshold - 5}">Ngưỡng ${THRESHOLDS.TEMP_MAX}°C</text>` : ''}
        ${series(humPts, '#14b8a6', 2)}
        ${series(tempPts, '#0284c7', 2.5)}
        ${peak}
      </svg>
    </div>
    <div class="flex items-center justify-between text-slate-400 font-mono text-[11px] pt-1">${ticks}</div>
    ${isNow ? '' : `<p class="text-[11px] text-amber-600 mt-2">Không có dữ liệu trong 24 giờ qua — đang hiển thị 24 giờ trước bản ghi cuối (${new Date(end).toLocaleString('vi-VN')}).</p>`}`;
}
