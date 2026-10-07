import { state, on, clearLogs, fullTime } from '../store.js';
import { panel, pageTitle, badge, segmented } from '../ui.js';

const TYPES = [['all', 'Tất cả'], ['sensor', 'Cảm biến'], ['device', 'Thiết bị'], ['door', 'Cửa'], ['alert', 'Cảnh báo']];
const TYPE_META = { sensor: ['Cảm biến', 'sky'], device: ['Thiết bị', 'slate'], door: ['Cửa', 'emerald'], alert: ['Cảnh báo', 'rose'] };
const PERIODS = { day: ['Ngày', 864e5], week: ['Tuần', 6048e5], month: ['Tháng', 2592e6] };
const LIMIT = 150;

export const historyPage = {
  mount(root) {
    let type = 'all', period = 'day';
    root.innerHTML = pageTitle('Cảnh báo & Lịch sử', 'Cảnh báo đang hoạt động và nhật ký sự kiện của nhà thông minh') + `
      <div id="alert-box"></div>
      <div id="log-box"></div>`;
    const alertEl = root.querySelector('#alert-box'), logEl = root.querySelector('#log-box');

    const paintAlerts = () => {
      alertEl.innerHTML = state.alerts.length
        ? `<div class="grid gap-3">${state.alerts.map((a) => `
            <div class="p-4 rounded-xl bg-rose-50 border border-rose-100 flex items-start gap-3">
              <span class="material-symbols-outlined text-rose-500">warning</span>
              <div><div class="text-sm font-semibold text-rose-800">Đang cảnh báo</div><div class="text-sm text-rose-700">${a.message}</div></div>
            </div>`).join('')}</div>`
        : `<div class="p-4 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center gap-3 text-sm text-emerald-800 font-semibold">
             <span class="material-symbols-outlined text-emerald-500">check_circle</span>Tất cả thông số an toàn</div>`;
    };

    const paintLogs = () => {
      const since = Date.now() - PERIODS[period][1];
      const rows = state.logs.filter((l) => l.ts >= since && (type === 'all' || l.type === type));
      logEl.innerHTML = panel({
        title: `Nhật ký sự kiện (${rows.length})`, icon: 'history',
        right: `<button type="button" data-act="clear" class="text-xs font-semibold text-rose-600 hover:text-rose-700">Xoá lịch sử</button>`,
        body: `
          <div class="flex flex-wrap items-center gap-3 mb-4">
            ${segmented(Object.entries(PERIODS).map(([k, v]) => [k, v[0]]), period, 'period')}
            ${segmented(TYPES, type, 'type')}
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead><tr class="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100"><th class="py-2 pr-4 font-semibold">Thời gian</th><th class="py-2 pr-4 font-semibold">Loại</th><th class="py-2 font-semibold">Nội dung</th></tr></thead>
              <tbody>${rows.slice(0, LIMIT).map((l) => `
                <tr class="border-b border-slate-50"><td class="py-2 pr-4 font-mono text-xs text-slate-500 whitespace-nowrap">${fullTime(l.ts)}</td>
                <td class="py-2 pr-4">${badge(...TYPE_META[l.type])}</td><td class="py-2 text-slate-700">${l.message}</td></tr>`).join('')
                || '<tr><td colspan="3" class="py-8 text-center text-slate-400">Không có sự kiện trong khoảng này</td></tr>'}</tbody>
            </table>
          </div>
          ${rows.length > LIMIT ? `<p class="text-xs text-slate-400 mt-3">Hiển thị ${LIMIT} sự kiện mới nhất.</p>` : ''}`,
      });
    };

    root.onclick = (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const { act, val } = b.dataset;
      if (act === 'period') period = val;
      else if (act === 'type') type = val;
      else if (act === 'clear') { if (confirm('Xoá toàn bộ lịch sử?')) clearLogs(); return; }
      paintLogs();
    };

    paintAlerts(); paintLogs();
    const offs = [on('alerts', paintAlerts), on('logs', paintLogs)];
    return () => offs.forEach((off) => off());
  },
};
