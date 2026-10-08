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
    name: z.string().trim().min(1, 'Tên không được để trống'),
    email: z.string().trim().email('Email không hợp lệ'),
    password: z.string().min(6, 'Mật khẩu phải từ 6 ký tự trở lên'),
    displayName: z.string().trim().optional().nullable(),
  }),
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().trim().email('Email không hợp lệ'),
    password: z.string().min(1, 'Mật khẩu không được để trống'),
  }),
});

// ==========================================
// 2. CÁC ĐƯỜNG DẪN (ROUTES)
// ==========================================

// Đăng ký
router.post(
  '/register',
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { name, email, password, displayName } = req.body;

    // Băm mật khẩu trước khi lưu
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Gọi Stored Procedure sp_register_user
    const procRes = await callProc(
      'sp_register_user',
      [name, email.toLowerCase().trim(), hashedPassword, displayName || null],
      ['p_user_id']
    );

    // Trích xuất biến OUT an toàn
    const out = procRes?.outResult || procRes?.outParams || procRes;
    const userId = out?.p_user_id ?? out?.['@p_user_id'];

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Email đã tồn tại hoặc không thể tạo tài khoản người dùng',
      });
    }

    res.status(201).json({
      success: true,
      message: 'Đăng ký tài khoản thành công',
      data: { userId },
    });
  })
);

// Đăng nhập
router.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    // Tìm kiếm thông tin User theo Email
    const [users] = await pool.query(
      'SELECT * FROM `User` WHERE Email = ? LIMIT 1',
      [email.toLowerCase().trim()]
    );
    const user = users[0];

    // Tương thích cả 2 tên cột mật khẩu: Password hoặc Password_Hash
    const savedPasswordHash = user?.Password_Hash || user?.Password;

    if (!user || !savedPasswordHash || !(await bcrypt.compare(password, savedPasswordHash))) {
      return res.status(401).json({
        success: false,
        message: 'Email hoặc mật khẩu không chính xác',
      });
    }

    // Kiểm tra trạng thái tài khoản nếu có cột Account_state
    if (user.Account_state && user.Account_state.toLowerCase() !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Tài khoản của bạn hiện đang bị khóa',
      });
    }

    // Tạo JWT Token (thời hạn 7 ngày)
    const token = jwt.sign(
      {
        userId: user.User_ID,
        User_ID: user.User_ID,
        email: user.Email,
        Role: user.Role || 'USER',
      },
      config.jwtSecret,
      { expiresIn: '7d' }
    );

    res.status(200).json({
      success: true,
      message: 'Đăng nhập thành công',
      data: {
        token,
        user: {
          id: user.User_ID,
          userId: user.User_ID,
          name: user.Name,
          email: user.Email,
          displayName: user.Display_name || user.Name,
          role: user.Role || 'USER',
        },
      },
    });
  })
);

// Lấy thông tin cá nhân hiện tại
router.get(
  '/me',
  auth,
  asyncHandler(async (req, res) => {
    const userId = req.user.User_ID ?? req.user.userId;

    // BỎ CỘT 'Role' KHỎI SELECT VÌ BẢNG USER KHÔNG CÓ CỘT NÀY
    const [users] = await pool.query(
      'SELECT User_ID, Email, Name, Display_name FROM `User` WHERE User_ID = ? LIMIT 1',
      [userId]
    );

    if (!users.length) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy thông tin người dùng',
      });
    }

    const user = users[0];
    const userData = {
      id: user.User_ID,
      userId: user.User_ID,
      name: user.Name,
      email: user.Email,
      displayName: user.Display_name || user.Name,
      role: 'USER', // Gán giá trị mặc định tránh lỗi undefined
    };

    res.status(200).json({
      success: true,
      user: userData,
      data: userData,
    });
  })
);

module.exports = router;