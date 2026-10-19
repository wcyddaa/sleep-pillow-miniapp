/**
 * 全局 UI Store
 */
const { createStore } = require('../index');

const store = createStore({
  statusBarHeight: 24,
  mqttConnected: false,
  scanning: false
});

module.exports = { store };
