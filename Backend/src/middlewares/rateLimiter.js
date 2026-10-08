// file: middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');

const pinLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 5, // Tối đa 5 lần sai
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Limit theo IP + Tên cửa (Chống spam từng cửa cụ thể)
        return req.ip + '_' + (req.params.doorName || 'door');
    },
    handler: (req, res) => {
        res.status(429).json({
            success: false,
            message: 'Nhập sai quá nhiều lần. Cửa đã bị khóa tạm thời trong 15 phút.'
        });
    }
});

module.exports = { pinLimiter };