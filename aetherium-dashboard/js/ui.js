import { TONES } from './utils/status.js';

export const pageTitle = (title, sub, right = '') => `
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-slate-900 font-['Space_Grotesk']">${title}</h1>
      <p class="text-sm text-slate-500 mt-0.5">${sub}</p>
    </div>${right}
  </div>`;

export const panel = ({ title, icon, right = '', body, cls = '' }) => `
  <section class="bg-white rounded-xl p-6 border border-slate-200/80 shadow-sm ${cls}">
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-2">
        <span class="material-symbols-outlined text-[20px] text-sky-600">${icon}</span>
        <h2 class="font-bold text-slate-900 text-sm font-['Space_Grotesk']">${title}</h2>
      </div>${right}
    </div>${body}
  </section>`;

export const badge = (text, tone = 'slate') =>
  `<span class="px-2 py-0.5 rounded-md ${TONES[tone].badge} text-[11px] font-semibold whitespace-nowrap">${text}</span>`;

export const toggle = (on, act) => `
  <button type="button" data-act="${act}" class="relative w-12 h-7 rounded-full transition-colors ${on ? 'bg-sky-600' : 'bg-slate-300'}">
    <span class="absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-5' : ''}"></span>
  </button>`;

export const segmented = (items, active, act) => `
  <div class="inline-flex p-0.5 rounded-lg bg-slate-100 text-xs font-semibold">
    ${items.map(([v, l]) => `<button type="button" data-act="${act}" data-val="${v}" class="px-3 py-1.5 rounded-md transition ${v === active ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}">${l}</button>`).join('')}
  </div>`;

const TOAST = { sky: 'bg-sky-600', emerald: 'bg-emerald-600', rose: 'bg-rose-600', amber: 'bg-amber-500' };
export function toast(msg, tone = 'sky') {
  let box = document.getElementById('toast-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast-box';
    box.className = 'fixed bottom-6 right-6 z-[100] flex flex-col gap-2';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = `px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium text-white ${TOAST[tone]}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
