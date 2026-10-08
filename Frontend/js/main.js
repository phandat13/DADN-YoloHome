import { state, on, initStore, selectHome, logout, refreshHomeData, refreshNotifications } from './store.js';
import { startRouter } from './router.js';
import { startSyncService } from './services/syncService.js';
import { renderTopbar } from './components/topbar.js';
import { toast } from './ui.js';

const topbar = document.getElementById('topbar');
const paintTopbar = () => renderTopbar(topbar);
['auth', 'home', 'homes', 'socket', 'notifications', 'alerts'].forEach((e) => on(e, paintTopbar));

// Sự kiện topbar gắn một lần (topbar được vẽ lại nhiều lần).
topbar.addEventListener('change', async (e) => {
  if (e.target.id !== 'home-select') return;
  const home = state.homes.find((h) => String(h.id) === e.target.value);
  await selectHome(home ? home.id : e.target.value);
  if (home) toast(`Đã chuyển sang "${home.name}"`, 'sky');
});
topbar.addEventListener('click', (e) => {
  if (e.target.closest('[data-act="logout"]') && confirm('Đăng xuất khỏi hệ thống?')) logout();
});

paintTopbar();
startRouter();
initStore();
// Mỗi 30s hoặc khi bấm "Đồng bộ ngay": làm mới thiết bị/cảm biến/cửa + đếm thông báo chưa đọc.
startSyncService({
  onSync: () => {
    if (!state.ready || state.homeId == null) return;
    refreshHomeData({ silent: true });
    refreshNotifications();
  },
});


