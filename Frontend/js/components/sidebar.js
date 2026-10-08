import { DEVICE, NAV_GROUPS } from '../config.js';
import { state } from '../store.js';
import { esc } from '../utils/fields.js';

const navItem = ({ icon, label, route, badge }, activeRoute) => {
  const count = badge === 'unread' ? state.unread : 0;
  const pill = count ? `<span class="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[11px] font-bold flex items-center justify-center">${count > 99 ? '99+' : count}</span>` : '';
  return route === activeRoute
    ? `<a href="#/${route}" class="flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-sky-50 text-sky-700 font-semibold text-sm transition-all shadow-sm">
         <span class="material-symbols-outlined text-[20px] text-sky-600">${icon}</span><span>${label}</span>${pill}</a>`
    : `<a href="#/${route}" class="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 font-medium text-sm transition-all">
         <span class="material-symbols-outlined text-[20px] text-slate-400">${icon}</span><span>${label}</span>${pill}</a>`;
};

export function renderSidebar(el, activeRoute = 'monitor') {
  const devices = state.devices.filter((d) => d.kind !== 'sensor');
  const total = devices.length;
  const online = devices.filter((d) => d.online === true).length;
  const known = devices.some((d) => d.online !== null);
  el.innerHTML = `
    <div class="flex flex-col">
      <div class="h-16 px-6 flex items-center gap-3 border-b border-slate-100 shrink-0">
        <img alt="${DEVICE.brand} Logo" class="h-8 w-8 rounded-lg object-cover ring-1 ring-slate-200" src="${DEVICE.logo}" />
        <div class="flex flex-col">
          <span class="font-bold text-slate-900 text-base tracking-tight font-['Space_Grotesk'] leading-none">${DEVICE.brand}</span>
          <span class="text-[10px] font-semibold tracking-wider text-sky-600 uppercase mt-0.5">${DEVICE.platform}</span>
        </div>
      </div>
      <div class="px-3 py-4 space-y-4">
        ${NAV_GROUPS.map((g) => `
          <div>
            <div class="px-3 pb-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">${g.title}</div>
            <nav class="flex flex-col gap-1">${g.items.map((n) => navItem(n, activeRoute)).join('')}</nav>
          </div>`).join('')}
      </div>
    </div>
    <div class="p-4 m-3 rounded-xl bg-slate-50 border border-slate-200/70">
      <div class="flex items-center justify-between text-xs mb-1.5 gap-2">
        <span class="text-slate-500 font-medium truncate">${state.home ? esc(state.home.name) : 'Chưa chọn nhà'}</span>
        <span class="${state.socketConnected ? 'text-emerald-600' : 'text-rose-500'} font-semibold whitespace-nowrap">${state.socketConnected ? 'Realtime' : 'Offline'}</span>
      </div>
      <div class="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
        <div class="bg-sky-500 h-full rounded-full" style="width:${total && known ? (online / total) * 100 : 0}%"></div>
      </div>
      <div class="flex items-center justify-between mt-2 text-[11px] text-slate-500">
        <span>${known ? `${online}/${total}` : total} thiết bị${known ? ' online' : ''}</span>
        <span class="font-mono text-slate-400">${state.sensors.length} cảm biến</span>
      </div>
    </div>`;
}
