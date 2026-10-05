const mysql = require('mysql2/promise');
const config = require('./config');

// Khởi tạo Connection Pool sử dụng trực tiếp config.db
const pool = mysql.createPool(config.db);

/**
 * Hàm hỗ trợ gọi Stored Procedure có tham số IN và OUT an toàn
 * @param {string} procName - Tên Stored Procedure
 * @param {Array} inParams - Danh sách tham số IN
 * @param {Array} outParamNames - Danh sách tên tham số OUT (ví dụ: ['p_decision'])
 */
async function callProc(procName, inParams = [], outParamNames = []) {
  const connection = await pool.getConnection();
  try {
    // 1. Tạo placeholder cho IN và OUT
    const inPlaceholders = inParams.map(() => '?');
    const outPlaceholders = outParamNames.map((name) => `@${name}`);
    const allPlaceholders = [...inPlaceholders, ...outPlaceholders].join(', ');

    // 2. Thực thi CALL procedure
    const callSql = `CALL ${procName}(${allPlaceholders})`;
    const [results] = await connection.query(callSql, inParams);

    // 3. Nếu không có biến OUT, trả về kết quả truy vấn
    if (outParamNames.length === 0) {
      return results;
    }

    // 4. Lấy giá trị các biến OUT (Đảm bảo có khoảng trắng quanh AS)
    const selectOutSql = `SELECT ${outParamNames
      .map((name) => `@${name} AS${name}`)
      .join(', ')}`;

    const [outRows] = await connection.query(selectOutSql);
    const outParams = outRows && outRows.length > 0 ? outRows[0] : {};

    return {
      results,
      outParams,
      ...outParams,
    };
  } finally {
    connection.release();
  }
}

module.exports = {
  pool,
  callProc,
};