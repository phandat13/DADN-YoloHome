// src/routes/member.js
const express = require('express');
const { z } = require('zod');
const { pool, callProc } = require('../db');
const asyncHandler = require('../middlewares/asyncHandler');
const validate = require('../middlewares/validate');
const auth = require('../middlewares/auth');
const requirePermission = require('../middlewares/permission');

const router = express.Router({ mergeParams: true });

router.use(auth);

// ==========================================
// 0. HÀM CHUYỂN ĐỔI NGÀY SANG MYSQL DATETIME
// ==========================================
const formatToMysqlDatetime = (dateVal) => {
  if (!dateVal) return null;
  const d = new Date(dateVal);
  if (Number.isNaN(d.getTime())) return null;

  // Nếu input gửi lên là dạng chỉ có ngày YYYY-MM-DD từ datepicker
  // Đặt thời gian đến 23:59:59 của ngày đó để Guest sử dụng trọn vẹn ngày
  if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
    d.setHours(23, 59, 59, 999);
  }

  return d.toISOString().slice(0, 19).replace('T', ' ');
};

// ==========================================
// 1. SCHEMA KIỂM TRA DỮ LIỆU (ZOD)
// ==========================================
const homeIdParamSchema = z.object({
  params: z.object({
    homeId: z.string().regex(/^\d+$/, 'homeId phải là số nguyên'),
  }),
});

// Cho phép chuỗi ISO đầy đủ, chuỗi ngày YYYY-MM-DD, null hoặc chuỗi rỗng
const dateSchema = z
  .union([
    z.string().datetime({ offset: true }),
    z.string().datetime(),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Định dạng ngày phải là YYYY-MM-DD'),
  ])
  .nullable()
  .optional()
  .transform((val) => (val === '' ? undefined : val));

const addMemberSchema = z.object({
  params: z.object({
    homeId: z.string().regex(/^\d+$/, 'homeId phải là số nguyên'),
  }),
  body: z.object({
    email: z.string().email('Email thành viên không hợp lệ'),
    roleName: z.enum(['Member', 'Guest'], {
      errorMap: () => ({ message: 'Vai trò chỉ có thể là Member hoặc Guest' }),
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
      errorMap: () => ({ message: 'Vai trò chỉ có thể là Member hoặc Guest' }),
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