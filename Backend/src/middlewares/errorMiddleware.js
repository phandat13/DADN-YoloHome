// src/middlewares/errorMiddleware.js

function notFound(req, res, next) {
  const error = new Error(`Không tìm thấy đường dẫn - ${req.originalUrl}`);
  res.status(404);
  next(error);
}

function errorHandler(err, req, res, next) {
  let statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  let message = err.message || 'Lỗi máy chủ nội bộ';

  // 1. Lỗi logic chủ động từ MySQL Trigger/Procedure (SIGNAL SQLSTATE '45000')
  if (err.sqlState === '45000') {
    statusCode = 400;
    message = err.sqlMessage || message;
  } 
  // 2. Lỗi trùng lặp dữ liệu (Unique constraint - ER_DUP_ENTRY)
  else if (err.code === 'ER_DUP_ENTRY') {
    statusCode = 409;
    message = 'Dữ liệu đã tồn tại trong hệ thống';
  } 
  // 3. Lỗi vi phạm khóa ngoại (Foreign key constraint)
  else if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_ROW_IS_REFERENCED_2') {
    statusCode = 400;
    message = 'Dữ liệu liên kết không hợp lệ hoặc đang được tham chiếu';
  }

  res.status(statusCode).json({
    success: false,
    message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack
  });
}

module.exports = {
  notFound,
  errorHandler
};