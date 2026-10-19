// 加载动画：全屏遮罩模式 / 行内模式
Component({
  options: { multipleSlots: false },
  properties: {
    full: { type: Boolean, value: false },   // 全屏遮罩
    text: { type: String, value: '加载中...' }
  }
});
