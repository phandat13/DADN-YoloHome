// Ngưỡng cảnh báo + chế độ tự động của từng nhà (dùng chung cho mọi thành viên / mọi trình duyệt)
const express = require('express');
const { z } = require('zod');
const { pool } = require('../db');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission');
const asyncHandler = require('../middlewares/asyncHandler');
const validate = require('../middlewares/validate');
const automation = require('../services/automation');

const router = express.Router({ mergeParams: true });
router.use(auth);

const homeParams = z.object({ homeId: z.string().regex(/^\d+$/, 'homeId phải là số nguyên') });
const num = (min, max) => z.preprocess(
  (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v),
  z.number({ error: 'Phải là số' }).finite().min(min).max(max)
);

const thresholdsSchema = z.object({
  params: homeParams,
  body: z
    .object({
      tempMax: num(-40, 100),
      humidityMin: num(0, 100),
      humidityMax: num(0, 100),
      lightMin: num(0, 100000),
    })
    .refine((b) => b.humidityMin < b.humidityMax, { message: 'Độ ẩm tối thiểu phải nhỏ hơn tối đa', path: ['humidityMin'] }),
});

const modeSchema = z.object({
  params: homeParams,
  body: z.object({ autoMode: z.boolean({ error: 'autoMode phải là true hoặc false' }) }),
});

const requireMember = asyncHandler(async (req, res, next) => {
  const [rows] = await pool.query('SELECT fn_is_home_member(?, ?) AS ok', [req.user.User_ID, parseInt(req.params.homeId, 10)]);
  if (rows[0]?.ok !== 1) return res.status(403).json({ success: false, message: 'Bạn không phải thành viên của ngôi nhà này' });
  next();
});

/**
 * @route GET /api/homes/:homeId/settings
 * @desc  Ngưỡng, chế độ tự động và các cảnh báo đang hoạt động
 */
router.get('/', validate(z.object({ params: homeParams })), requireMember, asyncHandler(async (req, res) => {
  const homeId = parseInt(req.params.homeId, 10);
  const settings = await automation.getSettings(homeId);
  res.json({ success: true, data: { ...settings, alerts: await automation.currentAlerts(homeId) } });
}));

/**
 * @route PUT /api/homes/:homeId/settings
 * @desc  Cập nhật ngưỡng cảnh báo (cần DEVICE_MANAGE)
 */
router.put('/', validate(thresholdsSchema), checkPermission('DEVICE_MANAGE'), asyncHandler(async (req, res) => {
  const homeId = parseInt(req.params.homeId, 10);
  const { tempMax, humidityMin, humidityMax, lightMin } = req.body;
  await automation.getSettings(homeId);
  await pool.query(
    'UPDATE Home_Setting SET Temp_Max = ?, Humidity_Min = ?, Humidity_Max = ?, Light_Min = ? WHERE Home_ID = ?',
    [tempMax, humidityMin, humidityMax, lightMin, homeId]
  );
  await pool.query('CALL sp_log_activity(?, ?, ?, ?, ?, ?)', [req.user.User_ID, homeId, 'home_setting', 'update_thresholds', 'web', 'success']);
  const settings = await automation.getSettings(homeId);
  const io = req.app.get('io');
  io?.to(`home_${homeId}`).emit('settings_updated', { homeId, settings });
  await automation.evaluateHome(io, homeId);
  res.json({ success: true, message: 'Đã lưu ngưỡng cảnh báo', data: { ...settings, alerts: await automation.currentAlerts(homeId) } });
}));

/**
 * @route PUT /api/homes/:homeId/settings/mode
 * @desc  Bật / tắt chế độ tự động (cần DEVICE_CONTROL)
 */
router.put('/mode', validate(modeSchema), checkPermission('DEVICE_CONTROL'), asyncHandler(async (req, res) => {
  const homeId = parseInt(req.params.homeId, 10);
  const settings = await automation.setAutoMode(req.app.get('io'), homeId, req.body.autoMode);
  await pool.query('CALL sp_log_activity(?, ?, ?, ?, ?, ?)', [req.user.User_ID, homeId, 'home_setting', settings.autoMode ? 'auto_mode_on' : 'auto_mode_off', 'web', 'success']);
  res.json({ success: true, message: settings.autoMode ? 'Đã bật chế độ tự động' : 'Đã chuyển sang chế độ thủ công', data: settings });
}));

module.exports = router;
