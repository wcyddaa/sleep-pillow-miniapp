/**
 * 常量定义：睡眠监测数据通道、睡眠分期、设备类型等
 * 数据通道的权威定义由云端下发（device.channels），此处仅提供缺省元数据与兜底
 */
// 通道类型：number 数值型 / state 状态型（在床/离床）
const CHANNEL_KINDS = { NUMBER: 'number', STATE: 'state' };

// 按通道 key 关键词映射图标（icon 目录名）
const CHANNEL_ICON_MAP = {
  heart: 'icon-heart',
  breath: 'icon-breath',
  snore: 'icon-snore',
  noise: 'icon-snore',
  ambient: 'icon-snore',
  turn: 'icon-turn',
  bed: 'icon-bed',
  score: 'icon-moon',
  duration: 'icon-moon',
  device: 'icon-gateway'
};
const DEFAULT_CHANNEL_ICON = 'icon-dashboard';

// 睡眠分期（code 与云端/模型输出对齐）
const SLEEP_STAGES = [
  { code: 0, name: '清醒', color: '#9CA3AF' },
  { code: 1, name: 'REM', color: '#A855F7' },
  { code: 2, name: '浅睡', color: '#3D7EFF' },
  { code: 3, name: '深睡', color: '#10B981' }
];

// 设备状态
const DEVICE_STATUS = {
  online: { key: 'online', text: '在线', color: '#10B981', bg: '#E7F8F1' },
  offline: { key: 'offline', text: '离线', color: '#9CA3AF', bg: '#F3F4F6' },
  alert: { key: 'alert', text: '告警', color: '#F0506E', bg: '#FDEBED' }
};

// 设备类型
const DEVICE_TYPES = {
  sleep_monitor: { key: 'sleep_monitor', text: '睡眠监测仪', icon: '/assets/images/icons/icon-moon.png' },
  gateway: { key: 'gateway', text: '睡眠网关', icon: '/assets/images/icons/icon-gateway.png' }
};

// 消息类型：5 类事件源（与后端 UserMessage.type 对齐）
const MESSAGE_TYPES = {
  apnea_high:    { key: 'apnea_high',    text: '健康预警', color: '#EF4444', bg: '#FEE2E2', icon: '⚠' },
  snore_heavy:   { key: 'snore_heavy',   text: '重度鼾声', color: '#F59E0B', bg: '#FEF3C7', icon: '🔊' },
  device_offline:{ key: 'device_offline',text: '设备离线', color: '#6B7280', bg: '#F3F4F6', icon: '⚡' },
  device_bound:  { key: 'device_bound',  text: '新设备',   color: '#10B981', bg: '#DCFCE7', icon: '✓' },
  report_ready:  { key: 'report_ready',  text: '报告完成', color: '#3D7EFF', bg: '#EAF1FF', icon: '✦' },
  // 兼容旧字段
  alert:  { key: 'alert',  text: '告警', color: '#F0506E', bg: '#FDEBED', icon: '⚠' },
  system: { key: 'system', text: '系统', color: '#3D7EFF', bg: '#EAF1FF', icon: '✦' },
  device: { key: 'device', text: '设备', color: '#10B981', bg: '#E7F8F1', icon: '⚙' }
};

// 注：已移除 CONTROL_CMDS。设备可控项只剩「三开关」（snore/stage/bcg），
//     且是设备本地状态，通过 BLE 0x04/0x05 读写，不经云端，见 BLEProvisioner。

const STORAGE_KEYS = {
  USER: 'mp_user_info',
  TOKEN: 'mp_token',
  DEVICES: 'mp_devices'
};

module.exports = {
  CHANNEL_KINDS,
  CHANNEL_ICON_MAP,
  DEFAULT_CHANNEL_ICON,
  SLEEP_STAGES,
  DEVICE_STATUS,
  DEVICE_TYPES,
  MESSAGE_TYPES,
  STORAGE_KEYS
};
