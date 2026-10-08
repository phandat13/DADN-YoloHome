import { DEVICE, THRESHOLDS, TIMING } from '../config.js';
import { formatDate, formatTime } from '../services/syncService.js';

const show = (v, digits) => (v == null ? '--' : digits == null ? v : Number(v).toFixed(digits));

export function renderLcdPanel(el, s, live = false) {
  const now = new Date();
  el.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-[20px] text-sky-600">developer_board</span>
          <span class="font-bold text-slate-900 text-sm font-['Space_Grotesk']">Màn hình LCD 16x2</span>
        </div>
        <span class="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-100 text-slate-600">I2C: ${DEVICE.lcdAddress}</span>
      </div>

      <div class="p-3.5 rounded-lg bg-teal-50 border border-teal-200/70 shadow-inner">
        <div class="flex items-center justify-between text-[10px] text-teal-700/70 uppercase font-mono font-bold tracking-wider mb-1.5">
          <span>LCD Matrix Dot 5x8</span>
          <span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full ${live ? 'bg-teal-500' : 'bg-slate-400'}"></span>${live ? 'Live' : 'Offline'}</span>
        </div>
        <div class="bg-teal-900/90 text-teal-200 font-mono text-xs sm:text-sm p-3 rounded tracking-wider leading-relaxed shadow-sm">
          <div class="flex justify-between font-bold">
            <span>${show(s.temperature, 1)}C</span><span>${show(s.humidity, 0)}%</span><span>${show(s.light)}L</span>
          </div>
          <div class="flex justify-between text-[11px] text-teal-300/80 font-medium pt-1">
            <span>${formatDate(now)}</span><span id="lcd-clock">${formatTime(now)}</span><span class="text-teal-400">${live ? 'NTP OK' : 'NO LINK'}</span>
          </div>
        </div>
      </div>

      <div class="p-3 rounded-lg bg-rose-50 border border-rose-100 flex items-start gap-2.5">
        <span class="material-symbols-outlined text-rose-500 text-[18px] mt-0.5">warning</span>
        <div class="text-xs">
          <span class="font-semibold text-rose-800">Cảnh báo tự động</span>
          <p class="text-rose-700/90 mt-0.5">Cảnh báo &amp; bật quạt 100% (chế độ tự động) khi nhiệt độ &gt; ${THRESHOLDS.TEMP_MAX}°C</p>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-3 gap-2 pt-4 border-t border-slate-100 mt-4">
      ${[['Làm mới', `${TIMING.SYNC_INTERVAL_S}s`], ['NTP Sync', `${TIMING.NTP_SYNC_S}s`], ['Quét PIR', `${TIMING.PIR_SCAN_S}s`]]
        .map(([k, v]) => `
        <div class="p-2 rounded-lg bg-slate-50 text-center">
          <span class="block text-[10px] text-slate-400 uppercase font-semibold">${k}</span>
          <span class="font-mono text-xs font-bold text-slate-700">${v}</span>
        </div>`).join('')}
    </div>`;
}


