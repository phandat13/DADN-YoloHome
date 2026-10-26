// Kênh sự kiện nội bộ để tách các service (tránh require vòng: sensorIngest -> automation -> deviceControl -> mqtt).
const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(20);

module.exports = bus;
