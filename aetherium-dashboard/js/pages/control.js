import { state, on, setDevice, setMode, openDoor, setPassword, addLog } from '../store.js';
import { panel, pageTitle, toggle, badge, segmented, toast } from '../ui.js';

const PROMPTS = ['Nhập mật mã hiện tại (lần 1) rồi nhấn F', 'Nhập lại mật mã hiện tại (lần 2) rồi nhấn F', 'Nhập mật mã mới rồi nhấn F'];
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'F'];

export const controlPage = {
  mount(root) {
    let buf = '', mode = 'open', step = 0, msg = null;   // trạng thái bàn phím mật mã (remote)
    root.innerHTML = pageTitle('Điều khiển thiết bị', 'Đèn, quạt và cửa mật mã — thủ công trên web hoặc tự động theo cảm biến') +
      `<div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
         <div id="dev-panel" class="lg:col-span-7"></div>
         <div id="door-panel" class="lg:col-span-5"></div>
       </div>`;
    const devEl = root.querySelector('#dev-panel'), doorEl = root.querySelector('#door-panel');

    const row = (icon, label, sub, ctrl) => `
      <div class="flex items-center justify-between py-4 border-b border-slate-100 last:border-0">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-slate-50 text-slate-600 flex items-center justify-center"><span class="material-symbols-outlined text-[20px]">${icon}</span></div>
          <div><div class="text-sm font-semibold text-slate-800">${label}</div><div class="text-xs text-slate-400">${sub}</div></div>
        </div>${ctrl}
      </div>`;

    const paintDev = () => {
      const d = state.devices;
      devEl.innerHTML = panel({
        title: 'Thiết bị ngoại vi', icon: 'tune',
        right: segmented([['auto', 'Tự động'], ['manual', 'Thủ công']], d.mode, 'mode'),
        body: `
          ${d.mode === 'auto' ? '<p class="text-xs text-sky-700 bg-sky-50 rounded-lg px-3 py-2 mb-2">Chế độ tự động: đèn theo PIR/ánh sáng, quạt theo nhiệt độ. Thao tác bên dưới sẽ chuyển sang thủ công.</p>' : ''}
          ${row('lightbulb', 'Đèn', 'Kênh V10', toggle(d.light, 'light'))}
          ${row('mode_fan', 'Quạt', 'Kênh V12 • tốc độ ' + `<b id="fan-val">${d.fan}</b>%`,
            `<input type="range" min="0" max="100" step="25" value="${d.fan}" data-act="fan" class="w-40 accent-sky-600">`)}
          ${row('notifications_active', 'Còi cảnh báo', 'Tự bật khi nhiệt độ vượt ngưỡng', badge(d.buzzer ? 'ĐANG KÊU' : 'Tắt', d.buzzer ? 'rose' : 'slate'))}
          ${row('door_front', 'Cửa', 'Servo • mở 2 giây khi đúng mật mã', badge(d.door ? 'ĐANG MỞ' : 'Đóng', d.door ? 'emerald' : 'slate'))}`,
      });
    };

    const paintDoor = () => {
      const tone = msg ? (msg.ok ? 'text-emerald-600' : 'text-rose-600') : 'text-slate-500';
      doorEl.innerHTML = panel({
        title: 'Cửa mật mã', icon: 'lock',
        right: segmented([['open', 'Mở cửa'], ['change', 'Đổi mật mã']], mode, 'kptab'),
        body: `
          <div class="rounded-lg bg-teal-900/90 text-teal-200 font-mono p-3 text-center tracking-[0.5em] text-lg min-h-[3rem]">${buf ? '●'.repeat(buf.length) : '_ _ _ _'}</div>
          <p class="text-xs mt-2 min-h-[2rem] font-semibold ${tone}">${msg ? msg.text : (mode === 'open' ? 'Nhập mật mã rồi nhấn F để xác nhận' : PROMPTS[step])}</p>
          <div class="grid grid-cols-3 gap-2 mt-2">
            ${KEYS.map((k) => `<button type="button" data-act="key" data-val="${k}" class="py-3 rounded-lg font-mono font-bold active:scale-95 transition ${
              k === 'F' ? 'bg-sky-600 text-white hover:bg-sky-500' : k === 'C' ? 'bg-rose-50 text-rose-600 hover:bg-rose-100' : 'bg-slate-50 text-slate-800 hover:bg-slate-100'}">${k}</button>`).join('')}
          </div>
          <p class="text-[11px] text-slate-400 mt-3">Phím giả lập remote: số = nhập, F = xác nhận, C = xoá. Mật mã mặc định: 1234.</p>`,
      });
    };

    const confirm = () => {
      if (!buf) return;                                   // bấm F khi chưa nhập: bỏ qua
      const wrong = () => { msg = { ok: false, text: 'SAI MAT MA' }; step = 0; addLog('door', 'Nhập sai mật mã'); };
      if (mode === 'open') {
        if (buf === state.password) { msg = { ok: true, text: 'Đúng mật mã — cửa đang mở' }; openDoor('mật mã'); } else wrong();
      } else if (step < 2) {
        if (buf === state.password) { step++; msg = null; } else wrong();
      } else {
        setPassword(buf); step = 0; mode = 'open'; msg = { ok: true, text: 'Đã đổi mật mã thành công' }; toast('Đã đổi mật mã', 'emerald');
      }
      buf = '';
    };

    root.onclick = (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const { act, val } = b.dataset;
      if (act === 'light') setDevice('light', !state.devices.light);
      else if (act === 'mode') setMode(val);
      else if (act === 'kptab') { mode = val; buf = ''; step = 0; msg = null; paintDoor(); }
      else if (act === 'key') {
        if (val === 'C') { buf = ''; msg = null; } else if (val === 'F') confirm(); else if (buf.length < 8) { buf += val; msg = null; }
        paintDoor();
      }
    };
    root.oninput = (e) => { if (e.target.dataset.act === 'fan') root.querySelector('#fan-val').textContent = e.target.value; };
    root.onchange = (e) => { if (e.target.dataset.act === 'fan') setDevice('fan', +e.target.value); };

    paintDev(); paintDoor();
    const off = on('devices', paintDev);
    return () => off();
  },
};
