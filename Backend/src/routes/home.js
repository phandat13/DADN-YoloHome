const express = require('express');
const { z } = require('zod');
const { pool, callProc } = require('../db');
const asyncHandler = require('../middlewares/asyncHandler');
const validate = require('../middlewares/validate');
const auth = require('../middlewares/auth');
const requirePermission = require('../middlewares/permission');

const router = express.Router();

// Tất cả route của Home đều yêu cầu đăng nhập
router.use(auth);

// ==========================================
// 1. KHAI BÁO SCHEMA (ZOD)
// ==========================================
const createHomeSchema = z.object({
  body: z.object({
    homeName: z.string().min(1, 'Tên nhà không được để trống'),
    address: z.string().optional()
  })
});

const updateHomeSchema = z.object({
  params: z.object({
    homeId: z.string().regex(/^\d+$/, 'homeId phải là số nguyên')
  }),
  body: z.object({
    homeName: z.string().min(1).optional(),
    address: z.string().optional(),
    state: z.string().optional()
  })
});

const homeIdParamSchema = z.object({
  params: z.object({
    homeId: z.string().regex(/^\d+$/, 'homeId phải là số nguyên')
  })
});

// ==========================================
// 2. CÁC ROUTES
// ==========================================

// Tạo nhà mới
router.post('/', validate(createHomeSchema), asyncHandler(async (req, res) => {
  const { homeName, address } = req.body;
  const ownerId = req.user.User_ID;

  // Gọi procedure sp_create_home
  const { outParams } = await callProc(
    'sp_create_home',
    [ownerId, homeName, address || null],
    ['p_home_id']
  );

  res.status(201).json({
    success: true,
    message: 'Tạo nhà thành công',
    data: { homeId: outParams.p_home_id }
  });
}));

// Xem danh sách nhà của người dùng đang đăng nhập
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user.User_ID;

  const [homes] = await pool.query(
    `SELECT h.Home_ID, h.Home_Name, h.Address, h.State, h.Time_Home_Created, 
            r.Role_Name, hm.Status AS Member_Status
     FROM Home h
     JOIN Home_Member hm ON h.Home_ID = hm.Home_ID
     JOIN Role r ON hm.Role_ID = r.Role_ID
     WHERE hm.User_ID = ? AND LOWER(hm.Status) = 'active'
       AND (hm.Expired IS NULL OR hm.Expired > NOW())`,
    [userId]
  );

  res.status(200).json({
    success: true,
    data: homes
  });
}));

// Xem chi tiết một nhà
router.get('/:homeId', validate(homeIdParamSchema), asyncHandler(async (req, res) => {
  const homeId = parseInt(req.params.homeId, 10);
  const userId = req.user.User_ID;

  // Kiểm tra người dùng có phải thành viên của nhà này không
  const [memberCheck] = await pool.query(
    'SELECT fn_is_home_member(?, ?) AS isMember',
    [userId, homeId]
  );

  if (!memberCheck[0]?.isMember) {
    return res.status(403).json({
      success: false,
      message: 'Bạn không phải thành viên của ngôi nhà này'
    });
  }

  const [homes] = await pool.query(
    'SELECT * FROM Home WHERE Home_ID = ? LIMIT 1',
    [homeId]
  );

  if (homes.length === 0) {
    return res.status(404).json({
      success: false,
      message: 'Không tìm thấy ngôi nhà'
    });
  }

  res.status(200).json({
    success: true,
    data: homes[0]
  });
}));

// Cập nhật thông tin nhà (Yêu cầu quyền HOME_UPDATE)
router.put('/:homeId', validate(updateHomeSchema), requirePermission('HOME_UPDATE'), asyncHandler(async (req, res) => {
  const homeId = parseInt(req.params.homeId, 10);
  const { homeName, address, state } = req.body;
  const actorId = req.user.User_ID;

  await callProc('sp_update_home', [
    actorId,
    homeId,
    homeName || null,
    address || null,
    state || null
  ]);

  res.status(200).json({
    success: true,
    message: 'Cập nhật thông tin nhà thành công'
  });
}));

// Xóa nhà (Chỉ chủ nhà mới được xóa)
router.delete('/:homeId', validate(homeIdParamSchema), asyncHandler(async (req, res) => {
  const homeId = parseInt(req.params.homeId, 10);
  const actorId = req.user.User_ID;

  await callProc('sp_delete_home', [actorId, homeId]);

  res.status(200).json({
    success: true,
    message: 'Xóa nhà thành công'
  });
}));

module.exports = router;