/**
 * 睡眠数据接口（对齐睡眠分析云后端 /api/v1/sleep、/reports、/chat）
 * - ingest：小程序把蓝牙直连采集/解析到的结构化睡眠数据上报云端（前端作为发布者）
 * - 载荷字段严格对应后端 SleepDataIngest：{device_id,start_time,end_time,vital_signs,audio_segments}
 */
const http = require('../httpClient');

/**
 * 上报结构化睡眠数据
 * @param {object} data { device_id, start_time, end_time, vital_signs[], audio_segments[] }
 */
function ingest(data) {
  return http.post('/sleep/ingest', {
    device_id: data.device_id,
    start_time: data.start_time,
    end_time: data.end_time,
    vital_signs: data.vital_signs || [],
    audio_segments: data.audio_segments || []
  });
}

/** 睡眠记录列表（分页，按开始时间倒序） */
function list(limit, offset) {
  return http.get('/sleep', { limit: limit || 20, offset: offset || 0 });
}

/** 单条记录（含 analysis / report） */
function get(recordId) {
  return http.get('/sleep/' + recordId);
}

/** 触发分析 */
function analyze(recordId) {
  return http.post('/sleep/' + recordId + '/analyze');
}

/** 生成报告：style: detailed | summary | pediatric */
function generateReport(recordId, style) {
  return http.post('/reports/generate', { sleep_record_id: recordId, style: style || 'detailed' });
}

/** AI 对话（可绑定某条记录） */
function chat(message, history, sleepRecordId) {
  return http.post('/chat', {
    message,
    history: (history || []).map((m) => ({ role: m.role, content: m.content })),
    sleep_record_id: sleepRecordId || null
  });
}

module.exports = { ingest, list, get, analyze, generateReport, chat };