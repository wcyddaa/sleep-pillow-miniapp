/**
 * ⚠️ 已废弃（2026-10-08）—— 这个文件可以直接删除。
 *
 * 原用途：小程序当网关，把 BLE 收到的实时帧攒成 30s 窗口，
 *         组装 SleepData 后 POST /api/v1/sleep/ingest 上报云后端。
 *
 * 为什么废弃：设备现在自己直连云端（固件 EdgeAggregator 每 30s 发
 *   /device/{id}/frame → IoTDA 规则引擎 → POST /api/v1/ingest/huawei/frame），
 *   不再需要手机中继；后端 /sleep/ingest 端点与 devices.cfg_json 列也一并删除。
 *
 * 实时数据现在走 BLE 直连（utils/bluetooth/BLEProvisioner.js 的 onRealtime），
 * 历史结构化数据走 GET /devices/{id}/raw-json。
 *
 * 保留空实现仅为避免任何残留 require 报错。
 */
module.exports = {
  start() { return Promise.resolve(); },
  stop() {},
  onData() {}
};
