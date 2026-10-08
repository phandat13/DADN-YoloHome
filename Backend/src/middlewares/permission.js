const { pool } = require('../db');

/**
 * Middleware kiểm tra quyền hạn theo permissionCode (hỗ trợ cả chuỗi đơn hoặc mảng quyền)
 * @param {string | string[]} permissionInput Mã quyền (ví dụ: 'MEMBER_MANAGE', 'HOME_UPDATE' hoặc ['DEVICE_VIEW', 'DOOR_UNLOCK'])
 */
const requirePermission = (permissionInput) => async (req, res, next) => {
  try {
    // 1. Trích xuất homeId từ params, query hoặc body
    const rawHomeId = req.params.homeId || req.query.homeId || req.body.homeId;
    const homeId = parseInt(rawHomeId, 10);

    if (!homeId || Number.isNaN(homeId)) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu định danh nhà (homeId) để kiểm tra quyền',
      });
    }

    // 2. Xác thực định danh người dùng (hỗ trợ cả req.user.User_ID lẫn req.user.userId)
    const userId = req.user?.User_ID ?? req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Người dùng chưa được xác thực',
      });
    }

    // 3. Ưu tiên Chủ nhà (Owner): Nếu user là chủ sở hữu ngôi nhà này thì cho phép toàn quyền ngay lập tức
    const [ownerRows] = await pool.query(
      'SELECT 1 FROM Home WHERE Home_ID = ? AND Owner_ID = ? LIMIT 1',
      [homeId, userId]
    );

    if (ownerRows && ownerRows.length > 0) {
      return next();
    }

    // 4. Chuẩn hóa danh sách quyền cần kiểm tra
    const permissions = Array.isArray(permissionInput) ? permissionInput : [permissionInput];

    // 5. Kiểm tra quyền đối với thành viên thường (Member/Guest) qua fn_has_permission
    let hasPermission = false;
    for (const code of permissions) {
      const [rows] = await pool.query(
        'SELECT fn_has_permission(?, ?, ?) AS hasPerm',
        [userId, homeId, String(code)]
      );

      if (rows && rows[0]?.hasPerm === 1) {
        hasPermission = true;
        break;
      }
    }

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: `Bạn không có quyền thực hiện thao tác này (${permissions.join(', ')})`,
      });
    }

    next();
  } catch (err) {
    next(err);
  }
};

module.exports = requirePermission;