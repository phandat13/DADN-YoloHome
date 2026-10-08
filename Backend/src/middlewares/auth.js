const jwt = require('jsonwebtoken');
const config = require('../config');
const { pool } = require('../db');

async function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Yêu cầu token xác thực hợp lệ'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwtSecret);

    // Kiểm tra tài khoản có còn active trong DB không
    const [users] = await pool.query(
      'SELECT User_ID, Name, Email, Display_name, Account_state FROM `User` WHERE User_ID = ? LIMIT 1',
      [decoded.userId]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Tài khoản không tồn tại'
      });
    }

    const user = users[0];
    if (user.Account_state.toLowerCase() !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Tài khoản hiện đang bị khóa'
      });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Token không hợp lệ hoặc đã hết hạn'
    });
  }
}

module.exports = auth;

