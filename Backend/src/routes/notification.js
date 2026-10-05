const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const asyncHandler = require('../middlewares/asyncHandler');
const { pool } = require('../db');

/**
 * @route   GET /api/notifications
 * @desc    Lấy danh sách thông báo của người dùng hiện tại
 */
router.get(
  '/',
  auth,
  asyncHandler(async (req, res) => {
    const userId = req.user.User_ID;
    const { status } = req.query; // 'Unread', 'Read' hoặc undefined (tất cả)

    let sql = `
      SELECT Notification_ID, Title, Type, Content, Level, Unread_Read, User_ID
      FROM Notification
      WHERE User_ID = ?
    `;
    const params = [userId];

    if (status && ['Unread', 'Read'].includes(status)) {
      sql += ' AND Unread_Read = ?';
      params.push(status);
    }

    sql += ' ORDER BY Notification_ID DESC LIMIT 50';

    const [rows] = await pool.query(sql, params);

    res.status(200).json({
      success: true,
      data: rows,
    });
  })
);

/**
 * @route   PATCH /api/notifications/:id/read
 * @desc    Đánh dấu một thông báo là đã đọc
 */
router.patch(
  '/:id/read',
  auth,
  asyncHandler(async (req, res) => {
    const userId = req.user.User_ID;
    const notificationId = parseInt(req.params.id, 10);

    const [result] = await pool.query(
      `UPDATE Notification 
       SET Unread_Read = 'Read' 
       WHERE Notification_ID = ? AND User_ID = ?`,
      [notificationId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy thông báo hoặc bạn không có quyền sửa thông báo này',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Đã đánh dấu thông báo là đã đọc',
    });
  })
);

module.exports = router;