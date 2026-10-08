// Cài đặt: ngưỡng cảnh báo (cục bộ) + cảm biến IoT (GET/POST /iot/sensors, POST /telemetry) + thông tin kết nối.
import { THRESHOLDS, CONFIG, SENSOR_TYPES, DATA_QUALITIES } from '../config.js';
import { state, on, onChange, applyThresholds, resetThresholds, refreshHomeData } from '../store.js';
import { api } from '../api.js';
import { esc, hhmm, idValue } from '../utils/fields.js';
import { panel, pageTitle, button, field, inputCls, emptyState, errorBlock, linkButton, toast, busy, formValues, fail } from '../ui.js';

const FIELDS = [
  ['TEMP_MAX', 'Nhiệt độ tối đa', '°C', 'Vượt ngưỡng: cảnh báo, quạt 100% (chế độ tự động)'],
  ['HUMIDITY_MIN', 'Độ ẩm tối thiểu', '%', 'Dưới mức này: cảnh báo độ ẩm'],
  ['HUMIDITY_MAX', 'Độ ẩm tối đa', '%', 'Trên mức này: cảnh báo độ ẩm'],
  ['LIGHT_MIN', 'Ánh sáng tối thiểu', 'Lux', 'Dưới mức này: tự bật đèn (chế độ tự động)'],
];
const KIND_LABEL = { temperature: 'Nhiệt độ', humidity: 'Độ ẩm', light: 'Ánh sáng', motion: 'Chuyển động' };

export const settingsPage = {
  mount(root) {
    const hasHome = state.homeId != null;
    root.innerHTML = pageTitle('Cài đặt', 'Ngưỡng cảnh báo, cảm biến IoT của nhà và thông tin kết nối Backend') + `
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        ${panel({ title: 'Ngưỡng cảnh báo', icon: 'settings', cls: 'lg:col-span-7', body: `
          <form id="thresholds" class="space-y-4">
            ${FIELDS.map(([k, label, unit, hint]) => `
              <label class="flex items-center justify-between gap-4">
                <span><span class="block text-sm font-semibold text-slate-800">${label}</span><span class="block text-xs text-slate-400">${hint}</span></span>
                <span class="flex items-center gap-2"><input type="number" step="any" name="${k}" value="${THRESHOLDS[k]}" class="w-24 rounded-lg border-slate-200 text-sm text-right font-mono focus:border-sky-500 focus:ring-sky-500"><span class="text-xs text-slate-400 w-8">${unit}</span></span>
              </label>`).join('')}
            <div class="flex gap-3 pt-2">
              ${button('Lưu ngưỡng', { type: 'submit' })}
              ${button('Khôi phục mặc định', { act: 'reset', tone: 'secondary' })}
            </div>
            <p class="text-[11px] text-slate-400">Backend chưa có API ngưỡng nên giá trị được lưu trên trình duyệt này.</p>
          </form>` })}
        <div id="rules" class="lg:col-span-5"></div>
      </div>
      <div id="sensor-box"></div>
      ${panel({ title: 'Kết nối Backend', icon: 'lan', body: `
        <dl class="grid sm:grid-cols-3 gap-4 text-sm">
          <div><dt class="text-xs text-slate-400">HTTP API</dt><dd class="font-mono text-slate-700 break-all">${esc(CONFIG.API_BASE_URL)}</dd></div>
          <div><dt class="text-xs text-slate-400">Socket.IO</dt><dd class="font-mono text-slate-700 break-all">${esc(CONFIG.SOCKET_URL)}</dd></div>
          <div><dt class="text-xs text-slate-400">Trạng thái realtime</dt><dd id="sock-state" class="font-semibold"></dd></div>
        </dl>
        <p class="text-[11px] text-slate-400 mt-3">Đổi địa chỉ trong <span class="font-mono">js/config.js</span>.</p>` })}`;
    const $ = (s) => root.querySelector(s);

    const paintRules = () => {
      $('#rules').innerHTML = panel({ title: 'Quy tắc tự động', icon: 'rule', body: `
        <ul class="text-sm text-slate-600 space-y-2 list-disc pl-5">
          <li>Số liệu cảm biến đến tức thời qua Socket.IO; REST làm mới mỗi 30 giây.</li>
          <li>Nhiệt độ &gt; ${THRESHOLDS.TEMP_MAX}°C: cảnh báo, quạt 100% (chế độ tự động).</li>
          <li>PIR phát hiện chuyển động hoặc ánh sáng &lt; ${THRESHOLDS.LIGHT_MIN} Lux: bật đèn.</li>
          <li>Chỉ tự động hoá theo số liệu mới (≤ 10 phút); lệnh gửi qua API điều khiển thiết bị.</li>
          <li>Mọi cảnh báo được ghi vào mục Cảnh báo &amp; Lịch sử.</li>
        </ul>` });
    };
    const paintSocket = () => {
      $('#sock-state').innerHTML = state.socketConnected ? '<span class="text-emerald-600">Đã kết nối</span>' : '<span class="text-rose-600">Mất kết nối</span>';
    };

    const fmtValue = (kind) => {
      const v = state.sensor[kind];
      if (v == null) return '—';
      if (kind === 'motion') return v ? 'Phát hiện' : 'Không';
      return `${v}${state.sensor.at[kind] ? ` <span class="text-slate-400">· ${hhmm(state.sensor.at[kind])}</span>` : ''}`;
    };

    const paintSensorTable = () => {
      const el = $('#sensor-table');
      if (!el) return;
      if (state.errors.sensors && !state.sensors.length) { el.innerHTML = errorBlock(`Không tải được cảm biến: ${state.errors.sensors}`); return; }
      if (!state.sensors.length) { el.innerHTML = emptyState('sensors', 'Chưa có cảm biến', 'Đăng ký cảm biến gắn với một thiết bị (VD: cụm DHT22 typeCode SENSOR).'); return; }
      el.innerHTML = `<div class="overflow-x-auto"><table class="w-full text-sm">
        <thead><tr class="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
          <th class="py-2 pr-4 font-semibold">ID</th><th class="py-2 pr-4 font-semibold">Kiểu dữ liệu</th><th class="py-2 pr-4 font-semibold">Đơn vị</th>
          <th class="py-2 pr-4 font-semibold">Thiết bị</th><th class="py-2 pr-4 font-semibold">Hiển thị như</th><th class="py-2 font-semibold">Giá trị mới nhất</th></tr></thead>
        <tbody>${state.sensors.map((s) => {
          const dev = state.devices.find((d) => String(d.id) === String(s.deviceId));
          const isPrimary = s.kind && state.sensors.find((x) => x.kind === s.kind) === s;
          return `<tr class="border-b border-slate-50">
            <td class="py-2 pr-4 font-mono text-xs text-slate-500">${esc(s.id)}</td>
            <td class="py-2 pr-4 font-semibold text-slate-800">${esc(s.dataType || '—')}</td>
            <td class="py-2 pr-4 text-slate-600">${esc(s.unit || '—')}</td>
            <td class="py-2 pr-4 text-slate-600">${dev ? esc(dev.name) : s.deviceId != null ? `#${esc(s.deviceId)}` : '—'}</td>
            <td class="py-2 pr-4 text-xs ${s.kind ? 'text-sky-700' : 'text-slate-400'}">${s.kind ? `${KIND_LABEL[s.kind]}${isPrimary ? '' : ' (phụ)'}` : 'Không nhận diện'}</td>
            <td class="py-2 font-mono text-xs text-slate-700">${isPrimary ? fmtValue(s.kind) : '—'}</td></tr>`;
        }).join('')}</tbody></table></div>`;
    };

    const deviceOptions = () => (state.devices.length
      ? state.devices.map((d) => `<option value="${esc(d.id)}">${esc(d.name)} (#${esc(d.id)})</option>`).join('')
      : '<option value="">(chưa có thiết bị — thêm ở trang Điều khiển)</option>');
    const sensorOptions = () => state.sensors.map((s) => `<option value="${esc(s.id)}">#${esc(s.id)} · ${esc(s.dataType)}${s.unit ? ` (${esc(s.unit)})` : ''}</option>`).join('');

    const paintSensorBox = () => {
      if (!hasHome) {
        $('#sensor-box').innerHTML = panel({ title: 'Cảm biến IoT', icon: 'sensors', body: emptyState('home_work', 'Chưa chọn nhà', '', linkButton('#/homes', 'Nhà của tôi')) });
        return;
      }
      $('#sensor-box').innerHTML = panel({
        title: 'Cảm biến IoT', icon: 'sensors',
        right: button('Tải lại', { act: 'reload', tone: 'secondary', size: 'sm', icon: 'refresh' }),
        body: `
          <div id="sensor-table"></div>
          <div class="grid md:grid-cols-2 gap-6 mt-6 pt-6 border-t border-slate-100">
            <form id="add-sensor" class="space-y-3">
              <div class="text-sm font-bold text-slate-800">Đăng ký cảm biến</div>
              ${field('Thiết bị gắn cảm biến *', `<select name="deviceId" class="${inputCls}" id="sensor-device">${deviceOptions()}</select>`)}
              <div class="grid grid-cols-2 gap-3">
                ${field('Kiểu dữ liệu *', `<select name="dataType" class="${inputCls}">${SENSOR_TYPES.map(([t, , l]) => `<option value="${t}">${t} — ${l}</option>`).join('')}</select>`)}
                ${field('Đơn vị', `<input name="unit" value="${SENSOR_TYPES[0][1]}" class="${inputCls}">`)}
              </div>
              ${button('Đăng ký', { type: 'submit', icon: 'add' })}
            </form>
            <form id="telemetry" class="space-y-3">
              <div class="text-sm font-bold text-slate-800">Gửi giá trị thử (telemetry)</div>
              ${field('Cảm biến', `<select name="sensorId" class="${inputCls}" id="tele-sensor">${sensorOptions()}</select>`)}
              <div class="grid grid-cols-2 gap-3">
                ${field('Giá trị *', `<input name="value" type="number" step="any" class="${inputCls} font-mono" placeholder="28.5">`)}
                ${field('Chất lượng', `<select name="dataQuality" class="${inputCls}">${DATA_QUALITIES.map((q) => `<option>${q}</option>`).join('')}</select>`)}
              </div>
              ${button('Gửi', { type: 'submit', tone: 'secondary', icon: 'upload' })}
              <p class="text-[11px] text-slate-400">Thường do Gateway gọi — dùng để thử luồng khi chưa có phần cứng.</p>
            </form>
          </div>`,
      });
      paintSensorTable();
    };

    root.addEventListener('change', (e) => {
      if (e.target.name !== 'dataType') return;
      const t = SENSOR_TYPES.find(([x]) => x === e.target.value);
      const unit = e.target.form?.querySelector('[name=unit]');
      if (t && unit) unit.value = t[1];
    });

    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'reset') {
        resetThresholds();
        FIELDS.forEach(([k]) => { $(`[name=${k}]`).value = THRESHOLDS[k]; });
        paintRules();
        toast('Đã khôi phục mặc định', 'sky');
      }
      if (b.dataset.act === 'reload') await busy(b, () => refreshHomeData());
    });

    root.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const v = formValues(f);
      const btn = f.querySelector('[type=submit]');
      if (f.id === 'thresholds') {
        const vals = {};
        for (const [k] of FIELDS) vals[k] = parseFloat(v[k]);
        if (Object.values(vals).some((n) => !Number.isFinite(n))) return toast('Vui lòng nhập số hợp lệ', 'rose');
        if (vals.HUMIDITY_MIN >= vals.HUMIDITY_MAX) return toast('Độ ẩm tối thiểu phải nhỏ hơn tối đa', 'rose');
        if (vals.HUMIDITY_MIN < 0 || vals.HUMIDITY_MAX > 100) return toast('Độ ẩm phải trong khoảng 0–100%', 'rose');
        if (vals.LIGHT_MIN < 0) return toast('Ánh sáng tối thiểu không được âm', 'rose');
        applyThresholds(vals);
        paintRules();
        toast('Đã lưu ngưỡng', 'emerald');
      } else if (f.id === 'add-sensor') {
        if (!v.deviceId) return toast('Cần chọn thiết bị — hãy thêm thiết bị trước', 'rose');
        await busy(btn, async () => {
          try {
            await api.iot.addSensor(state.homeId, { deviceId: idValue(v.deviceId), dataType: v.dataType, unit: v.unit });
            toast('Đã đăng ký cảm biến', 'emerald');
            await refreshHomeData({ silent: true });
          } catch (err) { fail(err, 'Không đăng ký được cảm biến'); }
        });
      } else if (f.id === 'telemetry') {
        const value = parseFloat(v.value);
        if (!v.sensorId) return toast('Chưa có cảm biến', 'rose');
        if (!Number.isFinite(value)) return toast('Giá trị phải là số', 'rose');
        await busy(btn, async () => {
          try {
            await api.iot.pushTelemetry(state.homeId, idValue(v.sensorId), value, v.dataQuality);
            toast('Đã gửi giá trị — sensor_update sẽ cập nhật dashboard', 'emerald');
            f.querySelector('[name=value]').value = '';
            setTimeout(() => refreshHomeData({ silent: true }), 600);
          } catch (err) { fail(err, 'Không gửi được'); }
        });
      }
    });

    paintRules();
    paintSocket();
    paintSensorBox();
    const offs = [
      on('socket', paintSocket),
      on('sensor', paintSensorTable),
      onChange(['sensors', 'devices', 'loading'], () => JSON.stringify([state.sensors.map((s) => [s.id, s.dataType, s.unit]), state.devices.map((d) => [d.id, d.name]), state.errors.sensors]), () => {
        paintSensorTable();
        const dev = $('#sensor-device'), tele = $('#tele-sensor');
        if (dev) { const keep = dev.value; dev.innerHTML = deviceOptions(); if ([...dev.options].some((o) => o.value === keep)) dev.value = keep; }
        if (tele) { const keep = tele.value; tele.innerHTML = sensorOptions(); if ([...tele.options].some((o) => o.value === keep)) tele.value = keep; }
      }),
    ];
    return () => offs.forEach((off) => off());
  },
};


