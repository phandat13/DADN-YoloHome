const { pool } = require('../db');

// Đảm bảo cửa trong URL thuộc đúng ngôi nhà trong URL (/homes/:homeId/doors/:doorName/...).
// Thiếu bước này thì có thể thao tác cửa của nhà khác chỉ bằng cách đổi homeId.
const requireDoorInHome = async (req, res, next) => {
  try {
    const homeId = parseInt(req.params.homeId, 10);
    const doorName = req.params.doorName;
    const [rows] = await pool.query(
      'SELECT Smart_Door_ID, Smart_Door_Name, Home_ID, Lock_Unlock_State FROM Smart_Door WHERE Home_ID = ? AND Smart_Door_Name = ? LIMIT 1',
      [homeId, doorName]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Cửa không tồn tại trong ngôi nhà này' });
    }
    req.door = rows[0];
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { requireDoorInHome };
