// 设备状态徽标：online/offline/alert
const { DEVICE_STATUS } = require('../../utils/common/constants');

Component({
  properties: {
    status: {
      type: String,
      value: 'offline',
      observer(val) {
        this.update(val);
      }
    }
  },
  data: {
    text: '离线',
    color: '#9CA3AF',
    bg: '#F3F4F6'
  },
  lifetimes: {
    attached() {
      this.update(this.data.status);
    }
  },
  methods: {
    update(status) {
      const def = DEVICE_STATUS[status] || DEVICE_STATUS.offline;
      this.setData({ text: def.text, color: def.color, bg: def.bg });
    }
  }
});
