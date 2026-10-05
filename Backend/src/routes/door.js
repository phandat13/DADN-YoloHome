const express = require('express');
const router = express.Router({ mergeParams: true });
const { z } = require('zod');

const { pool, callProc } = require('../db');
const asyncHandler = require('../middlewares/asyncHandler');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission');
const validate = require('../middlewares/validate');

// Helper giải mã an toàn tên cửa (hỗ trợ tiếng Việt có dấu và URL encoded)
const getDecodedDoorName = (req) => {
  try {
    return decodeURIComponent(req.params.doorName);
  } catch {
    return req.params.doorName;
  }
};

// ==========================================
// 1. ZOD SCHEMAS
// ==========================================

const createDoorSchema = z.object({
  body: z.object({
    doorName: z.string().trim().min(1, 'Tên cửa không được để trống').max(100),
    workingState: z.string().trim().max(30).optional().default('enabled'),
  }),
});

const createPinSchema = z.object({
  body: z.object({
    targetUserId: z.number().int({ message: 'User ID phải là số nguyên' }),
    pin: z.string().regex(/^[0-9]{4,8}$/, 'Mã PIN phải gồm từ 4 đến 8 chữ số'),
    validFrom: z.string().datetime().optional().nullable(),
    validTo: z.string().datetime().optional().nullable(),
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
      errorMap: () => ({ message: 'Trạng thái phải là "locked" hoặc "unlocked"' }),
    }),
  }),
});

// ==========================================
// 2. ENDPOINTS
// ==========================================

/**
 * @route   POST /api/homes/:homeId/doors
 * @desc    Tạo cửa thông minh mới (bảng Smart_Door)
 * @access  Yêu cầu quyền DEVICE_MANAGE
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
      [doorName, workingState, 'Locked', homeId]
    );

    res.status(201).json({
      success: true,
      message: 'Khởi tạo cửa thông minh thành công',
      data: {
        doorName,
        homeId,
        lockState: 'Locked',
        workingState,
      },
    });
  })
);

/**
 * @route   GET /api/homes/:homeId/doors
 * @desc    Lấy danh sách các cửa thông minh trong nhà
 * @access  Yêu cầu quyền DEVICE_VIEW
 */
router.get(
  '/',
  auth,
  checkPermission('DEVICE_VIEW'),
  asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);

    const [doors] = await pool.execute(
      'SELECT Smart_Door_Name, Working_State, Lock_Unlock_State, Home_ID FROM Smart_Door WHERE Home_ID = ?',
      [homeId]
    );

    res.status(200).json({
      success: true,
      data: doors,
    });
  })
);

/**
 * @route   POST /api/homes/:homeId/doors/:doorName/pins
 * @desc    Cấp mã PIN mở cửa cho thành viên / khách
 * @access  Yêu cầu quyền DOOR_MANAGE
 */
router.post(
  '/:doorName/pins',
  auth,
  checkPermission('DOOR_MANAGE'),
  validate(createPinSchema),
  asyncHandler(async (req, res) => {
    const actorId = req.user.User_ID;
    const doorName = getDecodedDoorName(req);
    const { targetUserId, pin, validFrom = null, validTo = null } = req.body;

    // sp_create_access_credential(p_actor_id, p_door, p_target_user_id, p_pin, p_valid_from, p_valid_to, OUT p_credential_id)
    const outResult = await callProc(
      'sp_create_access_credential',
      [actorId, doorName, targetUserId, pin, validFrom, validTo],
      ['p_credential_id']
    );

    const credentialId = outResult?.p_credential_id ?? outResult?.['@p_credential_id'];

    res.status(201).json({
      success: true,
      message: 'Cấp mã PIN mở cửa thành công',
      data: {
        credentialId,
        doorName,
        targetUserId,
      },
    });
  })
);

/**
 * @route   POST /api/homes/:homeId/doors/:doorName/verify-pin
 * @desc    Xác thực mã PIN mở cửa (tại bàn phím / remote cửa)
 * @access  Public / Device
 */
router.post(
  '/:doorName/verify-pin',
  validate(verifyPinSchema),
  asyncHandler(async (req, res) => {
    const doorName = getDecodedDoorName(req);
    const { pin } = req.body;

    // sp_verify_door_pin(IN p_door, IN p_pin, OUT p_result, OUT p_user_id)
    const outResult = await callProc(
      'sp_verify_door_pin',
      [doorName, pin],
      ['p_result', 'p_user_id']
    );

    const result = outResult?.p_result ?? outResult?.['@p_result'] ?? outResult?.result;
    const userId = outResult?.p_user_id ?? outResult?.['@p_user_id'] ?? outResult?.user_id;

    if (result === 'locked_out') {
      return res.status(429).json({
        success: false,
        message: 'Cửa đang bị khóa tạm thời do nhập sai quá 5 lần trong 10 phút',
        result,
      });
    }

    if (result !== 'success') {
      return res.status(400).json({
        success: false,
        message: 'Mã PIN không hợp lệ, đã hết hạn hoặc người dùng không có quyền mở cửa',
        result: result || 'failed',
      });
    }

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
 * @access  Yêu cầu quyền DOOR_MANAGE
 */
router.put(
  '/:doorName/change-pin',
  auth,
  checkPermission('DOOR_MANAGE'),
  validate(changePinSchema),
  asyncHandler(async (req, res) => {
    const actorId = req.user.User_ID;
    const { credentialId, currentPin, newPin, confirmPin } = req.body;

    // sp_change_door_pin(IN p_actor_id, IN p_credential_id, IN p_current_pin, IN p_new_pin, IN p_confirm_pin)
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
 * @access  Yêu cầu quyền DOOR_MANAGE
 */
router.delete(
  '/:doorName/credentials/:credentialId',
  auth,
  checkPermission('DOOR_MANAGE'),
  asyncHandler(async (req, res) => {
    const actorId = req.user.User_ID;
    const credentialId = parseInt(req.params.credentialId, 10);

    // sp_revoke_credential(IN p_actor_id, IN p_credential_id)
    await callProc('sp_revoke_credential', [actorId, credentialId], []);

    res.status(200).json({
      success: true,
      message: 'Thu hồi mã PIN thành công',
    });
  })
);

/**
 * @route   POST /api/homes/:homeId/doors/:doorName/unlock
 * @desc    Mở khóa hoặc khóa cửa từ xa
 * @access  Yêu cầu quyền DOOR_MANAGE
 */
router.post(
  '/:doorName/unlock',
  auth,
  checkPermission('DOOR_MANAGE'),
  validate(setDoorStateSchema),
  asyncHandler(async (req, res) => {
    const actorId = req.user.User_ID;
    const doorName = getDecodedDoorName(req);
    const { state } = req.body;

    // sp_set_door_state(IN p_actor_id, IN p_door, IN p_state)
    await callProc('sp_set_door_state', [actorId, doorName, state], []);

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
 * @desc    Xem lịch sử các lần quẹt thẻ / bấm PIN / nhận diện mở cửa
 * @access  Yêu cầu quyền DOOR_MANAGE
 */
router.get(
  '/:doorName/attempts',
  auth,
  checkPermission('DOOR_MANAGE'),
  asyncHandler(async (req, res) => {
    const doorName = getDecodedDoorName(req);
    const limit = parseInt(req.query.limit, 10) || 20;

    const [attempts] = await pool.execute(
      'SELECT Access_ID, Verify_Method, Access_Result, Failure_Reason, User_ID, `Time` FROM Access_Attempt WHERE Smart_Door_Name = ? ORDER BY `Time` DESC LIMIT ?',
      [doorName, limit]
    );

    res.status(200).json({
      success: true,
      data: attempts,
    });
  })
);

module.exports = router;