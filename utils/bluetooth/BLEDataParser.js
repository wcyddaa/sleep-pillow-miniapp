/**
 * BLE 数据解码（sleeppillow ESP32 睡眠枕协议）
 * 固件 TX 通知特征下发 UTF-8 JSON 文本：
 *   {"evt":"wifi","ok":true/false,"ssid":"..."}
 *   {"evt":"ctrl","sampling":true/false}
 *   {"evt":"cfg","snore":0,"stage":1,"bcg":2}         // 响应 0x04 / 0x05
 *   {"evt":"cfg_ok"}                                  // 0x05 写入成功
 *   {"evt":"rt","hr":65,"rr":15,"motion":0,"snore":3,"stage":1}  // 实时帧，固件每秒推
 *   {"evt":"error","msg":"..."}
 */
const appConfig = require('../../config/appConfig');
const crypto = require('../crypto/aesgcm');

const { bleCmd } = appConfig;

/** ArrayBuffer -> 普通数组 */
function ab2arr(buf) {
  return Array.prototype.slice.call(new Uint8Array(buf));
}

/** UTF-8 字节数组 -> 字符串 */
function bytes2str(arr) {
  return crypto.utf8Decode(arr);
}

/** 解析设备 JSON 通知；无效 JSON 返回 null */
function decodeNotify(bytes) {
  if (!bytes || !bytes.length) return { evt: 'empty' };
  const text = bytes2str(bytes);
  let obj = null;
  try { obj = JSON.parse(text); } catch (e) { return { evt: 'raw', raw: text }; }
  if (!obj || typeof obj !== 'object') return { evt: 'raw', raw: text };
  return obj;
}

/** 组 sleeppillow 采集开关指令：[0x02][0x01|0x00]（旧接口，保留给通用 BLE 调试 App） */
function buildSamplingCmd(enable) {
  return new Uint8Array([bleCmd.SAMPLING, enable ? 0x01 : 0x00]).buffer;
}

/** 组读三开关指令：[0x04] */
function buildGetCfgCmd() {
  return new Uint8Array([bleCmd.GET_CFG]).buffer;
}

/**
 * 组写三开关指令：[0x05][JSON UTF-8]
 * @param {{snore:number, stage:number, bcg:number}} cfg 各 0=OFF / 1=SIM / 2=REAL
 */
function buildSetCfgCmd(cfg) {
  const json = JSON.stringify({
    snore: Number(cfg && cfg.snore) || 0,
    stage: Number(cfg && cfg.stage) || 0,
    bcg: Number(cfg && cfg.bcg) || 0
  });
  const bytes = crypto.utf8Encode(json);
  const out = new Uint8Array(1 + bytes.length);
  out[0] = bleCmd.SET_CFG;
  out.set(bytes, 1);
  return out.buffer;
}

/** 组 sleeppillow Wi-Fi 凭据指令：[0x01][IV12][密文][TAG16] */
function buildWifiCmd(ssid, password) {
  return crypto.buildWifiCredPacket(ssid, password).buffer;
}

/**
 * TX 通知字节流累积解析器：处理半包/粘包。
 * 每次 notify 追加字节，尝试从中提取一条完整 JSON（逐字节找闭合符 '}'/']'，
 * 找到则把 buf[0..end] 解码并 parse），解析成功回调并仅清除已消费部分。
 * 注意 '}'=0x7D 不会出现在多字节 UTF-8 的延续字节中，字节级切片安全。
 */
function createNotifyParser(onParse) {
  let buf = [];
  const MAX = appConfig.ble.txBufferMax;
  // 容错取 JSON：跳过开头非 JSON 垃圾（如固件先 notify 的 device_id 纯字符串），
  // 从第一个 '{' 起、到其后第一个能成功 parse 的 '}' 为止，取出一条对象。
  function extract(bytes) {
    for (let start = 0; start < bytes.length; start++) {
      if (bytes[start] !== 0x7b) continue; // '{'
      for (let end = start + 1; end < bytes.length; end++) {
        if (bytes[end] !== 0x7d) continue; // '}'
        try {
          const obj = JSON.parse(bytes2str(bytes.slice(start, end + 1)));
          if (obj && typeof obj === 'object') {
            return { obj, rest: bytes.slice(end + 1) };
          }
        } catch (e) { /* 尝试更远的 '}' */ }
      }
    }
    return null;
  }
  return {
    feed(arrayBuf) {
      buf = buf.concat(ab2arr(arrayBuf));
      if (buf.length > MAX) buf = [];
      let res = extract(buf);
      while (res) {
        onParse(res.obj);
        buf = res.rest;
        res = buf.length ? extract(buf) : null;
      }
    }
  };
}

module.exports = {
  ab2arr,
  bytes2str,
  decodeNotify,
  buildSamplingCmd,
  buildGetCfgCmd,
  buildSetCfgCmd,
  buildWifiCmd,
  createNotifyParser
};