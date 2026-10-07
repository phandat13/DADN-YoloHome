import { state } from './store.js';
import { renderSidebar } from './components/sidebar.js';
import { monitoringPage } from './pages/monitoring.js';
import { controlPage } from './pages/control.js';
import { aiPage } from './pages/ai.js';
import { historyPage } from './pages/history.js';
import { settingsPage } from './pages/settings.js';

const ROUTES = { monitor: monitoringPage, control: controlPage, ai: aiPage, history: historyPage, settings: settingsPage };
let cleanup = null;

function go() {
  const key = location.hash.replace('#/', '') || 'monitor';
  const route = ROUTES[key] ? key : 'monitor';
  cleanup?.();
  const root = document.getElementById('page-root');
  root.innerHTML = '';
  cleanup = ROUTES[route].mount(root) ?? null;
  renderSidebar(document.getElementById('sidebar'), state.sensor, route);
  window.scrollTo(0, 0);
}

export function startRouter() {
  window.addEventListener('hashchange', go);
  go();
}
