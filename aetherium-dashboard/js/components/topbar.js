import { DEVICE } from '../config.js';

export function renderTopbar(el, state) {
  const { operator } = DEVICE;
  el.innerHTML = `
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 text-xs font-semibold">
        <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <span>${DEVICE.board} ${state.boardOnline ? 'Online' : 'Offline'}</span>
      </div>
      <div class="flex items-center gap-2 px-3 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-100 text-xs font-semibold">
        <span class="w-2 h-2 rounded-full bg-sky-500"></span>
        <span>OhStem Ping ${state.ping}ms</span>
      </div>
    </div>
    <div class="flex items-center gap-4">
      <a href="#/history" class="relative p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors">
        <span class="material-symbols-outlined text-[22px]">notifications</span>
        ${state.alertCount ? '<span class="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white"></span>' : ''}
      </a>
      <div class="h-5 w-px bg-slate-200"></div>
      <div class="flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center font-bold text-xs">${operator.initials}</div>
        <div class="hidden sm:block text-left">
          <div class="text-xs font-semibold text-slate-800 leading-tight">${operator.role}</div>
          <div class="text-[11px] text-slate-400 font-mono">${operator.id}</div>
        </div>
      </div>
    </div>`;
}
