import { TIMING } from '../config.js';

export function renderPageHeader(el) {
  el.innerHTML = `
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-slate-900 font-['Space_Grotesk']">Giám sát Môi trường</h1>
      <p class="text-sm text-slate-500 mt-0.5">Dữ liệu thời gian thực qua Socket.IO (<span class="font-mono">sensor_update</span>) từ cảm biến Yolo:Bit</p>
    </div>
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-slate-200 shadow-sm text-xs text-slate-600 font-medium">
        <span class="material-symbols-outlined text-[16px] text-slate-400 animate-spin" style="animation-duration: 4s;">sync</span>
        <span>Làm mới sau: <strong class="font-mono text-slate-900 font-semibold" id="sync-timer">${TIMING.SYNC_INTERVAL_S}s</strong></span>
      </div>
      <button id="manual-sync-btn" type="button" class="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 active:scale-95 text-white font-medium text-xs shadow-sm transition-all">
        <span class="material-symbols-outlined text-[16px]">sync</span>
        <span>Đồng bộ ngay</span>
      </button>
    </div>`;
}
