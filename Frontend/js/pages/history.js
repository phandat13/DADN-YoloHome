// Cảnh báo & Lịch sử: GET /homes/:homeId/activity-logs + nhật ký cục bộ (cảnh báo ngưỡng, tự động hoá).
import { state, on, clearLogs } from '../store.js';
import { api } from '../api.js';
import { asList, esc, fullTime, normText } from '../utils/fields.js';
import { normLog } from '../models.js';
import { panel, pageTitle, badge, segmented, button, inputCls, emptyState, loadingBlock, errorBlock, busy } from '../ui.js';

const TYPES = [['all', 'Tất cả'], ['sensor', 'Cảm biến'], ['device', 'Thiết bị'], ['door', 'Cửa'], ['alert', 'Cảnh báo']];
const TYPE_META = { sensor: ['Cảm biến', 'sky'], device: ['Thiết bị', 'slate'], door: ['Cửa', 'emerald'], alert: ['Cảnh báo', 'rose'] };
const PERIODS = { day: ['24 giờ', 864e5], week: ['7 ngày', 6048e5], month: ['30 ngày', 2592e6], all: ['Tất cả', Infinity] };
const LIMIT = 200;
let tab = 'system', period = 'week', localType = 'all', query = '';   // giữ lựa chọn khi chuyển trang

const actionTone = (a) => {
  const s = normText(a);
  if (/delete|remove|revoke|fail|deny|lock|xoa|thu hoi/.test(s)) return 'rose';
  if (/unlock|open|login|create|add|mo|tao|them/.test(s)) return 'emerald';
  if (/update|change|edit|patch|doi|sua/.test(s)) return 'amber';
  return 'slate';
};

export const historyPage = {
  mount(root) {
    let logs = null, logsErr = null, alive = true;
    const homeId = state.homeId;
    root.innerHTML = pageTitle('Cảnh báo & Lịch sử', 'Cảnh báo ngưỡng đang hoạt động, nhật ký hoạt động của hệ thống và sự kiện trên trình duyệt') + `
      <div id="alert-box"></div>
      <div id="tab-box"></div>
      <div id="log-box"></div>`;
    const $ = (s) => root.querySelector(s);

    const paintAlerts = () => {
      $('#alert-box').innerHTML = state.alerts.length
        ? `<div class="grid gap-3">${state.alerts.map((a) => `
            <div class="p-4 rounded-xl bg-rose-50 border border-rose-100 flex items-start gap-3">
              <span class="material-symbols-outlined text-rose-500">warning</span>
              <div><div class="text-sm font-semibold text-rose-800">Đang cảnh báo</div><div class="text-sm text-rose-700">${esc(a.message)}</div></div>
            </div>`).join('')}</div>`
        : `<div class="p-4 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center gap-3 text-sm text-emerald-800 font-semibold">
             <span class="material-symbols-outlined text-emerald-500">check_circle</span>Tất cả thông số an toàn</div>`;
    };

    const paintTabs = () => {
      $('#tab-box').innerHTML = segmented([['system', 'Nhật ký hệ thống (Backend)'], ['local', 'Sự kiện trên trình duyệt']], tab, 'tab');
    };

    const systemRows = () => {
      const since = Date.now() - PERIODS[period][1];
      const q = normText(query);
      return logs.filter((l) => (l.ts == null || l.ts >= since)
        && (!q || normText(`${l.actor} ${l.action} ${l.target} ${l.detail}`).includes(q)));
    };

    const paintSystemTable = () => {
      const el = $('#log-table');
      if (!el) return;
      if (logs === null) { el.innerHTML = loadingBlock(); return; }
      if (logsErr) { el.innerHTML = errorBlock(logsErr); return; }
      const rows = systemRows();
      $('#log-count').textContent = `(${rows.length})`;
      el.innerHTML = rows.length ? `
        <div class="overflow-x-auto"><table class="w-full text-sm">
          <thead><tr class="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
            <th class="py-2 pr-4 font-semibold">Thời gian</th><th class="py-2 pr-4 font-semibold">Người thực hiện</th>
            <th class="py-2 pr-4 font-semibold">Hành động</th><th class="py-2 font-semibold">Chi tiết</th></tr></thead>
          <tbody>${rows.slice(0, LIMIT).map((l) => `<tr class="border-b border-slate-50 align-top">
            <td class="py-2 pr-4 font-mono text-xs text-slate-500 whitespace-nowrap">${fullTime(l.ts)}</td>
            <td class="py-2 pr-4 text-slate-700 whitespace-nowrap">${esc(l.actor)}</td>
            <td class="py-2 pr-4">${l.action ? badge(l.action, actionTone(l.action)) : '—'}${l.target ? `<div class="text-xs text-slate-400 mt-1">${esc(l.target)}</div>` : ''}</td>
            <td class="py-2 text-slate-600 text-xs break-all">${esc(l.detail)}</td></tr>`).join('')}</tbody></table></div>
        ${rows.length > LIMIT ? `<p class="text-xs text-slate-400 mt-3">Hiển thị ${LIMIT} sự kiện mới nhất.</p>` : ''}`
        : emptyState('history', 'Không có sự kiện trong khoảng này');
    };

    const paintLocal = () => {
      const since = Date.now() - PERIODS[period][1];
      const rows = state.logs.filter((l) => l.ts >= since && (localType === 'all' || l.type === localType));
      $('#log-box').innerHTML = panel({
        title: `Sự kiện trên trình duyệt (${rows.length})`, icon: 'devices',
        right: '<button type="button" data-act="clear" class="text-xs font-semibold text-rose-600 hover:text-rose-700">Xoá lịch sử cục bộ</button>',
        body: `
          <p class="text-xs text-slate-400 mb-3">Nhật ký nhanh của trình duyệt này (lưu localStorage theo từng nhà): cảnh báo, thao tác thiết bị và cửa. Cảnh báo / lệnh tự động do Backend thực hiện được lưu ở mục Thông báo và nhật ký hoạt động bên dưới.</p>
          <div class="flex flex-wrap items-center gap-3 mb-4">
            ${segmented(Object.entries(PERIODS).map(([k, v]) => [k, v[0]]), period, 'period')}
            ${segmented(TYPES, localType, 'type')}
          </div>
          <div class="overflow-x-auto"><table class="w-full text-sm">
            <thead><tr class="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100"><th class="py-2 pr-4 font-semibold">Thời gian</th><th class="py-2 pr-4 font-semibold">Loại</th><th class="py-2 font-semibold">Nội dung</th></tr></thead>
            <tbody>${rows.slice(0, LIMIT).map((l) => `
              <tr class="border-b border-slate-50"><td class="py-2 pr-4 font-mono text-xs text-slate-500 whitespace-nowrap">${fullTime(l.ts)}</td>
              <td class="py-2 pr-4">${badge(...(TYPE_META[l.type] ?? ['Khác', 'slate']))}</td><td class="py-2 text-slate-700">${esc(l.message)}</td></tr>`).join('')
              || '<tr><td colspan="3" class="py-8 text-center text-slate-400">Không có sự kiện trong khoảng này</td></tr>'}</tbody>
          </table></div>`,
      });
    };

    const paintSystem = () => {
      $('#log-box').innerHTML = panel({
        title: 'Nhật ký hoạt động <span id="log-count" class="text-slate-400 font-medium"></span>', icon: 'history',
        right: button('Tải lại', { act: 'reload', tone: 'secondary', size: 'sm', icon: 'refresh' }),
        body: `
          <div class="flex flex-wrap items-center gap-3 mb-4">
            ${segmented(Object.entries(PERIODS).map(([k, v]) => [k, v[0]]), period, 'period')}
            <input id="log-q" type="search" value="${esc(query)}" placeholder="Tìm theo người, hành động, chi tiết…" class="${inputCls} max-w-xs">
          </div>
          <div id="log-table"></div>`,
      });
      paintSystemTable();
    };

    const paintLogs = () => (tab === 'system' ? paintSystem() : paintLocal());

    const load = async () => {
      try {
        const res = await api.logs.activity(homeId);
        if (!alive) return;
        logs = asList(res, 'logs', 'activityLogs').map(normLog).sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
        logsErr = null;
      } catch (e) {
        if (!alive) return;
        logs = [];
        logsErr = e.status === 403 ? 'Bạn cần quyền LOG_VIEW_ALL hoặc LOG_VIEW_OWN để xem nhật ký' : `Không tải được nhật ký: ${e.message}`;
      }
      if (tab === 'system') paintSystemTable();
    };

    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const { act, val } = b.dataset;
      if (act === 'tab') { tab = val; paintTabs(); return paintLogs(); }
      if (act === 'period') { period = val; return paintLogs(); }
      if (act === 'type') { localType = val; return paintLocal(); }
      if (act === 'clear') { if (confirm('Xoá toàn bộ lịch sử cục bộ của nhà này?')) clearLogs(); return; }
      if (act === 'reload') { logs = null; paintSystemTable(); await busy(b, load); }
    });
    root.addEventListener('input', (e) => {
      if (e.target.id !== 'log-q') return;
      query = e.target.value;
      paintSystemTable();
    });

    paintAlerts(); paintTabs(); paintLogs();
    load();
    const offs = [on('alerts', paintAlerts), on('logs', () => { if (tab === 'local') paintLocal(); })];
    return () => { alive = false; offs.forEach((off) => off()); };
  },
};


