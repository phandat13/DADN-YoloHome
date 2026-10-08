const mysql = require('mysql2/promise');
const config = require('./config');

// Dùng chung cấu hình trong config.js (trước đây bỏ qua DB_PORT và tự đọc process.env).
const pool = mysql.createPool(config.db);

// Múi giờ của máy chạy Node, dạng '+07:00'.
const nodeUtcOffset = () => {
  const minutes = -new Date().getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
};

// Đặt múi giờ phiên MySQL trùng với Node để NOW()/CURRENT_TIMESTAMP và Date của JS luôn khớp nhau,
// kể cả khi MySQL chạy ở múi giờ khác (VD: Docker để UTC).
pool.on('connection', (connection) => {
  connection.query(`SET time_zone = '${nodeUtcOffset()}'`, (err) => {
    if (err) console.error('[Database] Không đặt được time_zone cho phiên MySQL:', err.message);
  });
});

const callProc = async (procName, inParams = [], outParams = []) => {
  const connection = await pool.getConnection();
  try {
    const inPlaceholders = inParams.map(() => '?').join(', ');
    const outPlaceholders = outParams.map((name) => `@${name} AS ${name}`).join(', ');

    const allPlaceholders = [
      inPlaceholders,
      outParams.map((name) => `@${name}`).join(', '),
    ]
      .filter(Boolean)
      .join(', ');

    const query = `CALL ${procName}(${allPlaceholders})`;
    const [results] = await connection.query(query, inParams);

    let outResult = {};
    if (outParams.length > 0) {
      const [outData] = await connection.query(`SELECT ${outPlaceholders}`);
      outResult = outData && outData[0] ? outData[0] : {};
    }

    return {
      results,
      outResult,
      outParams: outResult, // Hỗ trợ cả 2 cách destruct: const { outParams } hoặc const { outResult }
    };
  } finally {
    connection.release();
  }
};

module.exports = {
  pool,
  callProc,
  query: (sql, params) => pool.query(sql, params),
  execute: (sql, params) => pool.execute(sql, params),
};
