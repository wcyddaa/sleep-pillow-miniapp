// DPR 获取（canvas 物理像素适配）
function getDpr() {
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return Math.min(info.pixelRatio || 2, 3);
  } catch (e) {
    return 2;
  }
}

module.exports = { getDpr };
