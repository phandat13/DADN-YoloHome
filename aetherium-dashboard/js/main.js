import { state, on, initStore, tick } from './store.js';
import { startRouter } from './router.js';
import { startSyncService } from './services/syncService.js';
import { renderTopbar } from './components/topbar.js';

const paintTopbar = () =>
  renderTopbar(document.getElementById('topbar'), { ...state.sensor, alertCount: state.alerts.length });

initStore();
paintTopbar();
on('alerts', paintTopbar);
startRouter();
startSyncService({ onSync: tick });   // mỗi 30s hoặc bấm "Đồng bộ ngay"
