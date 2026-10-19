/**
 * 小程序入口：初始化窗口信息、MQTT 实时通道
 */
const envConfig = require('./config/envConfig');
const logger = require('./utils/common/logger');
const mqttClient = require('./utils/network/mqttClient');
const appStore = require('./utils/store/stores/appStore');
const messageStore = require('./utils/store/stores/messageStore');

// 主包公共模块预注册：分包页面 require 主包 utils 时模块必须已加载，
// 显式引用可确保这些文件进入主包依赖图并在启动时注册（避免被裁剪/惰性注入遗漏）
require('./utils/common/formatter');
require('./utils/common/eventBus');
require('./utils/network/api/deviceAPI');
require('./utils/network/api/userAPI');
require('./utils/network/api/dataAPI');
require('./utils/network/api/aiAPI');
require('./utils/network/api/messageAPI');
require('./utils/network/api/authAPI');
require('./utils/network/api/sleepAPI');
require('./utils/bluetooth/BLEDataParser');
require('./utils/bluetooth/BLEManager');
require('./utils/bluetooth/BLEProvisioner');

App({
  globalData: {},

  onLaunch() {
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    appStore.store.setState({ statusBarHeight: (win && win.statusBarHeight) || 24 });

    logger.info(`app launch: env=${envConfig.env}, mock=${envConfig.useMock}, version=${envConfig.version}`);

    // 消息未读角标
    messageStore.updateTabBarBadge();
    // 实时数据通道（mock 模式下为本地模拟推送）
    mqttClient.connect();
  },

  onHide() {
    logger.debug('app hide');
  }
});
