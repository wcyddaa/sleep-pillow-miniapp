// 设备卡片：展示内容完全由云端下发的 channels 通道驱动
const { DEVICE_TYPES } = require('../../utils/common/constants');
const schema = require('../../utils/common/schema');

Component({
  properties: {
    device: { type: Object, value: {} }
  },
  data: {
    icon: '',
    typeText: '',
    main: null,     // 第一个数值通道作为主指标大字展示
    subs: []        // 其余通道（不含主通道）
  },
  lifetimes: {
    attached() { this.apply(this.data.device); }
  },
  observers: {
    device(d) { this.apply(d); }
  },
  methods: {
    apply(d) {
      if (!d || !d.id) return;
      const typeDef = DEVICE_TYPES[d.type] || DEVICE_TYPES.sleep_monitor;
      // 实时区只展示心率 / 呼吸 / 鼾声状态；翻身次数作为非实时历史指标，仅在报告页/控制页「最近一天」区出现
      const realtimeKeys = ['heartRate', 'breathRate', 'snoreIndex', 'snoreState'];
      const channels = schema.normalizeChannels(d.channels)
        .filter((c) => realtimeKeys.indexOf(c.key) >= 0)
        .map((c) => {
          const v = d.metrics ? d.metrics[c.key] : null;
          return Object.assign({}, c, { value: v, text: schema.formatValue(c, v) });
        });
      const main = channels.find((c) => c.kind === 'number') || null;
      const subs = channels.filter((c) => !main || c.key !== main.key);
      this.setData({ icon: typeDef.icon, typeText: typeDef.text, main, subs });
    },
    onTap() {
      this.triggerEvent('enter', { device: this.data.device });
    }
  }
});
