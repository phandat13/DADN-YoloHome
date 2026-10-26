// AI & Nhận diện:
//  - Giọng nói (UC 3.3): Web Speech API (vi-VN) → POST /ai/voice-commands { commandDetail } → BE phân tích,
//    điều khiển thiết bị và trợ lý trả lời (feed 'assistant' / V13, sự kiện Socket.IO 'assistant_message').
//  - FaceAI (UC 3.4): vector 128 chiều (face-api.js) → POST /ai/face-profiles và
//    POST /ai/doors/:doorName/face-recognition (x-iot-key hoặc người dùng có DOOR_UNLOCK) — khoảng cách Euclid ≤ 0.55 thì mở cửa.
import { state, on, onChange, addLog, markDoorOpened, applyDeviceState, refreshHomeData } from '../store.js';
import { api } from '../api.js';
import { FACE } from '../config.js';
import { asList, esc, fmtDate, fullTime, label, pickAny, idValue } from '../utils/fields.js';
import { normFaceProfile, normMember } from '../models.js';
import { startCamera, stopCamera, extractDescriptor, parseVector } from '../services/faceEngine.js';
import { panel, pageTitle, badge, button, field, inputCls, emptyState, loadingBlock, errorBlock, toast, busy, fail } from '../ui.js';

const QUICK = ['Bật đèn', 'Tắt đèn', 'Đổi đèn màu đỏ', 'Bật quạt 50%', 'Quạt mức 3', 'Tắt quạt', 'Bật còi'];
const rawJson = (res) => (res == null ? '' : `<details class="mt-2"><summary class="text-[11px] text-slate-400 cursor-pointer">Phản hồi Backend</summary>
  <pre class="mt-1 text-[11px] bg-slate-900 text-slate-100 rounded p-2 overflow-x-auto max-h-48">${esc(JSON.stringify(res, null, 2))}</pre></details>`);

export const aiPage = {
  mount(root) {
    let alive = true, vector = null, pastedVector = null, stream = null, recog = null;
    let profiles = null, profilesErr = null, members = null;
    const homeId = state.homeId;

    root.innerHTML = pageTitle('AI & Nhận diện', 'Điều khiển bằng giọng nói tiếng Việt (NLP ở Backend) và nhận diện khuôn mặt bằng vector đặc trưng') + `
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        ${panel({ title: 'Điều khiển giọng nói', icon: 'mic', body: `
          <div class="flex items-center gap-3">
            <button id="mic-btn" type="button" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold transition">
              <span class="material-symbols-outlined text-[18px]">mic</span><span id="mic-label">Bấm để nói</span></button>
            <span class="text-xs text-slate-400">Cần Chrome/Edge + micro. Hoặc nhập lệnh bên dưới.</span>
          </div>
          <form id="voice-form" class="flex gap-2 mt-4">
            <input id="voice-text" type="text" placeholder='VD: "Bật quạt phòng khách lên 50%"' class="${inputCls} flex-1">
            ${button('Gửi lệnh', { type: 'submit', tone: 'secondary' })}
          </form>
          <div class="flex flex-wrap gap-2 mt-3">
            ${QUICK.map((c) => `<button type="button" data-cmd="${c}" class="px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 text-xs font-medium hover:bg-sky-100">${c}</button>`).join('')}
          </div>
          <div id="voice-result" class="mt-4 p-4 rounded-lg bg-slate-50 border border-slate-100 text-sm text-slate-400">Chưa có lệnh nào.</div>
          <div class="mt-4">
            <div class="text-xs font-semibold text-slate-500 mb-1.5 flex items-center gap-1"><span class="material-symbols-outlined text-[16px]">smart_toy</span>Trợ lý (cũng hiện trên LCD của mạch)</div>
            <ul id="assistant-log" class="space-y-1 text-xs"></ul>
          </div>
          <p class="text-[11px] text-slate-400 mt-3">Văn bản được gửi tới <span class="font-mono">POST /ai/voice-commands</span> (cần quyền VOICE_USE).</p>` })}

        ${panel({ title: 'Vector khuôn mặt', icon: 'face', body: `
          <div class="relative rounded-lg overflow-hidden bg-slate-900 aspect-video">
            <video id="cam" class="w-full h-full object-cover mirror" autoplay muted playsinline></video>
            <div id="cam-off" class="absolute inset-0 flex flex-col items-center justify-center text-slate-400 text-xs gap-1">
              <span class="material-symbols-outlined text-[32px]">videocam_off</span>Camera đang tắt</div>
          </div>
          <div class="flex flex-wrap gap-2 mt-3">
            ${button('Bật camera', { act: 'cam-on', icon: 'videocam', tone: 'secondary', size: 'sm', attrs: 'id="cam-on"' })}
            ${button('Lấy vector', { act: 'capture', icon: 'center_focus_strong', size: 'sm' })}
            ${button('Tắt camera', { act: 'cam-off', icon: 'videocam_off', tone: 'ghost', size: 'sm' })}
          </div>
          <details class="mt-3">
            <summary class="text-xs font-semibold text-slate-500 cursor-pointer">Hoặc dán vector có sẵn (JSON)</summary>
            <textarea id="vec-input" rows="3" class="${inputCls} mt-2 font-mono text-xs" placeholder="[0.12, -0.05, 0.33, ...]"></textarea>
            <div class="mt-2">${button('Dùng vector này', { act: 'paste', tone: 'secondary', size: 'sm' })}</div>
          </details>
          <div id="vec-status" class="mt-3"></div>
          <p class="text-[11px] text-slate-400 mt-2">Vector 128 chiều trích bằng face-api.js ngay trên trình duyệt (mô hình tải từ CDN lần đầu, cần Internet). Ảnh không được gửi đi.</p>` })}
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        ${panel({ title: 'Nhận diện tại cửa', icon: 'how_to_reg', body: `
          <div class="grid grid-cols-2 gap-3">
            ${field('Cửa', '<select id="face-door" class="w-full rounded-lg border-slate-200 text-sm"></select>')}
            ${field('Ngưỡng tin cậy', `<input id="face-threshold" type="text" readonly value="${FACE.DEFAULT_THRESHOLD}% (cố định ở Backend)" class="${inputCls} font-mono bg-slate-50 text-slate-500">`)}
          </div>
          <div class="mt-4">${button('Nhận diện & mở cửa', { act: 'recognize', icon: 'door_open' })}</div>
          <p class="text-[11px] text-slate-500 mt-2">Bật camera ở khung "Vector khuôn mặt" — khi bấm, hệ thống chụp khuôn mặt <b>mới</b> rồi so với hồ sơ đã lưu.</p>
          <div id="face-result" class="mt-4 p-4 rounded-lg bg-slate-50 border border-slate-100 text-sm text-slate-400">Chưa chạy.</div>
          <p class="text-[11px] text-slate-400 mt-3">Camera trước cửa gọi API bằng x-iot-key; trên web cần quyền DOOR_UNLOCK. Backend tính khoảng cách Euclid, ≤ ${FACE.MATCH_DISTANCE} thì tự mở cửa.</p>` })}

        ${panel({ title: 'Đăng ký hồ sơ khuôn mặt', icon: 'person_add', body: `
          <div class="grid grid-cols-2 gap-3">
            <div id="face-user-field"></div>
            ${field('Hết hạn', `<input id="face-expired" type="date" class="${inputCls}">`, 'Để trống nếu không giới hạn')}
          </div>
          <div class="mt-4">${button('Lưu hồ sơ khuôn mặt', { act: 'register-face', icon: 'save' })}</div>
          <p class="text-[11px] text-slate-400 mt-3">Dùng vector hiện tại ở khung "Vector khuôn mặt". Cần quyền FACE_MANAGE.</p>` })}
      </div>
      <div id="profiles"></div>`;
    const $ = (s) => root.querySelector(s);

    // ----- Giọng nói -----
    const showVoice = (heard, text, tone, res) => {
      $('#voice-result').innerHTML = `<div class="text-xs text-slate-400">Nhận được</div>
        <div class="font-semibold text-slate-800">“${esc(heard || '…')}”</div>
        <div class="mt-2 font-bold ${tone}">${esc(text)}</div>${rawJson(res)}`;
    };
    const runVoice = async (text) => {
      const t = text.trim();
      if (!t) return showVoice('', 'KHÔNG HIỂU — câu lệnh trống', 'text-amber-600');
      showVoice(t, 'Đang gửi tới Backend…', 'text-slate-500');
      try {
        const res = await api.ai.voice(homeId, t);
        if (!alive) return;
        const message = label(pickAny(res, 'reply', 'message')) || 'Backend đã xử lý lệnh';
        showVoice(t, message, 'text-emerald-600', res);
        toast(message, 'emerald');
        const data = res?.data ?? {};
        if (data.targetDeviceId != null) applyDeviceState(data.targetDeviceId, data.workingState, data.color);
        if (data.autoModeDisabled) setTimeout(() => refreshHomeData({ silent: true }), 300);
        addLog('device', `Giọng nói "${t}" → ${message}`);
      } catch (e) {
        if (!alive) return;
        const text403 = e.status === 403 ? 'Bạn không có quyền VOICE_USE' : (e.body?.reply || e.message);
        showVoice(t, `KHÔNG THỰC HIỆN ĐƯỢC — ${text403}`, 'text-rose-600', e.body);
        addLog('device', `Giọng nói "${t}" → lỗi: ${text403}`);
      }
    };

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    $('#mic-btn').onclick = () => {
      if (!SR) return showVoice('', 'Trình duyệt không hỗ trợ nhận giọng nói — hãy dùng ô nhập lệnh', 'text-amber-600');
      if (recog) { recog.stop(); return; }
      recog = new SR();
      recog.lang = 'vi-VN';
      recog.onresult = (e) => runVoice(e.results[0][0].transcript);
      recog.onerror = (e) => {
        const map = { network: 'LỖI: mất kết nối Internet', 'not-allowed': 'Chưa cấp quyền micro cho trang', 'no-speech': 'Không nghe thấy giọng nói' };
        showVoice('', map[e.error] ?? 'KHÔNG HIỂU', e.error === 'no-speech' ? 'text-amber-600' : 'text-rose-600');
      };
      recog.onend = () => { recog = null; if (alive) $('#mic-label').textContent = 'Bấm để nói'; };
      recog.start();
      $('#mic-label').textContent = 'Đang nghe… (bấm để dừng)';
    };

    // ----- Vector -----
    const paintVector = () => {
      $('#vec-status').innerHTML = vector
        ? `<div class="flex items-center gap-2 text-xs">${badge(`Vector ${vector.length} chiều`, 'emerald')}
             <span class="font-mono text-slate-500 truncate">[${vector.slice(0, 4).map((x) => x.toFixed(3)).join(', ')}, …]</span></div>`
        : `<div class="text-xs text-slate-400">${badge('Chưa có vector', 'slate')}</div>`;
    };

    // ----- Danh sách cửa / thành viên -----
    const paintDoors = () => {
      const sel = $('#face-door');
      const keep = sel.value;
      sel.innerHTML = state.doors.length
        ? state.doors.map((d) => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('')
        : '<option value="">(chưa có cửa)</option>';
      if (state.doors.some((d) => d.name === keep)) sel.value = keep;
    };
    const paintUserField = () => {
      $('#face-user-field').innerHTML = members?.length
        ? field('Thành viên', `<select id="face-user" class="w-full rounded-lg border-slate-200 text-sm">${members.map((m) =>
            `<option value="${esc(m.userId)}" ${state.user && String(state.user.id) === String(m.userId) ? 'selected' : ''}>${esc(m.name || m.email)}${m.role ? ` (${esc(m.role)})` : ''}</option>`).join('')}</select>`)
        : field('User ID', `<input id="face-user" type="number" value="${esc(state.user?.id ?? '')}" class="${inputCls} font-mono">`);
    };

    const memberName = (uid) => {
      const m = members?.find((x) => String(x.userId) === String(uid));
      return m ? (m.name || m.email) : null;
    };

    const paintProfiles = () => {
      let body;
      if (profiles === null) body = loadingBlock();
      else if (profilesErr) body = errorBlock(profilesErr);
      else if (!profiles.length) body = emptyState('face', 'Chưa có hồ sơ khuôn mặt nào', 'Lấy vector rồi bấm "Lưu hồ sơ khuôn mặt".');
      else {
        body = `<div class="overflow-x-auto"><table class="w-full text-sm">
          <thead><tr class="text-left text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
            <th class="py-2 pr-4 font-semibold">ID</th><th class="py-2 pr-4 font-semibold">Người dùng</th><th class="py-2 pr-4 font-semibold">Vector</th>
            <th class="py-2 pr-4 font-semibold">Hết hạn</th><th class="py-2 font-semibold">Ngày tạo</th></tr></thead>
            <th class="py-2 font-semibold text-right">Hành động</th>
          <tbody>${profiles.map((p) => `<tr class="border-b border-slate-50">
            <td class="py-2 pr-4 font-mono text-xs text-slate-500">${esc(p.id ?? '—')}</td>
            <td class="py-2 pr-4 font-semibold text-slate-800">${esc(p.name || memberName(p.userId) || (p.userId != null ? `User #${p.userId}` : '—'))}</td>
            <td class="py-2 pr-4 text-xs text-slate-500">${p.dims ? `${p.dims} chiều` : '—'}</td>
            <td class="py-2 pr-4 text-xs text-slate-600">${p.expired ? fmtDate(p.expired) : 'Không giới hạn'}</td>
            <td class="py-2 font-mono text-xs text-slate-500">${p.ts ? fullTime(p.ts) : '—'}</td>
            <td class="py-2 text-right">${button('', { act: 'delete-face', val: p.id, tone: 'danger', icon: 'delete', size: 'sm', attrs: 'title="Xóa FaceID"' })}</td>
            </tr>`).join('')}</tbody></table></div>`;
      }
      $('#profiles').innerHTML = panel({
        title: `Hồ sơ khuôn mặt đã đăng ký${profiles?.length ? ` (${profiles.length})` : ''}`, icon: 'badge',
        right: button('Tải lại', { act: 'reload-profiles', tone: 'secondary', size: 'sm', icon: 'refresh' }), body,
      });
    };

    const loadProfiles = async () => {
      try {
        const res = await api.ai.listFaces(homeId);
        if (!alive) return;
        profiles = asList(res, 'profiles', 'faceProfiles').map(normFaceProfile);
        profilesErr = null;
      } catch (e) {
        if (!alive) return;
        profiles = [];
        profilesErr = e.status === 403 ? 'Cần quyền FACE_MANAGE để xem hồ sơ khuôn mặt' : `Không tải được hồ sơ: ${e.message}`;
      }
      paintProfiles();
    };
    const loadMembers = async () => {
      try {
        const res = await api.members.list(homeId);
        if (!alive) return;
        members = asList(res, 'members').map(normMember).filter((m) => m.userId != null);
      } catch { members = []; }
      paintUserField();
      paintProfiles();
    };

    const faceMsg = (html, tone = 'text-slate-600') => { $('#face-result').innerHTML = `<div class="font-semibold ${tone}">${html}</div>`; };

    root.addEventListener('click', async (e) => {
      const cmd = e.target.closest('[data-cmd]');
      if (cmd) return runVoice(cmd.dataset.cmd);
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const video = $('#cam');
      switch (b.dataset.act) {
        case 'cam-on':
          if (stream) return;
          try { stream = await startCamera(video); $('#cam-off').classList.add('hidden'); }
          catch (err) { fail(err, 'Không mở được camera'); }
          return;
        case 'cam-off':
          stopCamera(stream, video); stream = null; $('#cam-off').classList.remove('hidden');
          return;
        case 'capture':
          if (!stream) return toast('Hãy bật camera trước', 'amber');
          await busy(b, async () => {
            toast('Đang phân tích khuôn mặt… (lần đầu cần tải mô hình)', 'sky');
            try {
              const v = await extractDescriptor(video);
              if (!alive) return;
              if (!v) return toast('Không tìm thấy khuôn mặt trong khung hình', 'amber');
              vector = v; paintVector(); toast('Đã lấy vector khuôn mặt', 'emerald');
            } catch (err) { fail(err, 'Không tải được mô hình nhận diện (kiểm tra Internet)'); }
          });
          return;
        case 'paste': {
          const v = parseVector($('#vec-input').value);
          if (!v) return toast('Vector không hợp lệ — cần mảng số, VD [0.1, -0.2, ...]', 'rose');
          vector = v; pastedVector = v; paintVector(); toast(`Đã nhận vector ${v.length} chiều`, 'emerald');
          return;
        }
        case 'recognize': {
          const doorName = $('#face-door').value;
          if (!doorName) return toast('Nhà chưa có cửa — tạo cửa ở trang Cửa thông minh', 'amber');
          // Nhận diện phải dùng khuôn mặt CHỤP MỚI từ camera (không dùng lại vector vừa đăng ký,
          // nếu không sẽ luôn so vector với chính nó: khoảng cách 0, "khớp" 100%).
          if (!stream && !pastedVector) return toast('Bật camera trước — hệ thống sẽ chụp khuôn mặt mới để so khớp', 'amber');
          await busy(b, async () => {
            let probe = null;
            if (stream) {
              faceMsg('Đang chụp khuôn mặt từ camera…', 'text-sky-600');
              try { probe = await extractDescriptor(video); }
              catch (err) { return fail(err, 'Không tải được mô hình nhận diện (kiểm tra Internet)'); }
              if (!alive) return;
              if (!probe) return faceMsg('Không thấy khuôn mặt trong khung hình — nhìn thẳng vào camera rồi thử lại', 'text-amber-600');
            } else {
              probe = pastedVector;   // chỉ để thử API khi không có camera
            }
            faceMsg('Đang so khớp với hồ sơ đã lưu…', 'text-sky-600');
            try {
              const res = await api.ai.recognize(homeId, doorName, probe);
              if (!alive) return;
              const matched = pickAny(res, 'matched', 'isMatch', 'recognized', 'granted', 'unlocked', 'success');
              const dist = Number(pickAny(res, 'distance', 'minDistance', 'euclideanDistance'));
              const who = label(pickAny(res, 'label', 'userName', 'displayName', 'name', 'matchedUser', 'userId', 'matchedUserId'));
              const message = label(pickAny(res, 'message', 'result'));
              const ok = matched !== false && matched !== 'false';
              const info = [who && `Người: ${esc(memberName(who) ?? who)}`, Number.isFinite(dist) && `Khoảng cách: ${dist.toFixed(4)}`, message && esc(message)].filter(Boolean).join(' · ');
              if (ok) {
                markDoorOpened('FaceAI', doorName, res);
                faceMsg(`KHỚP — đã mở "${esc(doorName)}"${info ? `<div class="text-xs font-normal text-slate-500 mt-1">${info}</div>` : ''}${rawJson(res)}`, 'text-emerald-600');
              } else {
                faceMsg(`KHÔNG KHỚP${info ? `<div class="text-xs font-normal text-slate-500 mt-1">${info}</div>` : ''}${rawJson(res)}`, 'text-rose-600');
              }
            } catch (err) {
              if (!alive) return;
              faceMsg(`KHÔNG MỞ CỬA — ${esc(err.message)}${rawJson(err.body)}`, 'text-rose-600');
              addLog('door', `FaceAI không khớp tại "${doorName}": ${err.message}`);
            }
          });
          return;
        }
        case 'register-face': {
          const userId = idValue($('#face-user')?.value);
          const expired = $('#face-expired').value;
          if (!vector) return toast('Chưa có vector khuôn mặt', 'amber');
          if (userId === '' || userId == null) return toast('Chọn thành viên', 'amber');
          await busy(b, async () => {
            try {
              const body = { userId, faceData: vector };
              if (expired) body.validTo = expired;          // BE nhận validFrom / validTo (YYYY-MM-DD = hết ngày đó)
              await api.ai.addFace(homeId, body);
              vector = null; pastedVector = null; paintVector();   // vector đăng ký không dùng lại để nhận diện
              toast('Đã lưu hồ sơ khuôn mặt — giờ bấm "Nhận diện & mở cửa" để thử', 'emerald');
              addLog('device', `Đăng ký hồ sơ khuôn mặt cho ${memberName(userId) ?? `user #${userId}`}`);
              loadProfiles();
            } catch (err) { fail(err, 'Không lưu được hồ sơ'); }
          });
          return;
        }
        case 'reload-profiles':
          profiles = null; paintProfiles(); loadProfiles();
          return;
        case 'delete-face': {
          const profileId = b.dataset.val;
          if (!profileId) return;
      
          if (!confirm(`Bạn có chắc chắn muốn xóa hồ sơ FaceID #${profileId} này không?`)) return;

          await busy(b, async () => {
            try {
              await api.ai.removeFace(homeId, profileId);
              toast('Đã xóa hồ sơ FaceID thành công', 'emerald');
              addLog('device', `Xóa hồ sơ FaceID #${profileId}`);
              await loadProfiles(); // Tải lại danh sách sau khi xóa
            } catch (err) {
              fail(err, 'Không xóa được hồ sơ FaceID');
            }
          });
          return;
      }
        default:
      }
    });
    root.addEventListener('submit', (e) => {
      if (e.target.id !== 'voice-form') return;
      e.preventDefault();
      const input = $('#voice-text');
      runVoice(input.value);
      input.value = '';
    });

    const paintAssistant = () => {
      const el = $('#assistant-log');
      el.innerHTML = state.assistant.length
        ? state.assistant.slice(0, 5).map((m) => `<li class="flex gap-2"><span class="font-mono text-slate-400">${esc(fullTime(m.ts).slice(-8))}</span><span class="text-slate-700">${esc(m.text)}</span></li>`).join('')
        : '<li class="text-slate-400">Chưa có phản hồi.</li>';
    };

    paintAssistant();
    paintVector();
    paintDoors();
    paintUserField();
    paintProfiles();
    loadMembers();
    loadProfiles();
    const off = onChange('doors', () => state.doors.map((d) => d.name).join('|'), paintDoors);
    const offAssistant = on('assistant', paintAssistant);
    return () => {
      alive = false;
      off();
      offAssistant();
      recog?.abort?.();
      stopCamera(stream, $('#cam'));
    };
  },
};