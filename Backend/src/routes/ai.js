const express = require('express');
const router = express.Router({ mergeParams: true });
const { z } = require('zod');

const { pool, callProc } = require('../db');
const asyncHandler = require('../middlewares/asyncHandler');
const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission');
const validate = require('../middlewares/validate');
const { doorUnlocked } = require('../services/doorAutoLock');
const { iotKeyOrUser } = require('../middlewares/iotAuth');
const { toMysqlDatetime, optionalDateSchema } = require('../utils/datetime');
const { requireDoorInHome } = require('../utils/doors');
const { parseVoice, resolveDevice } = require('../utils/voice');
const { sendDeviceCommand, HttpError } = require('../services/deviceControl');
const { disableAutoOnManual } = require('../services/automation');
const assistant = require('../services/assistant');

// face-api.js (Frontend) sinh descriptor 128 chiều; vector khác độ dài sẽ không bao giờ so khớp được
const FACE_DIMS = 128;
const faceVector = z.array(z.number().finite()).length(FACE_DIMS, `Vector khuôn mặt phải có đúng ${FACE_DIMS} chiều`);

// ==========================================
// 0. HELPER FUNCTIONS & MIDDLEWARES
// ==========================================

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
      faceData: faceVector.optional().nullable(),
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
    inputFaceVector: faceVector,
  }),
});

const voiceCommandSchema = z.object({
  body: z.object({
    commandDetail: z.string().trim().min(1, 'Chi tiết lệnh không được để trống').max(255),
    language: z.string().trim().max(20).default('vi-VN'),
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
    const homeId = parseInt(req.params.homeId, 10);
    const { inputFaceVector } = req.body;

    // Ngưỡng khoảng cách Euclid tối ưu cho webcam / camera điều kiện thực tế
    const EUCLIDEAN_THRESHOLD = 0.45;
    const SERVER_THRESHOLD = 75.0; // Yêu cầu từ Stored Procedure

    // Quy đổi khoảng cách sang độ tin cậy (%):
    // d <= 0.45 -> reliability >= 75%
    // d = 0 -> reliability = 100%
    const toReliability = (d) => {
      if (!Number.isFinite(d)) return 0;
      const score = 100 - (d / 0.60) * 100;
      return Math.min(100, Math.max(0, Math.round(score * 100) / 100));
    };

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
        if (!Array.isArray(savedVec) || savedVec.length !== FACE_DIMS) continue;

        const dist = calculateEuclideanDistance(inputFaceVector, savedVec);
        if (dist < minDistance) {
          minDistance = dist;
          bestMatch = p;
        }
      } catch {
        // Bỏ qua lỗi parsing dữ liệu lưu
      }
    }

    let faceProfileId = null;
    let label = 'unknown';
    let reliability = toReliability(minDistance);

    // Xác nhận danh tính nếu khoảng cách nhỏ hơn hoặc bằng ngưỡng 0.45
    if (bestMatch && minDistance <= EUCLIDEAN_THRESHOLD) {
      faceProfileId = bestMatch.Face_Profile_ID;
      label = bestMatch.Name;
    } else {
      label = 'unknown';
    }
    const distance = Number.isFinite(minDistance) ? Math.round(minDistance * 10000) / 10000 : null;

    const outResult = await callProc(
      'sp_record_face_recognition',
      [
        req.doorRef.id,
        faceProfileId ? Number(faceProfileId) : null,
        label,
        Number(reliability),
        Number(SERVER_THRESHOLD),
      ],
      ['p_decision']
    );

    const decision = extractOutValue(outResult, 'p_decision');

    if (decision === 'allowed') {
      // Gửi "1" lên feed 'smart-door' + hẹn giờ tự khoá (gửi "0" khi hết giờ)
      const door = await doorUnlocked({ io: req.app.get('io'), homeId, door: req.doorRef, source: 'face' });
      assistant.say(req.app.get('io'), homeId, `Xin chao ${label}`).catch(() => {});

      return res.status(200).json({
        success: true,
        message: door.mqttPublished || door.simulated
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

const REPLY = {
  on: (d) => `${d.Device_Name} đã bật`,
  off: (d) => `${d.Device_Name} đã tắt`,
  speed: (d, p) => (p.speed > 0 ? `${d.Device_Name} chạy ${p.speed}%` : `${d.Device_Name} đã tắt`),
  color: (d) => `Đã đổi màu ${d.Device_Name.toLowerCase()}`,
};
const INPUT = {
  on: () => ({ action: 'TURN_ON' }),
  off: () => ({ action: 'TURN_OFF' }),
  speed: (p) => ({ action: 'SET_SPEED', speed: p.speed }),
  color: (p) => ({ action: 'SET_COLOR', color: p.color }),
};

/**
 * @route   POST /api/homes/:homeId/ai/voice-commands
 * @desc    Phân tích câu lệnh tiếng Việt -> điều khiển đèn / quạt / còi; trợ lý phản hồi lên feed 'assistant' (V13)
 * @access  Yêu cầu quyền VOICE_USE (chủ nhà luôn có)
 */
router.post(
  '/voice-commands',
  auth,
  validate(voiceCommandSchema),
  checkPermission('VOICE_USE'),
  asyncHandler(async (req, res) => {
    const userId = req.user.User_ID;
    const homeId = parseInt(req.params.homeId, 10);
    const io = req.app.get('io');
    const { commandDetail, language } = req.body;

    const parsed = parseVoice(commandDetail);
    const [devices] = await pool.query(
      `SELECT Device_ID, Device_Name, Feed_Key, Type_Code, Connection_State, Available_working_State, Color, Home_ID
       FROM Device WHERE Home_ID = ? ORDER BY Device_ID`,
      [homeId]
    );
    const device = parsed.intent in INPUT ? resolveDevice(devices, parsed) : null;
    const commandData = device ? INPUT[parsed.intent](parsed) : {};

    // Ghi lịch sử Voice_Command (thiết bị không xác định -> 'unsupported', trigger tự tạo thông báo)
    const { outParams } = await callProc(
      'sp_process_voice_command',
      [userId, homeId, commandDetail, device?.Device_Name ?? '', JSON.stringify(commandData), language],
      ['p_voice_id', 'p_state', 'p_target_device_id', 'p_feed_key']
    );
    const voiceId = outParams.p_voice_id;

    const reject = async (status, reply, message = reply) => {
      await assistant.say(io, homeId, reply).catch(() => false);
      return res.status(status).json({
        success: false, message, reply,
        data: { voiceId, state: 'unsupported', commandDetail, intent: parsed.intent },
      });
    };

    if (parsed.intent === 'door') {
      return reject(400, 'Vì an toàn, hãy mở cửa bằng mã PIN hoặc FaceAI');
    }
    if (!device || outParams.p_state !== 'sent') {
      return reject(400, 'Tôi không hiểu', parsed.kind
        ? 'Tôi không hiểu: nhà chưa có thiết bị phù hợp hoặc câu lệnh thiếu "bật / tắt / %"'
        : 'Tôi không hiểu: hãy nói rõ thiết bị (đèn, quạt, còi) và hành động (bật, tắt, 50%, màu đỏ...)');
    }

    let result;
    try {
      result = await sendDeviceCommand({ io, homeId, device, input: commandData, userId, sourceType: 'VOICE_COMMAND' });
    } catch (err) {
      if (err instanceof HttpError) return reject(err.status, err.message);
      throw err;
    }
    if (!result.ok) {
      return reject(503, 'Không gửi được lệnh', 'Không gửi được lệnh tới Adafruit IO (MQTT chưa kết nối hoặc không phản hồi)');
    }

    const autoModeDisabled = await disableAutoOnManual(io, homeId);
    const reply = REPLY[parsed.intent](device, parsed);
    await assistant.say(io, homeId, reply).catch(() => false);

    res.status(200).json({
      success: true,
      message: reply,
      reply,
      data: {
        voiceId,
        state: 'sent',
        commandDetail,
        intent: parsed.intent,
        deviceName: device.Device_Name,
        targetDeviceId: device.Device_ID,
        commandData,
        workingState: result.workingState,
        color: result.color,
        simulated: result.simulated,
        autoModeDisabled,
      },
    });
  })
);

module.exports = router;