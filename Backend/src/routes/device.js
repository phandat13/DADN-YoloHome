const express = require('express');
const router = express.Router({ mergeParams: true });
const { z } = require('zod');

const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission');
const asyncHandler = require('../middlewares/asyncHandler');
const validate = require('../middlewares/validate');
const { pool } = require('../db');
const { sendDeviceCommand, loadDevice } = require('../services/deviceControl');
const { disableAutoOnManual } = require('../services/automation');

const { resolveValidFeedKey, isFanDevice } = require('../utils/feeds');

const LIGHT_DEFAULT_COLOR = '#FFFFFF';

// ==========================================
// 1. ZOD SCHEMAS
// ==========================================
// Form trên web gửi mọi giá trị dạng chuỗi: "" -> null, "3" -> 3
const optionalIntId = z.preprocess(
  (v) => {
    if (v === '') return null;
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v);
    return v;
  },
  z.number().int().positive().nullable().optional()
);
// "ONLINE" / "Online" -> "online"
const connectionStateSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.enum(['online', 'offline'], { error: 'connectionState phải là online hoặc offline' })
);

const deviceIdParams = z.object({
  homeId: z.string().regex(/^\d+$/, 'homeId phải là số nguyên'),
  deviceId: z.string().regex(/^\d+$/, 'deviceId phải là số nguyên'),
});

const createDeviceSchema = z.object({
  body: z.object({
    deviceName: z.string().trim().min(1, 'Tên thiết bị không được để trống'),
    typeCode: z.string().trim().min(1, 'Mã loại thiết bị không được để trống').transform((v) => v.toUpperCase()),
    hardwareId: z.string().trim().optional().nullable(),
    serialNo: z.string().trim().optional().nullable(),
    controllerId: optionalIntId,
    connectionState: connectionStateSchema.default('online'),
    availableWorkingState: z.string().default('off'),
    feedKey: z.string().trim().optional().nullable(),
  }),
});

const updateDeviceSchema = z.object({
  params: deviceIdParams,
  body: z.object({
    deviceName: z.string().trim().min(1).optional(),
    connectionState: connectionStateSchema.optional(),
    availableWorkingState: z.string().trim().min(1).optional(),
    controllerId: optionalIntId,
    feedKey: z.string().trim().nullable().optional(),
  }),
});

const deviceParamSchema = z.object({ params: deviceIdParams });

// Lệnh điều khiển: { action?, state?, speed?, color?, payload?: {...} } (payload giữ tương thích bản cũ)
const commandSchema = z.object({
  params: deviceIdParams,
  body: z.object({
    action: z.string().trim().max(30).optional(),
    actionName: z.string().trim().max(30).optional(),
    command: z.string().trim().max(30).optional(),
    state: z.union([z.string(), z.number(), z.boolean()]).optional(),
    status: z.union([z.string(), z.number(), z.boolean()]).optional(),
    speed: z.union([z.number(), z.string()]).optional(),
    value: z.union([z.number(), z.string(), z.boolean()]).optional(),
    color: z.string().trim().optional(),
    payload: z.record(z.string(), z.any()).optional().nullable(),
    sourceType: z.string().optional(),
  }),
});

// ==========================================
// 3. ROUTES
// ==========================================

/**
 * @route   GET /api/homes/:homeId/devices
 */
router.get(
  '/',
  auth,
  checkPermission('DEVICE_VIEW'),
  asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);

    const [rows] = await pool.query(
      `SELECT 
        d.Device_ID AS deviceId,
        d.Device_Name AS deviceName,
        d.Hardware_ID AS hardwareId,
        d.Serial_No AS serialNo,
        d.Connection_State AS connectionState,
        d.Last_Connection_Time AS lastConnectionTime,
        d.Available_working_State AS availableWorkingState,
        d.Home_ID AS homeId,
        d.Type_Code AS typeCode,
        d.Controller_ID AS controllerId,
        d.Feed_Key AS feedKey,
        d.Color AS color,
        dt.Type_Name AS typeName,
        dt.Type_Group AS typeGroup,
        dt.Manufacturer AS manufacturer
      FROM Device d
      LEFT JOIN Device_Type dt ON d.Type_Code = dt.Type_Code
      WHERE d.Home_ID = ?
      ORDER BY d.Device_ID DESC`,
      [homeId]
    );

    res.status(200).json({
      success: true,
      data: rows,
    });
  })
);

/**
 * @route   POST /api/homes/:homeId/devices
 */
router.post(
  '/',
  auth,
  checkPermission('DEVICE_MANAGE'),
  validate(createDeviceSchema),
  asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);
    const actorId = req.user.User_ID;
    const {
      deviceName,
      hardwareId,
      serialNo,
      typeCode,
      controllerId,
      connectionState,
      availableWorkingState,
      feedKey: userFeedKey,
    } = req.body;

    const [typeCheck] = await pool.query(
      'SELECT Type_Code FROM Device_Type WHERE Type_Code = ? LIMIT 1',
      [typeCode]
    );

    if (typeCheck.length === 0) {
      return res.status(400).json({
        success: false,
        message: `Mã loại thiết bị '${typeCode}' không tồn tại trong hệ thống. Vui lòng kiểm tra lại.`,
      });
    }

    // Gán chính xác 1 trong các feed hợp lệ (utils/feeds.js)
    const finalFeedKey = resolveValidFeedKey(userFeedKey, typeCode, deviceName);

    const [result] = await pool.query(
      `INSERT INTO Device (
        Device_Name,
        Hardware_ID,
        Serial_No,
        Connection_State,
        Available_working_State,
        Home_ID,
        Type_Code,
        Controller_ID,
        Feed_Key,
        Color
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        deviceName,
        hardwareId || null,
        serialNo || null,
        connectionState || 'online',
        availableWorkingState || 'off',
        homeId,
        typeCode,
        controllerId || null,
        finalFeedKey,
        finalFeedKey === 'device-light' ? LIGHT_DEFAULT_COLOR : null,
      ]
    );

    await pool.query(
      'CALL sp_log_activity(?, ?, ?, ?, ?, ?)',
      [actorId, homeId, 'device', 'add_device', 'web', 'success']
    );

    res.status(201).json({
      success: true,
      message: 'Tạo thiết bị thành công',
      data: {
        deviceId: result.insertId,
        deviceName,
        homeId,
        typeCode,
        feedKey: finalFeedKey,
        connectionState: connectionState || 'online',
      },
    });
  })
);

/**
 * @route   PATCH /api/homes/:homeId/devices/:deviceId
 */
router.patch(
  '/:deviceId',
  auth,
  validate(updateDeviceSchema),
  checkPermission('DEVICE_MANAGE'),
  asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);
    const deviceId = parseInt(req.params.deviceId, 10);
    const { deviceName, connectionState, availableWorkingState, controllerId, feedKey } = req.body;

    const fields = [];
    const params = [];

    if (deviceName !== undefined) { fields.push('Device_Name = ?'); params.push(deviceName); }
    if (connectionState !== undefined) { fields.push('Connection_State = ?'); params.push(connectionState); }
    if (availableWorkingState !== undefined) { fields.push('Available_working_State = ?'); params.push(availableWorkingState); }
    if (controllerId !== undefined) { fields.push('Controller_ID = ?'); params.push(controllerId); }
    if (feedKey !== undefined) {
      // Dựa vào loại/tên hiện tại của thiết bị khi feedKey gửi lên không thuộc 8 feed chuẩn
      const [cur] = await pool.query('SELECT Type_Code, Device_Name FROM Device WHERE Device_ID = ? AND Home_ID = ?', [deviceId, homeId]);
      const sanitizedFeed = resolveValidFeedKey(feedKey, cur[0]?.Type_Code, deviceName ?? cur[0]?.Device_Name);
      fields.push('Feed_Key = ?');
      params.push(sanitizedFeed);
    }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: 'Không có trường dữ liệu nào để cập nhật' });
    }

    params.push(deviceId, homeId);

    const [result] = await pool.query(
      `UPDATE Device SET ${fields.join(', ')} WHERE Device_ID = ? AND Home_ID = ?`,
      params
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Thiết bị không tồn tại trong ngôi nhà này' });
    }

    res.status(200).json({ success: true, message: 'Cập nhật thiết bị thành công' });
  })
);

/**
 * @route   DELETE /api/homes/:homeId/devices/:deviceId
 */
router.delete(
  '/:deviceId',
  auth,
  validate(deviceParamSchema),
  checkPermission('DEVICE_MANAGE'),
  asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);
    const deviceId = parseInt(req.params.deviceId, 10);

    const [result] = await pool.query(
      'DELETE FROM Device WHERE Device_ID = ? AND Home_ID = ?',
      [deviceId, homeId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thiết bị để xóa' });
    }

    await pool.query('CALL sp_log_activity(?, ?, ?, ?, ?, ?)', [req.user.User_ID, homeId, 'device', 'delete_device', 'web', 'success']);

    res.status(200).json({ success: true, message: 'Đã xóa thiết bị thành công' });
  })
);

/**
 * @route   POST /api/homes/:homeId/devices/:deviceId/commands
 * @desc    Bật/tắt đèn, còi; đặt tốc độ quạt (0–100); đổi màu đèn (#RRGGBB)
 *          Phản hồi sau khi broker MQTT xác nhận đã nhận lệnh (hoặc ngay lập tức với nhà mô phỏng).
 */
router.post(
  '/:deviceId/commands',
  auth,
  validate(commandSchema),
  checkPermission('DEVICE_CONTROL'),
  asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);
    const deviceId = parseInt(req.params.deviceId, 10);
    const body = req.body || {};
    const inner = body.payload || {};

    const device = await loadDevice(homeId, deviceId);
    if (!device) {
      return res.status(404).json({ success: false, message: 'Thiết bị không tồn tại trong ngôi nhà này' });
    }

    const input = {
      action: body.action ?? body.actionName ?? body.command ?? inner.action,
      state: body.state ?? body.status ?? inner.state,
      speed: body.speed ?? inner.speed,
      color: body.color ?? inner.color,
    };
    // Bản cũ gửi { value }: số -> tốc độ quạt, còn lại -> bật/tắt
    if (body.value !== undefined && input.speed === undefined && input.state === undefined) {
      if (typeof body.value === 'number' && isFanDevice(device)) input.speed = body.value;
      else input.state = body.value;
    }

    const result = await sendDeviceCommand({
      io: req.app.get('io'), homeId, device, input, userId: req.user.User_ID, sourceType: 'USER',
    });

    if (!result.ok) {
      return res.status(503).json({
        success: false,
        message: 'Không gửi được lệnh tới Adafruit IO (MQTT chưa kết nối hoặc không phản hồi). Lệnh đã được ghi là FAILED.',
        data: { commandId: result.commandId },
      });
    }

    // Điều khiển tay -> tắt chế độ tự động để quy tắc tự động không bật/tắt ngược lại ngay sau đó
    const autoModeDisabled = await disableAutoOnManual(req.app.get('io'), homeId);

    res.status(200).json({
      success: true,
      message: result.simulated
        ? 'Đã cập nhật trạng thái (nhà này không gắn phần cứng nên không gửi MQTT)'
        : 'Gửi lệnh điều khiển thiết bị thành công',
      data: {
        deviceId,
        commandId: result.commandId,
        action: result.cmd.action,
        workingState: result.workingState,
        color: result.color,
        feedKey: result.cmd.feedKey,
        simulated: result.simulated,
        autoModeDisabled,
      },
    });
  })
);

module.exports = router;

