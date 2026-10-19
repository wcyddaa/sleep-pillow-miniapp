/**
 * 跨页面/组件事件总线
 */
const listeners = {};

module.exports = {
  on(event, fn) {
    if (!listeners[event]) listeners[event] = new Set();
    listeners[event].add(fn);
    return () => this.off(event, fn);
  },
  off(event, fn) {
    if (listeners[event]) listeners[event].delete(fn);
  },
  emit(event, payload) {
    const set = listeners[event];
    if (!set) return;
    set.forEach((fn) => {
      try { fn(payload); } catch (e) { console.error('[eventBus]', event, e); }
    });
  }
};
