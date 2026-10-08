import { TIMING } from '../config.js';

const pad = (n) => String(n).padStart(2, '0');
export const formatTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
export const formatDate = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;

// Chạy toàn cục: đếm ngược 30s -> onSync (làm mới qua REST), cập nhật đồng hồ LCD nếu đang hiển thị.
// Số liệu cảm biến đến tức thời qua Socket.IO; chu kỳ REST chỉ để bù khi socket rớt.
export function startSyncService({ onSync } = {}) {
  let countdown = TIMING.SYNC_INTERVAL_S;
  const paint = () => {
    const el = document.getElementById('sync-timer');
    if (el) el.textContent = `${countdown}s`;
  };
  const sync = () => { countdown = TIMING.SYNC_INTERVAL_S; paint(); onSync?.(); };

  setInterval(() => {
    countdown--;
    if (countdown <= 0) sync(); else paint();
    const clock = document.getElementById('lcd-clock');
    if (clock) clock.textContent = formatTime(new Date());
  }, 1000);

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#manual-sync-btn');
    if (!btn) return;
    sync();
    btn.classList.add('opacity-70');
    setTimeout(() => btn.classList.remove('opacity-70'), 400);
  });
}


