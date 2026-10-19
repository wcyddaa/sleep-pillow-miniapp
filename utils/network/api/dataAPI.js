/**
 * 数据查询接口：由后端 `GET /api/v1/sleep` 记录实时聚合出贝壳/概览/历史
 * （云后端暂无专用聚合接口，见交付文档「待实现接口」；此处临时前端聚合）
 */
const sleepAPI = require('./sleepAPI');
const http = require('../httpClient');   // ★ 趋势接口用，漏了会 ReferenceError

/** 提取单条记录的字段（含 analysis 自定义 JSON，尽量容错） */
function analyzeRec(r) {
  const a = (r && r.analysis) || {};
  const stages = a.sleep_stages || a.stages || {};
  return { r, a, stages };
}

/** 从最新记录聚合「昨晚概览」 */
function overviewFrom(list) {
  if (!list || !list.length) {
    return { score: null, duration: null, deepPct: null, snoreMinutes: null, startTime: null, endTime: null };
  }
  const rec = list[0];
  const { a, stages } = analyzeRec(rec);
  const start = new Date(rec.start_time).getTime();
  const end = new Date(rec.end_time).getTime();
  const duration = (end - start) / 3600000;
  const deepMin = (stages.deep != null ? stages.deep : (a.deep_minutes != null ? a.deep_minutes : null));
  return {
    score: rec.sleep_quality_score != null ? Math.round(rec.sleep_quality_score * 100) : null,
    duration,
    deepPct: deepMin != null && duration ? Math.round(deepMin / 60 / duration * 100) : null,
    snoreMinutes: a.snore_minutes != null ? a.snore_minutes : null,
    startTime: rec.start_time,
    endTime: rec.end_time,
    apneaRisk: rec.apnea_risk
  };
}

module.exports = {
  getSleepOverview() {
    return sleepAPI.list(20, 0).then(overviewFrom);
  },

  /**
   * 睡眠看板数据：直接走 /sleep/trend/dashboard（trend_graph 算的）
   *   入参：deviceId
   *   返回：{ last_night, avg_score, avg_duration_min, avg_deep_pct, insight, score_trend, ... }
   */
  getTrendDashboard(deviceId, days) {
    if (!deviceId) return Promise.resolve(null);
    return http.get('/sleep/trend/dashboard', { device_id: deviceId, days: days || 7 })
      .catch(() => null);
  },

  /**
   * 长期趋势：最近 N 天每日一行
   */
  getTrendWeekly(deviceId, days) {
    if (!deviceId) return Promise.resolve({ days: days || 7, items: [] });
    return http.get('/sleep/trend/weekly', { device_id: deviceId, days: days || 7 })
      .catch(() => ({ days: days || 7, items: [] }));
  },

  getDashboard() {
    return sleepAPI.list(100, 0).then((list) => {
      const recs = list || [];
      const o = overviewFrom(recs);
      // 按天统计最近 7/30 天评分与时长
      const week = trends(recs.slice(0, 7));
      const duration = trends(recs.slice(0, 7), (r) => {
        if (!r.start_time) return 0;
        return (new Date(r.end_time).getTime() - new Date(r.start_time).getTime()) / 3600000;
      });
      const latest = recs.length ? analyzeRec(recs[0]) : analyzeRec({});
      const stagesDist = stageDist(latest.stages);
      return {
        stats: {
          score: o.score != null ? o.score : 0,
          avgDuration: o.duration != null ? o.duration : 0,
          deepPct: o.deepPct != null ? o.deepPct : 0,
          snoreMinutes: o.snoreMinutes != null ? o.snoreMinutes : 0
        },
        weekly: { categories: week.cats, data: week.vals },
        duration: { categories: duration.cats, data: duration.vals },
        stagesDist,
        hr: genSeries('heartRate'),
        breath: genSeries('breathRate')
      };
    });
  },

  getHistory(metric, range) {
    return sleepAPI.list(100, 0).then((list) => {
      const recs = list || [];
      const t = trends(recs.slice(0, range === 'month' ? 30 : 7), (r) => {
        if (metric === 'score') return r.sleep_quality_score != null ? Math.round(r.sleep_quality_score * 100) : null;
        if (metric === 'duration') return r.end_time ? (new Date(r.end_time).getTime() - new Date(r.start_time).getTime()) / 3600000 : null;
        const a = (r && r.analysis) || {};
        if (metric === 'deepPct') {
          const d = a.deep_minutes;
          return d != null && r.end_time ? Math.round(d / ((new Date(r.end_time).getTime() - new Date(r.start_time).getTime()) / 3600000) / 60 * 100) : null;
        }
        if (metric === 'snore') return a.snore_minutes;
        return r.sleep_quality_score;
      });
      const map = {
        score: { label: '睡眠评分', unit: '分', digits: 0, color: '#6A5CFF' },
        duration: { label: '睡眠时长', unit: '小时', digits: 1, color: '#3D7EFF' },
        deepPct: { label: '深睡占比', unit: '%', digits: 0, color: '#10B981' },
        snore: { label: '鼾声指数', unit: '', digits: 0, color: '#F59E0B' }
      };
      const def = map[metric] || map.score;
      return Object.assign({ categories: t.cats, data: t.vals }, def);
    });
  },

  exportData(deviceId, metric, range) {
    // 云后端文件导出接口待实现（见交付文档）
    return Promise.reject(new Error('数据导出接口待实现'));
  }
};

/** 按天聚合（返回最近 categories + values），未打点日期以 null 占位 */
function trends(recs, fn) {
  const map = {};
  recs.forEach((r) => {
    if (!r.start_time) return;
    const day = new Date(r.start_time).toISOString().slice(0, 10);
    if (map[day] == null) map[day] = fn ? fn(r) : (r.sleep_quality_score != null ? Math.round(r.sleep_quality_score * 100) : null);
  });
  const keys = Object.keys(map).slice(-7);
  return { cats: keys, vals: keys.map((k) => map[k]) };
}

function stageDist(stages) {
  const defColor = { deep: '#10B981', light: '#3D7EFF', rem: '#A855F7', awake: '#9CA3AF' };
  const items = [
    ['深睡', stages.deep], ['浅睡', stages.light != null ? stages.light : stages.shallow],
    ['REM', stages.rem], ['清醒', stages.awake]
  ];
  return items
    .filter(([, v]) => v != null)
    .map(([name, v], i) => ({ name, minutes: v, color: defColor[[['深睡', 'deep'], ['浅睡', 'light'], ['REM', 'rem'], ['清醒', 'awake']][i][1]] }));
}

/** 空心率/呼吸曲线（后端分析未含逐夜序列时填充空数组让图表平稳降级） */
function genSeries(key) {
  const cats = [];
  const data = [];
  return { categories: cats, data };
}