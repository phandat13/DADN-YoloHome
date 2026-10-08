import { TONES } from './utils/status.js';
import { esc } from './utils/fields.js';

export const inputCls = 'w-full rounded-lg border-slate-200 text-sm focus:border-sky-500 focus:ring-sky-500';

export const pageTitle = (title, sub, right = '') => `
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-slate-900 font-['Space_Grotesk']">${title}</h1>
      <p class="text-sm text-slate-500 mt-0.5">${sub}</p>
    </div>${right}
  </div>`;

export const panel = ({ title, icon, right = '', body, cls = '', id = '' }) => `
  <section ${id ? `id="${id}"` : ''} class="bg-white rounded-xl p-6 border border-slate-200/80 shadow-sm ${cls}">
    <div class="flex items-center justify-between gap-3 mb-4">
      <div class="flex items-center gap-2 min-w-0">
        <span class="material-symbols-outlined text-[20px] text-sky-600">${icon}</span>
        <h2 class="font-bold text-slate-900 text-sm font-['Space_Grotesk'] truncate">${title}</h2>
      </div>${right}
    </div>${body}
  </section>`;

export const badge = (text, tone = 'slate') =>
  `<span class="px-2 py-0.5 rounded-md ${(TONES[tone] ?? TONES.slate).badge} text-[11px] font-semibold whitespace-nowrap">${esc(text)}</span>`;

export const toggle = (on, act, attrs = '') => `
  <button type="button" data-act="${act}" ${attrs} aria-pressed="${on}" class="relative shrink-0 w-12 h-7 rounded-full transition-colors ${on ? 'bg-sky-600' : 'bg-slate-300'}">
    <span class="absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-5' : ''}"></span>
  </button>`;

export const segmented = (items, active, act) => `
  <div class="inline-flex p-0.5 rounded-lg bg-slate-100 text-xs font-semibold">
    ${items.map(([v, l]) => `<button type="button" data-act="${act}" data-val="${esc(v)}" class="px-3 py-1.5 rounded-md transition ${String(v) === String(active) ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}">${l}</button>`).join('')}
  </div>`;

const BTN = {
  primary: 'bg-sky-600 hover:bg-sky-500 text-white',
  secondary: 'bg-slate-100 hover:bg-slate-200 text-slate-700',
  danger: 'bg-rose-50 hover:bg-rose-100 text-rose-600',
  success: 'bg-emerald-600 hover:bg-emerald-500 text-white',
  ghost: 'text-slate-500 hover:text-slate-800 hover:bg-slate-100',
};
export const button = (text, { act = '', val = '', tone = 'primary', icon = '', type = 'button', size = 'md', cls = '', attrs = '' } = {}) => `
  <button type="${type}" ${act ? `data-act="${act}"` : ''} ${val !== '' && val != null ? `data-val="${esc(val)}"` : ''} ${attrs}
    class="inline-flex items-center justify-center gap-1.5 ${size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-4 py-2 text-sm'} rounded-lg font-semibold whitespace-nowrap transition active:scale-95 disabled:opacity-50 disabled:pointer-events-none ${BTN[tone]} ${cls}">
    ${icon ? `<span class="material-symbols-outlined ${size === 'sm' ? 'text-[16px]' : 'text-[18px]'}">${icon}</span>` : ''}${text ? `<span>${text}</span>` : ''}
  </button>`;

export const field = (labelText, control, hint = '') => `
  <label class="block">
    <span class="block text-xs font-semibold text-slate-500 mb-1">${labelText}</span>${control}
    ${hint ? `<span class="block text-[11px] text-slate-400 mt-1">${hint}</span>` : ''}
  </label>`;

export const emptyState = (icon, title, sub = '', action = '') => `
  <div class="flex flex-col items-center justify-center text-center py-10 px-4">
    <span class="material-symbols-outlined text-[36px] text-slate-300">${icon}</span>
    <div class="mt-2 text-sm font-semibold text-slate-600">${title}</div>
    ${sub ? `<div class="text-xs text-slate-400 mt-1 max-w-md">${sub}</div>` : ''}
    ${action ? `<div class="mt-4">${action}</div>` : ''}
  </div>`;

export const loadingBlock = (text = 'Đang tải dữ liệu…') => `
  <div class="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
    <span class="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>${text}
  </div>`;

export const errorBlock = (msg) => `
  <div class="p-3 rounded-lg bg-rose-50 border border-rose-100 text-sm text-rose-700 flex items-start gap-2">
    <span class="material-symbols-outlined text-[18px]">error</span><span>${esc(msg)}</span>
  </div>`;

// html: nội dung đã an toàn (do code tạo ra)
export const infoBlock = (html, tone = 'sky') => {
  const c = { sky: 'bg-sky-50 border-sky-100 text-sky-800', amber: 'bg-amber-50 border-amber-100 text-amber-800' }[tone];
  return `<div class="p-3 rounded-lg border text-sm flex items-start gap-2 ${c}">
    <span class="material-symbols-outlined text-[18px]">info</span><span>${html}</span></div>`;
};

export const linkButton = (href, text, icon = 'arrow_forward') =>
  `<a href="${href}" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold">${text}<span class="material-symbols-outlined text-[18px]">${icon}</span></a>`;

export const formValues = (form) =>
  Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));

// Khoá nút trong lúc chờ API.
export async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } finally { if (btn?.isConnected) btn.disabled = false; }
}

const TOAST = { sky: 'bg-sky-600', emerald: 'bg-emerald-600', rose: 'bg-rose-600', amber: 'bg-amber-500', slate: 'bg-slate-700' };
export function toast(msg, tone = 'sky') {
  let box = document.getElementById('toast-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast-box';
    box.className = 'fixed bottom-6 right-6 z-[100] flex flex-col gap-2 max-w-sm';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = `px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium text-white ${TOAST[tone] ?? TOAST.sky}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), tone === 'rose' ? 5000 : 3000);
}

export const fail = (e, prefix = '') => toast(prefix ? `${prefix}: ${e?.message ?? e}` : String(e?.message ?? e), 'rose');


