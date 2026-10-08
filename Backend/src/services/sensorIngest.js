const { pool } = require('../db');

const QUALITIES = ['good', 'bad', 'uncertain'];

/**
 * Ghi 1 giá trị đo cho cảm biến: thêm Sensor_Record, cập nhật Sensor.Current_Value
 * và phát Socket.IO 'sensor_update' tới phòng của ngôi nhà chứa cảm biến.
 * Dùng chung cho MQTT (Adafruit IO) và HTTP telemetry.
 */
async function recordSensorValue({ sensorId, value, quality = 'good', io }) {
  const [rows] = await pool.query(
    `SELECT s.Sensor_ID, s.Sensor_Name, s.Sensor_Type, s.Unit, d.Home_ID
     FROM Sensor s JOIN Device d ON d.Device_ID = s.Device_ID
     WHERE s.Sensor_ID = ? LIMIT 1`,
    [sensorId]
  );
  if (rows.length === 0) return null;
  const sensor = rows[0];

  const q = QUALITIES.includes(String(quality).toLowerCase()) ? String(quality).toLowerCase() : 'good';
  await pool.query(
    'INSERT INTO Sensor_Record (Sensor_ID, Sensor_Value, Data_Quality, Time_Stamp) VALUES (?, ?, ?, NOW())',
    [sensor.Sensor_ID, value, q]
  );
  await pool.query('UPDATE Sensor SET Current_Value = ?, Last_Updated = NOW() WHERE Sensor_ID = ?', [value, sensor.Sensor_ID]);

  const payload = {
    homeId: sensor.Home_ID,
    sensorId: sensor.Sensor_ID,
    sensorName: sensor.Sensor_Name,
    type: sensor.Sensor_Type,
    value,
    unit: sensor.Unit,
    quality: q,
    timestamp: new Date().toISOString(),
  };
  if (io) io.to(`home_${sensor.Home_ID}`).emit('sensor_update', payload);
  return payload;
}

module.exports = { recordSensorValue };
