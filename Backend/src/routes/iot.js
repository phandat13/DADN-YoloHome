const express = require('express');
const router = express.Router({ mergeParams: true });
const auth = require('../middlewares/auth');
const asyncHandler = require('../middlewares/asyncHandler');
const { pool } = require('../db');

/**
 * @route   GET /api/homes/:homeId/iot/sensors
 * @desc    Lấy danh sách toàn bộ cảm biến trong nhà kèm thông tin thiết bị cha
 */
router.get(
  '/sensors',
  auth,
  asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);

    const [rows] = await pool.query(
      `SELECT 
        s.Sensor_ID,
        s.Sampling_Cycle,
        s.Working_State,
        s.Data_Type,
        s.Unit,
        s.Device_ID,
        d.Device_Name,
        d.Home_ID
      FROM Sensor s
      INNER JOIN Device d ON s.Device_ID = d.Device_ID
      WHERE d.Home_ID = ?
      ORDER BY s.Sensor_ID DESC`,
      [homeId]
    );

    res.status(200).json({
      success: true,
      data: rows,
    });
  })
);

/**
 * @route   POST /api/homes/:homeId/iot/sensors
 * @desc    Gắn thêm một cảm biến (Sensor) vào một Device trong nhà
 */
router.post(
  '/sensors',
  auth,
  asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);
    const { deviceId, samplingCycle, dataType, unit, workingState } = req.body;

    if (!deviceId || !dataType || !unit) {
      return res.status(400).json({
        success: false,
        message: 'deviceId, dataType và unit là bắt buộc',
      });
    }

    // Xác thực thiết bị thuộc nhà
    const [devCheck] = await pool.query(
      'SELECT Device_ID FROM Device WHERE Device_ID = ? AND Home_ID = ?',
      [deviceId, homeId]
    );

    if (devCheck.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Thiết bị không tồn tại trong ngôi nhà này',
      });
    }

    const [result] = await pool.query(
      `INSERT INTO Sensor (Sampling_Cycle, Working_State, Data_Type, Unit, Device_ID)
       VALUES (?, ?, ?, ?, ?)`,
      [samplingCycle || 10, workingState || 'active', dataType, unit, deviceId]
    );

    res.status(201).json({
      success: true,
      message: 'Tạo cảm biến thành công',
      data: {
        sensorId: result.insertId,
        deviceId,
        dataType,
        unit,
      },
    });
  })
);

/**
 * @route   POST /api/homes/:homeId/iot/sensors/:sensorId/telemetry
 * @desc    Gửi dữ liệu đo đạc (Telemetry) từ cảm biến lên server và lưu vào Sensor_Record
 */
router.post(
  '/sensors/:sensorId/telemetry',
  auth,
  asyncHandler(async (req, res) => {
    const sensorId = parseInt(req.params.sensorId, 10);
    const { value, dataQuality } = req.body;

    if (value === undefined || value === null) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu giá trị đo đạc (value)',
      });
    }

    // 1. Kiểm tra cảm biến có tồn tại không
    const [sensorRows] = await pool.query(
      'SELECT Sensor_ID, Unit, Data_Type FROM Sensor WHERE Sensor_ID = ?',
      [sensorId]
    );

    if (sensorRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy cảm biến với ID tương ứng',
      });
    }

    // 2. Chèn bản ghi đo đạc vào Sensor_Record
    const numericValue = parseFloat(value);
    const quality = dataQuality || 'GOOD';

    const [insertResult] = await pool.query(
      `INSERT INTO Sensor_Record (\`Value\`, Data_quality, Recorded_At, Sensor_ID)
       VALUES (?, ?, NOW(), ?)`,
      [numericValue, quality, sensorId]
    );

    res.status(201).json({
      success: true,
      message: 'Ghi nhận số liệu cảm biến thành công',
      data: {
        recordId: insertResult.insertId,
        sensorId,
        value: numericValue,
        unit: sensorRows[0].Unit,
        dataType: sensorRows[0].Data_Type,
        quality,
      },
    });
  })
);

/**
 * @route   GET /api/homes/:homeId/iot/sensors/:sensorId/records
 * @desc    Lấy lịch sử dữ liệu cảm biến gần nhất
 */
router.get(
  '/sensors/:sensorId/records',
  auth,
  asyncHandler(async (req, res) => {
    const sensorId = parseInt(req.params.sensorId, 10);
    const limit = parseInt(req.query.limit, 10) || 50;

    const [rows] = await pool.query(
      `SELECT Record_ID, \`Value\`, Data_quality, Recorded_At, Sensor_ID
       FROM Sensor_Record
       WHERE Sensor_ID = ?
       ORDER BY Recorded_At DESC
       LIMIT ?`,
      [sensorId, limit]
    );

    res.status(200).json({
      success: true,
      data: rows,
    });
  })
);

module.exports = router;