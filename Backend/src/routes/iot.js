const express = require('express');
const router = express.Router({ mergeParams: true });
const { z } = require('zod');

const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission');
const asyncHandler = require('../middlewares/asyncHandler');
const validate = require('../middlewares/validate');
const { requireIotKey, iotKeyOrUser } = require('../middlewares/iotAuth');
const { pool } = require('../db');
const { recordSensorValue } = require('../services/sensorIngest');
const { feedForSensorType } = require('../utils/feeds');
const { toMysqlDatetime } = require('../utils/datetime');

const idString = (name) => z.string().regex(/^\d+$/, `${name} phải là số nguyên`);
const numberLike = z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number({ error: 'Giá trị phải là số' }).finite());
const intLike = z.preprocess((v) => (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v), z.number().int());
const qualitySchema = z
  .preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['good', 'bad', 'uncertain']))
  .default('good');

const telemetrySchema = z.object({
  body: z.object({
    sensorId: intLike,
    value: numberLike,
    unit: z.string().trim().default(''), // Cho phép chuỗi rỗng cho cảm biến PIR/Motion
    dataQuality: qualitySchema,
  }),
});

const sensorTelemetrySchema = z.object({
  params: z.object({ homeId: idString('homeId'), sensorId: idString('sensorId') }),
  body: z.object({
    value: numberLike,
    dataQuality: qualitySchema,
  }),
});

// Tên kiểu dữ liệu trên giao diện -> Sensor_Type lưu trong DB
const SENSOR_TYPE_ALIASES = {
  TEMPERATURE: 'TEMPERATURE', TEMP: 'TEMPERATURE',
  HUMIDITY: 'HUMIDITY', HUMID: 'HUMIDITY', HUMI: 'HUMIDITY',
  LIGHT: 'LIGHT', LUX: 'LIGHT',
  MOTION: 'MOTION', PIR: 'MOTION',
};
const SENSOR_LABEL = { TEMPERATURE: 'Nhiệt độ', HUMIDITY: 'Độ ẩm', LIGHT: 'Ánh sáng', MOTION: 'Chuyển động' };

const createSensorSchema = z.object({
  params: z.object({ homeId: idString('homeId') }),
  body: z.object({
    deviceId: intLike,
    dataType: z
      .string()
      .trim()
      .transform((v) => SENSOR_TYPE_ALIASES[v.toUpperCase()] ?? v.toUpperCase())
      .pipe(z.string().min(1, 'Kiểu dữ liệu không được để trống').max(50)),
    unit: z.string().trim().max(20).default(''),
    sensorName: z.string().trim().max(100).optional(),
    feedKey: z.string().trim().max(100).optional().nullable(),
    samplingCycle: intLike.optional().nullable(),
  }),
});

/**
 * @route   GET /api/homes/:homeId/iot/sensors
 * @desc    Lấy danh sách cảm biến thuộc về ngôi nhà (Bắt buộc JOIN Device để lọc theo Home_ID)
 * @access  Yêu cầu quyền SENSOR_VIEW
 */
router.get(
  '/sensors',
  auth,
  checkPermission('SENSOR_VIEW'),
  asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);

    const [sensors] = await pool.query(
      `SELECT 
        s.Sensor_ID AS sensorId,
        s.Sensor_Name AS sensorName,
        s.Sensor_Type AS sensorType,
        s.Current_Value AS currentValue,
        s.Unit AS unit,
        s.Feed_Key AS feedKey,
        s.Last_Updated AS lastUpdated,
        s.Device_ID AS deviceId,
        d.Device_Name AS deviceName
       FROM Sensor s
       JOIN Device d ON s.Device_ID = d.Device_ID
       WHERE d.Home_ID = ?
       ORDER BY s.Sensor_ID`,
      [homeId]
    );

    res.status(200).json({ success: true, data: sensors });
  })
);

/**
 * @route   POST /api/homes/:homeId/iot/sensors
 * @desc    Đăng ký cảm biến gắn với 1 thiết bị của nhà (trang Cài đặt → Cảm biến IoT)
 * @access  Yêu cầu quyền DEVICE_MANAGE
 */
router.post(
  '/sensors',
  auth,
  validate(createSensorSchema),
  checkPermission('DEVICE_MANAGE'),
  asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);
    const { deviceId, dataType, unit, sensorName, feedKey, samplingCycle } = req.body;

    const [devices] = await pool.query(
      'SELECT Device_ID, Device_Name FROM Device WHERE Device_ID = ? AND Home_ID = ? LIMIT 1',
      [deviceId, homeId]
    );
    if (devices.length === 0) {
      return res.status(404).json({ success: false, message: 'Thiết bị không tồn tại trong ngôi nhà này' });
    }

    const name = sensorName || `${SENSOR_LABEL[dataType] ?? dataType} - ${devices[0].Device_Name}`;
    // Feed Adafruit mà cảm biến nhận dữ liệu (sensor-temperature / sensor-humidity / sensor-light)
    const finalFeed = feedKey || feedForSensorType(dataType);

    const [result] = await pool.query(
      `INSERT INTO Sensor (Sensor_Name, Sensor_Type, Unit, Feed_Key, Sampling_Cycle, Device_ID)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, dataType, unit, finalFeed, samplingCycle ?? null, deviceId]
    );

    await pool.query('CALL sp_log_activity(?, ?, ?, ?, ?, ?)', [req.user.User_ID, homeId, 'sensor', 'add_sensor', 'web', 'success']);

    res.status(201).json({
      success: true,
      message: 'Đăng ký cảm biến thành công',
      data: { sensorId: result.insertId, sensorName: name, sensorType: dataType, unit, feedKey: finalFeed, deviceId },
    });
  })
);

/**
 * @route   GET /api/homes/:homeId/iot/sensors/:sensorId/records
 * @desc    Lấy lịch sử đo của cảm biến theo khoảng thời gian và phân trang an toàn
 * @access  Yêu cầu quyền SENSOR_VIEW
 */
router.get(
  '/sensors/:sensorId/records',
  auth,
  checkPermission('SENSOR_VIEW'),
  asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);
    const sensorId = parseInt(req.params.sensorId, 10);
    if (Number.isNaN(sensorId)) {
      return res.status(400).json({ success: false, message: 'sensorId phải là số nguyên' });
    }
    const from = toMysqlDatetime(req.query.from, { dateOnly: 'start' });
    const to = toMysqlDatetime(req.query.to, { dateOnly: 'end' });

    // Tối đa 5000 bản ghi mỗi lần (đủ cho biểu đồ 24 giờ) để tránh cạn bộ nhớ
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 5000);

    // Xác thực cảm biến thuộc nhà này
    const [sensorCheck] = await pool.query(
      `SELECT s.Sensor_ID FROM Sensor s
       JOIN Device d ON s.Device_ID = d.Device_ID
       WHERE s.Sensor_ID = ? AND d.Home_ID = ?`,
      [sensorId, homeId]
    );

    if (sensorCheck.length === 0) {
      return res.status(404).json({ success: false, message: 'Cảm biến không tồn tại trong nhà này' });
    }

    let filterClause = '';
    const params = [sensorId];

    if (from) {
      filterClause += ' AND Time_Stamp >= ?';
      params.push(from);
    }
    if (to) {
      filterClause += ' AND Time_Stamp <= ?';
      params.push(to);
    }

    const [records] = await pool.query(
      `SELECT Record_ID AS recordId, Sensor_Value AS value, Time_Stamp AS timestamp, Data_Quality AS quality
       FROM Sensor_Record
       WHERE Sensor_ID = ? ${filterClause}
       ORDER BY Time_Stamp DESC, Record_ID DESC
       LIMIT ${Number(limit)}`,
      params
    );

    res.status(200).json({ success: true, data: records });
  })
);

// Ghi telemetry cho 1 cảm biến đã xác thực thuộc nhà
async function ingest(req, res, { sensorId, value, dataQuality, unit }) {
  const homeId = parseInt(req.params.homeId, 10);
  const [sensors] = await pool.query(
    `SELECT s.Sensor_ID FROM Sensor s
     JOIN Device d ON s.Device_ID = d.Device_ID
     WHERE s.Sensor_ID = ? AND d.Home_ID = ?`,
    [sensorId, homeId]
  );

  if (sensors.length === 0) {
    return res.status(404).json({ success: false, message: 'Cảm biến không thuộc nhà này' });
  }

  // Ghi bản ghi đo, cập nhật giá trị tức thời và phát Socket.IO tới Dashboard của nhà
  const payload = await recordSensorValue({ sensorId, value, quality: dataQuality, io: req.app.get('io') });

  return res.status(200).json({
    success: true,
    message: 'Ghi nhận telemetry thành công',
    data: { ...payload, unit: unit || payload?.unit },
  });
}

/**
 * @route   POST /api/homes/:homeId/iot/telemetry
 * @desc    Phần cứng / Gateway đẩy số liệu: { sensorId, value, dataQuality }
 * @access  Yêu cầu IoT Key (header x-iot-key)
 */
router.post(
  '/telemetry',
  requireIotKey,
  validate(telemetrySchema),
  asyncHandler(async (req, res) => ingest(req, res, req.body))
);

/**
 * @route   POST /api/homes/:homeId/iot/sensors/:sensorId/telemetry
 * @desc    Gửi giá trị thử từ giao diện web (Cài đặt) hoặc từ phần cứng
 * @access  IoT Key, hoặc người dùng có quyền DEVICE_MANAGE
 */
router.post(
  '/sensors/:sensorId/telemetry',
  iotKeyOrUser('DEVICE_MANAGE'),
  validate(sensorTelemetrySchema),
  asyncHandler(async (req, res) =>
    ingest(req, res, { sensorId: parseInt(req.params.sensorId, 10), value: req.body.value, dataQuality: req.body.dataQuality })
  )
);

module.exports = router;
