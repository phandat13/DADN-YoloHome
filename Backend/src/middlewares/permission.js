const { pool } = require('../db');

/**
 * Kiểm tra quyền hạn theo permissionCode
 * @param {string} permissionCode - Mã quyền (ví dụ: 'HOME_UPDATE', 'DEVICE_CONTROL')
 */
const requirePermission = (permissionCode) => async (req, res, next) => {
  try {
    // Lấy homeId từ params, query hoặc body
    const homeId = req.params.homeId || req.query.homeId || req.body.homeId;

    if (!homeId) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu định danh nhà (homeId) để kiểm tra quyền'
      });
    }

    const userId = req.user.User_ID;

    // Gọi hàm fn_has_permission trong DB
    const [rows] = await pool.query(
      'SELECT fn_has_permission(?, ?, ?) AS hasPerm',
      [userId, homeId, permissionCode]
    );

    const hasPermission = rows[0]?.hasPerm === 1;

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: `Bạn không có quyền thực hiện thao tác này (${permissionCode})`
      });
    }

    next();
  } catch (err) {
    next(err);
  }
};

module.exports = requirePermission;