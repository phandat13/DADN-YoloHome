import { DEVICE } from '../config.js';

export function renderStatusBar(el, s, alerts = []) {
  const safe = alerts.length === 0;
  el.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="w-2.5 h-2.5 rounded-full ${safe ? 'bg-emerald-500' : 'bg-rose-500'}"></span>
      <span class="font-semibold text-slate-800">${safe ? 'Tất cả thông số an toàn' : 'Có thông số vượt ngưỡng'}</span>
      <span class="text-slate-400 hidden sm:inline">• ${safe ? 'Không có cảnh báo bất thường nào' : 'Kiểm tra cảnh báo ngay'}</span>
    </div>
    <div class="flex flex-wrap items-center gap-4 text-slate-500">
      <span class="flex items-center gap-1.5">
        <span class="material-symbols-outlined text-[16px] text-sky-600">hub</span>
        <strong class="text-slate-700 font-medium">${s.nodes.online}/${s.nodes.total}</strong> Node kết nối
      </span>
      <span class="text-slate-300">•</span>
      <span class="flex items-center gap-1.5">
        <span class="material-symbols-outlined text-[16px] text-teal-600">mode_fan</span>
        Quạt &amp; Còi: <span class="text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded">${s.controlMode}</span>
      </span>
      <span class="text-slate-300">•</span>
      <span class="font-mono text-[11px] text-slate-400">Broker: ${DEVICE.broker}</span>
    </div>`;
}
