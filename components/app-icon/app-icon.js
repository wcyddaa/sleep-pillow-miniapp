// 首页应用图标：图标 + 名称，点击派发 tapapp 事件
Component({
  properties: {
    icon: { type: String, value: '' },
    label: { type: String, value: '' },
    badge: { type: null, value: '' }
  },
  methods: {
    onTap() {
      this.triggerEvent('tapapp', { label: this.data.label });
    }
  }
});
