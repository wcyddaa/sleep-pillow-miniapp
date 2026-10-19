/**
 * 轻量响应式 Store（零依赖）
 * createStore(initialState) -> { state, setState, subscribe }
 * bindStore: 页面/组件订阅 store，状态变化自动 setData
 */
const logger = require('../common/logger');

function createStore(initialState) {
  const listeners = new Set();
  return {
    state: Object.assign({}, initialState),
    setState(patch) {
      Object.assign(this.state, patch);
      listeners.forEach((fn) => {
        try { fn(this.state); } catch (e) { logger.error('store listener error:', e); }
      });
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}

/**
 * 在页面中使用：
 *   this._unsub = bindStore(this, deviceStore, (s) => ({ devices: s.devices }))
 *   onUnload 时调用 this._unsub && this._unsub()
 */
function bindStore(ctx, store, mapFn) {
  const apply = (s) => {
    const data = mapFn ? mapFn(s) : s;
    // 兼容“仅做副作用、不返回数据”的回调（如 control.js 直接 applyDevice）
    if (!data || typeof data !== 'object') return;
    // 只更新发生变化的 key，减少 setData 次数
    const patch = {};
    Object.keys(data).forEach((k) => {
      if (ctx.data[k] !== data[k]) patch[k] = data[k];
    });
    if (Object.keys(patch).length) ctx.setData(patch);
  };
  apply(store.state);
  return store.subscribe(apply);
}

module.exports = { createStore, bindStore };
