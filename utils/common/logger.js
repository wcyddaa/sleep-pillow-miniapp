/**
 * 日志系统：统一前缀，可按环境开关
 */
const envConfig = require('../../config/envConfig');

function fmt(args) {
  return ['[MP]'].concat(Array.prototype.slice.call(args));
}

module.exports = {
  debug() { if (envConfig.debug) console.log.apply(console, fmt(arguments)); },
  info() { if (envConfig.debug) console.info.apply(console, fmt(arguments)); },
  warn() { console.warn.apply(console, fmt(arguments)); },
  error() { console.error.apply(console, fmt(arguments)); }
};
