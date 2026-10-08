import { state, on } from './store.js';
import { getToken } from './api.js';
import { renderSidebar } from './components/sidebar.js';
import { pageTitle, emptyState, linkButton, loadingBlock } from './ui.js';
import { loginPage } from './pages/login.js';
import { homesPage } from './pages/homes.js';
import { membersPage } from './pages/members.js';
import { monitoringPage } from './pages/monitoring.js';
import { controlPage } from './pages/control.js';
import { doorPage } from './pages/door.js';
import { aiPage } from './pages/ai.js';
import { historyPage } from './pages/history.js';
import { notificationsPage } from './pages/notifications.js';
import { settingsPage } from './pages/settings.js';

const ROUTES = {
  login: loginPage, homes: homesPage, members: membersPage, monitor: monitoringPage, control: controlPage,
  door: doorPage, ai: aiPage, history: historyPage, notifications: notificationsPage, settings: settingsPage,
};
const NEEDS_HOME = new Set(['monitor', 'control', 'door', 'ai', 'history', 'members']);
let cleanup = null;
let current = 'monitor';

const noHomeView = () => pageTitle('Chưa chọn ngôi nhà', 'Các chức năng giám sát và điều khiển hoạt động theo từng nhà') + `
  <div class="bg-white rounded-xl border border-slate-200/80 shadow-sm">
    ${emptyState('home_work', 'Bạn chưa có ngôi nhà nào', 'Tạo nhà mới (bạn sẽ là Owner) hoặc nhờ chủ nhà mời bạn bằng email.', linkButton('#/homes', 'Đi tới Nhà của tôi'))}
  </div>`;

const paintSidebar = () => renderSidebar(document.getElementById('sidebar'), current);

function go() {
  const key = location.hash.replace(/^#\/?/, '').split('?')[0] || 'monitor';
  const authed = !!getToken();
  if (!authed && key !== 'login') { location.hash = '#/login'; return; }
  if (authed && key === 'login') { location.hash = '#/monitor'; return; }
  current = ROUTES[key] ? key : 'monitor';

  cleanup?.();
  cleanup = null;
  // Thay #page-root bằng phần tử mới để bỏ toàn bộ listener của trang trước.
  const old = document.getElementById('page-root');
  const root = old.cloneNode(false);
  old.replaceWith(root);
  document.body.classList.toggle('auth-mode', current === 'login');

  if (current !== 'login' && !state.ready) root.innerHTML = loadingBlock('Đang tải phiên làm việc…');
  else if (NEEDS_HOME.has(current) && state.homeId == null) root.innerHTML = noHomeView();
  else cleanup = ROUTES[current].mount(root) ?? null;

  if (current !== 'login') paintSidebar();
  window.scrollTo(0, 0);
}

export function startRouter() {
  window.addEventListener('hashchange', go);
  on('auth', go);
  on('home', go);
  ['devices', 'sensors', 'notifications', 'socket', 'homes'].forEach((e) => on(e, () => { if (current !== 'login') paintSidebar(); }));
  go();
}


