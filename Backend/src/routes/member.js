// src/routes/member.js
const express = require('express');
const { z } = require('zod');
const { pool, callProc } = require('../db');
const asyncHandler = require('../middlewares/asyncHandler');
const validate = require('../middlewares/validate');
const auth = require('../middlewares/auth');
const requirePermission = require('../middlewares/permission');
const { toMysqlDatetime, optionalDateSchema } = require('../utils/datetime');

const router = express.Router({ mergeParams: true });

router.use(auth);

// Ngày dạng YYYY-MM-DD từ datepicker -> 23:59:59 của ngày đó (giờ địa phương) để Guest dùng trọn ngày.
// (Bản cũ dùng toISOString() nên thành 16:59:59 ở VN, và chuỗi rỗng "" bị từ chối 400.)
const formatToMysqlDatetime = (dateVal) => toMysqlDatetime(dateVal, { dateOnly: 'end' });

// ==========================================
// 1. SCHEMA KIỂM TRA DỮ LIỆU (ZOD)
// ==========================================
const homeIdParamSchema = z.object({
  params: z.object({
    homeId: z.string().regex(/^\d+$/, 'homeId phải là số nguyên'),
  }),
});

// Cho phép chuỗi ISO đầy đủ, chuỗi ngày YYYY-MM-DD, null hoặc chuỗi rỗng
const dateSchema = optionalDateSchema;

const addMemberSchema = z.object({
  params: z.object({
    homeId: z.string().regex(/^\d+$/, 'homeId phải là số nguyên'),
  }),
  body: z.object({
    email: z.string().email('Email thành viên không hợp lệ'),
    roleName: z.enum(['Member', 'Guest'], {
      error: 'Vai trò chỉ có thể là Member hoặc Guest', // Zod 4 dùng `error` (errorMap của Zod 3 bị bỏ qua)
    }),
    expired: dateSchema,
  }),
});

const changeRoleSchema = z.object({
  params: z.object({
    homeId: z.string().regex(/^\d+$/, 'homeId phải là số nguyên'),
    userId: z.string().regex(/^\d+$/, 'userId phải là số nguyên'),
  }),
  body: z.object({
    roleName: z.enum(['Member', 'Guest'], {
      error: 'Vai trò chỉ có thể là Member hoặc Guest', // Zod 4 dùng `error` (errorMap của Zod 3 bị bỏ qua)
    }),
    expired: dateSchema,
  }),
});

const memberParamSchema = z.object({
  params: z.object({
    homeId: z.string().regex(/^\d+$/, 'homeId phải là số nguyên'),
    userId: z.string().regex(/^\d+$/, 'userId phải là số nguyên'),
  }),
});

// ==========================================
// 2. CÁC ROUTES
// ==========================================

// Lấy danh sách thành viên trong nhà
router.get('/', validate(homeIdParamSchema), asyncHandler(async (req, res) => {
  const homeId = parseInt(req.params.homeId, 10);
  const userId = req.user.User_ID;

  // Kiểm tra người gọi có thuộc nhà này không
  const [memberCheck] = await pool.query(
    'SELECT fn_is_home_member(?, ?) AS isMember',
    [userId, homeId]
  );

  if (!memberCheck[0]?.isMember) {
    return res.status(403).json({
      success: false,
      message: 'Bạn không có quyền xem thành viên của ngôi nhà này',
    });
  }

  const [members] = await pool.query(
    `SELECT hm.Home_Member_ID, u.User_ID, u.Name, u.Email, u.Display_name,
            r.Role_Name, hm.Status, hm.Joined, hm.Expired
     FROM Home_Member hm
     JOIN \`User\` u ON hm.User_ID = u.User_ID
     JOIN Role r ON hm.Role_ID = r.Role_ID
     WHERE hm.Home_ID = ?`,
    [homeId]
  );

  res.status(200).json({
    success: true,
    data: members,
  });
}));

// Thêm thành viên mới vào nhà (Cần quyền MEMBER_MANAGE)
router.post('/', validate(addMemberSchema), requirePermission('MEMBER_MANAGE'), asyncHandler(async (req, res) => {
  const homeId = parseInt(req.params.homeId, 10);
  const { email, roleName, expired } = req.body;
  const actorId = req.user.User_ID;

  const formattedExpired = formatToMysqlDatetime(expired);

  await callProc('sp_add_member', [
    actorId,
    homeId,
    email,
    roleName,
    formattedExpired,
  ]);

  res.status(201).json({
    success: true,
    message: 'Thêm thành viên thành công',
  });
}));

// Thay đổi vai trò / thời hạn thành viên
router.put('/:userId', validate(changeRoleSchema), requirePermission('MEMBER_MANAGE'), asyncHandler(async (req, res) => {
  const homeId = parseInt(req.params.homeId, 10);
  const targetUserId = parseInt(req.params.userId, 10);
  const { roleName, expired } = req.body;
  const actorId = req.user.User_ID;

  const formattedExpired = formatToMysqlDatetime(expired);

  await callProc('sp_change_member_role', [
    actorId,
    homeId,
    targetUserId,
    roleName,
    formattedExpired,
  ]);

  res.status(200).json({
    success: true,
    message: 'Cập nhật vai trò thành viên thành công',
  });
}));

// Xóa thành viên khỏi nhà
router.delete('/:userId', validate(memberParamSchema), requirePermission('MEMBER_MANAGE'), asyncHandler(async (req, res) => {
  const homeId = parseInt(req.params.homeId, 10);
  const targetUserId = parseInt(req.params.userId, 10);
  const actorId = req.user.User_ID;

  await callProc('sp_remove_member', [actorId, homeId, targetUserId]);

  res.status(200).json({
    success: true,
    message: 'Xóa thành viên khỏi nhà thành công',
  });
}));

module.exports = router;

