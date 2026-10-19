/**
 * 数据格式化：时间、数值
 */
function pad(n) { return n < 10 ? '0' + n : '' + n; }

/**
 * 相对时间：刚刚 / n分钟前 / n小时前 / 昨天 HH:mm / MM-DD / YYYY-MM-DD
 */
function formatTime(ts) {
  if (!ts) return '';
  const d = ts instanceof Date ? ts : new Date(ts);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
  const sameYear = d.getFullYear() === now.getFullYear();
  const yesterday = new Date(now.getTime() - 86400000);
  if (d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate()) {
    return '昨天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  if (sameYear) return pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** 完整时间 HH:mm:ss */
function formatHMS(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

/** 完整日期时间 YYYY-MM-DD HH:mm */
function formatDateTime(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/** 数值格式化（保留 digits 位，去掉多余 0） */
function formatNumber(v, digits) {
  if (v === null || v === undefined || isNaN(v)) return '--';
  const n = Number(v);
  if (digits !== undefined) return n.toFixed(digits).replace(/\.?0+$/, '');
  return String(n);
}

/** 指标值 + 单位 */
function formatMetric(value, def) {
  if (value === null || value === undefined) return '--';
  return formatNumber(value, def.digits);
}

/** 文件大小 */
function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '--';
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}

module.exports = { formatTime, formatHMS, formatDateTime, formatNumber, formatMetric, formatSize };
