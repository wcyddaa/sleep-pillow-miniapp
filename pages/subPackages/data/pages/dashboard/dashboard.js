// 睡眠看板：用 /sleep/trend/dashboard 接口（trend_graph 算的）
const dataAPI = require('../../../../../utils/network/api/dataAPI');
const deviceStore = require('../../../../../utils/store/stores/deviceStore');

Page({
  data: {
    loading: true,
    deviceIndex: 0,
    devices: [],
    dashboard: null,
    lastNight: null,
    // 7 天 daily 摘要（给简易曲线用）
    weekly: { categories: [], data: [] },
    durationWeekly: { categories: [], data: [] },
    deepWeekly: { categories: [], data: [] },
    snoreWeekly: { categories: [], data: [] },
    scoreTrendLabel: '稳定',
    insight: '',
    hasNoData: false
  },

  onLoad() {
    this.applyDevices();
    this.load();
  },

  onShow() {
    this.applyDevices();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  applyDevices() {
    const list = deviceStore.store.state.devices || [];
    this.setData({ devices: list, deviceIndex: 0 });
  },

  onDeviceChange(e) {
    this.setData({ deviceIndex: Number(e.detail.value) });
    this.load();
  },

  load() {
    const list = this.data.devices;
    if (!list.length) {
      this.setData({ loading: false, hasNoData: true, dashboard: null, lastNight: null });
      return Promise.resolve();
    }
    const target = list[this.data.deviceIndex] || list[0];
    this.setData({ loading: true });
    // ★ 一次请求拿全：/sleep/trend/dashboard 现在同时返回看板汇总 + N 天明细(items)。
    //   以前是 Promise.all([dashboard, weekly]) 并发两个请求，
    //   后端两个接口各自触发同一批每日摘要的重算 → 首屏要等好几秒。
    // ★ 同步异常也要兜住（dataAPI 内部若抛错，.catch 抓不到），否则 loading 永远不结束。
    let p;
    try {
      p = dataAPI.getTrendDashboard(target.id, 7);
    } catch (e) {
      this.setData({ loading: false, hasNoData: true });
      return Promise.resolve();
    }
    return p
      .then((d) => {
        const lastNight = d && d.last_night ? this._enrichLastNight(d.last_night) : null;
        const scoreTrendMap = { up: '改善', down: '下滑', stable: '稳定', no_data: '暂无数据' };
        const items = (d && d.items) || [];
        this.setData({
          loading: false,
          hasNoData: !d || (d.sample_count === 0),
          dashboard: d,
          lastNight,
          scoreTrendLabel: scoreTrendMap[d && d.score_trend] || '稳定',
          insight: (d && d.insight) || '',
          weekly: this.toSeries(items, 'score'),
          durationWeekly: this.toSeries(items, 'duration_min'),
          deepWeekly: this.toSeries(items, 'deep_pct'),
          snoreWeekly: this.toSeries(items, 'snore_minutes')
        });
      })
      .catch(() => {
        this.setData({ loading: false, hasNoData: true });
      });
  },

  /** 给 lastNight 加展示字符串字段（WXML 不支持 toFixed） */
  _enrichLastNight(lastNight) {
    const s = lastNight.summary || {};
    const deep = s.deep_pct;
    s.deepPctDisplay = (typeof deep === 'number') ? Math.round(deep * 100) + '%' : '--';
    return lastNight;
  },

  /** 把 weekly items 转成图表 series（categories + data） */
  toSeries(items, field) {
    const arr = (items || []).slice().reverse(); // 按时间升序
    const categories = arr.map((i) => i.day_label || '-');
    const data = arr.map((i) => {
      const v = i[field];
      if (v == null) return null;
      if (field === 'deep_pct') return Math.round(v * 100);
      if (field === 'duration_min') return Math.round(v / 6) / 10; // 分钟 → 小时，保留 1 位
      return typeof v === 'number' ? Math.round(v * 10) / 10 : v;
    });
    return { categories, data };
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/subPackages/data/pages/history/history' });
  },

  goReport() {
    wx.navigateTo({ url: '/pages/subPackages/ai/pages/report-range/report-range' });
  }
});
