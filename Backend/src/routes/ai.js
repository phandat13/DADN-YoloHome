const express = require('express');
const router = express.Router({ mergeParams: true });
const { z } = require('zod');

const { pool, callProc } = require('../db');
const asyncHandler = require('../middlewares/asyncHandler');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission');
const validate = require('../middlewares/validate');
const { publishCommand } = require('../services/mqttService');

// ==========================================
// 0. HELPER FUNCTIONS
// ==========================================

// Giải mã an toàn tên cửa từ URL params (hỗ trợ tiếng Việt có dấu và URL encoded)
const getDecodedDoorName = (req) => {
  try {
    return decodeURIComponent(req.params.doorName);
  } catch {
    return req.params.doorName;
  }
};

// Trích xuất an toàn biến OUT từ outResult
const extractOutValue = (outResult, paramName) => {
  if (!outResult) return undefined;

  const target = outResult.outParams || (Array.isArray(outResult) ? outResult[0] : outResult);
  if (!target || typeof target !== 'object') return undefined;

  return (
    target[paramName] ??
    target[`AS${paramName}`] ??
    target[`@${paramName}`] ??
    target[`@out_${paramName}`] ??
    target[`out_${paramName}`]
  );
};

// Hàm tính khoảng cách Euclidean giữa 2 vector khuôn mặt
const calculateEuclideanDistance = (vec1, vec2) => {
  if (!Array.isArray(vec1) || !Array.isArray(vec2) || vec1.length !== vec2.length) {
    return Infinity;
  }
  let sum = 0;
  for (let i = 0; i < vec1.length; i++) {
    sum += Math.pow(vec1[i] - vec2[i], 2);
  }
  return Math.sqrt(sum);
};

// Bộ phân tích ý định giọng nói tiếng Việt cơ bản (Rule-based NLP)
const parseVietnameseVoiceIntent = (rawText) => {
  const normalized = (rawText || '').toLowerCase().trim();
  let action = 'UNKNOWN';
  let deviceName = '';
  let payload = {};

  if (normalized.startsWith('bật') || normalized.includes('mở')) {
    action = 'TURN_ON';
    payload = { state: 'ON' };
    deviceName = normalized
      .replace(/^(bật|mở)\s+/i, '')
      .replace(/^thiết bị\s+/i, '')
      .trim();
  } else if (normalized.startsWith('tắt') || normalized.includes('đóng')) {
    action = 'TURN_OFF';
    payload = { state: 'OFF' };
    deviceName = normalized
      .replace(/^(tắt|đóng)\s+/i, '')
      .replace(/^thiết bị\s+/i, '')
      .trim();
  }

  if (deviceName) {
    deviceName = deviceName.charAt(0).toUpperCase() + deviceName.slice(1);
  }

  return { action, deviceName, payload };
};

// ==========================================
// 1. ZOD SCHEMAS
// ==========================================

const registerFaceSchema = z.object({
  body: z
    .object({
      targetUserId: z.number().int().optional(),
      userId: z.number().int().optional(),
      faceName: z.string().trim().optional(),
      faceData: z.array(z.number()).optional().nullable(),
      validFrom: z.string().optional().nullable(),
      validTo: z.string().optional().nullable(),
    })
    .refine((data) => data.targetUserId !== undefined || data.userId !== undefined, {
      message: 'Cần cung cấp targetUserId hoặc userId (số nguyên)',
      path: ['targetUserId'],
    }),
});

const updateFaceValiditySchema = z.object({
  body: z.object({
    validFrom: z.string().optional().nullable(),
    validTo: z.string().optional().nullable(),
  }),
});

const faceRecognitionSchema = z.object({
  body: z.object({
    faceProfileId: z.number().int().optional().nullable(),
    label: z.string().trim().max(100).default('unknown'),
    reliability: z.number().min(0).max(100, 'Reliability phải từ 0 đến 100').default(85.0),
    threshold: z.number().min(0).max(100).default(75.0),
    inputFaceVector: z.array(z.number()).optional().nullable(),
  }),
});

const voiceCommandSchema = z.object({
  body: z.object({
    commandDetail: z.string().trim().min(1, 'Chi tiết lệnh không được để trống'),
    deviceName: z.string().trim().optional().nullable(),
    commandData: z.record(z.any()).optional().nullable(),
    language: z.string().trim().default('vi-VN'),
  }),
});

// ==========================================
// 2. ENDPOINTS QUẢN LÝ FACE PROFILE
// ==========================================

/**
 * @route   POST /api/homes/:homeId/ai/face-profiles
 * @desc    Đăng ký FaceProfile cho thành viên trong nhà (hỗ trợ lưu vector khuôn mặt)
 * @access  Yêu cầu quyền FACE_MANAGE
 */
router.post(
  '/face-profiles',
  auth,
  checkPermission('FACE_MANAGE'),
  validate(registerFaceSchema),
  asyncHandler(async (req, res) => {
    const actorId = req.user.User_ID;
    const homeId = parseInt(req.params.homeId, 10);
    const targetUserId = req.body.targetUserId ?? req.body.userId;
    const { validFrom = null, validTo = null, faceData } = req.body;

    const outResult = await callProc(
      'sp_register_face_profile',
      [actorId, homeId, targetUserId, validFrom, validTo],
      ['p_profile_id']
    );

    const profileId = extractOutValue(outResult, 'p_profile_id');

    // Lưu chuỗi vector Face_Data nếu client có gửi lên
    if (profileId && faceData && Array.isArray(faceData)) {
      await pool.query(
        'UPDATE Face_Profile SET Face_Data = ? WHERE Face_Profile_ID = ?',
        [JSON.stringify(faceData), profileId]
      );
    }

    res.status(201).json({
      success: true,
      message: 'Đăng ký hồ sơ FaceProfile thành công',
      data: {
        profileId,
        homeId,
        targetUserId,
        validFrom,
        validTo,
        hasFaceVector: Boolean(faceData && Array.isArray(faceData)),
      },
    });
  })
);

/**
 * @route   GET /api/homes/:homeId/ai/face-profiles
 * @desc    Lấy danh sách các FaceProfile trong nhà
 * @access  Yêu cầu quyền FACE_MANAGE
 */
router.get(
  '/face-profiles',
  auth,
  checkPermission('FACE_MANAGE'),
  asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);

    const [profiles] = await pool.execute(
      `SELECT fp.Face_Profile_ID, fp.User_ID, u.Name, u.Display_name, fp.Valid_From, fp.Valid_To,
              (fp.Face_Data IS NOT NULL) AS hasFaceData
       FROM Face_Profile fp
       JOIN \`User\` u ON u.User_ID = fp.User_ID
       WHERE fp.Home_ID = ?`,
      [homeId]
    );

    res.status(200).json({
      success: true,
      data: profiles,
    });
  })
);

/**
 * @route   PUT /api/homes/:homeId/ai/face-profiles/:profileId
 * @desc    Cập nhật thời hạn cho FaceProfile
 * @access  Yêu cầu quyền FACE_MANAGE
 */
router.put(
  '/face-profiles/:profileId',
  auth,
  checkPermission('FACE_MANAGE'),
  validate(updateFaceValiditySchema),
  asyncHandler(async (req, res) => {
    const actorId = req.user.User_ID;
    const profileId = parseInt(req.params.profileId, 10);
    const { validFrom = null, validTo = null } = req.body;

    await callProc(
      'sp_set_face_profile_validity',
      [actorId, profileId, validFrom, validTo],
      []
    );

    res.status(200).json({
      success: true,
      message: 'Cập nhật thời hạn FaceProfile thành công',
    });
  })
);

/**
 * @route   DELETE /api/homes/:homeId/ai/face-profiles/:profileId
 * @desc    Xóa FaceProfile
 * @access  Yêu cầu quyền FACE_MANAGE
 */
router.delete(
  '/face-profiles/:profileId',
  auth,
  checkPermission('FACE_MANAGE'),
  asyncHandler(async (req, res) => {
    const actorId = req.user.User_ID;
    const profileId = parseInt(req.params.profileId, 10);

    await callProc('sp_delete_face_profile', [actorId, profileId], []);

    res.status(200).json({
      success: true,
      message: 'Xóa FaceProfile thành công',
    });
  })
);

// ==========================================
// 3. ENDPOINTS NHẬN DIỆN KHUÔN MẶT (FACE AI RECOGNITION)
// ==========================================

/**
 * @route   POST /api/homes/:homeId/ai/doors/:doorName/face-recognition
 * @desc    Nhận kết quả AI từ camera để mở cửa, đối soát qua Stored Procedure
 * @access  Public / Camera IoT Device
 */
router.post(
  '/doors/:doorName/face-recognition',
  validate(faceRecognitionSchema),
  asyncHandler(async (req, res) => {
    const doorName = getDecodedDoorName(req);
    const homeId = parseInt(req.params.homeId, 10);
    let { faceProfileId = null, label, reliability, threshold, inputFaceVector } = req.body;

    // So khớp vector khi camera gửi raw vector lên
    if (inputFaceVector && Array.isArray(inputFaceVector)) {
      const [profiles] = await pool.query(
        `SELECT fp.Face_Profile_ID, fp.Face_Data, u.Name 
         FROM Face_Profile fp
         JOIN \`User\` u ON fp.User_ID = u.User_ID
         WHERE fp.Home_ID = ?`,
        [homeId]
      );

      let bestMatch = null;
      let minDistance = Infinity;

      for (const p of profiles) {
        if (!p.Face_Data) continue;
        try {
          const savedVec = typeof p.Face_Data === 'string' ? JSON.parse(p.Face_Data) : p.Face_Data;
          const dist = calculateEuclideanDistance(inputFaceVector, savedVec);
          if (dist < minDistance) {
            minDistance = dist;
            bestMatch = p;
          }
        } catch {
          // Bỏ qua nếu dữ liệu JSON vector lưu lỗi
        }
      }

      // Ngưỡng khoảng cách Euclidean (< 0.6 là khớp)
      if (bestMatch && minDistance < 0.6) {
        faceProfileId = bestMatch.Face_Profile_ID;
        label = bestMatch.Name;
        reliability = Math.min(100, Math.max(0, Math.round((1 - minDistance) * 100)));
      } else {
        label = 'unknown';
        reliability = 40.0;
      }
    }

    const outResult = await callProc(
      'sp_record_face_recognition',
      [
        doorName,
        faceProfileId ? Number(faceProfileId) : null,
        label,
        Number(reliability),
        Number(threshold),
      ],
      ['p_decision']
    );

    let decision = extractOutValue(outResult, 'p_decision');
    const outParams = outResult?.outParams || outResult;

    if (!decision && outParams && typeof outParams === 'object') {
      const values = Object.values(outParams);
      if (values.includes('allowed')) decision = 'allowed';
      else if (values.includes('denied')) decision = 'denied';
    }

    if (decision === 'allowed') {
      // Gửi lệnh MQTT mở chốt cửa vật lý
      publishCommand(homeId, 0, { action: 'UNLOCK_DOOR', doorName });

      return res.status(200).json({
        success: true,
        message: 'Khuôn mặt hợp lệ, đã mở cửa',
        decision: 'allowed',
        label,
        reliability,
      });
    }

    return res.status(403).json({
      success: false,
      message: 'Khuôn mặt không hợp lệ hoặc không có quyền mở cửa',
      decision: decision || 'denied',
      label,
      reliability,
    });
  })
);

// ==========================================
// 4. ENDPOINTS LỆNH GIỌNG NÓI (VOICE COMMAND)
// ==========================================

/**
 * @route   POST /api/homes/:homeId/ai/voice-commands
 * @desc    Xử lý câu lệnh giọng nói, phân tích Intent và điều khiển thiết bị
 * @access  Yêu cầu quyền VOICE_USE
 */
router.post(
  '/voice-commands',
  auth,
  checkPermission('VOICE_USE'),
  validate(voiceCommandSchema),
  asyncHandler(async (req, res) => {
    const userId = req.user.User_ID;
    const homeId = parseInt(req.params.homeId, 10);
    let { commandDetail, deviceName, commandData, language } = req.body;

    if (!deviceName || !commandData) {
      const parsed = parseVietnameseVoiceIntent(commandDetail);
      if (!deviceName) deviceName = parsed.deviceName;
      if (!commandData) commandData = parsed.payload;
    }

    const outResult = await callProc(
      'sp_process_voice_command',
      [userId, homeId, commandDetail, deviceName || '', JSON.stringify(commandData || {}), language],
      ['p_voice_id', 'p_state']
    );

    const voiceId = extractOutValue(outResult, 'p_voice_id');
    const state = extractOutValue(outResult, 'p_state');

    if (state === 'unsupported') {
      return res.status(400).json({
        success: false,
        message: 'Lệnh không được hỗ trợ hoặc thiết bị không tồn tại/không đủ quyền',
        data: { voiceId, state, commandDetail, deviceName },
      });
    }

    if (state === 'sent') {
      const [devRows] = await pool.query(
        'SELECT Device_ID FROM Device WHERE Home_ID = ? AND Device_Name LIKE ? LIMIT 1',
        [homeId, `%${deviceName}%`]
      );

      if (devRows.length > 0) {
        const targetDeviceId = devRows[0].Device_ID;
        publishCommand(homeId, targetDeviceId, commandData);

        const newWorkingState = commandData?.state === 'ON' ? 'on' : 'off';
        await pool.query(
          'UPDATE Device SET Available_working_State = ? WHERE Device_ID = ?',
          [newWorkingState, targetDeviceId]
        );
      }
    }

    res.status(200).json({
      success: true,
      message: 'Thực thi lệnh giọng nói thành công',
      data: {
        voiceId,
        state,
        commandDetail,
        deviceName,
        commandData,
      },
    });
  })
);

module.exports = router;