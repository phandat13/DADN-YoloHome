import { DEVICE } from '../config.js';
import { state } from '../store.js';
import { esc } from '../utils/fields.js';

const initials = (name = '') => name.trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase() || 'U';

// Sự kiện (đổi nhà, đăng xuất) được gắn một lần trong main.js.
export function renderTopbar(el) {
  const u = state.user;
  const homeSelect = state.homes.length
    ? `<label class="flex items-center gap-2">
         <span class="material-symbols-outlined text-[20px] text-slate-400">home</span>
         <select id="home-select" class="rounded-lg border-slate-200 text-sm font-semibold text-slate-800 py-1.5 pl-3 pr-9 focus:border-sky-500 focus:ring-sky-500">
           ${state.homes.map((h) => `<option value="${esc(h.id)}" ${String(h.id) === String(state.homeId) ? 'selected' : ''}>${esc(h.name)}</option>`).join('')}
         </select>
       </label>`
    : `<a href="#/homes" class="text-sm font-semibold text-sky-600 hover:text-sky-700">+ Tạo nhà đầu tiên</a>`;

  const live = state.socketConnected
    ? `<div class="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 text-xs font-semibold">
         <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span>Realtime đã kết nối</span></div>`
    : `<div class="flex items-center gap-2 px-3 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-100 text-xs font-semibold">
         <span class="w-2 h-2 rounded-full bg-rose-500"></span><span>Mất kết nối realtime</span></div>`;

  el.innerHTML = `
    <div class="flex items-center gap-4 min-w-0">
      ${homeSelect}
      <div class="hidden md:flex items-center gap-2">
        ${live}
        <div class="flex items-center gap-2 px-3 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-100 text-xs font-semibold">
          <span class="w-2 h-2 rounded-full bg-sky-500"></span><span>${DEVICE.board} · ${esc(DEVICE.broker)}</span>
        </div>
      </div>
    </div>
    <div class="flex items-center gap-4">
      <a href="#/notifications" title="Thông báo" class="relative p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors">
        <span class="material-symbols-outlined text-[22px]">notifications</span>
        ${state.unread ? `<span class="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">${state.unread > 99 ? '99+' : state.unread}</span>` : ''}
        ${state.alerts.length ? '<span class="absolute bottom-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white" title="Có cảnh báo ngưỡng"></span>' : ''}
      </a>
      <div class="h-5 w-px bg-slate-200"></div>
      <div class="flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center font-bold text-xs">${esc(initials(u?.name))}</div>
        <div class="hidden sm:block text-left">
          <div class="text-xs font-semibold text-slate-800 leading-tight">${esc(u?.name ?? 'Đang tải…')}</div>
          <div class="text-[11px] text-slate-400">${esc(state.home?.role || u?.email || '')}</div>
        </div>
        <button type="button" data-act="logout" title="Đăng xuất" class="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50">
          <span class="material-symbols-outlined text-[20px]">logout</span>
        </button>
      </div>
    </div>`;
}
