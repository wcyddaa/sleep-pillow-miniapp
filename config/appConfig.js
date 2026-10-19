/**
 * 应用配置：sleeppillow ESP32 睡眠枕 BLE 协议（固定 UUID + AES-128-GCM 配网）
 * 对齐固件 components/network/ble_provision.{h,cc}
 */
const appConfig = {
  ble: {
    showUnnamed: true,          // 扫描结果包含未命名设备
    skipServicePrefixes: ['1800', '1801', '180A'], // GATT 通用服务，选特征时跳过
    mtu: 256,                    // 请求协商的 MTU（Android setBLEMTU(256)；iOS 自动）
    connectTimeout: 8000,
    scanDuration: 12000,
    // sleeppillow 固定 GATT 通道（Nordic UART 风格）
    serviceUUID: '6E400001-B5A3-F393-E0A9-E50E24DCCA9E'.toLowerCase(),
    writeCharUUID: '6E400002-B5A3-F393-E0A9-E50E24DCCA9E'.toLowerCase(),  // 手机->设备(W)
    notifyCharUUID: '6E400003-B5A3-F393-E0A9-E50E24DCCA9E'.toLowerCase(), // 设备->手机(N)
    deviceIdCharUUID: '6E400004-B5A3-F393-E0A9-E50E24DCCA9E'.toLowerCase(),// 设备身份ID(R)
    txBufferMax: 4096,           // TX 累积缓冲上限，防异常设备撑爆内存
    deviceName: 'SleepPillow'
  },

  // sleeppillow BLE 二进制命令（RX 载荷首字节）
  bleCmd: {
    WIFI_CRED: 0x01,        // [0x01][IV12][AES-GCM 密文][TAG16]
    SAMPLING: 0x02,         // [0x02][0x01=start | 0x00=stop]（旧采集开关，保留给通用 BLE 调试 App）
    GET_CFG: 0x04,          // [0x04]                   读三开关配置 → 设备回 {"evt":"cfg",...}
    SET_CFG: 0x05           // [0x05][JSON UTF-8]       写三开关配置 → 设备回 {"evt":"cfg_ok"}
  },

  // AES-128-GCM 配网密钥（与固件 kPsk 一致）
  psk: 'SleepPillow-2026',

  // 结构化数据窗口：固件端 EdgeAggregator 固定 30s 一帧，小程序不参与上报
  report: {
    windowMs: 30000
  },

  scan: {
    // 配网等待设备联网超时。
    // 固件侧 WifiManager::Connect 现在是「先等关联(≤15s) 再等 DHCP 拿 IP(≤20s)」，
    // 之后还要 NTP 同步 + 建 MQTT，所以这里必须给够，否则会误报"配网超时"。
    wifiTimeout: 45000
  }
};

module.exports = appConfig;