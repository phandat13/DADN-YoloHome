import { THRESHOLDS } from '../config.js';

// Khai báo đủ class Tailwind để dễ tra cứu và tránh nối chuỗi động.
export const TONES = {
  emerald: { badge: 'bg-emerald-50 text-emerald-700', text: 'text-emerald-600' },
  sky:     { badge: 'bg-sky-50 text-sky-700',         text: 'text-sky-600' },
  amber:   { badge: 'bg-amber-50 text-amber-700',     text: 'text-amber-600' },
  rose:    { badge: 'bg-rose-50 text-rose-700',       text: 'text-rose-600' },
  slate:   { badge: 'bg-slate-100 text-slate-600',    text: 'text-slate-600' },
};

export function getTempStatus(t) {
  return t > THRESHOLDS.TEMP_MAX
    ? { label: 'Vượt ngưỡng', tone: 'rose' }
    : { label: 'Bình thường', tone: 'emerald' };
}

export function getHumidityStatus(h) {
  const ok = h >= THRESHOLDS.HUMIDITY_MIN && h <= THRESHOLDS.HUMIDITY_MAX;
  return ok ? { label: 'Lý tưởng', tone: 'sky' } : { label: 'Ngoài chuẩn', tone: 'amber' };
}

export function getLightStatus(lux) {
  return lux > THRESHOLDS.LIGHT_MIN
    ? { label: 'Đủ sáng', tone: 'amber', lamp: `Đèn tắt (>${THRESHOLDS.LIGHT_MIN}L)` }
    : { label: 'Thiếu sáng', tone: 'slate', lamp: 'Đèn bật' };
}

export const isAllSafe = (s) => s.temperature <= THRESHOLDS.TEMP_MAX;
