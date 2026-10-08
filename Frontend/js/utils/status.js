import { THRESHOLDS } from '../config.js';

// Khai báo đủ class Tailwind để dễ tra cứu và tránh nối chuỗi động.
export const TONES = {
  emerald: { badge: 'bg-emerald-50 text-emerald-700', text: 'text-emerald-600' },
  sky:     { badge: 'bg-sky-50 text-sky-700',         text: 'text-sky-600' },
  amber:   { badge: 'bg-amber-50 text-amber-700',     text: 'text-amber-600' },
  rose:    { badge: 'bg-rose-50 text-rose-700',       text: 'text-rose-600' },
  slate:   { badge: 'bg-slate-100 text-slate-600',    text: 'text-slate-600' },
  violet:  { badge: 'bg-violet-50 text-violet-700',   text: 'text-violet-600' },
};

const NO_DATA = { label: 'Chưa có dữ liệu', tone: 'slate' };

export function getTempStatus(t) {
  if (t == null) return NO_DATA;
  return t > THRESHOLDS.TEMP_MAX
    ? { label: 'Vượt ngưỡng', tone: 'rose' }
    : { label: 'Bình thường', tone: 'emerald' };
}

export function getHumidityStatus(h) {
  if (h == null) return NO_DATA;
  const ok = h >= THRESHOLDS.HUMIDITY_MIN && h <= THRESHOLDS.HUMIDITY_MAX;
  return ok ? { label: 'Lý tưởng', tone: 'sky' } : { label: 'Ngoài chuẩn', tone: 'amber' };
}

export function getLightStatus(lux) {
  if (lux == null) return { ...NO_DATA, lamp: '—' };
  return lux >= THRESHOLDS.LIGHT_MIN
    ? { label: 'Đủ sáng', tone: 'amber', lamp: `Đèn tắt (≥${THRESHOLDS.LIGHT_MIN}L)` }
    : { label: 'Thiếu sáng', tone: 'slate', lamp: 'Đèn bật' };
}
