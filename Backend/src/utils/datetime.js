const { z } = require('zod');

const pad = (n) => String(n).padStart(2, '0');

// Date -> 'YYYY-MM-DD HH:mm:ss' theo giờ địa phương của máy chạy Node
// (cùng múi giờ với phiên MySQL, xem db.js). Trước đây dùng toISOString() nên bị lệch sang giờ UTC.
const formatLocalDatetime = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/**
 * Chuẩn hoá giá trị ngày giờ từ Frontend thành chuỗi MySQL DATETIME.
 * - 'YYYY-MM-DD' (ô chọn ngày): dateOnly='end' -> 23:59:59 của ngày đó (dùng cho hạn sử dụng),
 *   dateOnly='start' -> 00:00:00 (dùng cho thời điểm bắt đầu).
 * - Chuỗi ISO có/không có múi giờ: đổi sang giờ địa phương.
 * - Rỗng/null/không hợp lệ -> null.
 */
const toMysqlDatetime = (value, { dateOnly = 'end' } = {}) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value} ${dateOnly === 'start' ? '00:00:00' : '23:59:59'}`;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return formatLocalDatetime(d);
};

// Ngày giờ tuỳ chọn trong body: ISO (có hoặc không có múi giờ), 'YYYY-MM-DD', null, hoặc '' (= không giới hạn).
const optionalDateSchema = z.preprocess(
  (val) => (val === '' ? null : val),
  z
    .union([
      z.string().datetime({ offset: true }),
      z.string().datetime({ local: true }),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Định dạng ngày phải là YYYY-MM-DD'),
    ])
    .nullable()
    .optional()
);

module.exports = { toMysqlDatetime, formatLocalDatetime, optionalDateSchema };
