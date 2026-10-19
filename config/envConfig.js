/**
 * 环境配置：dev / test / prod
 * useMock 为 true 时，网络、蓝牙、MQTT 均走本地模拟数据，无需后端即可运行
 */
const envConfig = {
  env: 'prod',           // dev | test | prod
  useMock: false,        // 对接云后端后置 false；true 仅用于无后端联调
  debug: false,          // 日志开关
  version: '1.0.0'
};

module.exports = envConfig;
