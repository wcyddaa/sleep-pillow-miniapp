/**
 * 动态数据通道 schema：
 * 前端展示哪些指标完全由云端下发的 channels 决定 —— 设备能力不同（如仅雷达 vs 雷达+麦克风），
 * 下发通道不同，页面据此动态渲染，无需改前端代码
 */
const { CHANNEL_KINDS, CHANNEL_ICON_MAP, DEFAULT_CHANNEL_ICON } = require('./constants');

/** 补全单个通道的展示元数据 */
function normalizeChannel(ch, idx) {
  if (!ch || !ch.key) return null;
  const kind = ch.kind || CHANNEL_KINDS.NUMBER;
  const iconKey = guessIcon(ch);
  return {
    key: ch.key,
    label: ch.label || ch.key,
    unit: ch.unit || '',
    color: ch.color || '#3D7EFF',
    kind,
    digits: ch.digits !== undefined ? ch.digits : 0,
    min: ch.min !== undefined ? ch.min : 0,
    max: ch.max !== undefined ? ch.max : 100,
    base: ch.base !== undefined ? ch.base : (ch.min || 0),
    onText: ch.onText || '开启',
    offText: ch.offText || '关闭',
    // 展示用
    icon: '/assets/images/icons/' + iconKey + '.png',
    order: idx
  };
}

/** 按 key 关键词猜图标，其次用云端指定的 icon 字段 */
function guessIcon(ch) {
  const key = String(ch.key).toLowerCase();
  for (const kw of Object.keys(CHANNEL_ICON_MAP)) {
    if (key.indexOf(kw) >= 0) return CHANNEL_ICON_MAP[kw];
  }
  return ch.icon || DEFAULT_CHANNEL_ICON;
}

/** 归一化云端通道列表 */
function normalizeChannels(list) {
  return (list || []).map(normalizeChannel).filter(Boolean);
}

/** 按通道定义格式化数值：数值型保留位数，状态型映射文案 */
function formatValue(ch, v) {
  if (ch.kind === CHANNEL_KINDS.STATE) {
    if (v === null || v === undefined) return '--';
    const on = v === 1 || v === true;
    return on ? ch.onText : ch.offText;
  }
  if (v === null || v === undefined || isNaN(v)) return '--';
  return Number(v).toFixed(ch.digits);
}

/** 通道值的主色（状态型按开/关区分颜色） */
function valueColor(ch, v) {
  if (ch.kind === CHANNEL_KINDS.STATE) {
    const on = v === 1 || v === true;
    return on ? '#10B981' : '#9CA3AF';
  }
  return ch.color;
}

/** 找通道：按 key 包含关键词 */
function findChannel(channels, keyword) {
  keyword = String(keyword).toLowerCase();
  return (channels || []).find((c) => String(c.key).toLowerCase().indexOf(keyword) >= 0) || null;
}

/**
 * 从通道列表中拆分出「重点指标」（数值型，取前 n 个）与「其余通道」
 * 供实时监测页：hero 大字展示 + 网格展示
 */
function splitHero(channels, n) {
  const nums = channels.filter((c) => c.kind === CHANNEL_KINDS.NUMBER);
  return { hero: nums.slice(0, n), rest: nums.slice(n), states: channels.filter((c) => c.kind === CHANNEL_KINDS.STATE) };
}

module.exports = { normalizeChannel, normalizeChannels, formatValue, valueColor, findChannel, splitHero, guessIcon };
