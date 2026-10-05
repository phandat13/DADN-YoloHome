const express = require('express');
const router = express.Router({ mergeParams: true });
const auth = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/permission');
const asyncHandler = require('../middlewares/asyncHandler');
const { pool } = require('../db');

/**
 * @route   GET /api/homes/:homeId/activity-logs
 * @desc    Xem lịch sử hoạt động của ngôi nhà
 * @access  Owner/Admin xem toàn bộ (LOG_VIEW_ALL), Thành viên xem của mình (LOG_VIEW_OWN)
 */
router.get(
  '/',
  auth,
  asyncHandler(async (req, res) => {
    const userId = req.user.User_ID;
    const homeId = parseInt(req.params.homeId, 10);

    // 1. Kiểm tra xem user có quyền xem toàn bộ hay chỉ xem của mình
    const [permRows] = await pool.query(
      `SELECT 
         fn_has_permission(?, ?, 'LOG_VIEW_ALL') AS can_view_all,
         fn_has_permission(?, ?, 'LOG_VIEW_OWN') AS can_view_own`,
      [userId, homeId, userId, homeId]
    );

    const canViewAll = permRows[0]?.can_view_all === 1;
    const canViewOwn = permRows[0]?.can_view_own === 1;

    if (!canViewAll && !canViewOwn) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền xem nhật ký hoạt động của nhà này',
      });
    }

    // 2. Lấy dữ liệu lịch sử
    let sql = `
      SELECT 
        al.Activity_Log_ID, 
        al.Entity_Type, 
        al.Action, 
        al.Source, 
        al.Result, 
        al.Time, 
        al.User_ID, 
        al.Home_ID,
        u.Name AS UserName
      FROM Activity_Log al
      LEFT JOIN \`User\` u ON al.User_ID = u.User_ID
      WHERE al.Home_ID = ?
    `;
    const params = [homeId];

    // Nếu chỉ có quyền xem của chính mình
    if (!canViewAll && canViewOwn) {
      sql += ' AND al.User_ID = ?';
      params.push(userId);
    }

    sql += ' ORDER BY al.Time DESC LIMIT 50';

    const [rows] = await pool.query(sql, params);

    res.status(200).json({
      success: true,
      data: rows,
    });
  })
);

module.exports = router;