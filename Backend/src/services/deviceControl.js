// Điều khiển thiết bị dùng chung cho: trang Điều khiển, lệnh giọng nói và tự động hoá.
// Luồng: kiểm tra lệnh -> ghi Device_Command (PENDING) -> gửi MQTT (chờ broker xác nhận)
//        -> cập nhật SUCCESS / FAILED (trigger cập nhật Device_State) -> cập nhật Device + báo Socket.IO.
const { pool, callProc } = require('../db');
const { publishCommand } = require('./mqttService');
const { isHardwareHome, getHardwareHomeId } = require('./hardwareHome');
const { resolveValidFeedKey, deviceKind } = require('../utils/feeds');
const bus = require('./bus');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const COLOR_RE = /^#[0-9A-F]{6}$/i;
const SOURCE_TYPES = ['USER', 'VOICE_COMMAND', 'SCHEDULE', 'SYSTEM'];

const normalizeSourceType = (value) => {
  const v = String(value || '').toUpperCase();
  if (v === 'VOICE' || v === 'VOICE_COMMAND') return 'VOICE_COMMAND';
  if (v === 'AUTO') return 'SYSTEM';
  return SOURCE_TYPES.includes(v) ? v : 'USER';
};

const isOnValue = (v) => v === true || v === 1 || /^(on|1|true)$/i.test(String(v ?? '').trim());

const currentSpeed = (device) => {
  const n = parseInt(device.Available_working_State, 10);
  if (Number.isFinite(n)) return Math.min(Math.max(n, 0), 100);
  return /^on$/i.test(String(device.Available_working_State)) ? 100 : 0;
};

/**
 * Chuẩn hoá yêu cầu điều khiển thành lệnh cụ thể. Ném HttpError(400) nếu lệnh không hợp lệ.
 * input: { action?, state?, speed?, color? }
 * Trả về { kind, feedKey, action, workingState, speed?, color?, mqttPayload, record }
 */
function buildCommand(device, input = {}) {
  const kind = deviceKind(device.Type_Code, device.Device_Name);
  const feedKey = resolveValidFeedKey(device.Feed_Key, device.Type_Code, device.Device_Name);
  let action = String(input.action || '').toUpperCase();
  const { state, color } = input;
  const hasSpeed = input.speed !== undefined && input.speed !== null && input.speed !== '';

  if (kind === 'sensor' || kind === 'other') {
    throw new HttpError(400, 'Thiết bị này không nhận lệnh điều khiển (chỉ đèn, quạt và còi)');
  }
  if (kind === 'door') {
    throw new HttpError(400, 'Cửa được điều khiển ở trang Cửa thông minh (mã PIN, FaceAI hoặc mở từ xa)');
  }

  if (!action) {
    if (color !== undefined) action = 'SET_COLOR';
    else if (hasSpeed) action = 'SET_SPEED';
    else if (state !== undefined) action = isOnValue(state) ? 'TURN_ON' : 'TURN_OFF';
  }
  if (action === 'ON') action = 'TURN_ON';
  if (action === 'OFF') action = 'TURN_OFF';

  if (kind === 'fan') {
    let speed;
    if (action === 'SET_SPEED' || (hasSpeed && action !== 'TURN_OFF')) {
      speed = Number(input.speed);
      if (!Number.isInteger(speed) || speed < 0 || speed > 100) {
        throw new HttpError(400, 'Tốc độ quạt phải là số nguyên từ 0 đến 100');
      }
      action = 'SET_SPEED';
    } else if (action === 'TURN_ON') {
      speed = currentSpeed(device) || 100;
    } else if (action === 'TURN_OFF') {
      speed = 0;
    } else {
      throw new HttpError(400, 'Quạt chỉ hỗ trợ TURN_ON, TURN_OFF hoặc SET_SPEED (0–100)');
    }
    return {
      kind, feedKey, action, speed,
      workingState: String(speed),
      mqttPayload: String(speed),
      record: { action, state: speed > 0 ? 'ON' : 'OFF', speed },
    };
  }

  if (kind === 'light' && action === 'SET_COLOR') {
    if (!COLOR_RE.test(String(color || ''))) throw new HttpError(400, 'Màu đèn phải có dạng #RRGGBB');
    const c = String(color).toUpperCase();
    return {
      kind, feedKey, action, color: c,
      workingState: null,                // đổi màu không đổi trạng thái bật/tắt
      mqttPayload: c,
      record: { action, color: c },
    };
  }

  if (action !== 'TURN_ON' && action !== 'TURN_OFF') {
    throw new HttpError(400, kind === 'light'
      ? 'Đèn chỉ hỗ trợ TURN_ON, TURN_OFF hoặc SET_COLOR (#RRGGBB)'
      : 'Còi chỉ hỗ trợ TURN_ON hoặc TURN_OFF');
  }
  const on = action === 'TURN_ON';
  return {
    kind, feedKey, action,
    workingState: on ? 'on' : 'off',
    mqttPayload: kind === 'buzzer' ? `BUZZER:${on ? 1 : 0}` : (on ? '1' : '0'),
    record: { action, state: on ? 'ON' : 'OFF' },
  };
}

const emitDevice = (io, homeId, device, extra = {}) => io?.to(`home_${homeId}`).emit('device_state_updated', {
  homeId,
  deviceId: device.Device_ID,
  state: device.Available_working_State,
  color: device.Color ?? null,
  ...extra,
});

async function loadDevice(homeId, deviceId) {
  const [rows] = await pool.query(
    `SELECT Device_ID, Device_Name, Feed_Key, Type_Code, Connection_State, Available_working_State, Color, Home_ID
     FROM Device WHERE Device_ID = ? AND Home_ID = ?`,
    [deviceId, homeId]
  );
  return rows[0] ?? null;
}

// Thiết bị đầu tiên của 1 loại trong nhà (mô hình phần cứng giáo trình: 1 đèn, 1 quạt, 1 còi)
async function findPrimaryDevice(homeId, kind) {
  const [rows] = await pool.query(
    `SELECT Device_ID, Device_Name, Feed_Key, Type_Code, Connection_State, Available_working_State, Color, Home_ID
     FROM Device WHERE Home_ID = ? ORDER BY Device_ID`,
    [homeId]
  );
  return rows.find((d) => deviceKind(d.Type_Code, d.Device_Name) === kind) ?? null;
}

/**
 * Gửi lệnh tới thiết bị. Trả về { ok, commandId, workingState, color, published, simulated, cmd }.
 * ok = false khi không gửi được lên MQTT (lệnh được ghi FAILED).
 */
async function sendDeviceCommand({ io, homeId, device, input, userId, sourceType = 'USER' }) {
  const cmd = buildCommand(device, input);
  const hardware = await isHardwareHome(homeId);
  const record = hardware ? cmd.record : { ...cmd.record, simulated: true };

  const { outParams } = await callProc(
    'sp_send_device_command',
    [device.Device_ID, userId, cmd.action, normalizeSourceType(sourceType), JSON.stringify(record)],
    ['p_command_id']
  );
  const commandId = outParams.p_command_id;

  // Nhà không gắn phần cứng: không gửi MQTT, coi như thực thi thành công (chế độ mô phỏng)
  const published = hardware ? await publishCommand(cmd.feedKey, cmd.mqttPayload) : false;
  const ok = hardware ? published : true;
  await callProc('sp_update_command_result', [commandId, ok ? 'SUCCESS' : 'FAILED']);
  if (!ok) return { ok, commandId, cmd, published, simulated: !hardware };

  const sets = [];
  const params = [];
  if (cmd.workingState !== null) { sets.push('Available_working_State = ?'); params.push(cmd.workingState); }
  if (cmd.color) { sets.push('Color = ?'); params.push(cmd.color); }
  if (sets.length) {
    params.push(device.Device_ID);
    await pool.query(`UPDATE Device SET ${sets.join(', ')} WHERE Device_ID = ?`, params);
  }
  const updated = {
    ...device,
    Available_working_State: cmd.workingState ?? device.Available_working_State,
    Color: cmd.color ?? device.Color,
  };
  emitDevice(io, homeId, updated, { source: normalizeSourceType(sourceType) });

  return {
    ok, commandId, cmd, published, simulated: !hardware,
    workingState: updated.Available_working_State,
    color: updated.Color ?? null,
  };
}

// Đồng bộ khi phần cứng / dashboard Adafruit đổi trạng thái đèn, quạt (kể cả bản tin "dội lại" của chính server)
bus.on('device_feed', async ({ io, feedKey, data }) => {
  try {
    const homeId = await getHardwareHomeId();
    if (homeId == null) return;
    const raw = String(data.raw ?? '').trim();
    const sets = {};
    if (feedKey === 'device-light') {
      if (COLOR_RE.test(raw)) sets.Color = raw.toUpperCase();
      else if (data.state !== undefined || data.value !== undefined) sets.Available_working_State = isOnValue(data.state ?? data.value) ? 'on' : 'off';
    } else if (feedKey === 'device-fan') {
      const n = Number(data.speed ?? data.value);
      if (Number.isFinite(n)) sets.Available_working_State = String(Math.min(Math.max(Math.round(n), 0), 100));
      else if (data.state !== undefined) sets.Available_working_State = isOnValue(data.state) ? '100' : '0';
    }
    if (!Object.keys(sets).length) return;

    const [devices] = await pool.query(
      'SELECT Device_ID, Available_working_State, Color FROM Device WHERE Home_ID = ? AND Feed_Key = ?',
      [homeId, feedKey]
    );
    for (const d of devices) {
      const changed = Object.entries(sets).some(([k, v]) => String(d[k] ?? '') !== v);
      if (!changed) continue;
      const cols = Object.keys(sets);
      await pool.query(`UPDATE Device SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE Device_ID = ?`, [...cols.map((c) => sets[c]), d.Device_ID]);
      emitDevice(io, homeId, { ...d, ...sets }, { source: 'HARDWARE' });
    }
  } catch (err) {
    console.error('[MQTT] Không đồng bộ được trạng thái thiết bị:', err.message);
  }
});

module.exports = { HttpError, buildCommand, sendDeviceCommand, loadDevice, findPrimaryDevice, normalizeSourceType };
