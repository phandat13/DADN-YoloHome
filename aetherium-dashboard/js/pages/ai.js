import { addLog, setDevice, openDoor, hhmm } from '../store.js';
import { FACE_ACTIONS, FACE_MIN_PROB, FACE_HOLD_SECONDS } from '../config.js';
import { panel, pageTitle, toast } from '../ui.js';

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase().trim();

// Tìm từ khoá trong câu lệnh -> {key, value, label, channel} hoặc null
export function parseCommand(text) {
  const t = norm(text);
  const on = /\bbat\b/.test(t), off = /\btat\b/.test(t);
  if (!on && !off) return null;
  if (/\bden\b/.test(t)) return { key: 'light', value: on, label: `Đã ${on ? 'bật' : 'tắt'} đèn`, channel: 'V10' };
  if (/\bquat\b/.test(t)) return { key: 'fan', value: on ? 100 : 0, label: `Đã ${on ? 'bật' : 'tắt'} quạt`, channel: 'V12' };
  return null;
}

export const aiPage = {
  mount(root) {
    root.innerHTML = pageTitle('AI & Nhận diện', 'Điều khiển bằng giọng nói tiếng Việt và nhận diện khuôn mặt FaceAI') + `
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        ${panel({ title: 'Điều khiển giọng nói', icon: 'mic', body: `
          <div class="flex items-center gap-3">
            <button id="mic-btn" type="button" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold transition">
              <span class="material-symbols-outlined text-[18px]">mic</span><span id="mic-label">Bấm để nói</span></button>
            <span class="text-xs text-slate-400">Cần Chrome/Edge + micro. Hoặc nhập lệnh bên dưới.</span>
          </div>
          <div class="flex gap-2 mt-4">
            <input id="voice-text" type="text" placeholder='Ví dụ: "Bật đèn", "Tắt quạt"' class="flex-1 rounded-lg border-slate-200 text-sm focus:border-sky-500 focus:ring-sky-500">
            <button id="voice-send" type="button" class="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm font-semibold text-slate-700">Gửi lệnh</button>
          </div>
          <div class="flex flex-wrap gap-2 mt-3">
            ${['Bật đèn', 'Tắt đèn', 'Bật quạt', 'Tắt quạt', 'Mở nhạc'].map((c) => `<button type="button" data-cmd="${c}" class="px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 text-xs font-medium hover:bg-sky-100">${c}</button>`).join('')}
          </div>
          <div id="voice-result" class="mt-4 p-4 rounded-lg bg-slate-50 border border-slate-100 text-sm text-slate-400">Chưa có lệnh nào.</div>` })}

        ${panel({ title: 'Nhận diện khuôn mặt (FaceAI)', icon: 'face', body: `
          <p class="text-xs text-slate-500 mb-3">Giả lập kết quả mô hình Teachable Machine. Giữ xác suất ≥ ${FACE_MIN_PROB}% trong ${FACE_HOLD_SECONDS} giây liên tiếp để gửi lệnh.</p>
          <div class="grid grid-cols-2 gap-3">
            <label class="text-xs font-semibold text-slate-500">Nhãn nhận diện
              <select id="face-label" class="mt-1 w-full rounded-lg border-slate-200 text-sm">${Object.keys(FACE_ACTIONS).map((l) => `<option>${l}</option>`).join('')}</select></label>
            <label class="text-xs font-semibold text-slate-500">Xác suất: <b id="face-prob-val">90</b>%
              <input id="face-prob" type="range" min="0" max="100" value="90" class="mt-2 w-full accent-sky-600"></label>
          </div>
          <div class="flex items-center justify-between mt-4">
            <button id="face-btn" type="button" class="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold">Bắt đầu nhận diện</button>
            <div id="face-dots" class="flex items-center gap-1.5"></div>
          </div>
          <div id="face-result" class="mt-4 p-4 rounded-lg bg-slate-50 border border-slate-100 text-sm text-slate-400">Chưa chạy.</div>` })}
      </div>`;
    const $ = (s) => root.querySelector(s);

    // ----- Giọng nói -----
    const show = (heard, res, tone) => {
      $('#voice-result').innerHTML = `<div class="text-xs text-slate-400">Nhận được</div><div class="font-semibold text-slate-800">“${heard || '…'}”</div><div class="mt-2 font-bold ${tone}">${res}</div>`;
    };
    const run = (text) => {
      const t = text.trim();
      if (!t) return show('', 'KHONG HIEU', 'text-amber-600');
      const cmd = parseCommand(t);
      if (!cmd) { addLog('device', `Giọng nói "${t}" → KHONG HOP LE`); return show(t, 'KHONG HOP LE (gửi lên kênh V13)', 'text-rose-600'); }
      setDevice(cmd.key, cmd.value, 'giọng nói');
      show(t, `${cmd.label} → gửi kênh ${cmd.channel}`, 'text-emerald-600');
      toast(cmd.label, 'emerald');
    };
    $('#voice-send').onclick = () => { run($('#voice-text').value); $('#voice-text').value = ''; };
    $('#voice-text').onkeydown = (e) => { if (e.key === 'Enter') $('#voice-send').click(); };
    root.querySelectorAll('[data-cmd]').forEach((b) => { b.onclick = () => run(b.dataset.cmd); });

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    $('#mic-btn').onclick = () => {
      if (!SR) return show('', 'Trình duyệt không hỗ trợ micro — hãy dùng ô nhập lệnh', 'text-amber-600');
      const r = new SR();
      r.lang = 'vi-VN';
      r.onresult = (e) => run(e.results[0][0].transcript);
      r.onerror = (e) => show('', e.error === 'network' ? 'LOI (mất kết nối Internet)' : 'KHONG HIEU', e.error === 'network' ? 'text-rose-600' : 'text-amber-600');
      r.onend = () => { $('#mic-label').textContent = 'Bấm để nói'; };
      r.start();
      $('#mic-label').textContent = 'Đang nghe…';
    };

    // ----- FaceAI -----
    let timer = null, count = 0;
    const paintDots = () => {
      $('#face-dots').innerHTML = Array.from({ length: FACE_HOLD_SECONDS }, (_, i) =>
        `<span class="w-3 h-3 rounded-full ${i < count ? 'bg-emerald-500' : 'bg-slate-200'}"></span>`).join('') +
        `<span class="text-xs text-slate-500 ml-1 font-mono">${count}/${FACE_HOLD_SECONDS}s</span>`;
    };
    const faceMsg = (t, tone = 'text-slate-600') => { $('#face-result').innerHTML = `<div class="font-semibold ${tone}">${t}</div>`; };
    const faceTick = () => {
      const label = $('#face-label').value, p = +$('#face-prob').value, code = FACE_ACTIONS[label];
      if (p < FACE_MIN_PROB) return faceMsg(`Xác suất ${p}% < ${FACE_MIN_PROB}% — bỏ qua`, 'text-amber-600');
      if (!code) return faceMsg(`Nhãn ${label}: không có người — bỏ qua`);
      count++; paintDots();
      faceMsg(`Đang xác nhận ${label} (${p}%)…`, 'text-sky-600');
      if (count < FACE_HOLD_SECONDS) return;
      if (code === 'A') { openDoor('FaceAI'); faceMsg(`Gửi V14 ← "A", V13 ← "${label}" → Servo quay 90° mở cửa`, 'text-emerald-600'); }
      else { addLog('alert', `FaceAI: ${label} xuất hiện lúc ${hhmm(Date.now())} — đã gửi thông báo`); toast(`Đã gửi thông báo: ${label} xuất hiện`, 'sky'); faceMsg(`Gửi V14 ← "B" → gửi tin nhắn thông báo`, 'text-sky-600'); }
      count = 0; paintDots();
    };
    $('#face-prob').oninput = (e) => { $('#face-prob-val').textContent = e.target.value; };
    $('#face-btn').onclick = () => {
      if (timer) { clearInterval(timer); timer = null; count = 0; paintDots(); $('#face-btn').textContent = 'Bắt đầu nhận diện'; return faceMsg('Đã dừng.'); }
      timer = setInterval(faceTick, 1000);
      $('#face-btn').textContent = 'Dừng nhận diện';
      faceMsg('Đang quét…', 'text-sky-600');
    };
    paintDots();
    return () => clearInterval(timer);
  },
};
