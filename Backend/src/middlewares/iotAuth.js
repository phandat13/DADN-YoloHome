const crypto = require('crypto');
const config = require('../config');
const auth = require('./auth');
const requirePermission = require('./permission');

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

const hasValidIotKey = (req) => Boolean(config.iotApiKey) && safeEqual(req.headers['x-iot-key'], config.iotApiKey);

// Chỉ thiết bị phần cứng (Gateway, camera, bàn phím) có header x-iot-key
const requireIotKey = (req, res, next) => {
  if (!hasValidIotKey(req)) {
    return res.status(401).json({
      success: false,
      message: 'Không có quyền truy cập: IoT Key không hợp lệ hoặc bị thiếu',
    });
  }
  next();
};

// Phần cứng (x-iot-key) HOẶC người dùng đã đăng nhập có quyền `permission` trong nhà (VD: thử trên giao diện web)
const iotKeyOrUser = (permission) => (req, res, next) => {
  if (hasValidIotKey(req)) {
    req.viaIot = true;
    return next();
  }
  if (!req.headers.authorization) {
    return res.status(401).json({
      success: false,
      message: 'Cần IoT Key (header x-iot-key) hoặc token đăng nhập',
    });
  }
  return auth(req, res, (err) => {
    if (err) return next(err);
    return requirePermission(permission)(req, res, next);
  });
};

module.exports = { requireIotKey, iotKeyOrUser, hasValidIotKey };
