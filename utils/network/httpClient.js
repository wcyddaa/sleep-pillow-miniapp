/**
 * HTTP 请求封装：拦截器（token 注入、统一错误处理、401 自动跳登录）
 * envConfig.useMock = true 时走 utils/network/mock 本地数据
 */
const apiConfig = require('../../config/apiConfig');
const envConfig = require('../../config/envConfig');
const userStore = require('../store/stores/userStore');
const logger = require('../common/logger');

/** 防止 401 弹多次 toast / 多次 reLaunch */
let _401Redirecting = false;
function gotoLoginOnce(reason) {
  if (_401Redirecting) return;
  _401Redirecting = true;
  logger.warn('登录态失效 → reLaunch 登录页:', reason);
  userStore.logout();
  wx.showToast({ title: '登录已过期，请重新登录', icon: 'none' });
  // 延迟一下让 toast 显示出来再跳转
  setTimeout(() => {
    wx.reLaunch({ url: '/pages/subPackages/account/pages/login/login' });
    setTimeout(() => { _401Redirecting = false; }, 1500);
  }, 400);
}

/**
 * @param {string} url 接口路径（不含 baseURL）
 * @param {object} opts { method, data, mock } mock 为该接口的模拟数据（值或 () => 值）
 * @returns {Promise<any>}
 */
function request(url, opts) {
  const options = opts || {};
  if (envConfig.useMock && options.mock !== undefined) {
    const data = typeof options.mock === 'function' ? options.mock() : options.mock;
    return new Promise((resolve) => setTimeout(() => resolve(data), 180));
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: apiConfig.baseURL + url,
      method: options.method || 'GET',
      data: options.data || {},
      timeout: apiConfig.timeout,
      header: Object.assign(
        { 'content-type': 'application/json' },
        userStore.getToken() ? { Authorization: 'Bearer ' + userStore.getToken() } : {}
      ),
      success(res) {
        // 2xx 都算成功（后端创建类接口返回 201，不能只认 200）
        if (res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.code === 0) {
          resolve(res.data.data);
        } else if (res.statusCode === 401) {
          // ★ 登录过期：清 token + 跳登录页，不再 toast 一次让用户手动找入口
          gotoLoginOnce(url);
          reject(new Error('登录已过期，请重新登录'));
        } else if (res.statusCode === 404) {
          // 接口不存在（如后端未实现的接口）——静默，避免每次刷屏
          logger.warn('接口不存在', url);
          reject(new Error('接口不存在: ' + url));
        } else {
          const msg = (res.data && res.data.message) || '请求失败(' + res.statusCode + ')';
          wx.showToast({ title: msg, icon: 'none' });
          reject(new Error(msg));
        }
      },
      fail(err) {
        wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
        logger.error('request fail:', url, err);
        reject(new Error((err && err.errMsg) || '网络异常，请稍后重试'));
      }
    });
  });
}

/**
 * ★ SSE 流式请求（阿里云 FC 3.0 Web 函数 / 任意 text/event-stream 后端）
 *
 * 为什么要自己解 UTF-8：
 *   小程序 chunk 回调给的是 ArrayBuffer，且**一个中文字符（3 字节）可能被
 *   切在两个 chunk 之间**。直接用 String.fromCharCode 逐字节转会乱码且丢字，
 *   所以这里保留"残字节"到下一次拼接。
 *
 * @param {string} url 接口路径（不含 baseURL）
 * @param {object} data 请求体
 * @param {object} handlers { onOpen, onEvent(obj), onError(err), onComplete() }
 * @returns {{abort: Function}} 可用于中断
 */
function stream(url, data, handlers) {
  const cb = handlers || {};
  const token = userStore.getToken();

  // ---- UTF-8 增量解码器（带残字节保留）----
  let pendingBytes = [];
  function decodeChunk(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const arr = pendingBytes.concat(Array.prototype.slice.call(bytes));
    let out = '';
    let i = 0;
    while (i < arr.length) {
      const b = arr[i];
      let need = 0;
      let cp = 0;
      if (b < 0x80) { need = 1; cp = b; }
      else if ((b & 0xe0) === 0xc0) { need = 2; cp = b & 0x1f; }
      else if ((b & 0xf0) === 0xe0) { need = 3; cp = b & 0x0f; }
      else if ((b & 0xf8) === 0xf0) { need = 4; cp = b & 0x07; }
      else { i += 1; continue; }            // 非法起始字节，跳过

      if (i + need > arr.length) break;     // 不足一个完整字符 → 留到下次

      let ok = true;
      for (let k = 1; k < need; k += 1) {
        const cont = arr[i + k];
        if ((cont & 0xc0) !== 0x80) { ok = false; break; }
        cp = (cp << 6) | (cont & 0x3f);
      }
      if (!ok) { i += 1; continue; }
      out += String.fromCodePoint(cp);
      i += need;
    }
    pendingBytes = arr.slice(i);
    return out;
  }

  // ---- SSE 帧解析：按空行切，取 data: 行 ----
  let sseBuf = '';
  function feedText(text) {
    sseBuf += text;
    let idx = sseBuf.indexOf('\n\n');
    while (idx >= 0) {
      const rawEvent = sseBuf.slice(0, idx);
      sseBuf = sseBuf.slice(idx + 2);
      const lines = rawEvent.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (line.indexOf('data:') !== 0) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          const obj = JSON.parse(payload);
          if (cb.onEvent) cb.onEvent(obj);
        } catch (e) {
          logger.warn('SSE 解析失败:', payload.slice(0, 80));
        }
      }
      idx = sseBuf.indexOf('\n\n');
    }
  }

  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    if (cb.onComplete) cb.onComplete();
  }

  const task = wx.request({
    url: apiConfig.baseURL + url,
    method: 'POST',
    data: data || {},
    timeout: apiConfig.timeout,
    responseType: 'arraybuffer',
    enableChunked: true,          // ★ 关键：开启分块接收
    header: Object.assign(
      {
        'content-type': 'application/json',
        Accept: 'text/event-stream'  // ★ 关键：FC 见到这个头才不缓冲
      },
      token ? { Authorization: 'Bearer ' + token } : {}
    ),
    success(res) {
      if (res.statusCode === 401) {
        gotoLoginOnce(url);
        if (cb.onError) cb.onError(new Error('登录已过期，请重新登录'));
        finished = true;
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        if (cb.onError) cb.onError(new Error('请求失败(' + res.statusCode + ')'));
        finished = true;
        return;
      }
      finish();
    },
    fail(err) {
      if (finished) return;
      finished = true;
      logger.error('stream fail:', url, err);
      if (cb.onError) cb.onError(new Error((err && err.errMsg) || '网络异常'));
    }
  });

  // 分块到达
  if (task && typeof task.onChunkReceived === 'function') {
    task.onChunkReceived((res) => {
      try {
        feedText(decodeChunk(res.data));
      } catch (e) {
        logger.warn('chunk 处理异常:', e && e.message);
      }
    });
  } else {
    logger.warn('当前基础库不支持 onChunkReceived，流式不可用');
    if (cb.onError) cb.onError(new Error('当前微信版本不支持流式，请升级微信'));
  }

  return {
    abort() {
      finished = true;
      try { task && task.abort(); } catch (e) { /* ignore */ }
    }
  };
}

module.exports = {
  get(url, data, mock) { return request(url, { method: 'GET', data, mock }); },
  post(url, data, mock) { return request(url, { method: 'POST', data, mock }); },
  put(url, data, mock) { return request(url, { method: 'PUT', data, mock }); },
  patch(url, data, mock) { return request(url, { method: 'PATCH', data, mock }); },
  del(url, data, mock) { return request(url, { method: 'DELETE', data, mock }); },
  stream
};
