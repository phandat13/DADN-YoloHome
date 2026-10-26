// Giám sát môi trường (UC 1.1/2.1): số liệu từ sensor_update + records.
import { state, on } from '../store.js';
import { renderPageHeader } from '../components/pageHeader.js';
import { renderMetricCards } from '../components/metricCards.js';
import { renderTrendChart } from '../components/trendChart.js';
import { renderLcdPanel } from '../components/lcdPanel.js';
import { renderStatusBar } from '../components/statusBar.js';
import { errorBlock, infoBlock } from '../ui.js';

export const monitoringPage = {
  mount(root) {
    root.innerHTML = `
      <div id="page-header" class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2"></div>
      <div id="notice" data-hide-empty></div>
      <div id="metric-cards" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"></div>
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <section id="trend-chart" class="lg:col-span-8 bg-white rounded-xl p-6 border border-slate-200/80 shadow-sm flex flex-col justify-between"></section>
        <section id="lcd-panel" class="lg:col-span-4 bg-white rounded-xl p-6 border border-slate-200/80 shadow-sm flex flex-col justify-between"></section>
      </div>
      <div id="status-bar" class="bg-white rounded-xl px-6 py-3.5 border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"></div>`;
    const $ = (s) => root.querySelector(s);
    renderPageHeader($('#page-header'));

    const paintNotice = () => {
      const el = $('#notice');
      if (state.errors.sensors) el.innerHTML = errorBlock(`Không tải được danh sách cảm biến: ${state.errors.sensors}`);
      else if (!state.loading && !state.sensors.length) {
        el.innerHTML = infoBlock('Nhà này chưa đăng ký cảm biến nào. Vào <a href="#/settings" class="font-semibold underline">Cài đặt → Cảm biến IoT</a> để thêm cảm biến nhiệt độ, độ ẩm, ánh sáng, chuyển động.');
      } else if (!state.loading && !state.socketConnected) {
        el.innerHTML = infoBlock('Đang mất kết nối Socket.IO — số liệu được làm mới qua REST mỗi 30 giây.', 'amber');
      } else el.innerHTML = '';
    };
    const paintLive = () => {
      renderMetricCards($('#metric-cards'), state.sensor, state.sensors);
      renderLcdPanel($('#lcd-panel'), state.sensor, state.socketConnected, state.assistant[0]?.text);
      renderStatusBar($('#status-bar'), state);
      paintNotice();
    };
    const paintChart = () => renderTrendChart($('#trend-chart'), state.history);

    paintLive();
    paintChart();
    const offs = [
      ...['sensor', 'sensors', 'devices', 'alerts', 'socket', 'loading', 'settings', 'assistant'].map((e) => on(e, paintLive)),
      on('history', paintChart),
    ];
    return () => offs.forEach((off) => off());
  },
};


