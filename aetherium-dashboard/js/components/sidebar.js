import { DEVICE, NAV_ITEMS } from '../config.js';

const navItem = ({ icon, label, route }, activeRoute) => route === activeRoute
  ? `<a href="#/${route}" class="flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-sky-50 text-sky-700 font-semibold text-sm transition-all shadow-sm">
       <span class="material-symbols-outlined text-[20px] text-sky-600">${icon}</span><span>${label}</span></a>`
  : `<a href="#/${route}" class="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 font-medium text-sm transition-all">
       <span class="material-symbols-outlined text-[20px] text-slate-400">${icon}</span><span>${label}</span></a>`;

export function renderSidebar(el, state, activeRoute = 'monitor') {
  const { online, total } = state.nodes;
  el.innerHTML = `
    <div class="flex flex-col">
      <div class="h-16 px-6 flex items-center gap-3 border-b border-slate-100">
        <img alt="${DEVICE.brand} Logo" class="h-8 w-8 rounded-lg object-cover ring-1 ring-slate-200" src="${DEVICE.logo}" />
        <div class="flex flex-col">
          <span class="font-bold text-slate-900 text-base tracking-tight font-['Space_Grotesk'] leading-none">${DEVICE.brand}</span>
          <span class="text-[10px] font-semibold tracking-wider text-sky-600 uppercase mt-0.5">${DEVICE.platform}</span>
        </div>
      </div>
      <div class="px-3 py-5">
        <div class="px-3 pb-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Hệ thống</div>
        <nav class="flex flex-col gap-1">${NAV_ITEMS.map((n) => navItem(n, activeRoute)).join('')}</nav>
      </div>
    </div>
    <div class="p-4 m-3 rounded-xl bg-slate-50 border border-slate-200/70">
      <div class="flex items-center justify-between text-xs mb-1.5">
        <span class="text-slate-500 font-medium">Mesh Mạng</span>
        <span class="text-emerald-600 font-semibold">Tối ưu</span>
      </div>
      <div class="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
        <div class="bg-sky-500 h-full rounded-full" style="width:${(online / total) * 100}%"></div>
      </div>
      <div class="flex items-center justify-between mt-2 text-[11px] text-slate-500">
        <span>${online}/${total} Nodes</span>
        <span class="font-mono text-emerald-600 font-medium">0 ms loss</span>
      </div>
    </div>`;
}
