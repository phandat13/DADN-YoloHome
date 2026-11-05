// Hẹn giờ thiết bị: /api/homes/:homeId/schedules
const express = require('express');
const { z } = require('zod');
const { pool } = require('../db');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission');
const asyncHandler = require('../middlewares/asyncHandler');
const validate = require('../middlewares/validate');
const { loadDevice, buildCommand, HttpError } = require('../services/deviceControl');
const scheduler = require('../services/scheduler');

const router = express.Router({ mergeParams: true });
router.use(auth);

const homeParams = z.object({ homeId: z.string().regex(/^\d+$/, 'homeId phải là số nguyên') });
const idParams = homeParams.extend({ scheduleId: z.string().regex(/^\d+$/, 'scheduleId phải là số nguyên') });
const intLike = z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int());

const createSchema = z.object({
  params: homeParams,
  body: z.object({
    deviceId: intLike.pipe(z.number().positive()),
    action: z.string().trim().toUpperCase().pipe(z.enum(['TURN_ON', 'TURN_OFF', 'SET_SPEED', 'SET_COLOR'], { error: 'action phải là TURN_ON, TURN_OFF, SET_SPEED hoặc SET_COLOR' })),
    speed: intLike.pipe(z.number().min(0).max(100)).optional(),
    color: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, 'Màu phải có dạng #RRGGBB').optional(),
    // Một lần: runAt (thời điểm) hoặc afterMinutes (đếm ngược). Lặp lại: time "HH:MM" + days [0..6] (0 = Chủ nhật)
    repeat: z.boolean().default(false),
    runAt: z.string().trim().optional(),
    afterMinutes: intLike.pipe(z.number().min(1).max(7 * 24 * 60)).optional(),
    time: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ phải có dạng HH:MM').optional(),
    days: z.array(intLike.pipe(z.number().min(0).max(6))).min(1, 'Chọn ít nhất 1 ngày').optional(),
    note: z.string().trim().max(100).optional(),
  }).superRefine((b, ctx) => {
    if (b.repeat && !b.time) ctx.addIssue({ code: 'custom', path: ['time'], message: 'Lịch lặp lại cần giờ chạy (HH:MM)' });
    if (!b.repeat && !b.runAt && !b.afterMinutes) ctx.addIssue({ code: 'custom', path: ['runAt'], message: 'Lịch một lần cần runAt hoặc afterMinutes' });
  }),
});

/**
 * @route GET /api/homes/:homeId/schedules
 */
router.get('/', validate(z.object({ params: homeParams })), checkPermission('DEVICE_VIEW'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await scheduler.listSchedules(parseInt(req.params.homeId, 10)) });
}));

/**
 * @route POST /api/homes/:homeId/schedules
 * @desc  Tạo hẹn giờ. VD: { deviceId: 2, action: "TURN_OFF", afterMinutes: 30 }
 *        hoặc { deviceId: 1, action: "TURN_ON", repeat: true, time: "18:30", days: [1,2,3,4,5] }
 */
router.post('/', validate(createSchema), checkPermission('DEVICE_CONTROL'), asyncHandler(async (req, res) => {
  const homeId = parseInt(req.params.homeId, 10);
  const b = req.body;
  const device = await loadDevice(homeId, b.deviceId);
  if (!device) return res.status(404).json({ success: false, message: 'Thiết bị không tồn tại trong ngôi nhà này' });

  // Kiểm tra lệnh hợp lệ với loại thiết bị ngay lúc tạo (quạt mới có SET_SPEED, đèn mới có SET_COLOR...)
  try {
    buildCommand(device, { action: b.action, speed: b.speed, color: b.color });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ success: false, message: err.message });
    throw err;
  }
  if (b.action === 'SET_SPEED' && b.speed === undefined) return res.status(400).json({ success: false, message: 'SET_SPEED cần speed (0–100)' });
  if (b.action === 'SET_COLOR' && !b.color) return res.status(400).json({ success: false, message: 'SET_COLOR cần color (#RRGGBB)' });

  let runAt = null;
  if (!b.repeat) {
    runAt = b.afterMinutes ? new Date(Date.now() + b.afterMinutes * 60_000) : new Date(b.runAt);
    if (Number.isNaN(runAt.getTime())) return res.status(400).json({ success: false, message: 'runAt không phải thời điểm hợp lệ' });
    if (runAt <= new Date()) return res.status(400).json({ success: false, message: 'Thời điểm hẹn phải ở tương lai' });
  }
  const daysMask = b.repeat ? (b.days ?? [0, 1, 2, 3, 4, 5, 6]).reduce((m, d) => m | (1 << d), 0) : 127;

  const io = req.app.get('io');
  const schedule = await scheduler.createSchedule(io, homeId, req.user.User_ID, {
    deviceId: device.Device_ID, action: b.action, speed: b.speed, color: b.color?.toUpperCase(),
    repeat: b.repeat, runAt, time: b.time, daysMask, note: b.note, via: 'WEB',
  });
  await pool.query('CALL sp_log_activity(?, ?, ?, ?, ?, ?)', [req.user.User_ID, homeId, 'schedule', 'create_schedule', 'web', 'success']);
  res.status(201).json({ success: true, message: 'Đã tạo hẹn giờ', data: schedule });
}));

/**
 * @route PATCH /api/homes/:homeId/schedules/:scheduleId   body { enabled: boolean }
 */
router.patch('/:scheduleId', validate(z.object({ params: idParams, body: z.object({ enabled: z.boolean() }) })),
  checkPermission('DEVICE_CONTROL'), asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);
    const r = await scheduler.setEnabled(req.app.get('io'), homeId, parseInt(req.params.scheduleId, 10), req.body.enabled);
    if (!r) return res.status(404).json({ success: false, message: 'Không tìm thấy hẹn giờ' });
    if (r.error) return res.status(400).json({ success: false, message: r.error });
    res.json({ success: true, message: req.body.enabled ? 'Đã bật hẹn giờ' : 'Đã tạm dừng hẹn giờ' });
  }));

/**
 * @route DELETE /api/homes/:homeId/schedules/:scheduleId
 */
router.delete('/:scheduleId', validate(z.object({ params: idParams })), checkPermission('DEVICE_CONTROL'), asyncHandler(async (req, res) => {
  const homeId = parseInt(req.params.homeId, 10);
  const ok = await scheduler.removeSchedule(req.app.get('io'), homeId, parseInt(req.params.scheduleId, 10));
  if (!ok) return res.status(404).json({ success: false, message: 'Không tìm thấy hẹn giờ' });
  await pool.query('CALL sp_log_activity(?, ?, ?, ?, ?, ?)', [req.user.User_ID, homeId, 'schedule', 'delete_schedule', 'web', 'success']);
  res.json({ success: true, message: 'Đã xoá hẹn giờ' });
}));

module.exports = router;
