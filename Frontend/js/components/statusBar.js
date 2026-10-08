import { DEVICE } from '../config.js';

export function renderStatusBar(el, { alerts = [], devices = [], mode = 'auto', socketConnected = false }) {
  const safe = alerts.length === 0;
  const ctrl = devices.filter((d) => d.kind !== 'sensor');
  const online = ctrl.filter((d) => d.online === true).length;
  const known = ctrl.some((d) => d.online !== null);
  el.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="w-2.5 h-2.5 rounded-full ${safe ? 'bg-emerald-500' : 'bg-rose-500'}"></span>
      <span class="font-semibold text-slate-800">${safe ? 'Tất cả thông số an toàn' : 'Có thông số vượt ngưỡng'}</span>
      <span class="text-slate-400 hidden sm:inline">• ${safe ? 'Không có cảnh báo bất thường nào' : 'Kiểm tra mục Cảnh báo & Lịch sử'}</span>
    </div>
    <div class="flex flex-wrap items-center gap-4 text-slate-500">
      <span class="flex items-center gap-1.5">
        <span class="material-symbols-outlined text-[16px] text-sky-600">hub</span>
        <strong class="text-slate-700 font-medium">${known ? `${online}/${ctrl.length}` : ctrl.length}</strong> thiết bị${known ? ' online' : ''}
      </span>
      <span class="text-slate-300">•</span>
      <span class="flex items-center gap-1.5">
        <span class="material-symbols-outlined text-[16px] text-teal-600">mode_fan</span>
        Chế độ: <span class="${mode === 'auto' ? 'text-emerald-700 bg-emerald-50' : 'text-amber-700 bg-amber-50'} font-semibold px-2 py-0.5 rounded">${mode === 'auto' ? 'Tự động (Auto)' : 'Thủ công'}</span>
      </span>
      <span class="text-slate-300">•</span>
      <span class="flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full ${socketConnected ? 'bg-emerald-500' : 'bg-rose-500'}"></span>Socket.IO ${socketConnected ? 'đã kết nối' : 'mất kết nối'}
      </span>
      <span class="text-slate-300">•</span>
      <span class="font-mono text-[11px] text-slate-400">Broker: ${DEVICE.broker}</span>
    </div>`;
}
