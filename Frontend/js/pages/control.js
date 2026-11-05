// Điều khiển thiết bị (UC 3.1): POST /devices/:deviceId/commands (TURN_ON / TURN_OFF / SET_SPEED / SET_COLOR)
// + quản lý thiết bị: POST / PATCH / DELETE /homes/:homeId/devices
import { state, on, controlDevice, setMode, refreshHomeData, overrideOf, releaseOverride, sleepNow } from '../store.js';
import { api } from '../api.js';
import { DEVICE_TYPES, LIGHT_COLORS } from '../config.js';
import { esc, hhmm, fullTime } from '../utils/fields.js';
import { panel, pageTitle, toggle, badge, segmented, button, field, inputCls, emptyState, loadingBlock, errorBlock, toast, busy, formValues, fail } from '../ui.js';

const ICON = { light: 'lightbulb', fan: 'mode_fan', buzzer: 'notifications_active', other: 'power', sensor: 'sensors', door: 'door_front' };
const KIND_LABEL = { light: 'Đèn', fan: 'Quạt', buzzer: 'Còi', other: 'Thiết bị', sensor: 'Cảm biến', door: 'Cửa' };
const connBadge = (d) => (d.online === true ? badge(d.connection || 'Online', 'emerald')
  : d.online === false ? badge(d.connection || 'Offline', 'rose') : badge(d.connection || 'Không rõ', 'slate'));

export const controlPage = {
  mount(root) {
    let editing = null;

    root.innerHTML = pageTitle('Điều khiển thiết bị', 'Đèn, quạt — thủ công trên web hoặc tự động theo cảm biến; lệnh được gửi tới Backend → MQTT',
      button('Tải lại', { act: 'reload', tone: 'secondary', icon: 'refresh' })) + `
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div id="dev-panel" class="lg:col-span-7"></div>
        <div class="lg:col-span-5 space-y-6"><div id="insight-panel"></div><div id="add-panel"></div></div>
        <div id="schedule-panel" class="lg:col-span-12"></div>
        <div id="manage-panel" class="lg:col-span-12"></div>
      </div>`;
    const $ = (s) => root.querySelector(s);
    const find = (id) => state.devices.find((d) => String(d.id) === String(id));

    const row = (icon, title, sub, ctrl) => `
      <div class="flex items-center justify-between gap-4 py-4 border-b border-slate-100 last:border-0">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-9 h-9 shrink-0 rounded-lg bg-slate-50 text-slate-600 flex items-center justify-center"><span class="material-symbols-outlined text-[20px]">${icon}</span></div>
          <div class="min-w-0"><div class="text-sm font-semibold text-slate-800">${title}</div><div class="text-xs text-slate-400 flex flex-wrap items-center gap-1.5">${sub}</div></div>
        </div>${ctrl}
      </div>`;

    const colorPicker = (d) => `
      <label class="relative w-8 h-8 rounded-lg ring-1 ring-slate-200 cursor-pointer overflow-hidden shrink-0" title="Màu đèn (V11)">
        <input type="color" list="light-colors" value="${esc((d.color || '#FFFFFF').toLowerCase())}" data-act="color" data-id="${esc(d.id)}"
          class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
        <span class="block w-full h-full" style="background:${esc(d.color || '#FFFFFF')}"></span>
      </label>`;
    const control = (d) => {
      if (d.kind === 'fan') {
        return `<div class="flex items-center gap-3 shrink-0">
           <input type="range" min="0" max="100" step="10" value="${d.speed ?? 0}" data-act="fan" data-id="${esc(d.id)}" class="w-36 accent-sky-600">
           <b class="w-11 text-right font-mono text-sm text-slate-700" data-fan-val="${esc(d.id)}">${d.speed ?? 0}%</b></div>`;
      }
      if (d.kind === 'light') return `<div class="flex items-center gap-3 shrink-0">${colorPicker(d)}${toggle(d.on, 'toggle', `data-id="${esc(d.id)}"`)}</div>`;
      return toggle(d.on, 'toggle', `data-id="${esc(d.id)}"`);
    };

    // Thiết bị đang được giữ bởi lệnh của người -> tự động hoá tạm nhường (Backend: services/priority.js)
    const HOLD_TONE = { VOICE_COMMAND: 'violet', USER: 'sky', SCHEDULE: 'amber', SLEEP: 'slate' };
    const holdBadge = (d) => {
      const h = overrideOf(d.id);
      if (!h) return '';
      return `${badge(`${h.label} ưu tiên → ${hhmm(Date.parse(h.until))}`, HOLD_TONE[h.source] ?? 'sky')}
        <button type="button" data-act="release" data-id="${esc(d.id)}" class="text-[11px] font-semibold text-sky-600 hover:text-sky-800" title="Trả thiết bị về cho tự động hoá ngay">Trả về tự động</button>`;
    };

    const formatWorkingState = (d) => {
      if (d.kind === 'fan') {
        const val = d.speed !== undefined ? d.speed : (!isNaN(d.working) ? d.working : 0);
        return `${val}%`;
      }
      return d.on ? 'on' : (d.working || 'off');
    };

    const paintDev = () => {
      const list = state.devices.filter((d) => ['light', 'fan', 'buzzer', 'other'].includes(d.kind));

      // ĐỒNG BỘ TRẠNG THÁI TỪ BACKEND/STORE CHO NÚT SWITCH VÀ THANH TRƯỢT
      list.forEach((d) => {
        const w = String(d.working || '').toLowerCase().trim();
        if (d.kind === 'fan') {
          const num = parseInt(w, 10);
          if (!isNaN(num)) {
            d.speed = num;
            d.on = num > 0;
          } else {
            d.on = w === 'on';
            if (d.on && (d.speed === undefined || d.speed === 0)) d.speed = 100;
            if (!d.on) d.speed = 0;
          }
        } else {
          d.on = w === 'on' || (parseInt(w, 10) > 0);
        }
      });

      let body;
      if (state.errors.devices && !list.length) body = errorBlock(`Không tải được thiết bị: ${state.errors.devices}`);
      else if (state.loading && !list.length) body = loadingBlock();
      else if (!list.length) body = emptyState('devices_other', 'Chưa có thiết bị điều khiển', 'Thêm đèn (LIGHT), quạt (FAN) hoặc còi (BUZZER) ở khung "Thêm thiết bị".');
      else body = list.map((d) => row(ICON[d.kind], esc(d.name), `<span>${KIND_LABEL[d.kind]} · ${esc(d.typeCode || '—')} · ID ${esc(d.id)}</span>${connBadge(d)}${holdBadge(d)}`, control(d))).join('');

      $('#dev-panel').innerHTML = panel({
        title: 'Thiết bị ngoại vi', icon: 'tune',
        right: segmented([['auto', 'Tự động'], ['manual', 'Thủ công']], state.mode, 'mode'),
        body: `
          ${state.mode === 'auto' ? `<p class="text-xs text-sky-700 bg-sky-50 rounded-lg px-3 py-2 mb-2">Chế độ tự động chạy trên Backend (kể cả khi không mở web): đèn bật khi trời tối và có người, tắt khi không có người; quạt và còi theo nhiệt độ.
            Thao tác tay hoặc giọng nói chỉ giữ <b>riêng thiết bị đó</b> trong ${state.overrideMinutes} phút (giọng nói ưu tiên cao nhất), các thiết bị khác vẫn tự động.</p>` : ''}
          ${state.sleep.sleeping ? '<p class="text-xs text-indigo-700 bg-indigo-50 rounded-lg px-3 py-2 mb-2 flex items-center gap-1.5"><span class="material-symbols-outlined text-[16px]">bedtime</span>Đang trong giờ ngủ: đèn được giữ tắt, không tự bật theo trời tối / chuyển động.</p>' : ''}
          ${body}
          <datalist id="light-colors">${LIGHT_COLORS.map(([c]) => `<option value="${c.toLowerCase()}"></option>`).join('')}</datalist>
          ${row('door_front', 'Cửa', `<span>${state.doors.length} cửa · mở bằng mã PIN, FaceAI hoặc từ xa</span>`,
            `<div class="flex items-center gap-2 shrink-0">${badge(state.doorOpen ? 'ĐANG MỞ' : 'Đóng', state.doorOpen ? 'emerald' : 'slate')}<a href="#/door" class="text-xs font-semibold text-sky-600 hover:text-sky-700">Mở trang cửa →</a></div>`)}`,
      });
    };

    $('#add-panel').innerHTML = panel({ title: 'Thêm thiết bị', icon: 'add_circle', body: `
      <form id="add-device" class="space-y-3">
        ${field('Tên thiết bị *', `<input name="deviceName" required class="${inputCls}" placeholder="VD: Đèn phòng khách">`)}
        ${field('Mã loại (typeCode) *', `<input name="typeCode" required list="type-codes" class="${inputCls} uppercase" placeholder="LIGHT">`, 'Gợi ý: LIGHT (đèn RGB), FAN (quạt), BUZZER (còi), SENSOR (cụm cảm biến)')}
        <datalist id="type-codes">${DEVICE_TYPES.map(([c, l]) => `<option value="${c}">${l}</option>`).join('')}</datalist>
        ${button('Đăng ký thiết bị', { type: 'submit', icon: 'add' })}
      </form>` });

    const paintInsight = () => {
      const ins = state.insight;
      const sl = state.sleep;
      const sleepLine = sl.sleeping
        ? `Đang ngủ${sl.manual === 'SLEEP' && sl.manualUntil ? ` (lệnh "đi ngủ" tới ${hhmm(Date.parse(sl.manualUntil))})` : ` (${esc(sl.start)}–${esc(sl.end)})`}`
        : sl.manual === 'AWAKE' && sl.manualUntil ? `Đã thức dậy, giờ ngủ tiếp theo ${hhmm(Date.parse(sl.manualUntil))}`
          : sl.enabled ? `Giờ ngủ ${esc(sl.start)}–${esc(sl.end)}` : 'Chế độ ngủ đang tắt';
      $('#insight-panel').innerHTML = panel({
        title: 'Phân tích tự động', icon: 'insights',
        right: `<span class="text-[11px] text-slate-400">${ins?.at ? `cập nhật ${hhmm(Date.parse(ins.at))}` : ''}</span>`,
        body: `
          <ul class="space-y-1.5 text-sm text-slate-700">
            ${ins?.items?.length ? ins.items.map((i) => `<li class="flex gap-2"><span class="material-symbols-outlined text-[16px] text-sky-500 mt-0.5">${{ light: 'lightbulb', fan: 'mode_fan', buzzer: 'notifications_active', sleep: 'bedtime', mode: 'pan_tool' }[i.key] ?? 'info'}</span><span>${esc(i.text)}</span></li>`).join('')
              : '<li class="text-xs text-slate-400">Chưa có kết quả — phân tích chạy khi có số liệu cảm biến mới hoặc mỗi 30 giây.</li>'}
          </ul>
          <div class="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-slate-100">
            <span class="text-xs text-slate-500 flex items-center gap-1"><span class="material-symbols-outlined text-[16px] text-indigo-500">bedtime</span>${sleepLine}</span>
            ${sl.sleeping ? button('Thức dậy', { act: 'sleep-now', val: 'awake', tone: 'secondary', size: 'sm', icon: 'wb_sunny' })
              : button('Đi ngủ', { act: 'sleep-now', val: 'sleep', tone: 'secondary', size: 'sm', icon: 'bedtime' })}
          </div>` });
    };

    // ---------------- Hẹn giờ ----------------
    const ACTIONS = {
      light: [['TURN_ON', 'Bật'], ['TURN_OFF', 'Tắt'], ['SET_COLOR', 'Đổi màu']],
      fan: [['TURN_ON', 'Bật'], ['TURN_OFF', 'Tắt'], ['SET_SPEED', 'Đặt tốc độ']],
      buzzer: [['TURN_ON', 'Bật'], ['TURN_OFF', 'Tắt']],
      other: [['TURN_ON', 'Bật'], ['TURN_OFF', 'Tắt']],
    };
    const DAYS = [[1, 'T2'], [2, 'T3'], [3, 'T4'], [4, 'T5'], [5, 'T6'], [6, 'T7'], [0, 'CN']];
    const schedDevices = () => state.devices.filter((d) => ACTIONS[d.kind]);
    const RESULT = { SUCCESS: ['Đã chạy', 'emerald'], FAILED: ['Lỗi', 'rose'], SKIPPED: ['Bỏ qua (ưu tiên)', 'amber'], MISSED: ['Lỡ (server tắt)', 'slate'] };

    const actionOptions = (dev) => (ACTIONS[dev?.kind] ?? ACTIONS.other).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    const syncActionFields = () => {
      const f = $('#sched-form');
      if (!f) return;
      const act = f.querySelector('[name=action]').value;
      f.querySelector('[data-f=speed]').classList.toggle('hidden', act !== 'SET_SPEED');
      f.querySelector('[data-f=color]').classList.toggle('hidden', act !== 'SET_COLOR');
      const type = f.querySelector('[name=type]').value;
      f.querySelector('[data-f=after]').classList.toggle('hidden', type !== 'after');
      f.querySelector('[data-f=at]').classList.toggle('hidden', type !== 'at');
      f.querySelector('[data-f=repeat]').classList.toggle('hidden', type !== 'repeat');
    };

    const localInputValue = (d) => {
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    };

    const paintScheduleForm = () => {
      const devs = schedDevices();
      const box = $('#sched-form-box');
      if (!box) return;
      if (!devs.length) { box.innerHTML = emptyState('schedule', 'Chưa có thiết bị để hẹn giờ', 'Thêm đèn, quạt hoặc còi trước.'); return; }
      box.innerHTML = `
        <form id="sched-form" class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          ${field('Thiết bị', `<select name="deviceId" class="${inputCls}">${devs.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select>`)}
          ${field('Hành động', `<select name="action" class="${inputCls}">${actionOptions(devs[0])}</select>`)}
          <div data-f="speed" class="hidden">${field('Tốc độ (%)', `<input name="speed" type="number" min="0" max="100" step="10" value="50" class="${inputCls} font-mono">`)}</div>
          <div data-f="color" class="hidden">${field('Màu', `<input name="color" type="color" value="#ffffff" class="h-[38px] w-full rounded-lg border border-slate-200">`)}</div>
          ${field('Kiểu hẹn', `<select name="type" class="${inputCls}">
              <option value="after">Đếm ngược (sau … phút)</option>
              <option value="at">Một lần vào lúc</option>
              <option value="repeat">Lặp lại hằng tuần</option></select>`)}
          <div data-f="after">${field('Sau (phút)', `<input name="afterMinutes" type="number" min="1" max="10080" value="30" class="${inputCls} font-mono">`)}</div>
          <div data-f="at" class="hidden">${field('Thời điểm', `<input name="runAt" type="datetime-local" value="${localInputValue(new Date(Date.now() + 3600e3))}" class="${inputCls}">`)}</div>
          <div data-f="repeat" class="hidden sm:col-span-2 grid grid-cols-[110px_1fr] gap-3 items-end">
            ${field('Giờ', `<input name="time" type="time" value="18:30" class="${inputCls}">`)}
            <div><span class="block text-xs font-semibold text-slate-500 mb-1">Ngày</span>
              <div class="flex flex-wrap gap-1.5">${DAYS.map(([v, l]) => `<label class="inline-flex items-center gap-1 px-2 py-1.5 rounded-md bg-slate-50 border border-slate-200 text-xs cursor-pointer"><input type="checkbox" name="day" value="${v}" checked class="rounded text-sky-600">${l}</label>`).join('')}</div>
            </div>
          </div>
          <div>${button('Thêm hẹn giờ', { type: 'submit', icon: 'alarm_add' })}</div>
        </form>`;
      syncActionFields();
    };

    const paintScheduleList = () => {
      const el = $('#sched-list');
      if (!el) return;
      const list = state.schedules;
      if (!list.length) { el.innerHTML = '<p class="text-xs text-slate-400 py-3">Chưa có hẹn giờ. Có thể nói: "tắt quạt sau 30 phút", "hẹn giờ tắt đèn lúc 10 giờ tối".</p>'; return; }
      el.innerHTML = `<div class="overflow-x-auto"><table class="w-full text-sm">
        <thead><tr class="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
          <th class="py-2 pr-3 font-semibold">Thiết bị</th><th class="py-2 pr-3 font-semibold">Hành động</th><th class="py-2 pr-3 font-semibold">Lịch</th>
          <th class="py-2 pr-3 font-semibold">Lần chạy tới</th><th class="py-2 pr-3 font-semibold">Lần trước</th><th class="py-2 pr-3 font-semibold">Bật</th><th></th></tr></thead>
        <tbody>${list.map((s) => {
          const res = RESULT[s.lastResult];
          return `<tr class="border-b border-slate-50 ${s.enabled ? '' : 'opacity-60'}">
            <td class="py-2.5 pr-3 font-semibold text-slate-800">${esc(s.deviceName ?? `#${s.deviceId}`)}${s.createdVia === 'VOICE' ? ` <span title="Tạo bằng giọng nói (ưu tiên cao)" class="material-symbols-outlined text-[14px] text-violet-500 align-middle">mic</span>` : ''}</td>
            <td class="py-2.5 pr-3">${s.color ? `<span class="inline-block w-3 h-3 rounded-sm ring-1 ring-slate-200 align-middle mr-1" style="background:${esc(s.color)}"></span>` : ''}${esc(s.actionText)}</td>
            <td class="py-2.5 pr-3 text-xs text-slate-600">${s.repeat ? `${esc(s.time)} · ${esc(s.daysText)}` : 'Một lần'}</td>
            <td class="py-2.5 pr-3 text-xs font-mono text-slate-700">${s.enabled && s.nextRunAt ? fullTime(Date.parse(s.nextRunAt)) : '—'}</td>
            <td class="py-2.5 pr-3 text-xs">${res ? badge(res[0], res[1]) : '<span class="text-slate-400">—</span>'}${s.lastRunAt ? ` <span class="text-slate-400">${hhmm(Date.parse(s.lastRunAt))}</span>` : ''}</td>
            <td class="py-2.5 pr-3">${toggle(s.enabled, 'sched-toggle', `data-id="${esc(s.scheduleId)}"`)}</td>
            <td class="py-2.5 text-right">${button('', { act: 'sched-delete', val: s.scheduleId, tone: 'danger', icon: 'delete', size: 'sm', attrs: 'title="Xoá hẹn giờ"' })}</td>
          </tr>`;
        }).join('')}</tbody></table></div>`;
    };

    $('#schedule-panel').innerHTML = panel({
      title: 'Hẹn giờ thiết bị', icon: 'schedule',
      body: `<div id="sched-form-box"></div><div id="sched-list" class="mt-5"></div>
        <p class="text-[11px] text-slate-400 mt-3">Hẹn giờ chạy trên Backend (không cần mở web). Thiết bị đang được giữ bởi lệnh giọng nói sẽ bỏ qua hẹn giờ tạo trên web (ghi "Bỏ qua").</p>`,
    });

    const paintManage = () => {
      const list = state.devices;
      const cell = (name, value, ph = '') => `<input name="${name}" form="edit-device" value="${esc(value)}" placeholder="${ph}" class="w-full min-w-[110px] rounded-lg border-slate-200 text-xs py-1.5">`;
      const rows = list.map((d) => (String(editing) === String(d.id)
        ? `<tr class="bg-sky-50/40 border-b border-slate-100">
            <td class="py-2 pr-3 font-mono text-xs text-slate-500">${esc(d.id)}</td>
            <td class="py-2 pr-3">${cell('deviceName', d.name)}</td>
            <td class="py-2 pr-3 text-xs">${esc(d.typeCode || '—')}</td>
            <td class="py-2 pr-3">${cell('connectionState', d.connection, 'ONLINE')}</td>
            <td class="py-2 pr-3">${cell('availableWorkingState', d.working, 'ON')}</td>
            <td class="py-2 pr-3">${cell('controllerId', d.controllerId)}</td>
            <td class="py-2 text-right whitespace-nowrap">${button('Lưu', { type: 'submit', size: 'sm', attrs: 'form="edit-device"' })} ${button('Huỷ', { act: 'cancel', tone: 'secondary', size: 'sm' })}</td>
          </tr>`
        : `<tr class="border-b border-slate-50">
            <td class="py-2.5 pr-3 font-mono text-xs text-slate-500">${esc(d.id)}</td>
            <td class="py-2.5 pr-3"><div class="flex items-center gap-2"><span class="material-symbols-outlined text-[18px] text-slate-400">${ICON[d.kind]}</span><span class="font-semibold text-slate-800">${esc(d.name)}</span></div></td>
            <td class="py-2.5 pr-3 text-xs">${esc(d.typeCode || '—')}</td>
            <td class="py-2.5 pr-3">${connBadge(d)}</td>
            <td class="py-2.5 pr-3 text-xs font-mono font-semibold text-slate-700" data-status-id="${esc(d.id)}">${formatWorkingState(d)}</td>
            <td class="py-2.5 pr-3 text-xs font-mono text-slate-600">${esc(d.controllerId || '—')}</td>
            <td class="py-2.5 text-right whitespace-nowrap">
              ${button('', { act: 'edit', val: d.id, tone: 'ghost', icon: 'edit', size: 'sm', attrs: 'title="Sửa cấu hình"' })}
              ${button('', { act: 'delete', val: d.id, tone: 'danger', icon: 'delete', size: 'sm', attrs: 'title="Xoá thiết bị"' })}
            </td>
          </tr>`)).join('');
      $('#manage-panel').innerHTML = panel({
        title: `Quản lý thiết bị (${list.length})`, icon: 'settings_remote',
        body: list.length ? `
          <div class="overflow-x-auto"><table class="w-full text-sm">
            <thead><tr class="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
              <th class="py-2 pr-3 font-semibold">ID</th><th class="py-2 pr-3 font-semibold">Tên</th><th class="py-2 pr-3 font-semibold">Loại</th>
              <th class="py-2 pr-3 font-semibold">Kết nối</th><th class="py-2 pr-3 font-semibold">Trạng thái (BE)</th><th class="py-2 pr-3 font-semibold">Controller</th><th></th></tr></thead>
            <tbody>${rows}</tbody></table></div>
          <form id="edit-device" data-id="${esc(editing ?? '')}"></form>`
          : emptyState('devices', 'Nhà này chưa có thiết bị'),
      });
    };

    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const { act, val } = b.dataset;
      const d = find(b.dataset.id ?? val);
      if (act === 'reload') return busy(b, () => refreshHomeData());
      if (act === 'release') {
        try { await releaseOverride(b.dataset.id); toast('Thiết bị đã trở về chế độ tự động', 'sky'); }
        catch (err) { fail(err, 'Không trả được về tự động'); }
        return;
      }
      if (act === 'sleep-now') {
        return busy(b, async () => {
          try {
            const res = await sleepNow(val);
            toast(res?.message ?? 'Đã cập nhật chế độ ngủ', 'sky');
            await refreshHomeData({ silent: true });
          } catch (err) { fail(err, 'Không đổi được chế độ ngủ'); }
        });
      }
      if (act === 'sched-toggle') {
        const s = state.schedules.find((x) => String(x.scheduleId) === String(b.dataset.id));
        if (!s) return;
        try { await api.schedules.setEnabled(state.homeId, s.scheduleId, !s.enabled); toast(s.enabled ? 'Đã tạm dừng hẹn giờ' : 'Đã bật hẹn giờ', 'sky'); }
        catch (err) { fail(err, 'Không đổi được hẹn giờ'); }
        return;
      }
      if (act === 'sched-delete') {
        if (!confirm('Xoá hẹn giờ này?')) return;
        return busy(b, async () => {
          try { await api.schedules.remove(state.homeId, val); toast('Đã xoá hẹn giờ', 'emerald'); }
          catch (err) { fail(err, 'Không xoá được hẹn giờ'); }
        });
      }
      if (act === 'mode') {
        try { await setMode(val); toast(val === 'auto' ? 'Đã bật chế độ tự động' : 'Đã chuyển sang thủ công', 'sky'); }
        catch (err) { fail(err, 'Không đổi được chế độ (cần quyền DEVICE_CONTROL)'); }
        return;
      }

      // Bật/tắt công tắc đèn
      if (act === 'toggle' && d) {
        const nextState = !d.on;
        d.on = nextState;
        d.working = nextState ? 'on' : 'off';

        const stEl = root.querySelector(`[data-status-id="${CSS.escape(d.id)}"]`);
        if (stEl) stEl.textContent = d.working;
        paintDev();

        try {
          await controlDevice(d, { on: nextState });
          toast(`Đã ${nextState ? 'bật' : 'tắt'} ${d.name}`, 'emerald');
        } catch (err) {
          d.on = !nextState;
          d.working = !nextState ? 'on' : 'off';
          if (stEl) stEl.textContent = d.working;
          paintDev();
          fail(err, `Không gửi được lệnh tới ${d.name}`);
        }
        return;
      }

      if (act === 'edit') { editing = val; return paintManage(); }
      if (act === 'cancel') { editing = null; return paintManage(); }
      if (act === 'delete' && d) {
        if (!confirm(`Xoá thiết bị "${d.name}" khỏi nhà?`)) return;
        await busy(b, async () => {
          try { 
            await api.devices.remove(state.homeId, d.id); 
            toast('Đã xoá thiết bị', 'emerald'); 
            await refreshHomeData({ silent: true }); 
          } catch (err) { 
            fail(err, 'Không xoá được thiết bị'); 
          }
        });
      }
    });

    // Kéo thanh trượt quạt: Cập nhật text % trên màn hình ngay tức thì
    root.addEventListener('input', (e) => {
      if (e.target.dataset.act !== 'fan') return;
      const id = e.target.dataset.id;
      const val = +e.target.value;

      const lab = root.querySelector(`[data-fan-val="${CSS.escape(id)}"]`);
      if (lab) lab.textContent = `${val}%`;

      const stEl = root.querySelector(`[data-status-id="${CSS.escape(id)}"]`);
      if (stEl) stEl.textContent = `${val}%`;

      const d = find(id);
      if (d) {
        d.speed = val;
        d.working = String(val);
      }
    });

    // Nhả tay khỏi slider / chọn xong màu mới gửi lệnh xuống MQTT
    root.addEventListener('change', async (e) => {
      if (e.target.form?.id === 'sched-form') {
        if (e.target.name === 'deviceId') e.target.form.querySelector('[name=action]').innerHTML = actionOptions(find(e.target.value));
        if (['deviceId', 'action', 'type'].includes(e.target.name)) syncActionFields();
        return;
      }
      if (e.target.dataset.act === 'color') {
        const d = find(e.target.dataset.id);
        if (!d) return;
        const color = e.target.value.toUpperCase();
        try {
          await controlDevice(d, { color });
          toast(`Đã đổi màu ${d.name}: ${color}`, 'emerald');
        } catch (err) {
          paintDev();
          fail(err, `Không đổi được màu ${d.name}`);
        }
        return;
      }
      if (e.target.dataset.act !== 'fan') return;
      const d = find(e.target.dataset.id);
      if (d) {
        try {
          await controlDevice(d, { speed: +e.target.value });
          toast(`Đã đặt tốc độ ${d.name}: ${+e.target.value}%`, 'emerald');
        } catch (err) {
          fail(err, `Không gửi được lệnh tới ${d.name}`);
        }
      }
    });

    root.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const v = formValues(f);
      if (f.id === 'sched-form') {
        const body = { deviceId: Number(v.deviceId), action: v.action };
        if (v.action === 'SET_SPEED') body.speed = Number(v.speed);
        if (v.action === 'SET_COLOR') body.color = String(v.color).toUpperCase();
        if (v.type === 'after') body.afterMinutes = Number(v.afterMinutes);
        else if (v.type === 'at') {
          const t = new Date(v.runAt);
          if (Number.isNaN(t.getTime()) || t <= new Date()) return toast('Chọn thời điểm ở tương lai', 'rose');
          body.runAt = t.toISOString();
        } else {
          const days = [...f.querySelectorAll('[name=day]:checked')].map((x) => Number(x.value));
          if (!days.length) return toast('Chọn ít nhất 1 ngày', 'rose');
          Object.assign(body, { repeat: true, time: v.time, days });
        }
        await busy(f.querySelector('[type=submit]'), async () => {
          try {
            const res = await api.schedules.create(state.homeId, body);
            const s = res?.data;
            toast(s?.nextRunAt ? `Đã hẹn: ${s.actionText} ${s.deviceName} lúc ${fullTime(Date.parse(s.nextRunAt))}` : 'Đã tạo hẹn giờ', 'emerald');
          } catch (err) { fail(err, 'Không tạo được hẹn giờ'); }
        });
        return;
      }
      if (f.id === 'add-device') {
        if (!v.deviceName || !v.typeCode) return toast('Nhập đủ tên và mã loại thiết bị', 'rose');
        await busy(f.querySelector('[type=submit]'), async () => {
          try {
            await api.devices.create(state.homeId, { deviceName: v.deviceName, typeCode: v.typeCode.toUpperCase() });
            f.reset();
            toast('Đã đăng ký thiết bị', 'emerald');
            await refreshHomeData({ silent: true }); 
          } catch (err) { fail(err, 'Không đăng ký được thiết bị'); }
        });
      } else if (f.id === 'edit-device') {
        const body = {};
        for (const k of ['deviceName', 'connectionState', 'availableWorkingState', 'controllerId']) if (v[k]) body[k] = v[k];
        await busy(root.querySelector('[form="edit-device"][type=submit]'), async () => {
          try {
            await api.devices.update(state.homeId, f.dataset.id, body);
            toast('Đã cập nhật thiết bị', 'emerald');
            editing = null;
            await refreshHomeData({ silent: true }); 
          } catch (err) { fail(err, 'Không cập nhật được'); }
        });
      }
    });

    paintDev();
    paintInsight();
    paintScheduleForm();
    paintScheduleList();
    paintManage();
    // Hết thời gian ưu tiên thì bỏ huy hiệu (không cần sự kiện từ Backend)
    const holdTimer = setInterval(() => { if (state.overrides.length) paintDev(); }, 30_000);
    let schedDevKey = schedDevices().map((d) => `${d.id}:${d.kind}:${d.name}`).join('|');
    const offs = [
      ...['devices', 'loading', 'alerts', 'door', 'doors', 'settings', 'overrides'].map((e) => on(e, paintDev)),
      ...['insight', 'settings'].map((e) => on(e, paintInsight)),
      on('schedules', paintScheduleList),
      on('devices', () => {
        const key = schedDevices().map((d) => `${d.id}:${d.kind}:${d.name}`).join('|');
        if (key !== schedDevKey) { schedDevKey = key; paintScheduleForm(); }
        paintScheduleList();
      }),
      () => clearInterval(holdTimer),
      on('devices', () => { if (editing == null) paintManage(); }),
    ];
    return () => offs.forEach((off) => off());
  },
};

