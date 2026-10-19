/**
 * Mock 数据源：AI 睡眠监测
 * 数据链路：ESP32-S3(麦克风+毫米波雷达) -> 预处理(降噪/FFT) -> 云端 CNN 结构化 -> 本前端
 * channels 为云端下发的数据通道定义 —— 设备能力不同，通道不同，前端据此动态渲染
 */
const now = () => Date.now();
const rnd = (min, max) => min + Math.random() * (max - min);
const round = (v, d) => Number(Number(v).toFixed(d || 0));

/* ---------------- 数据通道定义（与云端下发一致） ---------------- */
const CH = {
  heartRate: { key: 'heartRate', label: '心率', unit: 'bpm', color: '#F0506E', min: 40, max: 130, base: 62, digits: 0, icon: 'icon-heart' },
  breathRate: { key: 'breathRate', label: '呼吸频率', unit: '次/分', color: '#3D7EFF', min: 8, max: 30, base: 15, digits: 0, icon: 'icon-breath' },
  snoreIndex: { key: 'snoreIndex', label: '鼾声指数', unit: '', color: '#F59E0B', min: 0, max: 100, base: 12, digits: 0, icon: 'icon-snore' },
  ambientNoise: { key: 'ambientNoise', label: '环境噪声', unit: 'dB', color: '#06B6D4', min: 25, max: 75, base: 34, digits: 0, icon: 'icon-snore' },
  turnCount: { key: 'turnCount', label: '翻身次数', unit: '次', color: '#8B5CF6', min: 0, max: 40, base: 8, digits: 0, icon: 'icon-turn' },
  inBed: { key: 'inBed', label: '在床状态', kind: 'state', color: '#10B981', icon: 'icon-bed', onText: '在床', offText: '离床' },
  onlineDevices: { key: 'onlineDevices', label: '在线节点', unit: '台', color: '#10B981', min: 0, max: 10, base: 2, digits: 0, icon: 'icon-gateway' }
};

const channelsFull = [CH.heartRate, CH.breathRate, CH.snoreIndex, CH.ambientNoise, CH.turnCount, CH.inBed];
const channelsRadar = [CH.heartRate, CH.breathRate, CH.turnCount, CH.inBed];
const channelsGateway = [CH.onlineDevices];

function buildMetrics(chs, override) {
  const m = {};
  chs.forEach((c) => {
    m[c.key] = c.kind === 'state' ? 1 : round(c.base + rnd(-c.base * 0.08, c.base * 0.08), c.digits);
  });
  return Object.assign(m, override || {});
}

/* ---------------- 设备（不同能力组合 -> 不同通道） ---------------- */
const mockDevices = [
  {
    id: 'dev_001', name: '卧室睡眠监测仪', model: 'ESP32-S3', type: 'sleep_monitor',
    sn: 'SLP2025A3001', mac: '5C:02:14:88:3A:01', firmware: 'v2.3.0',
    status: 'online', battery: null, rssi: -52, location: '主卧', boundAt: '2025-06-01', lastSeen: now() - 12 * 1000,
    capabilities: ['毫米波雷达 · 心率/呼吸/体动', 'INMP441 麦克风 · 鼾声识别', 'Wi-Fi 2.4G 上云', 'BLE 5.0 配网'],
    channels: channelsFull,
    metrics: buildMetrics(channelsFull, { heartRate: 62, breathRate: 15, snoreIndex: 12, ambientNoise: 34, turnCount: 8 }),
  },
  {
    id: 'dev_002', name: '儿童房监护雷达', model: 'ESP32-S3-R', type: 'sleep_monitor',
    sn: 'SLP2025B7002', mac: '5C:02:14:88:3A:02', firmware: 'v2.1.8',
    status: 'online', battery: null, rssi: -61, location: '儿童房', boundAt: '2025-06-20', lastSeen: now() - 25 * 1000,
    capabilities: ['毫米波雷达 · 心率/呼吸/体动', 'Wi-Fi 2.4G 上云', 'BLE 5.0 配网'],
    channels: channelsRadar,
    metrics: buildMetrics(channelsRadar, { heartRate: 78, breathRate: 19, turnCount: 12 }),
  },
  {
    id: 'dev_003', name: '客厅睡眠网关', model: 'GW-1', type: 'gateway',
    sn: 'GW2025011003', mac: '5C:02:14:88:3A:03', firmware: 'v1.8.0',
    status: 'online', battery: null, rssi: -40, location: '客厅', boundAt: '2025-02-15', lastSeen: now() - 8 * 1000,
    capabilities: ['多设备接入', '本地边缘计算', 'Wi-Fi 上云'],
    channels: channelsGateway,
    metrics: buildMetrics(channelsGateway, { onlineDevices: 2 }),
  },
  {
    id: 'dev_004', name: '独居监护终端', model: 'ESP32-S3', type: 'sleep_monitor',
    sn: 'SLP20250404S2', mac: '5C:02:14:88:3A:04', firmware: 'v2.2.1',
    status: 'alert', battery: null, rssi: -74, location: '次卧', boundAt: '2025-07-02', lastSeen: now() - 60 * 1000,
    capabilities: ['毫米波雷达 · 心率/呼吸/体动', 'INMP441 麦克风 · 鼾声识别', '异常上报告警'],
    channels: channelsFull,
    metrics: buildMetrics(channelsFull, { heartRate: 91, breathRate: 24, snoreIndex: 78, ambientNoise: 61, turnCount: 21 }),
  },
  {
    id: 'dev_005', name: '旧款记录仪', model: 'ESP32-S2', type: 'sleep_monitor',
    sn: 'SLP20250520T9', mac: '5C:02:14:88:3A:05', firmware: 'v1.9.2',
    status: 'offline', battery: null, rssi: 0, location: '阳台', boundAt: '2025-08-11', lastSeen: now() - 26 * 3600 * 1000,
    capabilities: ['毫米波雷达（旧版）'],
    channels: channelsRadar,
    metrics: { heartRate: null, breathRate: null, turnCount: null, inBed: 0 },
  }
];

/* ---------------- 消息 ---------------- */
const mockMessages = [
  { id: 'msg_01', type: 'alert', title: '鼾声超标提醒', content: '独居监护终端检测到持续鼾声，鼾声指数 78（重度），累计 42 分钟，已上传云端并标记待分析片段。', time: now() - 5 * 60 * 1000, read: false },
  { id: 'msg_02', type: 'alert', title: '心率异常波动', content: '卧室睡眠监测仪心率 91bpm，高于您睡眠期基线 45%，雷达波形已同步云端复核。', time: now() - 42 * 60 * 1000, read: false },
  { id: 'msg_03', type: 'device', title: 'CNN 模型已更新', content: '鼾声识别模型 snore-cnn v2.4 已部署，本周新增训练样本 1.2 万条（含您贡献的标注数据）。', time: now() - 3 * 3600 * 1000, read: false },
  { id: 'msg_04', type: 'system', title: '昨晚睡眠报告已生成', content: '昨晚睡眠评分 86 分（良好），AI 报告已生成，点击查看分期与鼾声分析。', time: now() - 8 * 3600 * 1000, read: true },
  { id: 'msg_05', type: 'device', title: '设备离线通知', content: '旧款记录仪已超过 24 小时未上报数据，请检查电源或 Wi-Fi。', time: now() - 26 * 3600 * 1000, read: true },
  { id: 'msg_06', type: 'alert', title: '夜间离床过久', content: '凌晨 03:24 检测到离床 28 分钟，超出常规范围，如需可开启离床提醒策略。', time: now() - 30 * 3600 * 1000, read: true },
  { id: 'msg_07', type: 'system', title: '数据贡献感谢', content: '感谢您开启「数据用于模型训练」，您的 7 段鼾声样本已脱敏入库，帮助模型继续提升准确率。', time: now() - 2 * 86400 * 1000, read: true },
  { id: 'msg_08', type: 'device', title: '配网成功', content: '新设备「儿童房监护雷达」已完成蓝牙配网并成功接入云端。', time: now() - 3 * 86400 * 1000, read: true }
];

/* ---------------- 实时数据（按设备通道随机游走） ---------------- */
function genRealtime(device) {
  const out = {};
  (device.channels || []).forEach((c) => {
    const cur = device.metrics ? device.metrics[c.key] : c.base;
    if (c.kind === 'state') {
      // 在床状态基本稳定，小概率短暂离床
      if (Math.random() < 0.03) out[c.key] = cur ? 0 : 1;
      else out[c.key] = cur;
      return;
    }
    let v = (cur === null || cur === undefined ? c.base : cur) + rnd(-(c.max - c.min) * 0.02, (c.max - c.min) * 0.02);
    if (device.status === 'alert' && c.key === 'snoreIndex') v = Math.max(v, 70);
    out[c.key] = round(Math.max(c.min, Math.min(c.max, v)), c.digits);
  });
  return out;
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/* ---------------- 昨晚睡眠 ---------------- */
const mockSleepOverview = () => ({
  score: 86,
  level: '良好',
  durationMin: 462,            // 7h42m
  deepPct: 28,
  remPct: 22,
  awakeCount: 2,
  asleepAt: '23:12',
  wakeupAt: '06:54',
  snoreMinutes: 18,
  avgHeartRate: 58,
  avgBreathRate: 15,
  date: '昨晚'
});

/** 睡眠分期序列：23:00-07:00，10 分钟粒度 -> 阶梯图 */
function genNightStages() {
  const stages = [];
  const categories = [];
  let h = 23, m = 0;
  const cycle = [2, 3, 3, 2, 1, 1, 2, 3, 2, 1];
  for (let i = 0; i < 48; i++) {
    let code;
    if (i < 2) code = 0;                       // 入睡潜伏期
    else if (i === 20 || i === 21) code = 0;   // 夜间短暂清醒
    else if (i >= 45) code = Math.random() < 0.4 ? 0 : 1;  // 晨间 REM/清醒
    else code = cycle[(i - 2) % cycle.length];
    if (h >= 3 && h < 5 && code === 3) code = Math.random() < 0.5 ? 3 : 2;
    stages.push(code);
    categories.push(pad2(h) + ':' + pad2(m));
    m += 10;
    if (m >= 60) { m = 0; h = (h + 1) % 24; }
  }
  return { categories, data: stages };
}

/** 夜间曲线：key = heartRate / breathRate */
function genNightSeries(key) {
  const def = key === 'heartRate' ? CH.heartRate : CH.breathRate;
  const cats = [];
  const data = [];
  let h = 23, m = 0;
  let v = def.base;
  for (let i = 0; i < 24; i++) {
    cats.push(pad2(h) + ':' + pad2(m));
    v += rnd(-def.base * 0.09, def.base * 0.09);
    if (h >= 1 && h <= 4) v -= 2;              // 深睡期下降
    v = Math.max(def.min + 5, Math.min(def.max - 10, v));
    data.push(round(v, def.digits));
    m += 20;
    if (m >= 60) { m = 0; h = (h + 1) % 24; }
  }
  return { categories: cats, data };
}

/* ---------------- 近 N 晚趋势 ---------------- */
function genWeekly(range) {
  const n = range === 'month' ? 30 : 7;
  const categories = [];
  const scores = [];
  const durations = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(d.getTime() - i * 86400 * 1000);
    categories.push(pad2(day.getMonth() + 1) + '-' + pad2(day.getDate()));
    scores.push(Math.round(rnd(72, 93)));
    durations.push(round(rnd(6.2, 8.6), 1));
  }
  return { categories, scores, durations };
}

/* ---------------- 睡眠报告（云端 CNN 结构化 + LLM 生成） ---------------- */
const mockSleepReport = (deviceId) => {
  const stages = genNightStages();
  const hr = genNightSeries('heartRate');
  const breath = genNightSeries('breathRate');
  return {
    id: 'rpt_' + (deviceId || 'demo'),
    deviceName: '卧室睡眠监测仪',
    score: 86,
    level: '良好',
    analyzedAt: now() - 2 * 3600 * 1000,
    model: 'SleepLLM-v2（蒸馏小模型 + RAG）',
    cnnModel: 'sleep-cnn v2.4',
    duration: { totalMin: 462, lightMin: 186, deepMin: 129, remMin: 102, awakeMin: 45, asleepAt: '23:12', wakeupAt: '06:54' },
    stages,
    hr,
    breath,
    snore: {
      count: 23,
      minutes: 18,
      peakDb: 52,
      index: 12,
      events: [
        { time: '00:12', db: 46, durSec: 85 },
        { time: '01:47', db: 52, durSec: 132 },
        { time: '03:24', db: 44, durSec: 61 },
        { time: '05:02', db: 49, durSec: 118 }
      ]
    },
    summary: '综合 7 小时 42 分钟的雷达与声学数据分析：昨晚睡眠结构完整，深睡占比 28% 处于理想区间。凌晨 01:47 出现一段持续 2 分钟的重度鼾声（峰值 52dB），伴随心率小幅上升；整夜心率均值 58bpm，呼吸平稳无暂停事件。整体睡眠质量良好，建议保持当前作息。',
    sections: [
      {
        title: '睡眠结构分析',
        body: '入睡潜伏期 12 分钟，早于您 80% 的历史记录。全夜完成 4 个完整睡眠周期，深睡集中在前半夜（符合生理节律），REM 睡眠占比 22%，主要分布在后半夜。夜醒 2 次，累计清醒 45 分钟，其中凌晨 03:24 离床 8 分钟。'
      },
      {
        title: '鼾声与呼吸',
        body: 'CNN 鼾声识别模型共检出 23 段鼾声事件，累计 18 分钟，以轻度为主；01:47 一次达重度（52dB），该时段环境噪声仅 31dB，可排除环境干扰。呼吸频率整夜稳定在 13-17 次/分，未检出呼吸暂停特征模式。'
      },
      {
        title: '心率与体动',
        body: '夜间心率均值 58bpm，深睡期最低 51bpm，REM 期波动至 66bpm，HRV 趋势正常。翻身 8 次，频率合理；离床事件 1 次，时长 8 分钟，返床后 6 分钟内重新入睡。'
      },
      {
        title: '改善建议（AI 生成）',
        body: '1. 昨晚 22:40 后的环境噪声从 28dB 升至 36dB，与入睡潜伏期偏长相关，建议保持卧室安静或开启白噪音；2. 鼾声峰值出现在仰卧时段（雷达体位判定），可尝试侧卧睡眠；3. 近 7 晚深睡占比呈上升趋势，当前作息有效，建议维持。'
      }
    ],
    // 原始 JSON：设备（ESP32-S3）预处理后上传的原始帧样例
    raw: {
      device: 'ESP32-S3', sn: 'SLP2025A3001', fw: 'v2.3.0', ts: 1757460000000,
      mic: { chip: 'INMP441', sample_rate: 16000, window_ms: 2000, fft_bins: 64, snore_prob: 0.87, ambient_db: 31.2, band_energy: [12, 48, 210, 88, 31, 9, 3, 1] },
      radar: { chip: 'mmWave-60G', heart_bpm: 61, breath_rate: 15, in_bed: true, turn_count: 8, range_bins: [0.2, 0.9, 1.4, 0.6, 0.3], phase_jitter: 0.031 },
      env: { rssi: -52, temperature: 26.1, humidity: 55 }
    },
    // 结构化 JSON：云端 CNN/AI 处理后的输出（供前端与再训练）
    structured: {
      session_id: 'slp_20250909_001', device_sn: 'SLP2025A3001',
      sleep: { score: 86, level: '良好', total_min: 462, deep_pct: 0.28, rem_pct: 0.22, awake_count: 2, efficiency: 0.91 },
      snore: { events: 23, total_min: 18, peak_db: 52, max_level: 'moderate' },
      vital: { hr_avg: 58, hr_min: 51, hr_max: 66, rr_avg: 15, apnea_risk: 'low' },
      labels_for_training: ['light_186', 'deep_129', 'rem_102', 'snore_moderate']
    }
  };
};

/* ---------------- AI 睡眠分析 ---------------- */
const mockAnalysisResult = (deviceId) => ({
  reportId: 'rpt_' + Date.now(),
  deviceId,
  score: 86,
  level: '良好',
  dims: [
    { name: '睡眠结构', score: 88 },
    { name: '呼吸质量', score: 92 },
    { name: '鼾声情况', score: 71 },
    { name: '心率变异', score: 90 }
  ],
  issues: [
    { severity: 'warning', text: '近 7 晚检出 23 段鼾声事件，其中 1 段重度（52dB），且集中在仰卧体位。' },
    { severity: 'info', text: '凌晨 03:24 前后心率上升 12%，与一次离床事件时间吻合，属正常生理反应。' },
    { severity: 'info', text: 'REM 占比 22% 略低于同年龄段理想区间（24-26%），与近两周入睡时间推迟相关。' }
  ],
  suggestions: [
    '尝试侧卧入睡：雷达体位数据显示鼾声事件 92% 发生在仰卧时段。',
    '将入睡时间提前 20 分钟：模型预测 REM 占比可提升约 3 个百分点。',
    '保持卧室夜间噪声低于 30dB：昨晚噪声峰值时段与清醒事件强相关（R=0.71）。'
  ],
  analyzedAt: now(),
  model: 'SleepLLM-v2（蒸馏小模型 + RAG）'
});

/* ---------------- 运行日志 ---------------- */
const mockLogs = (deviceId) => ([
  { time: now() - 10 * 60 * 1000, level: 'info', content: '数据帧上传正常，间隔 30s，CNN 推理时延 86ms' },
  { time: now() - 66 * 60 * 1000, level: 'warn', content: 'Wi-Fi RSSI 降至 -78dBm，触发缓存重传机制' },
  { time: now() - 3 * 3600 * 1000, level: 'info', content: '检出鼾声事件，本地预处理耗时 42ms' },
  { time: now() - 8 * 3600 * 1000, level: 'error', content: 'MQTT 连接超时，第 2 次重连成功' },
  { time: now() - 26 * 3600 * 1000, level: 'info', content: '固件 v2.3.0 校验通过，雷达自检正常' }
]);

/* ---------------- 蓝牙扫描（不限型号） ---------------- */
const mockBleDevices = [
  { deviceId: 'ble_A4', name: 'ESP32-SLP-A4', rssi: -52, serviceNum: 3 },
  { deviceId: 'ble_B9', name: 'sleep-esl02', rssi: -63, serviceNum: 2 },
  { deviceId: 'ble_G2', name: 'SLP-GW-G1', rssi: -71, serviceNum: 4 },
  { deviceId: 'ble_77', name: '', rssi: -78, serviceNum: 1 }
];

module.exports = {
  mockDevices,
  mockMessages,
  mockSleepOverview,
  genNightStages,
  genNightSeries,
  genWeekly,
  mockSleepReport,
  mockAnalysisResult,
  mockLogs,
  genRealtime,
  mockBleDevices
};
