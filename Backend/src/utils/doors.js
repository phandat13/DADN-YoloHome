const { pool } = require('../db');

// Đảm bảo cửa trong URL thuộc đúng ngôi nhà trong URL (/homes/:homeId/doors/:doorName/...).
// Tên cửa chỉ duy nhất trong 1 nhà, nên luôn tra theo (Home_ID, tên) rồi dùng Smart_Door_ID cho các bước sau.
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
    req.doorRef = { id: rows[0].Smart_Door_ID, name: rows[0].Smart_Door_Name };
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { requireDoorInHome };
