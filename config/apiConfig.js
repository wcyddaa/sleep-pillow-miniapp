/**
 * API 地址配置：对接睡眠分析云后端（FastAPI /api/v1）
 * 注意：微信小程序要求 HTTPS 且需在「开发设置 -> 服务器域名」白名单添加该域名。
 */
const envConfig = require('./envConfig');

// ===== 云后端地址（阿里云 FC 函数自定义域名 + /api/v1）=====
const CLOUD_BASE = 'https://sleep-m-backend-edgvqrpnhv.cn-shanghai.fcapp.run/api/v1';

const API_BASE = {
  dev: CLOUD_BASE,
  test: CLOUD_BASE,
  prod: CLOUD_BASE
};

// 实时通道：后端暂不提供 WebSocket/MQTT 推送，保留占位（false 时实时数据经 REST 拉取）
const MQTT = {
  dev: null,
  test: null,
  prod: null
};

const apiConfig = {
  baseURL: API_BASE[envConfig.env] || API_BASE.prod,
  // 30s：兼顾 FC 首次冷启动（可能 >15s）
  timeout: 30000,
  mqtt: MQTT[envConfig.env] || null,
  topicPrefix: 'iot/device',
  qrcodePrefix: 'https://app.example.com/d/'
};

module.exports = apiConfig;