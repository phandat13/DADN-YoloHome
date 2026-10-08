// Điều khiển thiết bị (UC 3.1): POST /devices/:deviceId/commands (TURN_ON / TURN_OFF / SET_SPEED)
// + quản lý thiết bị: POST / PATCH / DELETE /homes/:homeId/devices
import { state, on, controlDevice, setMode, refreshHomeData } from '../store.js';
import { api } from '../api.js';
import { DEVICE_TYPES } from '../config.js';
import { esc } from '../utils/fields.js';
import { panel, pageTitle, toggle, badge, segmented, button, field, inputCls, emptyState, loadingBlock, errorBlock, toast, busy, formValues, fail } from '../ui.js';

const ICON = { light: 'lightbulb', fan: 'mode_fan', other: 'power', sensor: 'sensors', door: 'door_front' };
const KIND_LABEL = { light: 'Đèn', fan: 'Quạt', other: 'Thiết bị', sensor: 'Cảm biến', door: 'Cửa' };
const connBadge = (d) => (d.online === true ? badge(d.connection || 'Online', 'emerald')
  : d.online === false ? badge(d.connection || 'Offline', 'rose') : badge(d.connection || 'Không rõ', 'slate'));

export const controlPage = {
  mount(root) {
    let editing = null;

    root.innerHTML = pageTitle('Điều khiển thiết bị', 'Đèn, quạt — thủ công trên web hoặc tự động theo cảm biến; lệnh được gửi tới Backend → MQTT',
      button('Tải lại', { act: 'reload', tone: 'secondary', icon: 'refresh' })) + `
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div id="dev-panel" class="lg:col-span-7"></div>
        <div id="add-panel" class="lg:col-span-5"></div>
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

    const control = (d) => (d.kind === 'fan'
      ? `<div class="flex items-center gap-3 shrink-0">
           <input type="range" min="0" max="100" step="10" value="${d.speed ?? 0}" data-act="fan" data-id="${esc(d.id)}" class="w-36 accent-sky-600">
           <b class="w-11 text-right font-mono text-sm text-slate-700" data-fan-val="${esc(d.id)}">${d.speed ?? 0}%</b></div>`
      : toggle(d.on, 'toggle', `data-id="${esc(d.id)}"`));

    const formatWorkingState = (d) => {
      if (d.kind === 'fan') {
        const val = d.speed !== undefined ? d.speed : (!isNaN(d.working) ? d.working : 0);
        return `${val}%`;
      }
      return d.on ? 'on' : (d.working || 'off');
    };

    const paintDev = () => {
      const list = state.devices.filter((d) => ['light', 'fan', 'other'].includes(d.kind));

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
      else if (!list.length) body = emptyState('devices_other', 'Chưa có thiết bị điều khiển', 'Thêm đèn (LIGHT) hoặc quạt (FAN) ở khung "Thêm thiết bị".');
      else body = list.map((d) => row(ICON[d.kind], esc(d.name), `<span>${KIND_LABEL[d.kind]} · ${esc(d.typeCode || '—')} · ID ${esc(d.id)}</span>${connBadge(d)}`, control(d))).join('');

      $('#dev-panel').innerHTML = panel({
        title: 'Thiết bị ngoại vi', icon: 'tune',
        right: segmented([['auto', 'Tự động'], ['manual', 'Thủ công']], state.mode, 'mode'),
        body: `
          ${state.mode === 'auto' ? '<p class="text-xs text-sky-700 bg-sky-50 rounded-lg px-3 py-2 mb-2">Chế độ tự động: đèn theo PIR/ánh sáng, quạt theo nhiệt độ (lệnh gửi thật xuống Backend). Thao tác tay bên dưới sẽ chuyển sang thủ công.</p>' : ''}
          ${body}
          ${row('notifications_active', 'Còi cảnh báo', '<span>Mạch tự kêu khi nhiệt độ vượt ngưỡng — hiển thị theo cảnh báo</span>', badge(state.buzzer ? 'ĐANG KÊU' : 'Tắt', state.buzzer ? 'rose' : 'slate'))}
          ${row('door_front', 'Cửa', `<span>${state.doors.length} cửa · mở bằng mã PIN, FaceAI hoặc từ xa</span>`,
            `<div class="flex items-center gap-2 shrink-0">${badge(state.doorOpen ? 'ĐANG MỞ' : 'Đóng', state.doorOpen ? 'emerald' : 'slate')}<a href="#/door" class="text-xs font-semibold text-sky-600 hover:text-sky-700">Mở trang cửa →</a></div>`)}`,
      });
    };

    $('#add-panel').innerHTML = panel({ title: 'Thêm thiết bị', icon: 'add_circle', body: `
      <form id="add-device" class="space-y-3">
        ${field('Tên thiết bị *', `<input name="deviceName" required class="${inputCls}" placeholder="VD: Đèn phòng khách">`)}
        ${field('Mã loại (typeCode) *', `<input name="typeCode" required list="type-codes" class="${inputCls} uppercase" placeholder="LIGHT">`, 'Gợi ý: LIGHT (đèn), FAN (quạt), SENSOR (cụm cảm biến)…')}
        <datalist id="type-codes">${DEVICE_TYPES.map(([c, l]) => `<option value="${c}">${l}</option>`).join('')}</datalist>
        ${button('Đăng ký thiết bị', { type: 'submit', icon: 'add' })}
      </form>` });

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
      if (act === 'mode') return setMode(val);

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

    // Nhả tay khỏi slider mới bắn API gửi lệnh xuống MQTT
    root.addEventListener('change', async (e) => {
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
    paintManage();
    const offs = [
      ...['devices', 'loading', 'alerts', 'door', 'doors'].map((e) => on(e, paintDev)),
      on('devices', () => { if (editing == null) paintManage(); }),
    ];
    return () => offs.forEach((off) => off());
  },
};

