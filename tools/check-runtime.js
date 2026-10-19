/**
 * 运行时冒烟测试：node tools/check-runtime.js
 * 在 Node 沙箱中 stub wx/App/Page/Component：
 *   1. 加载全部 JS 模块（捕获 require 路径/语法/顶层错误）
 *   2. 实例化每个 Page 并执行 onLoad -> onShow -> onUnload
 *   3. 实例化每个 Component 并执行 attached 生命周期
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* ---- 全局 stub ---- */
const wxStub = {
  getWindowInfo: () => ({ statusBarHeight: 24, pixelRatio: 2 }),
  getSystemInfoSync: () => ({ statusBarHeight: 24, pixelRatio: 2 }),
  getStorageSync: () => '',
  setStorageSync: () => {},
  removeStorageSync: () => {},
  setTabBarBadge: () => {},
  removeTabBarBadge: () => {},
  showToast: () => {},
  showModal: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  nextTick: (fn) => fn(),
  request: () => {},
  connectSocket: () => ({ onOpen: () => {}, onMessage: () => {}, onClose: () => {}, onError: () => {}, close: () => {} }),
  openBluetoothAdapter: () => {},
  startBluetoothDevicesDiscovery: () => {},
  stopBluetoothDevicesDiscovery: () => {},
  onBluetoothDeviceFound: () => {},
  createBLEConnection: () => {},
  getBLEDeviceServices: () => ({ services: [] }),
  getBLEDeviceCharacteristics: () => ({ characteristics: [] }),
  notifyBLECharacteristicValueChange: () => {},
  onBLECharacteristicValueChange: () => {},
  onBLEConnectionStateChange: () => {},
  writeBLECharacteristicValue: () => {},
  closeBLEConnection: () => {},
  login: () => {},
  getNetworkType: () => {},
  setClipboardData: () => {},
  setNavigationBarTitle: () => {},
  stopPullDownRefresh: () => {},
  navigateTo: () => {},
  redirectTo: () => {},
  switchTab: () => {},
  navigateBack: () => {}
};
global.wx = new Proxy(wxStub, { get: (t, p) => (p in t ? t[p] : () => {}) });
global.getApp = () => ({});
global.getCurrentPages = () => [];

/* 待实例化的 Page / Component（随文件加载逐个 drain） */
let pending = [];
global.Page = (opts) => pending.push({ kind: 'Page', opts });
global.Component = (opts) => pending.push({ kind: 'Component', opts });
global.App = () => {};

const PAGE_LIFECYCLE = new Set([
  'data', 'onLoad', 'onShow', 'onReady', 'onHide', 'onUnload',
  'onPullDownRefresh', 'onReachBottom', 'onShareAppMessage', 'onPageScroll',
  'onResize', 'onAddToFavorites', 'onShareTimeline', 'options'
]);

function makeInstance(def) {
  const inst = {
    data: JSON.parse(JSON.stringify(def.data || {})),
    setData(patch) { Object.assign(this.data, JSON.parse(JSON.stringify(patch))); },
    triggerEvent() {},
    createSelectorQuery() { return { select: () => ({ fields: () => {} }), exec: () => {} }; }
  };
  // 微信运行时会将 Page 选项函数 / Component methods 混入 this，stub 保持一致
  if (def.kind === 'Page') {
    Object.keys(def.opts).forEach((k) => {
      if (!PAGE_LIFECYCLE.has(k) && typeof def.opts[k] === 'function') inst[k] = def.opts[k].bind(inst);
    });
  } else {
    const methods = def.opts.methods || {};
    Object.keys(methods).forEach((k) => {
      if (typeof methods[k] === 'function') inst[k] = methods[k].bind(inst);
    });
  }
  return inst;
}

function instantiate(def, label, errors) {
  const inst = makeInstance(def);
  try {
    if (def.kind === 'Page') {
      def.opts.onLoad && def.opts.onLoad.call(inst, {});
      def.opts.onShow && def.opts.onShow.call(inst, {});
      def.opts.onUnload && def.opts.onUnload.call(inst, {});
    } else {
      const life = (def.opts.lifetimes || {}).attached || def.opts.attached;
      life && life.call(inst);
    }
  } catch (e) {
    errors.push(`${label} [${def.kind}]\n    ${e.message.split('\n')[0]}`);
  }
}

/* ---- 加载并执行 ---- */
function walk(dir, out = []) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'tools' || e.name.startsWith('.')) return;
      walk(p, out);
    } else if (p.endsWith('.js')) out.push(p);
  });
  return out;
}

const files = walk(ROOT).concat([path.join(ROOT, 'app.js')]);
const errors = [];
let pageCount = 0, compCount = 0;

files.forEach((f) => {
  const rel = path.relative(ROOT, f);
  pending = [];
  try {
    delete require.cache[require.resolve(f)];
    require(f);
  } catch (e) {
    errors.push(`${rel} [模块加载]\n    ${e.message.split('\n')[0]}`);
    pending = [];
    return;
  }
  pending.forEach((def) => instantiate(def, rel, errors));
  pageCount += pending.filter((d) => d.kind === 'Page').length;
  compCount += pending.filter((d) => d.kind === 'Component').length;
});

console.log(`加载模块: ${files.length} 个 | Page 生命周期: ${pageCount} | Component attached: ${compCount}`);
if (errors.length) {
  console.error('\n失败:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('✓ 全部模块加载 + 页面/组件生命周期模拟执行通过');
process.exit(0);
