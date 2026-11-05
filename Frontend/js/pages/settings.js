// Cài đặt: ngưỡng cảnh báo (lưu ở Backend: GET/PUT /homes/:homeId/settings) + cảm biến IoT (GET/POST /iot/sensors, POST /telemetry) + thông tin kết nối.
import { THRESHOLDS, CONFIG, SENSOR_TYPES, DATA_QUALITIES } from '../config.js';
import { state, on, onChange, applyThresholds, resetThresholds, refreshHomeData, saveSleepSettings, sleepNow } from '../store.js';
import { api } from '../api.js';
import { esc, hhmm, idValue } from '../utils/fields.js';
import { panel, pageTitle, button, field, inputCls, emptyState, errorBlock, linkButton, toast, busy, formValues, fail, toggle } from '../ui.js';

const FIELDS = [
  ['TEMP_MAX', 'Nhiệt độ tối đa', '°C', 'Vượt ngưỡng: cảnh báo, quạt 50% → 75% → 100% theo mức nóng, bật còi'],
  ['HUMIDITY_MIN', 'Độ ẩm tối thiểu', '%', 'Dưới mức này: cảnh báo độ ẩm'],
  ['HUMIDITY_MAX', 'Độ ẩm tối đa', '%', 'Trên mức này: cảnh báo độ ẩm'],
  ['LIGHT_MIN', 'Ánh sáng tối thiểu', 'Lux', 'Dưới mức này và có người: tự bật đèn (chế độ tự động)'],
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
            <p class="text-[11px] text-slate-400">Ngưỡng lưu ở Backend, áp dụng cho mọi thành viên của nhà. Cần quyền DEVICE_MANAGE để sửa.</p>
          </form>` })}
        <div id="rules" class="lg:col-span-5"></div>
        <div id="sleep-box" class="lg:col-span-12"></div>
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
          <li>Quy tắc chạy trên Backend mỗi khi có số liệu mới — không cần mở web.</li>
          <li>Nhiệt độ &gt; ${THRESHOLDS.TEMP_MAX}°C: cảnh báo, bật còi, quạt 50%; &gt; ${THRESHOLDS.TEMP_MAX + 2}°C: 75%; &gt; ${THRESHOLDS.TEMP_MAX + 4}°C: 100%. Tắt quạt khi ≤ ${THRESHOLDS.TEMP_MAX - 1}°C.</li>
          <li>Đèn chỉ bật khi trời tối (&lt; ${THRESHOLDS.LIGHT_MIN} Lux) <b>và</b> có người (PIR). Không thấy người vài phút thì tắt, dù sáng hay tối.</li>
          <li>Giờ ngủ: tắt đèn lúc bắt đầu, giữ đèn tắt kể cả khi tối / có chuyển động; còi chỉ kêu khi &gt; ${THRESHOLDS.TEMP_MAX + 5}°C.</li>
          <li>Ưu tiên: <b>giọng nói</b> &gt; thao tác web / hẹn giờ / giờ ngủ &gt; tự động. Thiết bị vừa được điều khiển tay chỉ bị “giữ” riêng trong ${state.overrideMinutes} phút.</li>
          <li>Chỉ tự động hoá theo số liệu mới (≤ 10 phút).</li>
          <li>Cảnh báo mới được gửi vào Thông báo của chủ nhà và hiện trên LCD qua trợ lý.</li>
        </ul>` });
    };
    const paintSleep = () => {
      if (!hasHome) { $('#sleep-box').innerHTML = ''; return; }
      const sl = state.sleep;
      const status = sl.sleeping ? '<span class="text-indigo-600 font-semibold">Đang ngủ</span>' : '<span class="text-amber-600 font-semibold">Đang thức</span>';
      const manual = sl.manual !== 'NONE' && sl.manualUntil && Date.parse(sl.manualUntil) > Date.now()
        ? ` · theo lệnh "${sl.manual === 'SLEEP' ? 'đi ngủ' : 'thức dậy'}" tới ${hhmm(Date.parse(sl.manualUntil))}` : '';
      $('#sleep-box').innerHTML = panel({ title: 'Chế độ ngủ & ưu tiên lệnh', icon: 'bedtime', body: `
        <div class="grid md:grid-cols-2 gap-6">
          <form id="sleep-form" class="space-y-4">
            <label class="flex items-center justify-between gap-4">
              <span><span class="block text-sm font-semibold text-slate-800">Tự động theo khung giờ ngủ</span><span class="block text-xs text-slate-400">Bắt đầu giờ ngủ: tắt mọi đèn, không tự bật lại tới giờ thức dậy</span></span>
              ${toggle(sl.enabled, 'sleep-enabled')}
            </label>
            <div class="grid grid-cols-3 gap-3">
              ${field('Đi ngủ lúc', `<input name="sleepStart" type="time" value="${esc(sl.start)}" class="${inputCls}">`)}
              ${field('Thức dậy lúc', `<input name="sleepEnd" type="time" value="${esc(sl.end)}" class="${inputCls}">`)}
              ${field('Ưu tiên lệnh tay (phút)', `<input name="overrideMinutes" type="number" min="0" max="1440" value="${state.overrideMinutes}" class="${inputCls} font-mono">`)}
            </div>
            ${button('Lưu', { type: 'submit' })}
            <p class="text-[11px] text-slate-400">Cần quyền DEVICE_MANAGE. "Ưu tiên lệnh tay" = số phút tự động hoá không đảo lại thiết bị vừa bị điều khiển bằng tay / giọng nói (0 = không giữ).</p>
          </form>
          <div class="space-y-3">
            <div class="text-sm text-slate-600">Hiện tại: ${status}${manual}</div>
            <div class="flex flex-wrap gap-2">
              ${button('Đi ngủ ngay', { act: 'sleep-now', val: 'sleep', icon: 'bedtime' })}
              ${button('Thức dậy', { act: 'sleep-now', val: 'awake', tone: 'secondary', icon: 'wb_sunny' })}
              ${button('Theo khung giờ', { act: 'sleep-now', val: 'auto', tone: 'ghost', icon: 'schedule' })}
            </div>
            <p class="text-xs text-slate-500">Cũng có thể nói <i>"chúc ngủ ngon"</i>, <i>"tắt đèn đi ngủ"</i> hoặc <i>"thức dậy"</i>. Lệnh "đi ngủ" có hiệu lực tới giờ thức dậy; "thức dậy" có hiệu lực tới giờ ngủ kế tiếp.</p>
          </div>
        </div>` });
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
        await busy(b, async () => {
          try {
            await resetThresholds();
            fillThresholds();
            paintRules();
            toast('Đã khôi phục mặc định', 'sky');
          } catch (err) { fail(err, 'Không lưu được ngưỡng'); }
        });
      }
      if (b.dataset.act === 'reload') await busy(b, () => refreshHomeData());
      if (b.dataset.act === 'sleep-enabled') {
        const on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(on));
        b.classList.toggle('bg-sky-600', on); b.classList.toggle('bg-slate-300', !on);
        b.firstElementChild.classList.toggle('translate-x-5', on);
      }
      if (b.dataset.act === 'sleep-now') {
        await busy(b, async () => {
          try { const res = await sleepNow(b.dataset.val); toast(res?.message ?? 'Đã cập nhật', 'sky'); await refreshHomeData({ silent: true }); }
          catch (err) { fail(err, 'Không đổi được chế độ ngủ'); }
        });
      }
    });

    root.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const v = formValues(f);
      const btn = f.querySelector('[type=submit]');
      if (f.id === 'sleep-form') {
        if (!v.sleepStart || !v.sleepEnd) return toast('Nhập đủ giờ ngủ và giờ thức dậy', 'rose');
        if (v.sleepStart === v.sleepEnd) return toast('Giờ ngủ và giờ thức dậy phải khác nhau', 'rose');
        const overrideMinutes = Number(v.overrideMinutes);
        if (!Number.isInteger(overrideMinutes) || overrideMinutes < 0 || overrideMinutes > 1440) return toast('Số phút ưu tiên phải là số nguyên 0–1440', 'rose');
        const sleepEnabled = f.querySelector('[data-act=sleep-enabled]').getAttribute('aria-pressed') === 'true';
        await busy(btn, async () => {
          try { await saveSleepSettings({ sleepEnabled, sleepStart: v.sleepStart, sleepEnd: v.sleepEnd, overrideMinutes }); toast('Đã lưu chế độ ngủ', 'emerald'); }
          catch (err) { fail(err, 'Không lưu được chế độ ngủ'); }
        });
        return;
      }
      if (f.id === 'thresholds') {
        const vals = {};
        for (const [k] of FIELDS) vals[k] = parseFloat(v[k]);
        if (Object.values(vals).some((n) => !Number.isFinite(n))) return toast('Vui lòng nhập số hợp lệ', 'rose');
        if (vals.HUMIDITY_MIN >= vals.HUMIDITY_MAX) return toast('Độ ẩm tối thiểu phải nhỏ hơn tối đa', 'rose');
        if (vals.HUMIDITY_MIN < 0 || vals.HUMIDITY_MAX > 100) return toast('Độ ẩm phải trong khoảng 0–100%', 'rose');
        if (vals.LIGHT_MIN < 0) return toast('Ánh sáng tối thiểu không được âm', 'rose');
        if (!hasHome) return toast('Chưa chọn nhà', 'rose');
        await busy(btn, async () => {
          try {
            await applyThresholds(vals);
            paintRules();
            toast('Đã lưu ngưỡng', 'emerald');
          } catch (err) { fail(err, 'Không lưu được ngưỡng'); }
        });
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

    const fillThresholds = () => FIELDS.forEach(([k]) => { const el = $(`[name=${k}]`); if (el && document.activeElement !== el) el.value = THRESHOLDS[k]; });

    paintRules();
    paintSleep();
    paintSocket();
    paintSensorBox();
    // Vẽ lại khung ngủ khi cài đặt đổi, trừ lúc đang sửa form (tránh mất giá trị đang nhập)
    const sleepSig = () => JSON.stringify([state.sleep, state.overrideMinutes]);
    const offs = [
      onChange('settings', sleepSig, () => { if (!root.querySelector('#sleep-form')?.contains(document.activeElement)) paintSleep(); }),
      on('settings', () => { fillThresholds(); paintRules(); }),
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


