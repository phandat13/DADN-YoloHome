import { state, on } from '../store.js';
import { history24h } from '../data/sensorData.js';
import { renderPageHeader } from '../components/pageHeader.js';
import { renderMetricCards } from '../components/metricCards.js';
import { renderTrendChart } from '../components/trendChart.js';
import { renderLcdPanel } from '../components/lcdPanel.js';
import { renderStatusBar } from '../components/statusBar.js';

export const monitoringPage = {
  mount(root) {
    root.innerHTML = `
      <div id="page-header" class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2"></div>
      <div id="metric-cards" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"></div>
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <section id="trend-chart" class="lg:col-span-8 bg-white rounded-xl p-6 border border-slate-200/80 shadow-sm flex flex-col justify-between"></section>
        <section id="lcd-panel" class="lg:col-span-4 bg-white rounded-xl p-6 border border-slate-200/80 shadow-sm flex flex-col justify-between"></section>
      </div>
      <div id="status-bar" class="bg-white rounded-xl px-6 py-3.5 border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"></div>`;
    const $ = (s) => root.querySelector(s);
    renderPageHeader($('#page-header'));
    const paint = () => {
      renderMetricCards($('#metric-cards'), state.sensor);
      renderTrendChart($('#trend-chart'), history24h);
      renderLcdPanel($('#lcd-panel'), state.sensor);
      renderStatusBar($('#status-bar'),
        { ...state.sensor, controlMode: state.devices.mode === 'auto' ? 'Tự động (Auto)' : 'Thủ công' }, state.alerts);
    };
    paint();
    const offs = ['sensor', 'devices'].map((e) => on(e, paint));
    return () => offs.forEach((off) => off());
  },
};
