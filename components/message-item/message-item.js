// 消息列表项：类型图标 + 标题 + 摘要 + 相对时间
const { MESSAGE_TYPES } = require('../../utils/common/constants');
const formatter = require('../../utils/common/formatter');

Component({
  properties: {
    message: {
      type: Object,
      value: {},
      observer(m) { this.apply(m); }
    }
  },
  data: {
    icon: '✦',
    iconBg: '#EAF1FF',
    iconColor: '#3D7EFF',
    timeText: ''
  },
  lifetimes: {
    attached() { this.apply(this.data.message); }
  },
  methods: {
    apply(m) {
      if (!m || !m.id) return;
      const def = MESSAGE_TYPES[m.type] || MESSAGE_TYPES.system;
      this.setData({
        icon: def.icon,
        iconBg: def.bg,
        iconColor: def.color,
        timeText: formatter.formatTime(m.createdAt || m.time)
      });
    },
    onTap() {
      this.triggerEvent('enter', { message: this.data.message });
    }
  }
});
