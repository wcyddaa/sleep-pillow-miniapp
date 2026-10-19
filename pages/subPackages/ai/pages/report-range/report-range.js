// 按时间段生成睡眠报告（独立智能体，对接 /reports/range）
const aiAPI = require('../../../../../utils/network/api/aiAPI');
const deviceStore = require('../../../../../utils/store/stores/deviceStore');
const formatter = require('../../../../../utils/common/formatter');
const logger = require('../../../../../utils/common/logger');

// ★ 生成阶段：后端是黑盒（一次 HTTP 请求），只能按已耗时估算推进。
//   真实耗时分布：查帧/算覆盖很快（<2s），LLM 生成 5 段文本最慢（10~30s）。
const STAGES = ['读取睡眠数据', '计算数据完整度', 'AI 分析睡眠结构', '生成报告文本'];

/** 已耗时(秒) → 阶段下标 + 进度百分比（封顶 92%，避免 100% 后还在等） */
function progressOf(sec) {
  let stageIdx = 0;
  let pct = 0;
  if (sec < 2) {
    stageIdx = 0;
    pct = (sec / 2) * 15;                    // 0 → 15%
  } else if (sec < 4) {
    stageIdx = 1;
    pct = 15 + ((sec - 2) / 2) * 15;         // 15 → 30%
  } else if (sec < 25) {
    stageIdx = 2;
    pct = 30 + ((sec - 4) / 21) * 55;        // 30 → 85%（LLM 主力阶段）
  } else {
    stageIdx = 3;
    pct = 85 + Math.min((sec - 25) / 20, 1) * 7;  // 85 → 92%
  }
  return { stageIdx, pct: Math.round(pct) };
}

Page({
  data: {
    loading: false,
    streaming: false,        // ★ 正在逐字接收 LLM 输出
    streamText: '',          // 已接收的正文（打字机效果）

    // ★ 进度反馈
    stages: STAGES,
    stageIdx: 0,
    stageText: STAGES[0],
    progressPct: 0,
    elapsedSec: 0,

    // 设备选择
    deviceOptions: [],
    deviceIndex: 0,

    // 时间区间：multiSelector 用 [年,月,日,时,分] 各列
    dateRange: [[], [], [], [], []],
    startIndex: [0, 0, 0, 0, 0],
    endIndex: [0, 0, 0, 0, 0],
    startText: '',
    endText: '',

    // 快捷区间
    quickRanges: [
      { key: 'yesterday', label: '昨天' },
      { key: 'last7', label: '最近 7 天' },
      { key: 'last30', label: '最近 30 天' }
    ],

    // 报告结果
    report: null,
    summary: null,
    coverage: null,
    degradation: null,
    frameCount: 0,
    sections: [],
    warnings: [],
    windowText: '',
    degradeLabel: '',
    degradeClass: 'degrade-full',
    coverageText: ''
  },

  onLoad(query) {
    this.buildDeviceOptions();
    this.buildDateRange();
    // 默认：昨天 12:00 ~ 今天 12:00（24h，对齐"每天 12:00 切分"的口径）
    const now = new Date();
    const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
    const yestNoon = new Date(todayNoon.getTime() - 86400000);
    const startMs = yestNoon.getTime();
    const endMs = todayNoon.getTime();
    this.setData({
      startText: this.idxToText(this.msToIndex(startMs)),
      endText: this.idxToText(this.msToIndex(endMs)),
      startIndex: this.msToIndex(startMs),
      endIndex: this.msToIndex(endMs),
      _startMs: startMs,
      _endMs: endMs
    });
  },

  onUnload() {
    this.stopProgress();
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (this._streamTask && this._streamTask.abort) {
      this._streamTask.abort();
      this._streamTask = null;
    }
  },

  // ---- 进度定时器 ----
  startProgress() {
    this.stopProgress();
    const began = Date.now();
    this._progressTimer = setInterval(() => {
      const sec = (Date.now() - began) / 1000;
      const { stageIdx, pct } = progressOf(sec);
      this.setData({
        elapsedSec: Math.floor(sec),
        stageIdx,
        stageText: STAGES[stageIdx],
        progressPct: pct
      });
    }, 400);
  },

  stopProgress() {
    if (this._progressTimer) {
      clearInterval(this._progressTimer);
      this._progressTimer = null;
    }
  },

  buildDeviceOptions() {
    const list = deviceStore.store.state.devices || [];
    const opts = list.map((d) => ({
      label: (d.name || d.device_id) + '（ID ' + d.id + '）',
      value: d.id
    }));
    if (!opts.length) opts.push({ label: '暂未绑定设备', value: null });
    this.setData({ deviceOptions: opts, deviceIndex: 0 });
  },

  buildDateRange() {
    // ★ 列内存**纯数字**（不带"年月日"单位），否则 Number("2026年")=NaN，
    //   会让 new Date(NaN,...) 变成 Invalid Date。单位只在 idxToText() 拼。
    const now = new Date();
    // ★ 年份列从「今年-1」开始，后续 idx→年 换算都靠这个基数，存起来避免各处重复算
    this._baseYear = now.getFullYear() - 1;
    const years = [];
    const months = [];
    const days = [];
    const hours = [];
    const minutes = [];

    for (let y = this._baseYear; y <= this._baseYear + 2; y++) years.push(String(y));
    for (let m = 1; m <= 12; m++) months.push(String(m));
    for (let d = 1; d <= 31; d++) days.push(String(d));
    for (let h = 0; h < 24; h++) hours.push(String(h));
    for (let mi = 0; mi < 60; mi += 5) minutes.push(String(mi));

    this.setData({ dateRange: [years, months, days, hours, minutes] });
  },

  /**
   * ★ 关键：picker 给的是**列下标**（0-based），不是年月日的值。
   *   例：['1','9','15','12','0'] 表示 years[1]=2026 / months[9]=10 /
   *       days[15]=16 / hours[12]=12 / minutes[0]=0
   *   直接把下标当值用会得到 new Date(1,9,15,...) = 1901 年。
   */
  idxToParts(idx) {
    const base = (this._baseYear != null) ? this._baseYear : (new Date().getFullYear() - 1);
    return {
      y: base + Number(idx[0]),          // years 列：base, base+1, base+2
      m: Number(idx[1]) + 1,             // months 列：1..12（下标 0..11）
      d: Number(idx[2]) + 1,             // days 列：1..31（下标 0..30）
      h: Number(idx[3]),                 // hours 列：0..23
      mi: Number(idx[4]) * 5             // minutes 列：步长 5 → 值 = 下标 × 5
    };
  },

  idxToText(idx) {
    const p = this.idxToParts(idx);
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return `${p.y}年${pad(p.m)}月${pad(p.d)}日 ${pad(p.h)}:${pad(p.mi)}`;
  },

  idxToMs(idx) {
    const p = this.idxToParts(idx);
    return new Date(p.y, p.m - 1, p.d, p.h, p.mi, 0).getTime();
  },

  /** 把时间戳反查成 picker 的**列下标**，用于把 picker 初始值对齐到默认区间 */
  msToIndex(ms) {
    const dt = new Date(ms);
    const base = (this._baseYear != null) ? this._baseYear : (new Date().getFullYear() - 1);
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    return [
      clamp(dt.getFullYear() - base, 0, 2),      // 年份列：base..base+2
      clamp(dt.getMonth(), 0, 11),               // 月份列：下标 = 月 - 1
      clamp(dt.getDate() - 1, 0, 30),            // 日期列：下标 = 日 - 1
      clamp(dt.getHours(), 0, 23),               // 小时列：下标 = 时
      clamp(Math.round(dt.getMinutes() / 5), 0, 11)  // 分钟列：步长 5
    ];
  },

  onDeviceChange(e) {
    this.setData({ deviceIndex: Number(e.detail.value) });
  },

  onStartChange(e) {
    const idx = e.detail.value;
    const text = this.idxToText(idx);
    const ms = this.idxToMs(idx);
    this.setData({ startIndex: idx, startText: text, _startMs: ms });
  },

  onEndChange(e) {
    const idx = e.detail.value;
    const text = this.idxToText(idx);
    const ms = this.idxToMs(idx);
    this.setData({ endIndex: idx, endText: text, _endMs: ms });
  },

  /** 快捷区间 */
  onQuickRange(e) {
    const key = e.currentTarget.dataset.key;
    const now = new Date();
    const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
    let startMs, endMs;
    if (key === 'yesterday') {
      endMs = todayNoon.getTime();
      startMs = endMs - 86400000;
    } else if (key === 'last7') {
      endMs = todayNoon.getTime();
      startMs = endMs - 7 * 86400000;
    } else if (key === 'last30') {
      endMs = todayNoon.getTime();
      startMs = endMs - 30 * 86400000;
    }
    this.setData({
      startText: this.idxToText(this.msToIndex(startMs)),
      endText: this.idxToText(this.msToIndex(endMs)),
      startIndex: this.msToIndex(startMs),
      endIndex: this.msToIndex(endMs),
      _startMs: startMs,
      _endMs: endMs
    });
  },

  /** 生成报告：优先走 SSE 流式，失败自动回退到普通接口 */
  onGenerate() {
    const device = this.data.deviceOptions[this.data.deviceIndex];
    if (!device || !device.value) {
      return wx.showToast({ title: '请先绑定设备', icon: 'none' });
    }
    const startMs = this.data._startMs;
    const endMs = this.data._endMs;
    if (!startMs || !endMs || endMs <= startMs) {
      return wx.showToast({ title: '时间区间无效', icon: 'none' });
    }
    if (endMs - startMs > 7 * 86400000) {
      return wx.showToast({ title: '单次区间请不超过 7 天', icon: 'none' });
    }

    this._streamText = '';
    this._finalReport = null;
    this._metaReady = false;
    this._fellBack = false;
    // 记录本次请求参数，供兜底/中断使用
    this._curDeviceId = device.value;
    this._curStartTs = Math.floor(startMs / 1000);
    this._curEndTs = Math.floor(endMs / 1000);

    this.setData({
      loading: true,
      streaming: false,
      streamText: '',
      stageIdx: 0,
      stageText: STAGES[0],
      progressPct: 0,
      elapsedSec: 0
    });
    this.startProgress();

    const startTs = this._curStartTs;
    const endTs = this._curEndTs;

    // ★ 本页已确认流式接口不可用（后端未部署 /reports/range/stream）→ 直接走普通接口，
    //   避免每次生成都先吃一个 404 往返。页面重进会重置，部署后自动恢复。
    if (this._streamBroken) {
      logger.warn('流式接口本页已失效，直接走普通接口');
      this._fallbackToPlain(device.value, startTs, endTs, new Error('stream unavailable'));
      return;
    }

    this._streamTask = aiAPI.streamRangeReport(
      device.value,
      startTs,
      endTs,
      {
        onEvent: (ev) => this._onStreamEvent(ev),
        onError: (err) => this._fallbackToPlain(device.value, startTs, endTs, err)
      },
      () => {
        // 流结束（无论成功失败都会调用）
        if (this._fellBack) return;
        const text = this._finalReport || this._streamText;
        if (text) {
          this.finalizeStream(text);
        } else {
          this._fallbackToPlain(device.value, startTs, endTs, new Error('流式未返回内容'));
        }
      }
    );
  },

  /** SSE 事件处理 */
  _onStreamEvent(ev) {
    if (!ev || !ev.t) return;

    if (ev.t === 'meta') {
      // 先拿到统计信息 → 立刻结束进度条，进入正文流式
      this.stopProgress();
      this._metaReady = true;
      const disp = this._degradeDisplay(ev.degradation, ev.coverage, ev.frame_count);
      this.setData(Object.assign({
        loading: false,
        streaming: true,
        frameCount: ev.frame_count || 0,
        summary: ev.summary || {},
        coverage: ev.coverage || {},
        degradation: ev.degradation || {},
        warnings: (ev.degradation && ev.degradation.warnings) || []
      }, disp));
      return;
    }

    if (ev.t === 'delta') {
      this._streamText += (ev.text || '');
      // 节流：每 80ms 才 setData 一次，避免长文本频繁渲染掉帧
      if (!this._flushTimer) {
        this._flushTimer = setTimeout(() => {
          this._flushTimer = null;
          this.setData({ streamText: this._streamText });
        }, 80);
      }
      return;
    }

    if (ev.t === 'done') {
      this._finalReport = ev.report || '';
      return;
    }

    if (ev.t === 'error') {
      this._fallbackToPlain(
        this._curDeviceId, this._curStartTs, this._curEndTs,
        new Error(ev.message || '流式生成失败')
      );
    }
  },

  /** 流式结束 → 定稿渲染 */
  finalizeStream(text) {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    this.stopProgress();
    const sections = this.parseSections(text);
    this.setData({
      loading: false,
      streaming: false,
      streamText: '',
      progressPct: 100,
      sections,
      // 流式模式下正文已经来自 LLM，这里补一个 report 对象给「复制」按钮用
      report: Object.assign({}, this.data.report || {}, {
        report: text,
        frame_count: this.data.frameCount
      })
    });
  },

  /** 流式不可用 / 失败 → 回退到一次性接口 */
  _fallbackToPlain(deviceId, startTs, endTs, err) {
    if (this._fellBack || this.data.report) return;
    this._fellBack = true;
    // 404/接口不存在 → 记住本页别再试流式（后端可能还没部署这个接口）
    if (err && /请求失败\(404\)|接口不存在/.test(err.message || '')) {
      this._streamBroken = true;
    }
    this._curDeviceId = deviceId;
    this._curStartTs = startTs;
    this._curEndTs = endTs;
    logger.warn('流式失败，回退普通接口:', err && err.message);

    aiAPI.generateRangeReport(deviceId, startTs, endTs)
      .then((r) => {
        this.stopProgress();
        this.setData({ streaming: false, streamText: '', progressPct: 100 });
        this.applyResult(r);
      })
      .catch((e2) => {
        this.stopProgress();
        this.setData({ loading: false, streaming: false, streamText: '', progressPct: 0 });
        wx.showToast({ title: (e2 && e2.message) || '生成失败', icon: 'none' });
      });
  },

  /** 降级档位 + 覆盖率的展示字段（进度/流式/定稿三处共用） */
  _degradeDisplay(degradation, coverage, frameCount) {
    const mode = (degradation && degradation.mode) || 'full';
    const modeLabelMap = {
      full: '完整评估',
      partial: '部分降级',
      insufficient: '降级评估',
      failed: '评估受限'
    };
    const cov = coverage || {};
    const ratio = cov.missing_ratio || 0;
    const fc = (cov.frame_count != null) ? cov.frame_count : (frameCount || 0);
    const expect = (cov.expected != null) ? cov.expected : null;
    const coverageText = expect != null
      ? `${fc}/${expect} 帧 · 缺失 ${Math.round(ratio * 100)}%`
      : `${fc} 帧 · 缺失 ${Math.round(ratio * 100)}%`;
    return {
      degradeLabel: modeLabelMap[mode] || '未知',
      degradeClass: 'degrade-' + mode,
      coverageText
    };
  },

  applyResult(r) {
    const sections = this.parseSections(r.report || '');
    const mode = (r.degradation && r.degradation.mode) || 'full';
    const modeLabelMap = {
      full: '完整评估',
      partial: '部分降级',
      insufficient: '降级评估',
      failed: '评估受限'
    };
    const cov = r.coverage || {};
    const ratio = cov.missing_ratio || 0;
    // 帧数展示：缺失字段时不显示 undefined
    const fc = (cov.frame_count != null) ? cov.frame_count : (r.frame_count || 0);
    const expect = (cov.expected != null) ? cov.expected : null;
    const coverageText = expect != null
      ? `${fc}/${expect} 帧 · 缺失 ${Math.round(ratio * 100)}%`
      : `${fc} 帧 · 缺失 ${Math.round(ratio * 100)}%`;
    // 时间窗展示：ts 缺失时给占位，不抛 Invalid Date
    let windowText = '';
    if (r.start_ts && r.end_ts) {
      windowText = `${formatter.formatDateTime(new Date(r.start_ts * 1000))} ~ ${formatter.formatDateTime(new Date(r.end_ts * 1000))}`;
    }
    this.setData({
      loading: false,
      streaming: false,
      report: r,
      sections,
      summary: r.summary || {},
      coverage: cov,
      degradation: r.degradation || {},
      frameCount: r.frame_count || fc,
      warnings: (r.degradation && r.degradation.warnings) || [],
      windowText,
      degradeLabel: modeLabelMap[mode] || '未知',
      degradeClass: 'degrade-' + mode,
      coverageText
    });
  },

  parseSections(text) {
    text = (text || '').trim();
    if (!text) return [];
    const sections = [];
    const re = /【([^】]+)】([\s\S]*?)(?=【[^】]+】|$)/g;
    let m;
    while ((m = re.exec(text))) {
      const body = (m[2] || '').trim();
      if (body) sections.push({ title: m[1].trim(), body });
    }
    if (!sections.length) sections.push({ title: 'AI 报告', body: text });
    return sections;
  },

  copyReport() {
    if (!this.data.report) return;
    wx.setClipboardData({
      data: this.data.report.report || '',
      success: () => wx.showToast({ title: '已复制', icon: 'none' })
    });
  }
});
