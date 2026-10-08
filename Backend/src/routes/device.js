const express = require('express');
const router = express.Router({ mergeParams: true });
const { z } = require('zod');

const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission');
const asyncHandler = require('../middlewares/asyncHandler');
const validate = require('../middlewares/validate');
const { pool, callProc } = require('../db');
const { publishCommand } = require('../services/mqttService');

const { resolveValidFeedKey, isFanDevice } = require('../utils/feeds');

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

// Device_Command.Source_Type là ENUM('USER','VOICE_COMMAND','SCHEDULE','SYSTEM'); Frontend có thể gửi 'APP', 'web'...
const normalizeSourceType = (value) => {
  const v = String(value || '').toUpperCase();
  if (v === 'VOICE' || v === 'VOICE_COMMAND') return 'VOICE_COMMAND';
  if (v === 'SCHEDULE' || v === 'AUTO') return 'SCHEDULE';
  if (v === 'SYSTEM') return 'SYSTEM';
  return 'USER';
};

const extractOutValue = (outResult, paramName) => {
  if (!outResult) return undefined;
  const target = outResult.outParams || (Array.isArray(outResult) ? outResult[0] : outResult);
  if (!target || typeof target !== 'object') return undefined;
  return target[paramName] ?? target[`@${paramName}`];
};

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

    // Gán chính xác feed thuộc 8 feed hợp lệ
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
        Feed_Key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
 * @desc    Gửi lệnh tới 1 trong 8 feed chuẩn
 */
router.post(
  '/:deviceId/commands',
  auth,
  validate(deviceParamSchema),
  checkPermission('DEVICE_CONTROL'),
  asyncHandler(async (req, res) => {
    const userId = req.user.User_ID;
    const homeId = parseInt(req.params.homeId, 10);
    const deviceId = parseInt(req.params.deviceId, 10);
    const body = req.body || {};

    const innerPayload = (typeof body.payload === 'object' && body.payload !== null) ? body.payload : {};
    let action = body.action || body.actionName || body.command || innerPayload.action;
    let state = body.state !== undefined ? body.state : (body.status !== undefined ? body.status : innerPayload.state);
    let speed = body.speed !== undefined 
      ? body.speed 
      : (innerPayload.speed !== undefined 
          ? innerPayload.speed 
          : (typeof body.value === 'number' ? body.value : undefined));
    let value = body.value;
    const sourceType = normalizeSourceType(body.sourceType);

    if (!action) {
      if (state !== undefined) {
        action = (String(state).toUpperCase() === 'ON' || state === 1 || state === true) ? 'TURN_ON' : 'TURN_OFF';
      } else if (speed !== undefined) {
        action = 'SET_SPEED';
      } else if (value !== undefined) {
        action = (value === 1 || value === true || String(value).toUpperCase() === 'ON') ? 'TURN_ON' : 'TURN_OFF';
      } else {
        action = 'CONTROL';
      }
    }

    // 1. Đọc thông tin thiết bị từ DB
    const [devRows] = await pool.query(
      'SELECT Device_ID, Device_Name, Feed_Key, Type_Code, Connection_State FROM Device WHERE Device_ID = ? AND Home_ID = ?',
      [deviceId, homeId]
    );

    if (devRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Thiết bị không tồn tại trong ngôi nhà này' });
    }

    const device = devRows[0];

    // 2. Đảm bảo feedKey thuộc đúng 8 feed chuẩn
    const feedKey = resolveValidFeedKey(device.Feed_Key, device.Type_Code, device.Device_Name);
    const isFan = isFanDevice(device, feedKey);

    // 3. Chuẩn hóa payload
    let newWorkingState = null;
    let mqttPayload = { action };
    if (typeof body.payload === 'object' && body.payload !== null) {
      mqttPayload = { ...mqttPayload, ...body.payload };
    }

    const upperAction = String(action).toUpperCase();
    if (upperAction === 'TURN_ON' || upperAction === 'ON') {
      newWorkingState = 'on';
      mqttPayload.state = 'ON';
    } else if (upperAction === 'TURN_OFF' || upperAction === 'OFF') {
      newWorkingState = 'off';
      mqttPayload.state = 'OFF';
      // CHỈ GÁN SPEED = 0 NẾU LÀ QUẠT, KHÔNG GÁN CHO ĐÈN
      if (isFan) {
        mqttPayload.speed = 0;
      } else {
        delete mqttPayload.speed;
      }
    } else if (upperAction === 'SET_SPEED' || speed !== undefined) {
      const finalSpeed = Number(speed ?? 0);
      newWorkingState = String(finalSpeed);
      mqttPayload.speed = finalSpeed;
      mqttPayload.state = finalSpeed > 0 ? 'ON' : 'OFF';
    }

    // 4. Phát lệnh sang MQTT broker
    const isPublished = publishCommand(feedKey, mqttPayload);
    if (!isPublished) {
      return res.status(503).json({ success: false, message: 'Không thể kết nối hoặc gửi lệnh tới MQTT broker' });
    }

    // 5. Phản hồi HTTP 200 ngay tức thì (Zero-delay UI)
    res.status(200).json({
      success: true,
      message: 'Gửi lệnh điều khiển thiết bị thành công',
      data: { deviceId, action, workingState: newWorkingState, feedKey },
    });

    // 6. Ghi log và đồng bộ dữ liệu chạy ngầm (Non-blocking)
    (async () => {
      try {
        const commandDataString = JSON.stringify(mqttPayload);

        // Ghi vào bảng Device_Command
        try {
          await callProc(
            'sp_send_device_command',
            [deviceId, userId, action, sourceType, commandDataString],
            ['p_command_id']
          );
        } catch {
          await pool.query(
            `INSERT INTO Device_Command (Source_ID, Source_Type, Data_attached, Excute_Time, Excute_State, Device_ID)
             VALUES (?, ?, ?, NOW(), 'SUCCESS', ?)`,
            [userId, sourceType, commandDataString, deviceId]
          );
        }

        // Cập nhật trạng thái hiển thị cho bảng Device
        if (newWorkingState !== null) {
          await pool.query(
            'UPDATE Device SET Available_working_State = ? WHERE Device_ID = ?',
            [newWorkingState, deviceId]
          );

          // Bắn Socket.IO thông báo cho các tab khác
          const io = req.app.get('io');
          if (io) {
            io.to(`home_${homeId}`).emit('device_state_updated', {
              homeId,
              deviceId,
              state: newWorkingState,
            });
          }
        }
      } catch (bgErr) {
        console.error('[BACKGROUND_DEVICE_UPDATE_ERROR]:', bgErr);
      }
    })();
  })
);

module.exports = router;

