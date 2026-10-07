import { THRESHOLDS, TIMING } from '../config.js';
import { TONES, getTempStatus, getHumidityStatus, getLightStatus } from '../utils/status.js';

function card({ icon, iconBg, label, badge, value, unit, footLeft, footRight, footClass }) {
  return `
  <div class="bg-white rounded-xl p-5 border border-slate-200/80 shadow-sm flex flex-col justify-between hover:border-slate-300 transition-all">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center">
          <span class="material-symbols-outlined text-[18px]">${icon}</span>
        </div>
        <span class="text-xs font-semibold uppercase tracking-wider text-slate-500">${label}</span>
      </div>
      ${badge}
    </div>
    <div class="my-4">
      <div class="flex items-baseline gap-1">
        ${unit
          ? `<span class="text-3xl font-bold tracking-tight text-slate-900 font-['Space_Grotesk'] font-mono-num">${value}</span>
             <span class="text-lg font-medium text-slate-400">${unit}</span>`
          : `<span class="text-2xl font-bold tracking-tight text-slate-900 font-['Space_Grotesk']">${value}</span>`}
      </div>
    </div>
    <div class="flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 pt-2.5">
      <span>${footLeft}</span><span class="${footClass} font-medium">${footRight}</span>
    </div>
  </div>`;
}

const pill = (text, tone) =>
  `<span class="px-2 py-0.5 rounded-md ${TONES[tone].badge} text-[11px] font-semibold">${text}</span>`;

export function renderMetricCards(el, s) {
  const temp = getTempStatus(s.temperature);
  const hum = getHumidityStatus(s.humidity);
  const light = getLightStatus(s.light);

  const motionBadge = s.motion
    ? `<span class="relative flex h-2.5 w-2.5">
         <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
         <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span></span>`
    : `<span class="inline-flex rounded-full h-2.5 w-2.5 bg-slate-300"></span>`;

  el.innerHTML = [
    card({
      icon: 'thermostat', iconBg: 'bg-amber-50 text-amber-600', label: 'Nhiệt độ',
      badge: pill(`< ${THRESHOLDS.TEMP_MAX}°C`, temp.tone),
      value: s.temperature.toFixed(1), unit: '°C',
      footLeft: 'DHT22 • V1', footRight: temp.label, footClass: TONES[temp.tone].text,
    }),
    card({
      icon: 'humidity_mid', iconBg: 'bg-sky-50 text-sky-600', label: 'Độ ẩm',
      badge: pill(hum.label, hum.tone),
      value: s.humidity, unit: '%',
      footLeft: 'DHT22 • V2', footRight: `Chuẩn ${THRESHOLDS.HUMIDITY_MIN}-${THRESHOLDS.HUMIDITY_MAX}%`, footClass: TONES[hum.tone].text,
    }),
    card({
      icon: 'wb_sunny', iconBg: 'bg-amber-50 text-amber-500', label: 'Ánh sáng',
      badge: pill(light.label, light.tone),
      value: s.light, unit: 'Lux',
      footLeft: 'LDR • V3', footRight: light.lamp, footClass: 'text-slate-600',
    }),
    card({
      icon: 'motion_sensor_active', iconBg: 'bg-emerald-50 text-emerald-600', label: 'Chuyển động',
      badge: motionBadge,
      value: s.motion ? 'Phát hiện' : 'Không có', unit: '',
      footLeft: `Quét ${TIMING.PIR_SCAN_S}s • V4`,
      footRight: s.motion ? 'Đèn tự bật' : 'Chờ', footClass: s.motion ? 'text-emerald-700 font-semibold' : 'text-slate-500',
    }),
  ].join('');
}
