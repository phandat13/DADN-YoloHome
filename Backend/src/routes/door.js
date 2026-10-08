const express = require('express');
const router = express.Router({ mergeParams: true });
const { z } = require('zod');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const { pool, callProc } = require('../db');
const asyncHandler = require('../middlewares/asyncHandler');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission');
const validate = require('../middlewares/validate');
const { isMqttConnected } = require('../services/mqttService');
const { doorUnlocked, doorLocked, getAutoLockAt } = require('../services/doorAutoLock');
const config = require('../config');
const { toMysqlDatetime, optionalDateSchema } = require('../utils/datetime');
const { requireDoorInHome } = require('../utils/doors');


// ==========================================
// 0. HELPER FUNCTIONS & MIDDLEWARES
// ==========================================

const pinLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  skipSuccessfulRequests: true, // chỉ đếm lần nhập SAI (đúng như thông báo "sai 5 lần")
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}_${req.params.homeId}_${req.params.doorName || 'default'}`,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Quá nhiều lần thử mã PIN. Vui lòng thử lại sau 10 phút.',
    });
  },
});

// Lấy trực tiếp doorName đã được Express tự giải mã an toàn
const getDoorName = (req) => req.params.doorName;


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

const dateSchema = optionalDateSchema;

// "12" (chuỗi từ form) -> 12
const intLike = z.preprocess(
  (v) => (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v),
  z.number().int({ message: 'Phải là số nguyên' })
);

const createDoorSchema = z.object({
  body: z.object({
    doorName: z.string().trim().min(1, 'Tên cửa không được để trống').max(100),
    workingState: z.string().trim().max(30).optional().default('enabled'),
  }),
});

const createPinSchema = z.object({
  body: z.object({
    targetUserId: intLike.optional().nullable(),
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

// Bàn phím trên web chỉ biết mã cũ + mã mới (không biết credentialId) -> credentialId không bắt buộc,
// chấp nhận cả tên trường oldPin, và confirmPin mặc định bằng newPin (bàn phím đã tự so 2 lần nhập).
const changePinSchema = z.object({
  body: z
    .object({
      credentialId: intLike.optional().nullable(),
      currentPin: z.string().min(1).optional(),
      oldPin: z.string().min(1).optional(),
      newPin: z.string().regex(/^[0-9]{4,8}$/, 'Mã PIN mới phải gồm 4 đến 8 chữ số'),
      confirmPin: z.string().regex(/^[0-9]{4,8}$/, 'Xác nhận mã PIN mới phải gồm 4 đến 8 chữ số').optional(),
    })
    .refine((b) => b.currentPin || b.oldPin, { message: 'Vui lòng nhập mã PIN hiện tại', path: ['currentPin'] }),
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

    try {
      await pool.execute(
        'INSERT INTO Smart_Door (Smart_Door_Name, Working_State, Lock_Unlock_State, Home_ID) VALUES (?, ?, ?, ?)',
        [doorName, workingState || 'enabled', 'Locked', homeId]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          success: false,
          message: `Tên cửa "${doorName}" đã được sử dụng. Tên cửa phải là duy nhất, hãy đặt tên khác (VD: "${doorName} - nhà 2").`,
        });
      }
      throw err;
    }
    await pool.query('CALL sp_log_activity(?, ?, ?, ?, ?, ?)', [req.user.User_ID, homeId, 'smart_door', 'create_door', 'web', 'success']);

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

    // Cửa đang mở: kèm thời điểm sẽ tự khoá để giao diện hiển thị đếm ngược
    for (const d of doors) {
      const lockAt = getAutoLockAt(d.doorName);
      d.autoLockAt = lockAt ? new Date(lockAt).toISOString() : null;
      d.autoLockSeconds = config.doorAutoLockSeconds;
    }

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
  requireDoorInHome,
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
        ac.Credential_State AS state
       FROM Access_Credential ac
       JOIN Smart_Door sd ON ac.Smart_Door_Name = sd.Smart_Door_Name
       JOIN \`User\` u ON ac.User_ID = u.User_ID
       WHERE sd.Home_ID = ? AND ac.Smart_Door_Name = ?
       ORDER BY ac.Credential_ID DESC`,
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
  requireDoorInHome,
  validate(createPinSchema),
  asyncHandler(async (req, res) => {
    const actorId = req.user.User_ID ?? req.user.userId;
    const doorName = getDoorName(req);
    const { targetUserId, pin, validFrom = null, validTo = null } = req.body;

    const finalUserId = targetUserId || actorId;
    const formattedValidFrom = toMysqlDatetime(validFrom, { dateOnly: 'start' });
    const formattedValidTo = toMysqlDatetime(validTo, { dateOnly: 'end' });

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
  requireDoorInHome,
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

    // Gửi UNLOCK_DOOR lên feed + hẹn giờ tự khoá (sẽ gửi LOCK_DOOR lên feed khi hết giờ)
    const homeId = parseInt(req.params.homeId, 10);
    const door = doorUnlocked({ io: req.app.get('io'), homeId, doorName, source: 'pin', userId });

    res.status(200).json({
      success: true,
      message: door.mqttPublished
        ? 'Mở cửa thành công'
        : 'Mã PIN đúng nhưng chưa gửi được lệnh mở cửa tới Adafruit IO (MQTT chưa kết nối)',
      data: {
        result,
        userId,
        ...door,
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
  requireDoorInHome,
  validate(changePinSchema),
  asyncHandler(async (req, res) => {
    const actorId = req.user.User_ID ?? req.user.userId;
    const doorName = getDoorName(req);
    const currentPin = req.body.currentPin ?? req.body.oldPin;
    const { newPin } = req.body;
    const confirmPin = req.body.confirmPin ?? newPin;
    let credentialId = req.body.credentialId;

    if (credentialId) {
      // Credential phải thuộc đúng cửa trong URL
      const [own] = await pool.query(
        'SELECT 1 FROM Access_Credential WHERE Credential_ID = ? AND Smart_Door_Name = ? LIMIT 1',
        [credentialId, doorName]
      );
      if (own.length === 0) {
        return res.status(404).json({ success: false, message: 'Mã PIN không thuộc cửa này' });
      }
    } else {
      // Không có credentialId: tìm mã PIN đang hoạt động của cửa khớp với mã hiện tại (ưu tiên của chính mình)
      const [found] = await pool.query(
        `SELECT Credential_ID FROM Access_Credential
         WHERE Smart_Door_Name = ? AND LOWER(Credential_State) = 'active'
           AND Credential_Value = fn_hash_pin(Smart_Door_Name, User_ID, ?)
         ORDER BY (User_ID = ?) DESC, Credential_ID DESC
         LIMIT 1`,
        [doorName, currentPin, actorId]
      );
      if (found.length === 0) {
        return res.status(400).json({ success: false, message: 'Mật mã hiện tại không đúng' });
      }
      credentialId = found[0].Credential_ID;
    }

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
  requireDoorInHome,
  asyncHandler(async (req, res) => {
    const actorId = req.user.User_ID ?? req.user.userId;
    const credentialId = parseInt(req.params.credentialId, 10);
    if (Number.isNaN(credentialId)) {
      return res.status(400).json({ success: false, message: 'credentialId phải là số nguyên' });
    }
    const [own] = await pool.query(
      'SELECT 1 FROM Access_Credential WHERE Credential_ID = ? AND Smart_Door_Name = ? LIMIT 1',
      [credentialId, getDoorName(req)]
    );
    if (own.length === 0) {
      return res.status(404).json({ success: false, message: 'Mã PIN không tồn tại ở cửa này' });
    }

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
  requireDoorInHome,
  validate(setDoorStateSchema),
  asyncHandler(async (req, res) => {
    const actorId = req.user.User_ID ?? req.user.userId;
    const doorName = getDoorName(req);
    const homeId = parseInt(req.params.homeId, 10);
    const { state } = req.body;

    // Không gửi được lệnh lên Adafruit thì không đổi trạng thái trong DB (cửa thật không nhận được lệnh)
    if (!isMqttConnected()) {
      return res.status(503).json({
        success: false,
        message: 'Không gửi được lệnh tới Adafruit IO (MQTT chưa kết nối). Kiểm tra MQTT_USERNAME / MQTT_KEY và mạng.',
      });
    }

    await callProc('sp_set_door_state', [actorId, doorName, state], []);

    // Gửi lệnh lên feed chuẩn 'smart-door'; mở khoá thì hẹn giờ tự khoá, khoá tay thì huỷ hẹn giờ
    const io = req.app.get('io');
    const door = state === 'unlocked'
      ? doorUnlocked({ io, homeId, doorName, source: 'remote', userId: actorId })
      : doorLocked({ io, homeId, doorName, source: 'remote' });

    res.status(200).json({
      success: true,
      message: state === 'unlocked'
        ? `Đã mở khoá cửa từ xa${door.autoLockSeconds ? `, tự khoá sau ${door.autoLockSeconds} giây` : ''}`
        : 'Đã khoá cửa từ xa',
      data: {
        doorName,
        state,
        ...door,
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
  requireDoorInHome,
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
        COALESCE(u.Display_name, u.Name) AS userName,
        aa.\`Time\` AS \`time\`,
        aa.Smart_Door_Name AS doorName
      FROM Access_Attempt aa
      JOIN Smart_Door sd ON aa.Smart_Door_Name = sd.Smart_Door_Name
      LEFT JOIN \`User\` u ON u.User_ID = aa.User_ID
      WHERE sd.Home_ID = ? AND aa.Smart_Door_Name = ?
      ORDER BY aa.\`Time\` DESC, aa.Access_ID DESC
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

