# 智眠 · AI 睡眠监测小程序用户端（miniprogram-user）

面向 **ESP32-S3 + INMP441 麦克风 + 毫米波雷达** 睡眠监测系统的微信小程序用户端。

数据链路：**端侧采集（鼾声/心率/呼吸/在床/翻身）→ 预处理（降噪/ADC/FFT）→ JSON 上云 → 云端 CNN 结构化（原始 JSON 与输出 JSON 双存档，供再训练）→ 本前端展示；报告文字由 LLM（SleepLLM-v2，蒸馏小模型 + RAG）生成**。

**零 npm 依赖、全量 Mock 数据，导入微信开发者工具即可直接运行预览。**

## 核心设计

- **动态数据渲染**：展示哪些指标完全由云端下发的 `device.channels`（数据通道定义）决定——仅雷达机型显示心率/呼吸/在床/翻身，带麦克风机型额外显示鼾声指数/环境噪声。新增设备能力无需改前端，见 `utils/common/schema.js`
- **蓝牙不限型号**：扫描全部 BLE 设备（含未命名设备），连接后动态枚举服务与特征（跳过 GATT 通用服务），自动选择可写/可通知特征作为配网通道，不依赖固定名称前缀或固定 UUID
- **配网由前端完成**：蓝牙通道下发 Wi-Fi 凭据（AA55 帧协议）→ 设备联网 → 云端注册，四步可视化进度
- **原始/结构化 JSON 双查看**：睡眠报告页与设备详情页可查看设备原始上传帧（含 FFT 频带能量、雷达距离仓）与云端结构化输出，数据均存档用于模型再训练

## 页面结构

| 页面 | 路径 | 说明 |
|---|---|---|
| 首页 | `pages/tabBar/home` | 昨晚睡眠概览卡（评分/时长/深睡/鼾声）+ 应用宫格 + 设备卡片（通道驱动） |
| 消息中心 | `pages/tabBar/message` | 鼾声超标/心率异常/离床过久等告警，类型筛选、未读角标 |
| 我的 | `pages/tabBar/profile` | 账号、设备统计、鼾声/离床提醒开关 |
| 添加设备 | `.../device/pages/connect` | 通用蓝牙扫描 → 动态服务发现 → Wi-Fi 配网 → 注册 |
| 实时监测 | `.../device/pages/control` | 心率大字 + 通道网格 + 在床状态，控制上传间隔/雷达灵敏度/麦克风灵敏度/鼾声告警，数据链路可视化 |
| 设备详情 | `.../device/pages/detail` | 硬件能力、数据链路、原始数据帧查看、运行日志、重启/解绑 |
| 睡眠看板 | `.../data/pages/dashboard` | 近7晚评分/时长、分期分布、夜间心率/呼吸曲线 |
| 长期趋势 | `.../data/pages/history` | 睡眠评分/时长/深睡占比/鼾声指数 × 近7晚/30晚，CSV 导出 |
| AI 睡眠分析 | `.../ai/pages/analysis` | 四阶段分析动画 → 睡眠结构/呼吸质量/鼾声情况/心率变异维度评分 + 问题 + 建议 |
| 睡眠报告 | `.../ai/pages/report/report` | 评分环、**睡眠分期阶梯图**、夜间曲线、鼾声事件条、LLM 报告全文、原始/结构化 JSON 切换、分享 |

## 技术要点

- **分包加载**：device/data/ai 三分包 + `preloadRule`，主包入口（`app.js`）显式预注册分包所需的全部公共模块
- **状态管理**：`utils/store` 自研轻量响应式 Store，`bindStore` 自动 diff-setData
- **实时通道**：`mqttClient`（Mock 下每 5s 随机游走推送）→ deviceStore + eventBus → 页面自动刷新
- **图表组件**：`components/chart` Canvas 2D 自绘 line / bar / **stage（睡眠分期阶梯图）**，DPR 适配
- **图标资源**：`tools/gen-icons.js` 程序化绘制（心/呼吸波/鼾声/翻身/在床/新月等），改字形后重跑

## 与云端/固件的对接约定

- **channels 下发**：`GET /device/list` 返回的每个设备带 `channels: [{key,label,unit,kind,color,min,max,digits,onText,offText,icon}]`，前端仅按此渲染
- **实时数据**：MQTT 主题 `iot/device/{id}/data`，payload 为 `{key: value}` 键值对（key 与 channels 对齐）
- **睡眠报告**：`GET /ai/report` 返回分期序列（编码 0清醒/1REM/2浅睡/3深睡）、夜间曲线、鼾声事件、LLM 文本、`raw`（设备原始帧）与 `structured`（CNN 结构化输出）
- **配网协议**：`[AA 55][CMD][LEN][PAYLOAD][SUM]`，CMD 0x10/0x11/0x12 下发 SSID/密码/提交，0x90 ACK

## 开发与校验

```bash
node tools/gen-icons.js      # 重新生成全部图标 PNG
node tools/check.js          # 静态校验：JS 语法 / JSON / 页面四件套 / 组件引用 / 图片路径 / WXML 括号
node tools/check-runtime.js  # 运行时冒烟：stub wx 加载全部模块 + 模拟 Page/Component 生命周期执行
```

## 接入真实后端

1. `config/envConfig.js` → `env: 'prod'`，`useMock: false`
2. `config/apiConfig.js` → 填入真实 `baseURL` 与 MQTT Broker（`wxs://` WebSocket）
3. `utils/network/mqttClient.js` → `connectReal()` 按 Broker 规范补齐 SUBSCRIBE 报文（或引入 mqtt.js 小程序构建版）
4. API 模块移除 mock 参数后自动走 `wx.request`
