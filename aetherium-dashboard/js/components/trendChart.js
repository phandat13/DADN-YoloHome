import { THRESHOLDS } from '../config.js';

const W = 500, TOP = 30, BOTTOM = 165;
const TEMP_RANGE = [20, 40];
const HUM_RANGE = [40, 100];
const TIME_LABELS = ['00:00', '04:00', '08:00', '12:00', '14:30 (Hiện tại)', '20:00', '24:00'];

const yOf = (v, [min, max]) => BOTTOM - ((v - min) / (max - min)) * (BOTTOM - TOP);

function toPoints(values, range) {
  return values.map((v, i) => ({ x: (i / (values.length - 1)) * W, y: yOf(v, range) }));
}

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

const legend = (dot, text, extra = '') =>
  `<div class="flex items-center gap-1.5">${dot}<span class="text-slate-600 ${extra}">${text}</span></div>`;

export function renderTrendChart(el, history) {
  const tempPts = toPoints(history.temperature, TEMP_RANGE);
  const humPts = toPoints(history.humidity, HUM_RANGE);
  const peakIdx = history.temperature.indexOf(Math.max(...history.temperature));
  const peak = tempPts[peakIdx];
  const peakVal = history.temperature[peakIdx];
  const yThreshold = yOf(THRESHOLDS.TEMP_MAX, TEMP_RANGE);
  const grid = [30, 75, 120].map(y => `<line stroke="#f1f5f9" stroke-width="1" x1="0" x2="${W}" y1="${y}" y2="${y}"/>`).join('');

  el.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3 pb-3">
      <div>
        <h2 class="text-base font-bold text-slate-900 font-['Space_Grotesk']">Xu hướng 24 Giờ</h2>
        <p class="text-xs text-slate-400">Chu kỳ cập nhật 30s từ cảm biến nhiệt độ &amp; độ ẩm</p>
      </div>
      <div class="flex items-center gap-4 text-xs font-medium">
        ${legend('<span class="w-2.5 h-2.5 rounded-full bg-sky-500"></span>', 'Nhiệt độ (°C)')}
        ${legend('<span class="w-2.5 h-2.5 rounded-full bg-teal-500"></span>', 'Độ ẩm (%)')}
        ${legend('<span class="w-3 border-b-2 border-dashed border-rose-400"></span>', `Ngưỡng ${THRESHOLDS.TEMP_MAX}°C`).replace('text-slate-600', 'text-rose-600 font-semibold')}
      </div>
    </div>
    <div class="relative w-full h-56 my-2">
      <svg class="w-full h-full" preserveAspectRatio="none" viewBox="0 0 ${W} 180">
        ${grid}
        <line stroke="#e2e8f0" stroke-width="1" x1="0" x2="${W}" y1="${BOTTOM}" y2="${BOTTOM}"/>
        <line stroke="#f87171" stroke-dasharray="4 4" stroke-width="1.2" x1="0" x2="${W}" y1="${yThreshold}" y2="${yThreshold}"/>
        <text fill="#ef4444" font-family="Plus Jakarta Sans" font-size="9" font-weight="600" text-anchor="end" x="${W - 5}" y="${yThreshold - 5}">Ngưỡng ${THRESHOLDS.TEMP_MAX}°C</text>
        <path d="${smoothPath(humPts)}" fill="none" stroke="#14b8a6" stroke-linecap="round" stroke-width="2"/>
        <path d="${smoothPath(tempPts)}" fill="none" stroke="#0284c7" stroke-linecap="round" stroke-width="2.5"/>
        <circle cx="${peak.x}" cy="${peak.y}" r="4" fill="#0284c7"/>
        <circle cx="${peak.x}" cy="${peak.y}" r="8" fill="#0284c7" opacity="0.3"/>
        <text fill="#0f172a" font-family="Space Grotesk" font-size="10" font-weight="700" text-anchor="middle" x="${peak.x}" y="${peak.y - 10}">${peakVal}°C</text>
      </svg>
    </div>
    <div class="flex items-center justify-between text-slate-400 font-mono text-[11px] pt-1">
      ${TIME_LABELS.map(t => t.includes('Hiện tại') ? `<span class="text-sky-600 font-semibold">${t}</span>` : `<span>${t}</span>`).join('')}
    </div>`;
}
