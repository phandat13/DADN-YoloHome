const express = require('express');
const router = express.Router({ mergeParams: true });
const { z } = require('zod');

const { pool, callProc } = require('../db');
const asyncHandler = require('../middlewares/asyncHandler');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission');
const validate = require('../middlewares/validate');
const { publishCommand } = require('../services/mqttService');
const { doorUnlocked } = require('../services/doorAutoLock');
const { iotKeyOrUser } = require('../middlewares/iotAuth');
const { toMysqlDatetime, optionalDateSchema } = require('../utils/datetime');
const { resolveValidFeedKey, isFanDevice } = require('../utils/feeds');
const { requireDoorInHome } = require('../utils/doors');

// ==========================================
// 0. HELPER FUNCTIONS & MIDDLEWARES
// ==========================================


// Lấy tên cửa trực tiếp từ Express route param (Express đã tự decodeURIComponent)
const getDoorName = (req) => req.params.doorName;

// Trích xuất an toàn biến OUT từ outResult (đã chuẩn hóa sau khi fix db.js)
const extractOutValue = (outResult, paramName) => {
  if (!outResult) return undefined;
  const target = outResult.outParams || (Array.isArray(outResult) ? outResult[0] : outResult);
  if (!target || typeof target !== 'object') return undefined;
  return target[paramName] ?? target[`@${paramName}`];
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

// Bộ phân tích ý định giọng nói tiếng Việt (hỗ trợ bật, tắt và set tốc độ/độ sáng %)
const parseVietnameseVoiceIntent = (rawText) => {
  const normalized = (rawText || '').toLowerCase().trim();
  let action = 'UNKNOWN';
  let deviceName = '';
  let payload = {};

  const percentMatch = normalized.match(/(\d+)\s*%/);
  const percentage = percentMatch ? parseInt(percentMatch[1], 10) : null;

  if (normalized.startsWith('bật') || normalized.includes('mở')) {
    action = percentage !== null ? 'SET_SPEED' : 'TURN_ON';
    payload = percentage !== null ? { state: 'ON', speed: percentage } : { state: 'ON' };
    deviceName = normalized
      .replace(/^(bật|mở)\s+/i, '')
      .replace(/^thiết bị\s+/i, '')
      .replace(/\s+\d+\s*%/i, '')
      .trim();
  } else if (normalized.startsWith('tắt') || normalized.includes('đóng')) {
    action = 'TURN_OFF';
    payload = { state: 'OFF', speed: 0 };
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

const dateSchema = optionalDateSchema;
const intLike = z.preprocess((v) => (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v), z.number().int());

const registerFaceSchema = z.object({
  body: z
    .object({
      targetUserId: intLike.optional(),
      userId: intLike.optional(),
      faceName: z.string().trim().optional(),
      faceData: z.array(z.number()).optional().nullable(),
      validFrom: dateSchema,
      validTo: dateSchema,
    })
    .refine((data) => data.targetUserId !== undefined || data.userId !== undefined, {
      message: 'Cần cung cấp targetUserId hoặc userId (số nguyên)',
      path: ['targetUserId'],
    }),
});

const updateFaceValiditySchema = z.object({
  body: z.object({
    validFrom: dateSchema,
    validTo: dateSchema,
  }),
});

// Không tin cậy client: Bắt buộc gửi vector, bỏ hoàn toàn reliability/threshold
const faceRecognitionSchema = z.object({
  body: z.object({
    inputFaceVector: z.array(z.number()).min(128, 'Vector khuôn mặt phải có ít nhất 128 chiều'),
  }),
});

const voiceCommandSchema = z.object({
  body: z.object({
    commandDetail: z.string().trim().min(1, 'Chi tiết lệnh không được để trống'),
    deviceName: z.string().trim().optional().nullable(),
    commandData: z.record(z.string(), z.any()).optional().nullable(),
    language: z.string().trim().default('vi-VN'),
  }),
});

// ==========================================
// 2. ENDPOINTS QUẢN LÝ FACE PROFILE
// ==========================================

/**
 * @route   POST /api/homes/:homeId/ai/face-profiles
 * @desc    Đăng ký FaceProfile cho thành viên trong nhà
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
    const validFrom = toMysqlDatetime(req.body.validFrom, { dateOnly: 'start' });
    const validTo = toMysqlDatetime(req.body.validTo, { dateOnly: 'end' });
    const { faceData } = req.body;

    const outResult = await callProc(
      'sp_register_face_profile',
      [actorId, homeId, targetUserId, validFrom, validTo],
      ['p_profile_id']
    );

    const profileId = extractOutValue(outResult, 'p_profile_id');

    if (profileId && faceData && Array.isArray(faceData)) {
      await pool.query(
        'UPDATE Face_Profile SET Face_Data = ? WHERE Face_Profile_ID = ?',
        [JSON.stringify(faceData), profileId]
      );
    }
    await pool.query('CALL sp_log_activity(?, ?, ?, ?, ?, ?)', [actorId, homeId, 'face_profile', 'register_face', 'web', 'success']);

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
      `SELECT fp.Face_Profile_ID AS faceProfileId, 
              fp.User_ID AS userId, 
              u.Name AS name, 
              u.Display_name AS displayName, 
              fp.Valid_From AS validFrom, 
              fp.Valid_To AS validTo,
              fp.Created_At AS createdAt,
              (fp.Face_Data IS NOT NULL) AS hasFaceData,
              IF(fp.Face_Data IS NULL, NULL, JSON_LENGTH(fp.Face_Data)) AS faceDims
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
    const validFrom = toMysqlDatetime(req.body.validFrom, { dateOnly: 'start' });
    const validTo = toMysqlDatetime(req.body.validTo, { dateOnly: 'end' });

    // Hồ sơ phải thuộc nhà trong URL
    const [own] = await pool.query('SELECT 1 FROM Face_Profile WHERE Face_Profile_ID = ? AND Home_ID = ?', [profileId, req.params.homeId]);
    if (own.length === 0) {
      return res.status(404).json({ success: false, message: 'FaceProfile không tồn tại trong ngôi nhà này' });
    }

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

    const [own] = await pool.query('SELECT 1 FROM Face_Profile WHERE Face_Profile_ID = ? AND Home_ID = ?', [profileId, req.params.homeId]);
    if (own.length === 0) {
      return res.status(404).json({ success: false, message: 'FaceProfile không tồn tại trong ngôi nhà này' });
    }

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
 * @desc    Nhận kết quả AI từ camera để mở cửa, đối soát vector an toàn
 * @access  Header x-iot-key (camera trước cửa) hoặc người dùng đã đăng nhập có quyền DOOR_UNLOCK
 *          (trang "AI & Nhận diện" trên web dùng webcam làm camera cửa)
 */
router.post(
  '/doors/:doorName/face-recognition',
  iotKeyOrUser('DOOR_UNLOCK'),
  requireDoorInHome,
  validate(faceRecognitionSchema),
  asyncHandler(async (req, res) => {
    const doorName = getDoorName(req);
    const homeId = parseInt(req.params.homeId, 10);
    const { inputFaceVector } = req.body;

    // Ngưỡng bảo mật cố định trên server.
    // Độ tin cậy được quy đổi sao cho khoảng cách = EUCLIDEAN_THRESHOLD ứng với đúng SERVER_THRESHOLD (75%).
    // (Bản cũ tính (1 - d) * 100 nên chỉ khoảng cách <= 0.25 mới đạt 75% -> người đúng vẫn bị từ chối.)
    const SERVER_THRESHOLD = 75.0;
    const EUCLIDEAN_THRESHOLD = 0.55;
    const toReliability = (d) =>
      Number.isFinite(d) ? Math.min(100, Math.max(0, Math.round((100 - (d / EUCLIDEAN_THRESHOLD) * (100 - SERVER_THRESHOLD)) * 100) / 100)) : 0;

    // Chỉ lấy hồ sơ hợp lệ còn trong hạn truy cập
    const [profiles] = await pool.query(
      `SELECT fp.Face_Profile_ID, fp.Face_Data, fp.User_ID, u.Name 
       FROM Face_Profile fp
       JOIN \`User\` u ON fp.User_ID = u.User_ID
       WHERE fp.Home_ID = ? 
         AND (fp.Valid_From IS NULL OR fp.Valid_From <= NOW())
         AND (fp.Valid_To IS NULL OR fp.Valid_To >= NOW())`,
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
        // Bỏ qua lỗi parsing nếu dữ liệu lưu bị hỏng
      }
    }

    let faceProfileId = null;
    let label = 'unknown';
    let reliability = 0.0;

    if (bestMatch && minDistance <= EUCLIDEAN_THRESHOLD) {
      faceProfileId = bestMatch.Face_Profile_ID;
      label = bestMatch.Name;
      reliability = toReliability(minDistance);
    } else {
      label = 'unknown';
      reliability = toReliability(minDistance);
    }
    const distance = Number.isFinite(minDistance) ? Math.round(minDistance * 10000) / 10000 : null;

    const outResult = await callProc(
      'sp_record_face_recognition',
      [
        doorName,
        faceProfileId ? Number(faceProfileId) : null,
        label,
        Number(reliability),
        Number(SERVER_THRESHOLD),
      ],
      ['p_decision']
    );

    const decision = extractOutValue(outResult, 'p_decision');

    if (decision === 'allowed') {
      // Gửi UNLOCK_DOOR lên feed 'smart-door' + hẹn giờ tự khoá (gửi LOCK_DOOR khi hết giờ)
      const door = doorUnlocked({ io: req.app.get('io'), homeId, doorName, source: 'face', userId: bestMatch?.User_ID ?? null });

      return res.status(200).json({
        success: true,
        message: door.mqttPublished
          ? 'Khuôn mặt hợp lệ, đã gửi lệnh mở cửa'
          : 'Khuôn mặt hợp lệ nhưng chưa gửi được lệnh mở cửa tới Adafruit IO (MQTT chưa kết nối)',
        decision: 'allowed',
        label,
        reliability,
        distance,
        ...door,
      });
    }

    return res.status(403).json({
      success: false,
      message: 'Khuôn mặt không hợp lệ hoặc không có quyền mở cửa',
      decision: 'denied',
      label,
      reliability,
      distance,
    });
  })
);

// ==========================================
// 4. ENDPOINTS LỆNH GIỌNG NÓI (VOICE COMMAND)
// ==========================================

/**
 * @route   POST /api/homes/:homeId/ai/voice-commands
 * @desc    Xử lý câu lệnh giọng nói, phân tích Intent và điều khiển thiết bị
 * @access  Yêu cầu quyền VOICE_USE (hoặc chủ nhà Owner)
 */
router.post(
  '/voice-commands',
  auth,
  // Lưu ý: Nếu user là Owner, backend vẫn cho phép chạy tiếp,
  // hoặc checkPermission có thể giữ nguyên nếu middleware đã hỗ trợ bypass cho Owner.
  checkPermission('VOICE_USE'),
  validate(voiceCommandSchema),
  asyncHandler(async (req, res) => {
    const userId = req.user.User_ID;
    const homeId = parseInt(req.params.homeId, 10);
    let { commandDetail, deviceName, commandData, language } = req.body;

    let parsedAction = 'UNKNOWN';
    if (!deviceName || !commandData) {
      const parsed = parseVietnameseVoiceIntent(commandDetail);
      if (!deviceName) deviceName = parsed.deviceName;
      if (!commandData) commandData = parsed.payload;
      parsedAction = parsed.action;
    }

    // Gọi Stored Procedure đã nâng cấp nhận diện thiết bị & quyền chủ nhà
    const outResult = await callProc(
      'sp_process_voice_command',
      [
        userId,
        homeId,
        commandDetail,
        deviceName || '',
        JSON.stringify(commandData || {}),
        language,
      ],
      ['p_voice_id', 'p_state', 'p_target_device_id', 'p_feed_key']
    );

    const voiceId = extractOutValue(outResult, 'p_voice_id');
    const state = extractOutValue(outResult, 'p_state');
    const targetDeviceId = extractOutValue(outResult, 'p_target_device_id');
    const feedKey = extractOutValue(outResult, 'p_feed_key');

    if (state === 'unsupported' || !targetDeviceId) {
      return res.status(400).json({
        success: false,
        message: 'Lệnh không được hỗ trợ hoặc thiết bị không tồn tại/không đủ quyền',
        data: { voiceId, state, commandDetail, deviceName },
      });
    }

    if (state === 'sent') {
      // Xác định loại thiết bị để xử lý payload MQTT (chuẩn theo Lỗi 1 & 2)
      const [devRows] = await pool.query(
        'SELECT Device_ID, Device_Name, Type_Code, Feed_Key FROM Device WHERE Device_ID = ? LIMIT 1',
        [targetDeviceId]
      );

      const targetDevice = devRows[0];
      // Luôn đưa về 1 trong 8 feed chuẩn (bản cũ có thể sinh feed lạ 'device-<id>')
      const actualFeedKey = resolveValidFeedKey(feedKey || targetDevice?.Feed_Key, targetDevice?.Type_Code, targetDevice?.Device_Name);
      const isFan = isFanDevice(targetDevice, actualFeedKey);

      // Chuẩn hóa MQTT Payload:
      // - Nếu là QUẠT: giữ speed
      // - Nếu là ĐÈN hoặc thiết bị khác: loại bỏ speed khi TURN_OFF hoặc TURN_ON thường
      const mqttPayload = { ...commandData };
      if (!isFan) {
        delete mqttPayload.speed;
      }
      // Cùng định dạng với lệnh từ trang Điều khiển: { action, state, speed? }
      if (!mqttPayload.action) {
        const on = String(mqttPayload.state).toUpperCase() === 'ON';
        mqttPayload.action = !on ? 'TURN_OFF' : isFan && mqttPayload.speed !== undefined ? 'SET_SPEED' : 'TURN_ON';
      }

      // Gửi tín hiệu điều khiển qua MQTT Adafruit IO
      publishCommand(actualFeedKey, mqttPayload);

      // Cập nhật trạng thái hoạt động của thiết bị trong DB
      let newWorkingState = mqttPayload?.state === 'ON' ? 'on' : 'off';
      if (isFan && mqttPayload?.speed !== undefined && mqttPayload.speed > 0) {
        newWorkingState = String(mqttPayload.speed);
      }

      await pool.query(
        'UPDATE Device SET Available_working_State = ? WHERE Device_ID = ?',
        [newWorkingState, targetDeviceId]
      );

      // Ghi lịch sử lệnh + báo các tab đang mở cập nhật công tắc
      await pool
        .query(
          `INSERT INTO Device_Command (Source_ID, Source_Type, Data_attached, Excute_Time, Excute_State, Device_ID)
           VALUES (?, 'VOICE_COMMAND', ?, NOW(), 'SUCCESS', ?)`,
          [userId, JSON.stringify(mqttPayload), targetDeviceId]
        )
        .catch((err) => console.error('[VOICE] Không ghi được Device_Command:', err.message));
      const io = req.app.get('io');
      if (io) io.to(`home_${homeId}`).emit('device_state_updated', { homeId, deviceId: targetDeviceId, state: newWorkingState });
    }

    res.status(200).json({
      success: true,
      message: 'Thực thi lệnh giọng nói thành công',
      data: {
        voiceId,
        state,
        commandDetail,
        deviceName,
        targetDeviceId,
        commandData,
      },
    });
  })
);

module.exports = router;

