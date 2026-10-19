// 长期趋势：7 天每日报告（trend_graph 算的）
const dataAPI = require('../../../../../utils/network/api/dataAPI');
const deviceStore = require('../../../../../utils/store/stores/deviceStore');
const logger = require('../../../../../utils/common/logger');

const METRICS = [
  { key: 'score',    label: '睡眠评分', unit: '分', color: '#6A5CFF' },
  { key: 'duration', label: '睡眠时长', unit: '小时', color: '#3D7EFF' },
  { key: 'deep',     label: '深睡占比', unit: '%', color: '#10B981' },
  { key: 'snore',    label: '鼾声', unit: '分', color: '#F59E0B' }
];

const CACHE_TTL_MS = 5 * 60 * 1000;   // 缓存 5 分钟
const CACHE_KEY = (deviceId) => 'trend_weekly_' + deviceId + '_7';

Page({
  data: {
    devices: [],
    deviceIndex: 0,
    metric: 'score',
    metrics: METRICS,
    loading: true,
    refreshing: false,          // 后台静默刷新中（保留旧数据，不闪屏）
    elapsedSec: 0,
    progressPct: 0,             // JS 预计算，避免 WXML 嵌套三元
    chart: { categories: [], data: [] },
    curDef: METRICS[0],
    items: [],
    latest: '--',
    avg: '--',
    max: '--',
    min: '--',
    hasNoData: false
  },

  onLoad() {
    this.applyDevices();
    this.load();
  },

  onShow() {
    const before = (this.data.devices || []).length;
    this.applyDevices();
    // ★ 首次进入时首页可能还没拉到设备列表 → 这里设备到了自动补一次加载
    if (before === 0 && (this.data.devices || []).length > 0 && !this.data.items.length) {
      this.load();
    }
  },

  onUnload() {
    this.stopTick();
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh());
  },

  applyDevices() {
    const list = deviceStore.store.state.devices || [];
    // 保持当前选中的设备，不要每次 onShow 都重置到第 0 台
    const cur = this.data.devices[this.data.deviceIndex];
    let idx = 0;
    if (cur) {
      const found = list.findIndex((d) => String(d.id) === String(cur.id));
      if (found >= 0) idx = found;
    }
    this.setData({ devices: list, deviceIndex: idx });
  },

  onDeviceChange(e) {
    this.setData({ deviceIndex: Number(e.detail.value), items: [], hasNoData: false });
    this.load();
  },

  onMetricTap(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ metric: key, curDef: METRICS.find((m) => m.key === key) });
    this.computeStats();
  },

  // ---- 缓存读写 ----
  readCache(deviceId) {
    try {
      const raw = wx.getStorageSync(CACHE_KEY(deviceId));
      if (!raw || !raw.ts || !Array.isArray(raw.items)) return null;
      if (Date.now() - raw.ts > CACHE_TTL_MS) return null;
      return raw.items;
    } catch (e) {
      return null;
    }
  },

  writeCache(deviceId, items) {
    try {
      wx.setStorageSync(CACHE_KEY(deviceId), { ts: Date.now(), items });
    } catch (e) {
      // 缓存写失败不影响主流程（storage 满等情况）
    }
  },

  // ---- 加载 ----
  startTick() {
    this.stopTick();
    const began = Date.now();
    this._tick = setInterval(() => {
      const sec = Math.floor((Date.now() - began) / 1000);
      // 进度按阶段爬升，封顶 90%（后面还要等后端返回）
      let pct;
      if (sec < 3) pct = 12 + sec * 4;          // 0~3s  → 12~24%
      else if (sec < 8) pct = 25 + (sec - 3) * 6;   // 3~8s  → 25~55%
      else if (sec < 15) pct = 55 + (sec - 8) * 3.3; // 8~15s → 55~78%
      else pct = Math.min(78 + (sec - 15) * 1.2, 90);
      this.setData({ elapsedSec: sec, progressPct: Math.round(pct) });
    }, 500);
  },

  stopTick() {
    if (this._tick) {
      clearInterval(this._tick);
      this._tick = null;
    }
  },

  /**
   * @param {boolean} force true=跳过缓存（下拉刷新 / 切设备）
   * 策略：有缓存 → 先秒渲染旧数据，再后台静默刷新（stale-while-revalidate）
   */
  load(force) {
    const list = this.data.devices;
    if (!list.length) {
      this.setData({ loading: false, refreshing: false, hasNoData: true, items: [] });
      return Promise.resolve();
    }
    const target = list[this.data.deviceIndex] || list[0];
    const deviceId = target.id;

    if (!force) {
      const cached = this.readCache(deviceId);
      if (cached && cached.length) {
        const items = cached.map(this._enrichItem);
        this.setData({ items, hasNoData: false, loading: false, refreshing: true });
        this.computeStats();
        this.fetchItems(deviceId, true);
        return Promise.resolve();
      }
    }

    this.setData({ loading: true, refreshing: false, elapsedSec: 0 });
    this.startTick();
    return this.fetchItems(deviceId, false);
  },

  fetchItems(deviceId, isBackground) {
    // ★ 同步异常也要兜住：dataAPI 内部若抛 ReferenceError，
    //   原写法会走不进 .then/.catch → stopTick() 永远不执行 → 计时器一直转。
    let p;
    try {
      p = dataAPI.getTrendWeekly(deviceId, 7);
    } catch (e) {
      this.stopTick();
      this.setData({ loading: false, refreshing: false, hasNoData: true });
      logger.error('getTrendWeekly 同步异常:', e && e.message);
      return Promise.resolve();
    }
    return p
      .then((w) => {
        const items = ((w && w.items) || []).map(this._enrichItem);
        this.stopTick();
        this.setData({
          loading: false,
          refreshing: false,
          hasNoData: items.length === 0,
          items
        });
        this.computeStats();
        // 只缓存非空结果，避免空数据把缓存冲掉
        if (items.length) this.writeCache(deviceId, items);
      })
      .catch(() => {
        this.stopTick();
        // 后台刷新失败时保留已有数据，不打断用户
        if (!isBackground) {
          this.setData({ loading: false, refreshing: false, hasNoData: true });
        } else {
          this.setData({ refreshing: false });
        }
      });
  },

  /** 给每条 summary 加展示字符串字段（WXML 不支持 toFixed） */
  _enrichItem(item) {
    const dc = item.data_completeness;
    item.completenessDisplay = (typeof dc === 'number') ? Math.round(dc * 100) + '% 缺失' : '';
    item.warnCompleteness = (typeof dc === 'number') && dc >= 0.3;
    item.durationDisplay = (typeof item.duration_min === 'number')
      ? Math.round(item.duration_min / 60 * 10) / 10 + 'h'
      : '--h';
    item.deepDisplay = (typeof item.deep_pct === 'number')
      ? Math.round(item.deep_pct * 100) + '%'
      : '--';
    item.snoreDisplay = (typeof item.snore_minutes === 'number')
      ? Math.round(item.snore_minutes)
      : 0;
    return item;
  },

  computeStats() {
    const { items, metric } = this.data;
    if (!items.length) {
      this.setData({ chart: { categories: [], data: [] }, latest: '--', avg: '--', max: '--', min: '--' });
      return;
    }
    // 按时间升序
    const arr = items.slice().reverse();
    const categories = arr.map((i) => i.day_label || '-');
    const field = { score: 'score', duration: 'duration_min', deep: 'deep_pct', snore: 'snore_minutes' }[metric];
    const raw = arr.map((i) => i[field]);
    const data = raw.map((v) => {
      if (v == null) return null;
      if (metric === 'deep') return Math.round(v * 100);
      if (metric === 'duration') return Math.round(v / 6) / 10;
      return Math.round(v * 10) / 10;
    });
    const valid = data.filter((v) => v != null);
    const sum = valid.reduce((a, b) => a + b, 0);
    const curDef = METRICS.find((m) => m.key === metric) || METRICS[0];
    this.setData({
      chart: { categories, data },
      curDef,
      latest: valid.length ? data[data.length - 1] : '--',
      avg: valid.length ? Math.round(sum / valid.length * 10) / 10 : '--',
      max: valid.length ? Math.max(...valid) : '--',
      min: valid.length ? Math.min(...valid) : '--'
    });
  }
});
