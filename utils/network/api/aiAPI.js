/**
 * AI 分析接口（对齐睡眠分析云后端）
 * - analyze  -> POST /api/v1/sleep/{recordId}/analyze
 * - getReport-> GET  /api/v1/sleep/{recordId}（含 analysis + report + raw_data）
 * - getReportList -> GET /api/v1/sleep（列表）
 * - chat      -> POST /api/v1/chat
 */
const http = require('../httpClient');
const sleepAPI = require('./sleepAPI');
const formatter = require('../../common/formatter');

function num(v) {
  return (typeof v === 'number' && isFinite(v)) ? v : (v == null ? null : v);
}

/** 后端 SleepRecordOut -> 前端报告对象 */
function mapReport(r) {
  const a = r.analysis || {};
  const stages = a.sleep_stages || a.stages || {};
  const deepMin = num(stages.deep) != null ? num(stages.deep) : num(a.deep_minutes);
  const lightMin = num(stages.light) != null ? num(stages.light) : num(stages.shallow);
  const remMin = num(stages.rem);
  const awakeMin = num(stages.awake);
  const raw = r.raw_data || {};
  const st = r.start_time ? new Date(r.start_time).getTime() : null;
  const en = r.end_time ? new Date(r.end_time).getTime() : null;
  const totalSrc = (st != null && en != null) ? Math.max((en - st) / 1000 / 60, 0) : 0;
  const totalMin = totalSrc
    ? Math.round(totalSrc)
    : ([deepMin, lightMin, remMin, awakeMin].every((v) => v == null) ? null : ((deepMin || 0) + (lightMin || 0) + (remMin || 0) + (awakeMin || 0)));
  return {
    id: String(r.id),
    recordId: r.id,
    device_id: r.device_id,
    score: r.sleep_quality_score != null ? Math.round(r.sleep_quality_score * 100) : null,
    level: levelOf(r.sleep_quality_score != null ? Math.round(r.sleep_quality_score * 100) : null),
    apneaRisk: r.apnea_risk,
    avgHeartRate: r.avg_heart_rate,
    avgRespiratoryRate: r.avg_respiratory_rate,
    analysis: a,
    // 分析结果页展示字段（后端 analysis 输出，缺失时降级为空）
    dims: a.dims || [],
    issues: a.issues || [],
    suggestions: a.suggestions || [],
    // 只保留 analysis 主动给的 model 字段；不再有硬编码「CNN / 毫米波雷达 / 睡眠分析模型」默认值
    model: a.model || null,
    report: r.report || '',
    raw,
    // 「云端结构化输出」展示 analysis（模型推理结果），不再引用 raw_data（设备原始上传）
    structured: a,
    summary: (r.report || '').split('\n')[0] || '',
    sections: parseSections(r.report || ''),
    snore: num(a.snore_minutes) != null ? num(a.snore_minutes) : ((raw.audio_segments || []).filter((s) => s.snore_detected).length),
    duration: {
      totalMin,
      lightMin,
      deepMin,
      remMin,
      awakeMin,
      asleepAt: r.start_time,
      wakeupAt: r.end_time
    },
    analyzedAt: r.created_at,
    deviceName: '',
    startTime: r.start_time,
    endTime: r.end_time,
    createdAt: r.created_at
  };
}

function levelOf(score) {
  if (score == null) return null;
  if (score >= 90) return '优秀';
  if (score >= 80) return '良好';
  if (score >= 70) return '一般';
  return '较差';
}

/** 把 LLM 报告的【章节】正文切分成结构化 sections，供报告页逐章节渲染 */
function parseSections(text) {
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
}

// ============================================================
// 单帧 30s 结构化数据的 AI 分析
// ============================================================
const STAGE_LABEL = { 0: '清醒', 1: '浅睡', 2: '深睡' };
const FLAG_SNORE_OFF = 0x01;
const FLAG_STAGE_OFF = 0x02;
const FLAG_BCG_OFF = 0x04;

/** -1 / null → null（表示该通道未启用） */
function ch(v) {
  return (v === -1 || v === null || v === undefined) ? null : v;
}

/** 后端 FrameAnalysisOut -> 前端展示对象 */
function mapFrameAnalysis(payload) {
  if (!payload || !payload.frame) return null;
  const f = payload.frame || {};
  const flags = f.flags || 0;
  const st = f.window_start_ts ? f.window_start_ts * 1000 : null;
  const en = f.window_end_ts ? f.window_end_ts * 1000 : null;
  const stageVal = ch(f.stage);
  const motionVal = ch(f.motion);
  const text = payload.analysis || '';
  return {
    // 原始帧（供完整报告页展示全部字段）
    frame: f,
    analysis: text,
    sections: parseSections(text),
    generatedAt: payload.generated_at,
    generatedAtText: payload.generated_at ? formatter.formatHMS(payload.generated_at) : '--',
    // 窗口时间
    windowText: (st && en)
      ? (formatter.formatHMS(st) + ' ~ ' + formatter.formatHMS(en))
      : '--',
    // 指标（null = 未启用）
    stage: stageVal,
    stageLabel: stageVal == null ? '未启用' : (STAGE_LABEL[stageVal] || '--'),
    stageColor: stageVal === 0 ? '#F59E0B' : stageVal === 1 ? '#3D7EFF' : stageVal === 2 ? '#10B981' : '#9CA3AF',
    heartRate: ch(f.heart_rate),
    respRate: ch(f.resp_rate),
    motion: motionVal,
    motionLabel: motionVal == null ? '未启用' : (motionVal === 1 ? '体动' : '静止'),
    snoreSeconds: ch(f.snore_seconds),
    flags,
    // 通道开关（true = 该通道已开启）
    channels: {
      snore: !(flags & FLAG_SNORE_OFF),
      stage: !(flags & FLAG_STAGE_OFF),
      bcg: !(flags & FLAG_BCG_OFF)
    },
    deviceId: f.device_id,
    frameId: f.id
  };
}

// 最近一次帧分析结果：report 页免二次调 LLM
let _lastFrameAnalysis = null;

function setLastFrameAnalysis(v) { _lastFrameAnalysis = v; }
function getLastFrameAnalysis() { return _lastFrameAnalysis; }

module.exports = {
  /** 触发分析（返回分析后的记录） */
  analyze(recordId) {
    return sleepAPI.analyze(recordId).then(mapReport);
  },

  /**
   * ★ AI 分析：拉该设备最新一帧 30s 结构化数据，交后端 LLM 分析。
   * 不针对 sleep_record，不落库。
   */
  analyzeLatestFrame(deviceId) {
    return http.post('/devices/' + deviceId + '/frame/analyze')
      .then((payload) => {
        const mapped = mapFrameAnalysis(payload);
        setLastFrameAnalysis(mapped);
        return mapped;
      });
  },

  getLastFrameAnalysis,
  setLastFrameAnalysis,

  getReport(recordId) {
    return sleepAPI.get(recordId).then(mapReport);
  },

  /** 基于已分析记录生成自然语言报告（后端 /reports/generate） */
  generateReport(recordId, style) {
    return sleepAPI.generateReport(recordId, style || 'detailed').then(mapReport);
  },

  /**
   * ★ 按区间生成报告（独立智能体）
   *   入参：deviceId, startTs (秒), endTs (秒)
   *   后端：POST /reports/range
   *   返回：{ report, coverage, summary, degradation, frame_count }
   */
  generateRangeReport(deviceId, startTs, endTs) {
    return http.post('/reports/range', {
      device_id: deviceId,
      start_ts: Math.floor(startTs),
      end_ts: Math.floor(endTs)
    });
  },

  /**
   * ★ 按区间生成报告（SSE 流式版）
   *   后端：POST /reports/range/stream
   *   事件：meta → delta(多次) → done / error
   *   返回 { abort } 可用于中断
   */
  streamRangeReport(deviceId, startTs, endTs, handlers, onDone) {
    return http.stream(
      '/reports/range/stream',
      {
        device_id: deviceId,
        start_ts: Math.floor(startTs),
        end_ts: Math.floor(endTs)
      },
      {
        onEvent: handlers && handlers.onEvent,
        onError: handlers && handlers.onError,
        onComplete: onDone
      }
    );
  },

  getReportList() {
    return sleepAPI.list(50, 0).then((list) => (list || []).map((r) => ({
      id: String(r.id),
      recordId: r.id,
      deviceId: r.device_id,
      score: r.sleep_quality_score != null ? Math.round(r.sleep_quality_score * 100) : null,
      level: levelOf(r.sleep_quality_score != null ? Math.round(r.sleep_quality_score * 100) : null),
      analyzedAt: r.created_at,
      endTime: r.end_time
    })));
  },

  chat(message, history, sleepRecordId) {
    return sleepAPI.chat(message, history, sleepRecordId);
  }
};