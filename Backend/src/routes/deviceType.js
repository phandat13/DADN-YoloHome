const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const asyncHandler = require('../middlewares/asyncHandler');
const { pool } = require('../db');

/**
 * @route   GET /api/device-types
 * @desc    Lấy danh mục các loại thiết bị được hỗ trợ trong hệ thống
 * @access  Đã đăng nhập
 */
router.get(
  '/',
  auth,
  asyncHandler(async (req, res) => {
    const [types] = await pool.query(
      `SELECT 
        Type_Code AS typeCode,
        Type_Name AS typeName,
        Type_Group AS typeGroup,
        Manufacturer AS manufacturer
       FROM Device_Type 
       ORDER BY Type_Group, Type_Name`
    );

    res.status(200).json({
      success: true,
      data: types,
    });
  })
);

module.exports = router;

