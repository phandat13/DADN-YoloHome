const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const config = require('../config');
const { pool, callProc } = require('../db');
const asyncHandler = require('../middlewares/asyncHandler');
const validate = require('../middlewares/validate');
const auth = require('../middlewares/auth');

const router = express.Router();

// ==========================================
// 1. KHAI BÁO SCHEMA (ZOD)
// ==========================================
const registerSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Tên không được để trống'),
    email: z.string().email('Email không hợp lệ'),
    password: z.string().min(6, 'Mật khẩu phải từ 6 ký tự trở lên'),
    displayName: z.string().optional()
  })
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Email không hợp lệ'),
    password: z.string().min(1, 'Mật khẩu không được để trống')
  })
});

// ==========================================
// 2. CÁC ĐƯỜNG DẪN (ROUTES)
// ==========================================

// Đăng ký
router.post('/register', validate(registerSchema), asyncHandler(async (req, res) => {
  const { name, email, password, displayName } = req.body;

  // Băm mật khẩu trước khi lưu
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  // Gọi stored procedure sp_register_user
  const { outParams } = await callProc('sp_register_user', [
    name,
    email,
    hashedPassword,
    displayName || null
  ], ['p_user_id']);

  res.status(201).json({
    success: true,
    message: 'Đăng ký tài khoản thành công',
    data: { userId: outParams.p_user_id }
  });
}));

// Đăng nhập
router.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Lấy thông tin user theo email
  const [users] = await pool.query('SELECT * FROM `User` WHERE Email = ?', [email.toLowerCase().trim()]);
  const user = users[0];

  // Kiểm tra tồn tại và so khớp mật khẩu bằng bcrypt
  if (!user || !(await bcrypt.compare(password, user.Password))) {
    return res.status(401).json({
      success: false,
      message: 'Email hoặc mật khẩu không chính xác'
    });
  }

  // Kiểm tra trạng thái tài khoản
  if (user.Account_state.toLowerCase() !== 'active') {
    return res.status(403).json({
      success: false,
      message: 'Tài khoản của bạn hiện đang bị khóa'
    });
  }

  // Tạo JWT Token
  const token = jwt.sign(
    { userId: user.User_ID },
    config.jwtSecret,
    { expiresIn: '7d' } // Token có hạn 7 ngày
  );

  res.status(200).json({
    success: true,
    message: 'Đăng nhập thành công',
    data: {
      token,
      user: {
        id: user.User_ID,
        name: user.Name,
        email: user.Email,
        displayName: user.Display_name
      }
    }
  });
}));

// Lấy thông tin cá nhân (Cần truyền token)
router.get('/me', auth, asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      id: req.user.User_ID,
      name: req.user.Name,
      email: req.user.Email,
      displayName: req.user.Display_name,
      accountState: req.user.Account_state
    }
  });
}));

module.exports = router;