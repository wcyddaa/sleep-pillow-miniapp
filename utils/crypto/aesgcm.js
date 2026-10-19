/**
 * 纯 JS AES-128-GCM 加解密（微信小程序无 WebCrypto，故自实现）。
 * 用于 sleeppillow ESP32 配网：对明文 JSON（{"ssid","password"}）用 AES-128-GCM
 * 加密，密钥 kPsk="SleepPillow-2026"，附加数据(AAD)为空。
 *
 * 载荷格式：ciphertext | tag(16)
 * 算法：AES-128 块加密 CTR 模式 + GHASH(GCM 认证)，
 *       参考 NIST SP 800-38D 与 RFC 5288。
 */

// ---------- 运行时动态构建 S-box（避免大段硬编码数表） ----------
function buildSbox() {
  // 传统表驱动：gmul 递归求逆
  const S = new Array(256);
  const mult = (a, b) => {
    let p = 0, i = 0;
    for (; i < 8; i++) {
      if (b & 1) p ^= a;
      const hi = a & 0x80;
      a = (a << 1) & 0xff;
      if (hi) a ^= 0x1b;
      b >>= 1;
    }
    return p;
  };
  const mul2 = (a) => ((a << 1) & 0xff) ^ (a & 0x80 ? 0x1b : 0);
  for (let i = 0; i < 256; i++) {
    // 求逆
    let inv = i === 0 ? 0 : 1;
    for (let j = 1; j < 256; j++) {
      if (mult(i, j) === 1) { inv = j; break; }
    }
    let s = inv;
    s ^= rotl8(s, 1) ^ rotl8(s, 2) ^ rotl8(s, 3) ^ rotl8(s, 4);
    S[i] = (s ^ 0x63) & 0xff;
  }
  return S;
}
function rotl8(x, n) { n &= 7; return ((x << n) | (x >> (8 - n))) & 0xff; }

const S_BOX = buildSbox();
const S_INV = (function () { const a = new Array(256); for (let i = 0; i < 256; i++) a[S_BOX[i]] = i; return a; })();

function xtime(a) { return ((a << 1) & 0xff) ^ (a & 0x80 ? 0x1b : 0); }

// ---------- AES 核心 ----------
function keyExpansion(key) {
  // key: Uint8Array(16)
  const w = new Uint8Array(16 * 11);
  let i = 0;
  for (; i < 16; i++) w[i] = key[i];
  let rcon = 1;
  for (i = 4; i < 44; i++) {
    const prev = i - 1;
    let temp = [w[prev * 4], w[prev * 4 + 1], w[prev * 4 + 2], w[prev * 4 + 3]];
    if (i % 4 === 0) {
      // RotWord + SubWord + Rcon
      const t0 = temp[0];
      temp[0] = S_BOX[temp[1]];
      temp[1] = S_BOX[temp[2]];
      temp[2] = S_BOX[temp[3]];
      temp[3] = S_BOX[t0];
      temp[0] ^= rcon;
      rcon = xtime(rcon);
    }
    const base = i * 4;
    const prevBase = (i - 4) * 4;
    for (let j = 0; j < 4; j++) w[base + j] = w[prevBase + j] ^ temp[j];
  }
  return w;
}

function addRoundKey(state, w, round) {
  for (let i = 0; i < 16; i++) state[i] ^= w[round * 16 + i];
}
function subBytes(state) { for (let i = 0; i < 16; i++) state[i] = S_BOX[state[i]]; }
function invSubBytes(state) { for (let i = 0; i < 16; i++) state[i] = S_INV[state[i]]; }
function shiftRows(state) {
  // 行序：state[i] i=0..15 按列填充 [c*4+r]
  const t = state.slice();
  for (let r = 1; r < 4; r++) {
    for (let c = 0; c < 4; c++) state[r + c * 4] = t[r + ((c + r) % 4) * 4];
  }
}
function invShiftRows(state) {
  const t = state.slice();
  for (let r = 1; r < 4; r++) {
    for (let c = 0; c < 4; c++) state[r + c * 4] = t[r + ((c - r + 4) % 4) * 4];
  }
}
// state[i]=[c*4+r]，mixColumns 是列混合
function mixColumns(state) {
  const t = state.slice();
  for (let c = 0; c < 4; c++) {
    const base = c * 4;
    const a0 = t[base], a1 = t[base + 1], a2 = t[base + 2], a3 = t[base + 3];
    state[base] = xtime(a0 ^ a1) ^ a1 ^ a2 ^ a3; // (2*a0 + 3*a1 + a2 + a3)
    state[base + 1] = xtime(a1 ^ a2) ^ a2 ^ a3 ^ a0;
    state[base + 2] = xtime(a2 ^ a3) ^ a3 ^ a0 ^ a1;
    state[base + 3] = xtime(a3 ^ a0) ^ a0 ^ a1 ^ a2;
  }
}
function invMixColumns(state) {
  const t = state.slice();
  const mul2 = (a) => xtime(a);
  const mul3 = (a) => xtime(a) ^ a;
  const mul9 = (a) => xtime(xtime(xtime(a))) ^ a;
  const mul11 = (a) => xtime(xtime(xtime(a)) ^ a) ^ a;
  const mul13 = (a) => xtime(xtime((xtime(a) ^ a))) ^ a;
  const mul14 = (a) => xtime(xtime((xtime(a) ^ a)) ^ a) ^ a;
  for (let c = 0; c < 4; c++) {
    const base = c * 4;
    const a0 = t[base], a1 = t[base + 1], a2 = t[base + 2], a3 = t[base + 3];
    state[base] = mul14(a0) ^ mul11(a1) ^ mul13(a2) ^ mul9(a3);
    state[base + 1] = mul9(a0) ^ mul14(a1) ^ mul11(a2) ^ mul13(a3);
    state[base + 2] = mul13(a0) ^ mul9(a1) ^ mul14(a2) ^ mul11(a3);
    state[base + 3] = mul11(a0) ^ mul13(a1) ^ mul9(a2) ^ mul14(a3);
  }
}

function encryptBlock(plain, w) {
  const state = plain.slice();
  addRoundKey(state, w, 0);
  for (let round = 1; round < 10; round++) {
    subBytes(state);
    shiftRows(state);
    mixColumns(state);
    addRoundKey(state, w, round);
  }
  subBytes(state);
  shiftRows(state);
  addRoundKey(state, w, 10);
  return state;
}

function decryptBlock(cipher, w) {
  const state = cipher.slice();
  addRoundKey(state, w, 10);
  for (let round = 9; round >= 1; round--) {
    invShiftRows(state);
    invSubBytes(state);
    addRoundKey(state, w, round);
    invMixColumns(state);
  }
  invShiftRows(state);
  invSubBytes(state);
  addRoundKey(state, w, 0);
  return state;
}

// ---------- GF(2^128) GHASH ----------
function gf128Mult(x, y) {
  // x, y: Uint8Array(16)，结果覆盖 R
  const xr = new Array(16).fill(0);
  const yr = new Array(16).fill(0);
  for (let i = 0; i < 16; i++) { xr[i] = x[i]; yr[i] = y[i]; }
  const Z = new Array(16).fill(0);
  const V = xr.slice();
  for (let i = 0; i < 128; i++) {
    if (((yr[i >> 3] >> (7 - (i & 7))) & 1) === 1) {
      for (let j = 0; j < 16; j++) Z[j] ^= V[j];
    }
    const lsb = V[15] & 1;
    for (let j = 15; j >= 0; j--) {
      const carry = (j !== 0) ? (V[j - 1] & 1) : 0;
      V[j] = (V[j] >> 1) | (carry << 7);
    }
    if (lsb) V[0] ^= 0xe1;
  }
  return Z;
}

// ---------- GCM ----------
function ghash(H, data) {
  // Y = 0; 对每个 16 字节块 Y = (Y ^ Xi) * H
  const Y = new Array(16).fill(0);
  const blocks = data.length / 16;
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < 16; i++) Y[i] ^= data[b * 16 + i];
    const prod = gf128Mult(Y, H);
    for (let i = 0; i < 16; i++) Y[i] = prod[i];
  }
  return new Uint8Array(Y);
}

function gctrEncrypt(keyW, icb, data) {
  // 计数模式加密：Y=inc32(ICB)；C = P ^ E(K, Y)
  const out = new Uint8Array(data.length);
  const cb = new Uint8Array(16);
  cb.set(icb.slice());
  let i = 0;
  while (i < data.length) {
    const encrypted = encryptBlock(cb, keyW);
    const n = Math.min(16, data.length - i);
    for (let j = 0; j < n; j++) out[i + j] = data[i + j] ^ (encrypted[j] & 0xff);
    // inc32: 仅最后 4 字节 +1
    for (let j = 15; j >= 12; j--) { cb[j] = (cb[j] + 1) & 0xff; if (cb[j] !== 0) break; }
    i += n;
  }
  return out;
}

function bufToUint(b) { return b instanceof Uint8Array ? b : new Uint8Array(b); }

/** inc32(J0)：把最后 4 字节 +1（GCM 数据流的第一个计数器是 inc32(J0)，tag 才用 J0） */
function inc32(cb) {
  const out = new Uint8Array(16);
  out.set(cb);
  for (let j = 15; j >= 12; j--) { out[j] = (out[j] + 1) & 0xff; if (out[j] !== 0) break; }
  return out;
}

/**
 * AES-128-GCM 加密
 * @param {Uint8Array} key 16字节
 * @param {Uint8Array} iv  12字节
 * @param {Uint8Array} plaintext 明文（需自行 UTF-8 编码）
 * @param {Uint8Array} [aad] 附加数据（留空）
 * @returns {{cipher: Uint8Array, tag: Uint8Array}}
 */
function encryptGCM(key, iv, plaintext, aad) {
  const K = bufToUint(key);
  const IV = bufToUint(iv);
  const P = bufToUint(plaintext);
  const A = aad ? bufToUint(aad) : null;
  const keyW = keyExpansion(K);

  // H = E(K, 0^128)
  const H = encryptBlock(new Uint8Array(16).fill(0), keyW);

  // J0: IV(12) || 0x00000001
  const J0 = new Uint8Array(16);
  J0.set(IV.subarray(0, 12));
  J0[15] = 1;

  // 数据流第一个计数器用 inc32(J0)；J0 本身仅用于 tag 的 E(K,J0)
  const C = gctrEncrypt(keyW, inc32(J0), P);

  // S = GHASH(H, A || pad(A) || C || pad(C) || [len(A)]64 || [len(C)]64)
  const aBlockLen = (A ? (A.length + 15) >> 4 : 0);
  const cBlockLen = (C.length + 15) >> 4;
  const lenBitsA = (A ? A.length * 8 : 0);
  const lenBitsC = C.length * 8;
  const dataLen = aBlockLen * 16 + cBlockLen * 16 + 16;
  const data = new Uint8Array(dataLen);
  let off = 0;
  if (A) { data.set(A, off); off += aBlockLen * 16; }
  data.set(C, off); off += cBlockLen * 16;
  // 最后一块：len(A) [64bit] || len(C) [64bit]，大端
  // 长度是 64 位大端，值要落在每 8 字节字段的低 4 字节（off+4~7 / off+12~15）；
  // 之前误写到高 4 字节，导致 tag 与固件 mbedtls 计算不一致 → decrypt failed
  data[off + 4] = (lenBitsA >>> 24) & 0xff; data[off + 5] = (lenBitsA >>> 16) & 0xff;
  data[off + 6] = (lenBitsA >>> 8) & 0xff; data[off + 7] = lenBitsA & 0xff;
  data[off + 12] = (lenBitsC >>> 24) & 0xff; data[off + 13] = (lenBitsC >>> 16) & 0xff;
  data[off + 14] = (lenBitsC >>> 8) & 0xff; data[off + 15] = lenBitsC & 0xff;

  let S = ghash(H, data);
  // T = MSB_128(E(K, J0) ^ S)
  const eJ0 = encryptBlock(J0, keyW);
  const tag = new Uint8Array(16);
  for (let i = 0; i < 16; i++) tag[i] = eJ0[i] ^ S[i];

  return { cipher: C, tag };
}

/**
 * AES-128-GCM 解密并校验
 * @param {Uint8Array} key 16字节
 * @param {Uint8Array} iv  12字节
 * @param {Uint8Array} cipher
 * @param {Uint8Array} tag  16字节
 * @param {Uint8Array} [aad]
 * @returns {{ok:boolean, plaintext:Uint8Array}}
 */
function decryptGCM(key, iv, cipher, tag, aad) {
  const K = bufToUint(key);
  const IV = bufToUint(iv);
  const C = bufToUint(cipher);
  const T = bufToUint(tag);
  const A = aad ? bufToUint(aad) : null;
  const keyW = keyExpansion(K);
  const H = encryptBlock(new Uint8Array(16).fill(0), keyW);
  const J0 = new Uint8Array(16);
  J0.set(IV.subarray(0, 12));
  J0[15] = 1;

  // 计算期望 tag
  const aBlockLen = (A ? (A.length + 15) >> 4 : 0);
  const cBlockLen = (C.length + 15) >> 4;
  const lenBitsA = (A ? A.length * 8 : 0);
  const lenBitsC = C.length * 8;
  const dataLen = aBlockLen * 16 + cBlockLen * 16 + 16;
  const data = new Uint8Array(dataLen);
  let off = 0;
  if (A) { data.set(A, off); off += aBlockLen * 16; }
  data.set(C, off); off += cBlockLen * 16;
  data[off + 4] = (lenBitsA >>> 24) & 0xff; data[off + 5] = (lenBitsA >>> 16) & 0xff;
  data[off + 6] = (lenBitsA >>> 8) & 0xff; data[off + 7] = lenBitsA & 0xff;
  data[off + 12] = (lenBitsC >>> 24) & 0xff; data[off + 13] = (lenBitsC >>> 16) & 0xff;
  data[off + 14] = (lenBitsC >>> 8) & 0xff; data[off + 15] = lenBitsC & 0xff;
  let S = ghash(H, data);
  const eJ0 = encryptBlock(J0, keyW);
  let ok = true;
  for (let i = 0; i < 16; i++) {
    if (((eJ0[i] ^ S[i]) & 0xff) !== (T[i] & 0xff)) ok = false;
  }
  const plaintext = gctrEncrypt(keyW, inc32(J0), C);
  return { ok, plaintext };
}

/** UTF-8 编码 */
function utf8Encode(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0xd800 || c >= 0xe000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else { i++; const c2 = str.charCodeAt(i); const cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff)); bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)); }
  }
  return new Uint8Array(bytes);
}

/** UTF-8 解码 */
function utf8Decode(bytes) {
  let out = '', i = 0;
  const B = bufToUint(bytes);
  while (i < B.length) {
    const b0 = B[i++];
    if (b0 < 0x80) { out += String.fromCharCode(b0); }
    else if (b0 < 0xe0) { out += String.fromCharCode(((b0 & 0x1f) << 6) | (B[i++] & 0x3f)); }
    else if (b0 < 0xf0) { out += String.fromCharCode(((b0 & 0x0f) << 12) | ((B[i++] & 0x3f) << 6) | (B[i++] & 0x3f)); }
    else { const cp = ((b0 & 0x07) << 18) | ((B[i++] & 0x3f) << 12) | ((B[i++] & 0x3f) << 6) | (B[i++] & 0x3f); out += String.fromCodePoint(cp); }
  }
  return out;
}

/**
 * 生成 12 字节随机 IV：优先用平台 CSPRNG（Node/微信均可能提供）；
 * 不可用时回退时间戳+计数器（避免 IV 重用）。
 */
function newIv() {
  const iv = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(iv);
  } else if (typeof wx !== 'undefined' && wx.getRandomValues) {
    try {
      const rand = new Uint8Array(12);
      const res = wx.getRandomValues(rand);
      if (res) {
        for (let i = 0; i < 12; i++) iv[i] = (res[i] != null) ? res[i] : rand[i];
      } else {
        for (let i = 0; i < 12; i++) iv[i] = rand[i];
      }
    } catch (e) { /* 忽略 */ }
    if (iv.every((b) => b === 0)) fallbackIv(iv);
  } else {
    fallbackIv(iv);
  }
  return iv;
}
function fallbackIv(iv) {
  const t = Date.now() & 0xffffffff;
  for (let i = 0; i < 12; i++) { iv[i] = (t >>> ((i % 4) * 8)) & 0xff; }
  // 混合计数器到后 4 字节，降低同秒重复概率
  const ctr = (Date.now() * 31) & 0xffffffff;
  iv[8] = (ctr & 0xff); iv[9] = (ctr >> 8) & 0xff; iv[10] = (ctr >> 16) & 0xff; iv[11] = (ctr >> 24) & 0xff;
}

/** 组通用凭据包：[cmd][IV12][密文][TAG16]，明文为 JSON 字符串 */
function buildCredPacket(cmd, payload, psk) {
  const key = psk ? bufToUint(psk) : utf8Encode('SleepPillow-2026');
  const iv = newIv();
  const plain = utf8Encode(JSON.stringify(payload));
  const { cipher, tag } = encryptGCM(key, iv, plain);
  const packet = new Uint8Array(1 + iv.length + cipher.length + tag.length);
  packet[0] = cmd;
  packet.set(iv, 1);
  packet.set(cipher, 1 + iv.length);
  packet.set(tag, 1 + iv.length + cipher.length);
  return packet;
}

/**
 * 组 sleeppillow Wi-Fi 凭据包：[0x01][IV12][密文][TAG16]
 * @param {string} ssid
 * @param {string} password
 * @param {Uint8Array} [psk] 16字节，缺省用 SleepPillow-2026
 * @returns {Uint8Array}
 */
function buildWifiCredPacket(ssid, password, psk) {
  return buildCredPacket(0x01, { ssid, password }, psk);
}

module.exports = {
  S_BOX,
  encryptGCM,
  decryptGCM,
  utf8Encode,
  utf8Decode,
  buildWifiCredPacket
};