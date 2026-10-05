const express = require('express');
const router = express.Router({ mergeParams: true });
const auth = require('../middlewares/auth');
const asyncHandler = require('../middlewares/asyncHandler');
const { pool } = require('../db');
const { publishCommand } = require('../services/mqttService');

/**
 * @route   GET /api/homes/:homeId/devices
 * @desc    Lấy danh sách tất cả thiết bị của một ngôi nhà
 */
router.get(
  '/',
  auth,
  asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);

    const [rows] = await pool.query(
      `SELECT 
        d.Device_ID,
        d.Device_Name,
        d.Hardware_ID,
        d.Serial_No,
        d.Connection_State,
        d.Last_Connection_Time,
        d.Available_working_State,
        d.Home_ID,
        d.Type_Code,
        d.Controller_ID,
        dt.Type_Name,
        dt.Type_Group,
        dt.Manufacturer
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
 * @desc    Tạo mới một thiết bị trong nhà
 */
router.post(
  '/',
  auth,
  asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);
    const {
      deviceName,
      hardwareId,
      serialNo,
      typeCode,
      controllerId,
      connectionState,
      availableWorkingState,
    } = req.body;

    if (!deviceName || !typeCode) {
      return res.status(400).json({
        success: false,
        message: 'deviceName và typeCode là bắt buộc',
      });
    }

    const [result] = await pool.query(
      `INSERT INTO Device (
        Device_Name,
        Hardware_ID,
        Serial_No,
        Connection_State,
        Available_working_State,
        Home_ID,
        Type_Code,
        Controller_ID
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        deviceName,
        hardwareId || null,
        serialNo || null,
        connectionState || 'connected',
        availableWorkingState || 'ready',
        homeId,
        typeCode,
        controllerId || null,
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Tạo thiết bị thành công',
      data: {
        deviceId: result.insertId,
        deviceName,
        homeId,
        typeCode,
      },
    });
  })
);

/**
 * @route   PATCH /api/homes/:homeId/devices/:deviceId
 * @desc    Cập nhật thông tin hoặc trạng thái thiết bị
 */
router.patch(
  '/:deviceId',
  auth,
  asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);
    const deviceId = parseInt(req.params.deviceId, 10);
    const { deviceName, connectionState, availableWorkingState, controllerId } = req.body;

    const fields = [];
    const params = [];

    if (deviceName !== undefined) {
      fields.push('Device_Name = ?');
      params.push(deviceName);
    }
    if (connectionState !== undefined) {
      fields.push('Connection_State = ?');
      params.push(connectionState);
    }
    if (availableWorkingState !== undefined) {
      fields.push('Available_working_State = ?');
      params.push(availableWorkingState);
    }
    if (controllerId !== undefined) {
      fields.push('Controller_ID = ?');
      params.push(controllerId);
    }

    if (fields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Không có dữ liệu nào được cung cấp để cập nhật',
      });
    }

    params.push(deviceId, homeId);

    const [result] = await pool.query(
      `UPDATE Device SET ${fields.join(', ')} WHERE Device_ID = ? AND Home_ID = ?`,
      params
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Thiết bị không tồn tại trong nhà này',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Cập nhật thiết bị thành công',
    });
  })
);

/**
 * @route   DELETE /api/homes/:homeId/devices/:deviceId
 * @desc    Xóa thiết bị khỏi nhà
 */
router.delete(
  '/:deviceId',
  auth,
  asyncHandler(async (req, res) => {
    const homeId = parseInt(req.params.homeId, 10);
    const deviceId = parseInt(req.params.deviceId, 10);

    const [result] = await pool.query(
      'DELETE FROM Device WHERE Device_ID = ? AND Home_ID = ?',
      [deviceId, homeId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy thiết bị để xóa',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Đã xóa thiết bị thành công',
    });
  })
);

/**
 * @route   POST /api/homes/:homeId/devices/:deviceId/commands
 * @desc    Gửi lệnh điều khiển thiết bị (Bật/Tắt, điều chỉnh công suất)
 */
router.post(
  '/:deviceId/commands',
  auth,
  asyncHandler(async (req, res) => {
    const userId = req.user.User_ID;
    const homeId = parseInt(req.params.homeId, 10);
    const deviceId = parseInt(req.params.deviceId, 10);
    const { action, payload, sourceType } = req.body;

    if (!action) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu trường action (ví dụ: TURN_ON, TURN_OFF, SET_BRIGHTNESS)',
      });
    }

    // 1. Xác thực thiết bị thuộc nhà
    const [devRows] = await pool.query(
      'SELECT Device_ID, Device_Name FROM Device WHERE Device_ID = ? AND Home_ID = ?',
      [deviceId, homeId]
    );

    if (devRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Thiết bị không tồn tại trong ngôi nhà này',
      });
    }

    // 2. Ghi nhận lệnh vào Device_Command
    const commandPayload = JSON.stringify({ action, ...(payload || {}) });
    const chosenSourceType = ['USER', 'VOICE_COMMAND', 'SCHEDULE', 'SYSTEM'].includes(sourceType)
      ? sourceType
      : 'USER';

    const [cmdResult] = await pool.query(
      `INSERT INTO Device_Command (
        Source_ID,
        Source_Type,
        Data_attached,
        Excute_Time,
        Excute_State,
        Device_ID
      ) VALUES (?, ?, ?, NOW(), 'EXECUTED', ?)`,
      [userId, chosenSourceType, commandPayload, deviceId]
    );

    publishCommand(homeId, deviceId, { action, payload });
    // 3. Tự động đồng bộ trạng thái Available_working_State trong Device
    let newWorkingState = null;
    if (action === 'TURN_ON') newWorkingState = 'on';
    if (action === 'TURN_OFF') newWorkingState = 'off';

    if (newWorkingState) {
      await pool.query(
        'UPDATE Device SET Available_working_State = ? WHERE Device_ID = ?',
        [newWorkingState, deviceId]
      );
    }

    res.status(200).json({
      success: true,
      message: 'Gửi lệnh điều khiển thành công',
      data: {
        commandId: cmdResult.insertId,
        deviceId,
        action,
        workingState: newWorkingState,
        executeState: 'EXECUTED',
      },
    });
  })
);

module.exports = router;