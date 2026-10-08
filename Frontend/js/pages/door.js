// Cửa thông minh (UC 3.2): verify-pin (public), change-pin, pins, credentials, unlock, attempts, tạo cửa.
import { state, on, onChange, markDoorOpened, markDoorLocked, refreshHomeData, addLog } from '../store.js';
import { api } from '../api.js';
import { PIN_PATTERN } from '../config.js';
import { asList, asObject, deepFind, pick, esc, fullTime, toTs } from '../utils/fields.js';
import { normAttempt, normCredential } from '../models.js';
import { panel, pageTitle, badge, segmented, button, field, inputCls, emptyState, loadingBlock, errorBlock, toast, busy, formValues, fail } from '../ui.js';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'F'];
const CHANGE_PROMPTS = ['Nhập mã PIN hiện tại rồi nhấn F', 'Nhập mã PIN mới (4–8 số) rồi nhấn F', 'Nhập lại mã PIN mới rồi nhấn F'];
let selected = null;           // tên cửa đang chọn (giữ khi chuyển trang)
const issued = {};             // credential đã cấp trong phiên này: { [doorName]: [{ id, ts }] }

export const doorPage = {
  mount(root) {
    let buf = '', mode = 'open', step = 0, oldPin = '', newPin = '', msg = null;
    let attempts = null, attemptsErr = null, alive = true;
    let creds = null, credsErr = null;          // GET /doors/:doorName/credentials (cần DOOR_MANAGE)
    const door = () => state.doors.find((d) => d.name === selected) ?? null;
    const ensureSelected = () => { if (!state.doors.some((d) => d.name === selected)) selected = state.doors[0]?.name ?? null; };

    root.innerHTML = pageTitle('Cửa thông minh', 'Bàn phím ảo trước cửa, mở khoá từ xa, quản lý mã PIN và lịch sử truy cập',
      '<div id="door-picker" class="flex items-center gap-2"></div>') + `
      <div id="door-empty" data-hide-empty></div>
      <div id="door-main" class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div id="keypad" class="lg:col-span-5"></div>
        <div class="lg:col-span-7 space-y-6">
          <div id="door-ctrl"></div>
          ${panel({ title: 'Mã PIN & quyền mở cửa', icon: 'key', body: `
            <div id="cred-list" class="mb-4"></div>
            <div class="grid sm:grid-cols-2 gap-4">
              <form id="issue-pin" class="flex gap-2 items-end">
                ${field('Cấp mã PIN mới', `<input name="pin" inputmode="numeric" maxlength="8" placeholder="4–8 chữ số" class="${inputCls} font-mono">`)}
                ${button('Cấp', { type: 'submit', icon: 'add' })}
              </form>
              <form id="revoke-cred" class="flex gap-2 items-end">
                ${field('Thu hồi theo Credential ID', `<input name="credentialId" class="${inputCls} font-mono" placeholder="VD: 12">`)}
                ${button('Thu hồi', { type: 'submit', tone: 'danger', icon: 'block' })}
              </form>
            </div>
            <p class="text-[11px] text-slate-400 mt-3">Cần quyền DOOR_MANAGE. Đổi mã PIN dùng tab "Đổi mã PIN" trên bàn phím (nhập mã hiện tại của cửa này).</p>` })}
          ${panel({ title: 'Thêm cửa', icon: 'add_box', body: `
            <form data-form="create-door" class="flex gap-2 items-end">
              ${field('Tên cửa', `<input name="doorName" placeholder="VD: Cửa chính" class="${inputCls}">`)}
              ${button('Tạo cửa', { type: 'submit', icon: 'add' })}
            </form>
            <p class="text-[11px] text-slate-400 mt-2">Cần quyền DEVICE_MANAGE. Tên có dấu cách được tự động mã hoá trên URL.</p>` })}
        </div>
        <div id="door-attempts" class="lg:col-span-12"></div>
      </div>`;
    const $ = (s) => root.querySelector(s);

    const paintPicker = () => {
      $('#door-picker').innerHTML = state.doors.length ? `
        <select id="door-select" class="rounded-lg border-slate-200 text-sm font-semibold py-2 pl-3 pr-9 focus:border-sky-500 focus:ring-sky-500">
          ${state.doors.map((d) => `<option value="${esc(d.name)}" ${d.name === selected ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
        </select>${button('', { act: 'refresh', tone: 'secondary', icon: 'refresh', attrs: 'title="Tải lại"' })}` : '';
    };

    const paintEmpty = () => {
      const has = state.doors.length > 0;
      $('#door-main').classList.toggle('hidden', !has);
      let body;
      if (has) body = '';
      else if (state.loading) body = loadingBlock();
      else if (state.errors.doors) body = errorBlock(`Không tải được danh sách cửa: ${state.errors.doors}`);
      else {
        body = `<div class="bg-white rounded-xl border border-slate-200/80 shadow-sm p-6">${emptyState('door_front', 'Nhà này chưa có cửa nào', 'Tạo cửa để dùng bàn phím mã PIN, FaceAI và mở khoá từ xa.')}
          <form data-form="create-door" class="flex gap-2 items-end max-w-md mx-auto">
            ${field('Tên cửa', `<input name="doorName" placeholder="VD: Cửa chính" class="${inputCls}">`)}${button('Tạo cửa', { type: 'submit', icon: 'add' })}
          </form></div>`;
      }
      $('#door-empty').innerHTML = body;
    };

    const paintKeypad = () => {
      const d = door();
      if (!d) return;
      const tone = msg ? (msg.ok === true ? 'text-emerald-600' : msg.ok === false ? 'text-rose-600' : 'text-sky-600') : 'text-slate-500';
      const hint = mode === 'open' ? 'Nhập mã PIN rồi nhấn F để mở cửa' : CHANGE_PROMPTS[step];
      $('#keypad').innerHTML = panel({
        title: `Bàn phím · ${esc(d.name)}`, icon: 'dialpad',
        right: segmented([['open', 'Mở cửa'], ['change', 'Đổi mã PIN']], mode, 'kptab'),
        body: `
          <div class="rounded-lg bg-teal-900/90 text-teal-200 font-mono p-3 text-center tracking-[0.5em] text-lg min-h-[3rem]">${buf ? '●'.repeat(buf.length) : '_ _ _ _'}</div>
          <p class="text-xs mt-2 min-h-[2rem] font-semibold ${tone}">${esc(msg ? msg.text : hint)}</p>
          <div class="grid grid-cols-3 gap-2 mt-2">
            ${KEYS.map((k) => `<button type="button" data-act="key" data-val="${k}" class="py-3 rounded-lg font-mono font-bold active:scale-95 transition ${
              k === 'F' ? 'bg-sky-600 text-white hover:bg-sky-500' : k === 'C' ? 'bg-rose-50 text-rose-600 hover:bg-rose-100' : 'bg-slate-50 text-slate-800 hover:bg-slate-100'}">${k}</button>`).join('')}
          </div>
          <p class="text-[11px] text-slate-400 mt-3">Phím giả lập remote: số = nhập, F = xác nhận, C = xoá. Mở cửa gọi API công khai <span class="font-mono">verify-pin</span>; sai 5 lần trong 10 phút sẽ bị tạm khoá (HTTP 429).</p>`,
      });
    };

    // Trạng thái khoá theo Backend + đếm ngược tới lúc tự khoá
    const lockBadge = (d) => {
      if (!/unlocked/i.test(d.state)) return badge('ĐÃ KHOÁ', 'slate');
      const left = d.autoLockAt ? Math.max(0, Math.ceil((d.autoLockAt - Date.now()) / 1000)) : null;
      return badge(left != null ? `ĐANG MỞ · tự khoá sau ${left}s` : 'ĐANG MỞ', 'emerald');
    };

    const paintCtrl = () => {
      const d = door();
      if (!d) return;
      const secs = d.autoLockSeconds;
      $('#door-ctrl').innerHTML = panel({
        title: 'Điều khiển từ xa', icon: 'lock_open',
        right: `<span id="door-lock-badge">${lockBadge(d)}</span>`,
        body: `
          <div class="flex flex-wrap items-center gap-2">
            ${button('Mở khoá', { act: 'unlock', val: 'unlocked', icon: 'lock_open' })}
            ${button('Khoá', { act: 'unlock', val: 'locked', tone: 'secondary', icon: 'lock' })}
            <span class="text-xs text-slate-400 ml-1">Cửa: <b class="text-slate-700">${esc(d.name)}</b>${d.id != null ? ` · ID ${esc(d.id)}` : ''}</span>
          </div>
          <p class="text-[11px] text-slate-400 mt-3">Gửi lệnh MQTT lên feed <span class="font-mono">smart-door</span> qua <span class="font-mono">POST /doors/:doorName/unlock</span> (cần quyền DOOR_MANAGE).
            ${secs ? `Sau khi mở (PIN, FaceAI hoặc từ xa), cửa tự khoá sau <b>${secs} giây</b> và gửi <span class="font-mono">LOCK_DOOR</span> lên feed.` : 'Tự khoá đang tắt (DOOR_AUTO_LOCK_SECONDS=0).'}</p>`,
      });
    };

    const paintCreds = () => {
      const d = door();
      if (!d) return;
      const map = new Map();
      d.credentials.forEach((c) => map.set(String(c.id), c));
      (creds ?? []).forEach((c) => map.set(String(c.id), c));
      (issued[d.name] ?? []).forEach((c) => { if (!map.has(String(c.id))) map.set(String(c.id), { ...c, type: 'PIN', status: 'Vừa cấp' }); });
      const list = [...map.values()].filter((c) => c.id != null).sort((a, b) => Number(b.id) - Number(a.id));
      const active = (c) => !/revoked|expired|inactive/i.test(c.status || '');
      let html;
      if (list.length) {
        html = `
        <div class="divide-y divide-slate-100 border border-slate-100 rounded-lg">
          ${list.map((c) => `<div class="flex items-center justify-between px-3 py-2 text-sm ${active(c) ? '' : 'opacity-60'}">
            <div class="flex items-center gap-2 flex-wrap"><span class="material-symbols-outlined text-[18px] text-slate-400">password</span>
              <span class="font-mono text-slate-700">#${esc(c.id)}</span>${badge(c.type, 'sky')}${c.status ? badge(c.status, active(c) ? 'emerald' : 'slate') : ''}
              ${c.owner ? `<span class="text-xs text-slate-600">${esc(c.owner)}</span>` : ''}
              <span class="text-xs text-slate-400">${c.expired ? `hết hạn ${fullTime(toTs(c.expired))}` : c.ts ? fullTime(c.ts) : ''}</span></div>
            ${active(c) ? button('Thu hồi', { act: 'revoke', val: c.id, tone: 'danger', size: 'sm' }) : ''}
          </div>`).join('')}
        </div>`;
      } else if (creds === null) html = loadingBlock('Đang tải danh sách mã PIN…');
      else if (credsErr) html = `<p class="text-xs text-slate-400">${esc(credsErr)}</p>`;
      else html = '<p class="text-xs text-slate-400">Cửa này chưa có mã PIN nào.</p>';
      $('#cred-list').innerHTML = html;
    };

    const loadCreds = async () => {
      const d = door();
      if (!d) return;
      try {
        const res = await api.doors.credentials(state.homeId, d.name);
        if (!alive || d.name !== selected) return;
        creds = asList(res, 'credentials').map(normCredential);
        credsErr = null;
      } catch (e) {
        if (!alive || d.name !== selected) return;
        creds = [];
        credsErr = e.status === 403 ? 'Cần quyền DOOR_MANAGE để xem danh sách mã PIN.' : `Không tải được danh sách mã PIN: ${e.message}`;
      }
      paintCreds();
    };

    const paintAttempts = () => {
      const d = door();
      if (!d) return;
      let body;
      if (attempts === null) body = loadingBlock();
      else if (attemptsErr) body = errorBlock(`Không tải được lịch sử truy cập: ${attemptsErr}`);
      else if (!attempts.length) body = emptyState('history', 'Chưa có lượt truy cập nào');
      else {
        body = `<div class="overflow-x-auto"><table class="w-full text-sm">
          <thead><tr class="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
            <th class="py-2 pr-4 font-semibold">Thời gian</th><th class="py-2 pr-4 font-semibold">Kết quả</th><th class="py-2 pr-4 font-semibold">Phương thức</th>
            <th class="py-2 pr-4 font-semibold">Người dùng</th><th class="py-2 font-semibold">Chi tiết</th></tr></thead>
          <tbody>${attempts.slice(0, 100).map((a) => `<tr class="border-b border-slate-50">
            <td class="py-2 pr-4 font-mono text-xs text-slate-500 whitespace-nowrap">${fullTime(a.ts)}</td>
            <td class="py-2 pr-4">${badge(a.result || (a.ok ? 'Thành công' : a.ok === false ? 'Thất bại' : '—'), a.ok ? 'emerald' : a.ok === false ? 'rose' : 'slate')}</td>
            <td class="py-2 pr-4 text-slate-600">${esc(a.method || '—')}</td>
            <td class="py-2 pr-4 text-slate-600">${esc(a.actor || '—')}</td>
            <td class="py-2 text-slate-500 text-xs">${esc(a.detail || '')}</td></tr>`).join('')}</tbody></table></div>`;
      }
      $('#door-attempts').innerHTML = panel({
        title: `Lịch sử truy cập · ${esc(d.name)}${attempts?.length ? ` (${attempts.length})` : ''}`, icon: 'manage_history',
        right: button('Tải lại', { act: 'reload-attempts', tone: 'secondary', size: 'sm', icon: 'refresh' }), body,
      });
    };

    const loadAttempts = async () => {
      const d = door();
      if (!d) return;
      try {
        const res = await api.doors.attempts(state.homeId, d.name);
        if (!alive || d.name !== selected) return;
        attempts = asList(res, 'attempts').map(normAttempt).sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
        attemptsErr = null;
      } catch (e) {
        if (!alive || d.name !== selected) return;
        attempts = [];
        attemptsErr = e.message;
      }
      paintAttempts();
    };

    const paintAll = () => {
      ensureSelected();
      paintPicker(); paintEmpty(); paintKeypad(); paintCtrl(); paintCreds(); paintAttempts();
    };

    const resetKeypad = () => { buf = ''; step = 0; oldPin = ''; newPin = ''; msg = null; };

    // Phím F
    const confirmKey = async () => {
      const d = door();
      if (!buf || !d) return;
      const pin = buf;
      buf = '';
      if (!PIN_PATTERN.test(pin)) { msg = { ok: false, text: 'Mã PIN gồm 4–8 chữ số' }; return paintKeypad(); }

      if (mode === 'open') {
        msg = { ok: null, text: 'Đang xác thực…' };
        paintKeypad();
        try {
          const res = await api.doors.verifyPin(state.homeId, d.name, pin);
          const info = res?.data ?? {};
          if (info.mqttPublished === false) msg = { ok: false, text: `ĐÚNG MÃ PIN nhưng chưa gửi được lệnh tới Adafruit — ${res.message}` };
          else msg = { ok: true, text: `ĐÚNG MÃ PIN — cửa đang mở${info.autoLockSeconds ? `, tự khoá sau ${info.autoLockSeconds}s` : ''}` };
          markDoorOpened('mã PIN', d.name, info);
          setTimeout(loadAttempts, 500);
        } catch (e) {
          if (e.status === 429) msg = { ok: false, text: 'TẠM KHOÁ: nhập sai quá 5 lần trong 10 phút, vui lòng thử lại sau' };
          else if ([400, 401, 403].includes(e.status)) msg = { ok: false, text: `SAI MÃ PIN — ${e.message}` };
          else msg = { ok: false, text: e.message };
          addLog('door', `Nhập mã PIN thất bại tại "${d.name}": ${msg.text}`);
          setTimeout(loadAttempts, 500);
        }
        if (alive) paintKeypad();
        return;
      }

      if (step === 0) { oldPin = pin; step = 1; msg = null; }
      else if (step === 1) { newPin = pin; step = 2; msg = null; }
      else if (pin !== newPin) { resetKeypad(); msg = { ok: false, text: 'Mã PIN nhập lại không khớp — làm lại từ đầu' }; }
      else {
        msg = { ok: null, text: 'Đang đổi mã PIN…' };
        paintKeypad();
        try {
          await api.doors.changePin(state.homeId, d.name, oldPin, newPin);
          resetKeypad();
          mode = 'open';
          msg = { ok: true, text: 'Đã đổi mã PIN thành công' };
          toast('Đã đổi mã PIN', 'emerald');
          addLog('door', `Đổi mã PIN cửa "${d.name}"`);
          loadCreds();
        } catch (e) {
          resetKeypad();
          msg = { ok: false, text: `Không đổi được mã PIN — ${e.message}` };
        }
      }
      if (alive) paintKeypad();
    };

    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const { act, val } = b.dataset;
      const d = door();
      if (act === 'refresh') return busy(b, () => refreshHomeData());
      if (act === 'kptab') { mode = val; resetKeypad(); return paintKeypad(); }
      if (act === 'key') {
        if (val === 'C') { buf = ''; msg = null; }
        else if (val === 'F') return confirmKey();
        else if (buf.length < 8) { buf += val; msg = null; }
        return paintKeypad();
      }
      if (act === 'reload-attempts') { attempts = null; paintAttempts(); return loadAttempts(); }
      if (act === 'unlock' && d) {
        await busy(b, async () => {
          try {
            const res = await api.doors.unlock(state.homeId, d.name, val);
            if (val === 'unlocked') {
              markDoorOpened('mở từ xa', d.name, res?.data);
              toast(`${res?.message || 'Đã mở khoá'} — "${d.name}"`, 'emerald');
            } else {
              markDoorLocked(d.name);
              addLog('door', `Khoá cửa "${d.name}" từ xa`);
              toast(`Đã gửi lệnh khoá "${d.name}"`, 'sky');
            }
            setTimeout(loadAttempts, 500);
          } catch (err) { fail(err, 'Không gửi được lệnh'); }
        });
      }
      if (act === 'revoke' && d) {
        if (!confirm(`Thu hồi credential #${val} của "${d.name}"?`)) return;
        await busy(b, () => revoke(d, val));
      }
    });

    const revoke = async (d, credentialId) => {
      try {
        await api.doors.revoke(state.homeId, d.name, credentialId);
        issued[d.name] = (issued[d.name] ?? []).filter((c) => String(c.id) !== String(credentialId));
        toast(`Đã thu hồi credential #${credentialId}`, 'emerald');
        addLog('door', `Thu hồi credential #${credentialId} của cửa "${d.name}"`);
        await refreshHomeData({ silent: true });
        await loadCreds();
      } catch (err) { fail(err, 'Không thu hồi được'); }
    };

    root.addEventListener('change', (e) => {
      if (e.target.id !== 'door-select') return;
      selected = e.target.value;
      resetKeypad(); mode = 'open'; attempts = null; creds = null;
      paintAll();
      loadAttempts(); loadCreds();
    });

    root.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const v = formValues(f);
      const btn = f.querySelector('[type=submit]');
      const d = door();
      if (f.id === 'issue-pin' && d) {
        if (!PIN_PATTERN.test(v.pin)) return toast('Mã PIN phải gồm 4–8 chữ số', 'rose');
        await busy(btn, async () => {
          try {
            const res = await api.doors.issuePin(state.homeId, d.name, v.pin);
            const id = deepFind(res, ['credentialId', 'id']);
            if (id != null) (issued[d.name] ??= []).push({ id, ts: Date.now() });
            f.reset();
            toast(`Đã cấp mã PIN mới${id != null ? ` (credential #${id})` : ''}`, 'emerald');
            addLog('door', `Cấp mã PIN mới cho cửa "${d.name}"`);
            await refreshHomeData({ silent: true });
            await loadCreds();
          } catch (err) { fail(err, 'Không cấp được mã PIN'); }
        });
      } else if (f.id === 'revoke-cred' && d) {
        if (!v.credentialId) return toast('Nhập Credential ID cần thu hồi', 'rose');
        await busy(btn, async () => { await revoke(d, v.credentialId); f.reset(); });
      } else if (f.dataset.form === 'create-door') {
        if (!v.doorName) return toast('Nhập tên cửa', 'rose');
        await busy(btn, async () => {
          try {
            const res = await api.doors.create(state.homeId, v.doorName);
            f.reset();
            toast(`Đã tạo cửa "${v.doorName}"`, 'emerald');
            selected = pick(asObject(res, 'door'), 'doorName', 'name') ?? v.doorName;
            await refreshHomeData({ silent: true });
            attempts = null; creds = null;
            paintAll();
            loadAttempts(); loadCreds();
          } catch (err) { fail(err, 'Không tạo được cửa'); }
        });
      }
    });

    paintAll();
    loadAttempts();
    loadCreds();
    const offs = [
      onChange(['doors', 'loading'], () => JSON.stringify([state.loading, state.errors.doors, state.doors.map((d) => [d.name, d.state, d.credentials.map((c) => c.id)])]), () => {
        const prev = selected;
        ensureSelected();
        paintPicker(); paintEmpty(); paintCtrl(); paintCreds();
        if (selected !== prev) { resetKeypad(); attempts = null; creds = null; paintKeypad(); paintAttempts(); paintCreds(); loadAttempts(); loadCreds(); }
      }),
      on('door', paintCtrl),
    ];
    // Đếm ngược mỗi giây: chỉ cập nhật huy hiệu (không vẽ lại nút để không mất cú bấm)
    const tick = setInterval(() => {
      const d = door();
      const el = $('#door-lock-badge');
      if (d && el && /unlocked/i.test(d.state) && d.autoLockAt) el.innerHTML = lockBadge(d);
    }, 1000);
    return () => { alive = false; clearInterval(tick); offs.forEach((off) => off()); };
  },
};


