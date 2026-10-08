const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'smart_home',
  timezone: '+00:00',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
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