const express = require('express');
const router = express.Router({ mergeParams: true });
const { z } = require('zod');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const { pool, callProc } = require('../db');
const asyncHandler = require('../middlewares/asyncHandler');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission');
const validate = require('../middlewares/validate');
const { publishCommand } = require('../services/mqttService');
const config = require('../config');

// ==========================================
// 0. HELPER FUNCTIONS & MIDDLEWARES
// ==========================================

const pinLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}_${req.params.doorName || 'default'}`,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Quá nhiều lần thử mã PIN. Vui lòng thử lại sau 10 phút.',
    });
  },
});

// Cho phép cả thiết bị phần cứng IoT (x-iot-key) lẫn giao diện Web (Token người dùng hoặc công khai)
const allowIotOrAuth = (req, res, next) => {
  const clientKey = req.headers['x-iot-key'];
  if (config.iotApiKey && clientKey === config.iotApiKey) {
    return next();
  }

  // Nếu request có Header Authorization của người dùng Web thì xác thực JWT
  if (req.headers.authorization) {
    return auth(req, res, next);
  }

  // Cho phép tiếp tục nếu hệ thống mở cửa bảo mật thông qua rate-limit và mã PIN
  next();
};

// Lấy trực tiếp doorName đã được Express tự giải mã an toàn
const getDoorName = (req) => req.params.doorName;

// Chuyển chuỗi ISO sang chuỗi MySQL DATETIME (YYYY-MM-DD HH:mm:ss)
const toMysqlDatetime = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

// Trích xuất biến OUT từ kết quả Stored Procedure
const extractOutValue = (outResult, paramName) => {
  if (!outResult) return undefined;
  const target = outResult.outParams || (Array.isArray(outResult) ? outResult[0] : outResult);
  if (!target || typeof target !== 'object') return undefined;
  return target[paramName] ?? target[`@${paramName}`];
};

// ==========================================
// 1. ZOD SCHEMAS
// ==========================================

const dateSchema = z
  .union([
    z.string().datetime({ offset: true }),
    z.string().datetime(),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Định dạng ngày phải là YYYY-MM-DD'),
  ])
  .nullable()
  .optional();

const createDoorSchema = z.object({
  body: z.object({
    doorName: z.string().trim().min(1, 'Tên cửa không được để trống').max(100),
    workingState: z.string().trim().max(30).optional().default('enabled'),
  }),
});

const createPinSchema = z.object({
  body: z.object({
    targetUserId: z.number().int({ message: 'User ID phải là số nguyên' }).optional().nullable(),
    pin: z.string().regex(/^[0-9]{4,8}$/, 'Mã PIN phải gồm từ 4 đến 8 chữ số'),
    validFrom: dateSchema,
    validTo: dateSchema,
  }),
});

const verifyPinSchema = z.object({
  body: z.object({
    pin: z.string().min(1, 'Mã PIN không được để trống'),
  }),
});

const changePinSchema = z.object({
  body: z.object({
    credentialId: z.number().int(),
    currentPin: z.string().min(1, 'Vui lòng nhập mã PIN hiện tại'),
    newPin: z.string().regex(/^[0-9]{4,8}$/, 'Mã PIN mới phải gồm 4 đến 8 chữ số'),
    confirmPin: z.string().regex(/^[0-9]{4,8}$/, 'Xác nhận mã PIN mới phải gồm 4 đến 8 chữ số'),
  }),
});

const setDoorStateSchema = z.object({
  body: z.object({
    state: z.enum(['locked', 'unlocked'], {
      error: 'Trạng thái phải là "locked" hoặc "unlocked"',
    }),
  }),
});

// ==========================================
// 2. ENDPOINTS
// ==========================================

/**
 * @route   POST /api/homes/:homeId/doors
 * @desc    Tạo cửa thông minh mới
 */
router.post(
  '/',
  auth,
  checkPermission('DEVICE_MANAGE'),
  validate(createDoorSchema),
  asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);
    const { doorName, workingState } = req.body;

    await pool.execute(
      'INSERT INTO Smart_Door (Smart_Door_Name, Working_State, Lock_Unlock_State, Home_ID) VALUES (?, ?, ?, ?)',
      [doorName, workingState || 'enabled', 'Locked', homeId]
    );

    res.status(201).json({
      success: true,
      message: 'Khởi tạo cửa thông minh thành công',
      data: {
        doorName,
        smartDoorName: doorName,
        homeId,
        lockState: 'Locked',
        lockUnlockState: 'Locked',
        workingState: workingState || 'enabled',
      },
    });
  })
);

/**
 * @route   GET /api/homes/:homeId/doors
 * @desc    Lấy danh sách các cửa thông minh
 */
router.get(
  '/',
  auth,
  checkPermission(['DEVICE_VIEW', 'DOOR_UNLOCK']),
  asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);

    const [doors] = await pool.execute(
      `SELECT 
        Smart_Door_Name AS smartDoorName,
        Smart_Door_Name AS doorName,
        Working_State AS workingState,
        Lock_Unlock_State AS lockUnlockState,
        Lock_Unlock_State AS lockState,
        Home_ID AS homeId
       FROM Smart_Door 
       WHERE Home_ID = ?`,
      [homeId]
    );

    res.status(200).json({
      success: true,
      data: doors,
    });
  })
);

/**
 * @route   GET /api/homes/:homeId/doors/:doorName/credentials
 * @desc    Lấy danh sách mã PIN / Credential đã cấp
 */
router.get(
  '/:doorName/credentials',
  auth,
  checkPermission('DOOR_MANAGE'),
  asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);
    const doorName = getDoorName(req);

    const [credentials] = await pool.query(
      `SELECT 
        ac.Credential_ID AS credentialId,
        ac.User_ID AS userId,
        u.Name AS userName,
        u.Display_name AS displayName,
        ac.Valid_From AS validFrom,
        ac.Valid_To AS validTo,
        ac.State AS state
       FROM Access_Credential ac
       JOIN Smart_Door sd ON ac.Smart_Door_Name = sd.Smart_Door_Name
       JOIN \`User\` u ON ac.User_ID = u.User_ID
       WHERE sd.Home_ID = ? AND ac.Smart_Door_Name = ?`,
      [homeId, doorName]
    );

    res.status(200).json({
      success: true,
      data: credentials,
    });
  })
);

/**
 * @route   POST /api/homes/:homeId/doors/:doorName/pins
 * @desc    Cấp mã PIN mở cửa cho thành viên / khách
 */
router.post(
  '/:doorName/pins',
  auth,
  checkPermission('DOOR_MANAGE'),
  validate(createPinSchema),
  asyncHandler(async (req, res) => {
    const actorId = req.user.User_ID ?? req.user.userId;
    const doorName = getDoorName(req);
    const { targetUserId, pin, validFrom = null, validTo = null } = req.body;

    const finalUserId = targetUserId || actorId;
    const formattedValidFrom = toMysqlDatetime(validFrom);
    const formattedValidTo = toMysqlDatetime(validTo);

    const outResult = await callProc(
      'sp_create_access_credential',
      [actorId, doorName, finalUserId, pin, formattedValidFrom, formattedValidTo],
      ['p_credential_id']
    );

    const credentialId = extractOutValue(outResult, 'p_credential_id');

    res.status(201).json({
      success: true,
      message: 'Cấp mã PIN mở cửa thành công',
      data: {
        credentialId,
        doorName,
        targetUserId: finalUserId,
        validFrom: formattedValidFrom,
        validTo: formattedValidTo,
      },
    });
  })
);

/**
 * @route   POST /api/homes/:homeId/doors/:doorName/verify-pin
 * @desc    Xác thực mã PIN mở cửa (Chấp nhận cả phần cứng lẫn Web)
 */
router.post(
  '/:doorName/verify-pin',
  pinLimiter,
  validate(verifyPinSchema),
  asyncHandler(async (req, res) => {
    const doorName = getDoorName(req);
    const { pin } = req.body;

    const outResult = await callProc(
      'sp_verify_door_pin',
      [doorName, pin],
      ['p_result', 'p_user_id']
    );

    const result = extractOutValue(outResult, 'p_result');
    const userId = extractOutValue(outResult, 'p_user_id');

    if (result === 'locked_out') {
      return res.status(429).json({
        success: false,
        message: 'Cửa đang bị khóa tạm thời do nhập sai quá số lần quy định',
        result,
      });
    }

    if (result !== 'success') {
      return res.status(400).json({
        success: false,
        message: 'Mã PIN không chính xác hoặc đã hết hạn truy cập',
        result: result || 'failed',
      });
    }

    // Gửi lệnh mở chốt cửa qua MQTT tới mạch điều khiển
    const feedKey = `smart-door`;
    publishCommand(feedKey, { action: 'UNLOCK_DOOR', doorName, userId });

    res.status(200).json({
      success: true,
      message: 'Mở cửa thành công',
      data: {
        result,
        userId,
      },
    });
  })
);

/**
 * @route   PUT /api/homes/:homeId/doors/:doorName/change-pin
 * @desc    Đổi mã PIN mở cửa
 */
router.put(
  '/:doorName/change-pin',
  auth,
  checkPermission('DOOR_MANAGE'),
  validate(changePinSchema),
  asyncHandler(async (req, res) => {
    const actorId = req.user.User_ID ?? req.user.userId;
    const { credentialId, currentPin, newPin, confirmPin } = req.body;

    await callProc(
      'sp_change_door_pin',
      [actorId, credentialId, currentPin, newPin, confirmPin],
      []
    );

    res.status(200).json({
      success: true,
      message: 'Đổi mã PIN mở cửa thành công',
    });
  })
);

/**
 * @route   DELETE /api/homes/:homeId/doors/:doorName/credentials/:credentialId
 * @desc    Thu hồi mã PIN truy cập cửa
 */
router.delete(
  '/:doorName/credentials/:credentialId',
  auth,
  checkPermission('DOOR_MANAGE'),
  asyncHandler(async (req, res) => {
    const actorId = req.user.User_ID ?? req.user.userId;
    const credentialId = parseInt(req.params.credentialId, 10);

    await callProc('sp_revoke_credential', [actorId, credentialId], []);

    res.status(200).json({
      success: true,
      message: 'Thu hồi mã PIN thành công',
    });
  })
);

/**
 * @route   POST /api/homes/:homeId/doors/:doorName/unlock
 * @desc    Mở khóa hoặc khóa cửa từ xa qua Web và phát lệnh MQTT
 */
router.post(
  '/:doorName/unlock',
  auth,
  checkPermission('DOOR_MANAGE'),
  validate(setDoorStateSchema),
  asyncHandler(async (req, res) => {
    const actorId = req.user.User_ID ?? req.user.userId;
    const doorName = getDoorName(req);
    const { state } = req.body;

    await callProc('sp_set_door_state', [actorId, doorName, state], []);

    // Đồng bộ phát lệnh MQTT tới mạch điều khiển cửa
    const feedKey = `door-${encodeURIComponent(doorName)}`;
    const mqttAction = state === 'unlocked' ? 'UNLOCK_DOOR' : 'LOCK_DOOR';
    publishCommand(feedKey, { action: mqttAction, doorName });

    res.status(200).json({
      success: true,
      message: `Đã ${state === 'unlocked' ? 'mở khóa' : 'khóa'} cửa từ xa thành công`,
      data: {
        doorName,
        state,
      },
    });
  })
);

/**
 * @route   GET /api/homes/:homeId/doors/:doorName/attempts
 * @desc    Xem lịch sử truy cập cửa
 */
router.get(
  '/:doorName/attempts',
  auth,
  checkPermission('DOOR_MANAGE'),
  asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);
    const doorName = getDoorName(req);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const query = `
      SELECT 
        aa.Access_ID AS accessId,
        aa.Verify_Method AS verifyMethod,
        aa.Access_Result AS accessResult,
        aa.Failure_Reason AS failureReason,
        aa.User_ID AS userId,
        aa.\`Time\` AS \`time\`,
        aa.Smart_Door_Name AS doorName
      FROM Access_Attempt aa
      JOIN Smart_Door sd ON aa.Smart_Door_Name = sd.Smart_Door_Name
      WHERE sd.Home_ID = ? AND aa.Smart_Door_Name = ?
      ORDER BY aa.\`Time\` DESC
      LIMIT ${Number(limit)}
    `;

    const [attempts] = await pool.query(query, [homeId, doorName]);

    res.status(200).json({
      success: true,
      data: attempts,
    });
  })
);

module.exports = router;