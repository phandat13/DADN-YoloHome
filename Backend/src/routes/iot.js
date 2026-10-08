const express = require('express');
const router = express.Router({ mergeParams: true });
const { z } = require('zod');

const auth = require('../middlewares/auth');
const checkPermission = require('../middlewares/permission');
const asyncHandler = require('../middlewares/asyncHandler');
const validate = require('../middlewares/validate');
const { pool } = require('../db');
const config = require('../config');

// Xác thực thiết bị phần cứng đẩy dữ liệu cảm biến
const requireIotKey = (req, res, next) => {
  const clientKey = req.headers['x-iot-key'];
  if (!config.iotApiKey || clientKey !== config.iotApiKey) {
    return res.status(401).json({
      success: false,
      message: 'Không có quyền truy cập: IoT Key không hợp lệ hoặc bị thiếu',
    });
  }
  next();
};

const telemetrySchema = z.object({
  body: z.object({
    sensorId: z.number().int(),
    value: z.number(),
    unit: z.string().trim().default(''), // Cho phép chuỗi rỗng cho cảm biến PIR/Motion
    dataQuality: z.enum(['good', 'bad', 'uncertain', 'GOOD', 'BAD', 'UNCERTAIN']).default('good'),
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
        s.Device_ID AS deviceId,
        d.Device_Name AS deviceName
       FROM Sensor s
       JOIN Device d ON s.Device_ID = d.Device_ID
       WHERE d.Home_ID = ?`,
      [homeId]
    );

    res.status(200).json({ success: true, data: sensors });
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
    const { from, to } = req.query;

    // Giới hạn trần tối đa 500 bản ghi để tránh cạn bộ nhớ
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);

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
       ORDER BY Time_Stamp DESC
       LIMIT ${Number(limit)}`,
      params
    );

    res.status(200).json({ success: true, data: records });
  })
);

/**
 * @route   POST /api/homes/:homeId/iot/telemetry
 * @desc    Nhận telemetry, ghi DB và phát Socket.IO ra Dashboard
 * @access  Yêu cầu IoT Key
 */
router.post(
  '/telemetry',
  requireIotKey,
  validate(telemetrySchema),
  asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);
    const { sensorId, value, unit, dataQuality } = req.body;

    // Xác thực cảm biến thuộc nhà
    const [sensors] = await pool.query(
      `SELECT s.Sensor_ID, s.Sensor_Name, d.Home_ID 
       FROM Sensor s 
       JOIN Device d ON s.Device_ID = d.Device_ID 
       WHERE s.Sensor_ID = ? AND d.Home_ID = ?`,
      [sensorId, homeId]
    );

    if (sensors.length === 0) {
      return res.status(404).json({ success: false, message: 'Cảm biến không thuộc nhà này' });
    }

    const qualityFormatted = dataQuality.toLowerCase();

    // 1. Ghi bản ghi đo
    await pool.query(
      `INSERT INTO Sensor_Record (Sensor_ID, Sensor_Value, Data_Quality, Time_Stamp)
       VALUES (?, ?, ?, NOW())`,
      [sensorId, value, qualityFormatted]
    );

    // 2. Cập nhật giá trị tức thời
    await pool.query(
      'UPDATE Sensor SET Current_Value = ?, Last_Updated = NOW() WHERE Sensor_ID = ?',
      [value, sensorId]
    );

    // 3. Phát Socket.IO tới phòng của nhà (khắc phục lỗi dashboard không cập nhật)
    const io = req.app.get('io');
    if (io) {
      io.to(`home_${homeId}`).emit('sensor_update', {
        sensorId,
        sensorName: sensors[0].Sensor_Name,
        value,
        unit,
        quality: qualityFormatted,
        timestamp: new Date().toISOString(),
      });
    }

    res.status(200).json({ success: true, message: 'Ghi nhận telemetry thành công' });
  })
);

module.exports = router;