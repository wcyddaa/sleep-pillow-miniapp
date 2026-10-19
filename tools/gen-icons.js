/**
 * 图标生成脚本（纯 Node，无依赖）：node tools/gen-icons.js
 * 产出 assets/images/{tabbar,icons,default} 下的全部 PNG
 * 采用 4x 超采样 + 盒滤波降采样，保证边缘平滑
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const SCALE = 4;

/* ---------------- PNG 编码 ---------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([sig, chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------------- 颜色工具 ---------------- */
function hex(str) {
  const n = parseInt(str.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** 对角渐变（左上 -> 右下） */
function grad(c1, c2) {
  const a = hex(c1), b = hex(c2);
  return (u, v) => {
    const t = Math.min(1, Math.max(0, (u + v) / 2));
    return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
  };
}

/* ---------------- 超采样画布（坐标均为 0..1 归一化） ---------------- */
class Icon {
  constructor(size) {
    this.size = size;
    this.n = size * SCALE;
    this.buf = new Float64Array(this.n * this.n * 4); // 预乘 alpha
  }
  blend(x, y, rgb, alpha) {
    if (x < 0 || y < 0 || x >= this.n || y >= this.n) return;
    const i = (y * this.n + x) * 4;
    const sa = alpha;
    const d = this.buf;
    d[i] = rgb[0] * sa + d[i] * (1 - sa);
    d[i + 1] = rgb[1] * sa + d[i + 1] * (1 - sa);
    d[i + 2] = rgb[2] * sa + d[i + 2] * (1 - sa);
    d[i + 3] = sa + d[i + 3] * (1 - sa);
  }
  col(colorDef, nx, ny) { return typeof colorDef === 'function' ? colorDef(nx, ny) : colorDef; }
  each(x0, y0, x1, y1, colorDef, alpha, test) {
    const n = this.n;
    const px0 = Math.max(0, Math.floor(x0 * n) - 1), px1 = Math.min(n - 1, Math.ceil(x1 * n) + 1);
    const py0 = Math.max(0, Math.floor(y0 * n) - 1), py1 = Math.min(n - 1, Math.ceil(y1 * n) + 1);
    for (let py = py0; py <= py1; py++) {
      for (let px = px0; px <= px1; px++) {
        const qx = (px + 0.5) / n, qy = (py + 0.5) / n;
        if (test && !test(qx, qy)) continue;
        this.blend(px, py, this.col(colorDef, qx, qy), alpha);
      }
    }
  }
  fillCircle(cx, cy, r, color, alpha, clip) {
    this.each(cx - r, cy - r, cx + r, cy + r, color, alpha === undefined ? 1 : alpha, (x, y) => {
      const dx = x - cx, dy = y - cy;
      return dx * dx + dy * dy <= r * r && (!clip || clip(x, y));
    });
  }
  fillRect(x0, y0, w, h, color, alpha, clip) {
    this.each(x0, y0, x0 + w, y0 + h, color, alpha === undefined ? 1 : alpha, (x, y) => !clip || clip(x, y));
  }
  roundRect(x0, y0, w, h, r, color, alpha) {
    const X0 = x0, Y0 = y0, X1 = x0 + w, Y1 = y0 + h;
    this.each(x0, y0, X1, Y1, color, alpha === undefined ? 1 : alpha, (x, y) => {
      const nx = Math.min(Math.max(x, X0 + r), X1 - r);
      const ny = Math.min(Math.max(y, Y0 + r), Y1 - r);
      const dx = x - nx, dy = y - ny;
      return dx * dx + dy * dy <= r * r;
    });
  }
  ring(cx, cy, r0, r1, color, alpha, extra) {
    this.each(cx - r1, cy - r1, cx + r1, cy + r1, color, alpha === undefined ? 1 : alpha, (x, y) => {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      return d >= r0 && d <= r1 && (!extra || extra(x, y));
    });
  }
  ringArc(cx, cy, r0, r1, deg0, deg1, color, alpha) {
    const a0 = (deg0 % 360 + 360) % 360, a1 = (deg1 % 360 + 360) % 360;
    this.ring(cx, cy, r0, r1, color, alpha, (x, y) => {
      const a = ((Math.atan2(y - cy, x - cx) * 180) / Math.PI + 360) % 360;
      return a >= a0 && a <= a1;
    });
  }
  seg(x1, y1, x2, y2, w, color, alpha) {
    const m = w / 2;
    const vx = x2 - x1, vy = y2 - y1;
    const len2 = vx * vx + vy * vy || 1e-9;
    this.each(Math.min(x1, x2) - m, Math.min(y1, y2) - m, Math.max(x1, x2) + m, Math.max(y1, y2) + m, color, alpha === undefined ? 1 : alpha, (x, y) => {
      let t = ((x - x1) * vx + (y - y1) * vy) / len2;
      t = Math.max(0, Math.min(1, t));
      const dx = x - (x1 + vx * t), dy = y - (y1 + vy * t);
      return dx * dx + dy * dy <= m * m;
    });
  }
  poly(points, color, alpha) {
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    this.each(Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys), color, alpha === undefined ? 1 : alpha, (x, y) => {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i][0], yi = points[i][1], xj = points[j][0], yj = points[j][1];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    });
  }
  toPNG() {
    const n = this.n, s = SCALE, size = this.size;
    const out = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let dy = 0; dy < s; dy++) {
          for (let dx = 0; dx < s; dx++) {
            const i = ((y * s + dy) * n + x * s + dx) * 4;
            r += this.buf[i]; g += this.buf[i + 1]; b += this.buf[i + 2]; a += this.buf[i + 3];
          }
        }
        const cnt = s * s;
        const aa = a / cnt;
        const o = (y * size + x) * 4;
        if (aa > 0) {
          // buf 中 RGB 为预乘色（0..255 量纲），alpha 为 0..1，直接相除即还原直色
          out[o] = Math.min(255, Math.round(r / a));
          out[o + 1] = Math.min(255, Math.round(g / a));
          out[o + 2] = Math.min(255, Math.round(b / a));
          out[o + 3] = Math.round(aa * 255);
        }
      }
    }
    return encodePNG(size, size, out);
  }
}

/* ---------------- 字形库（颜色为参数，白色细节固定） ---------------- */
const WHITE = [255, 255, 255];

const glyphs = {
  home(c, color) {
    c.poly([[0.5, 0.10], [0.08, 0.47], [0.92, 0.47]], color);
    c.roundRect(0.17, 0.42, 0.66, 0.44, 0.08, color);
    c.roundRect(0.42, 0.60, 0.16, 0.26, 0.08, WHITE);
  },
  message(c, color) {
    c.roundRect(0.14, 0.15, 0.72, 0.52, 0.24, color);
    c.poly([[0.26, 0.58], [0.18, 0.84], [0.46, 0.63]], color);
    [0.34, 0.5, 0.66].forEach((x) => c.fillCircle(x, 0.41, 0.05, WHITE));
  },
  profile(c, color) {
    c.fillCircle(0.5, 0.29, 0.16, color);
    c.fillCircle(0.5, 0.86, 0.30, color, 1, (x, y) => y <= 0.86);
  },
  wifi(c, color) {
    c.fillCircle(0.5, 0.75, 0.07, color);
    c.ringArc(0.5, 0.73, 0.17, 0.26, 205, 335, color);
    c.ringArc(0.5, 0.73, 0.31, 0.40, 205, 335, color);
  },
  bt(c, color) {
    const T = [0.44, 0.10], B = [0.44, 0.90], P1 = [0.70, 0.28], P2 = [0.70, 0.72], M = [0.44, 0.50];
    c.seg(T[0], T[1], B[0], B[1], 0.09, color);
    c.seg(T[0], T[1], P1[0], P1[1], 0.09, color);
    c.seg(P1[0], P1[1], M[0], M[1], 0.09, color);
    c.seg(M[0], M[1], P2[0], P2[1], 0.09, color);
    c.seg(P2[0], P2[1], B[0], B[1], 0.09, color);
  },
  bars(c, color) {
    c.roundRect(0.18, 0.52, 0.15, 0.32, 0.06, color);
    c.roundRect(0.425, 0.36, 0.15, 0.48, 0.06, color);
    c.roundRect(0.67, 0.20, 0.15, 0.64, 0.06, color);
  },
  curve(c, color) {
    const pts = [[0.14, 0.70], [0.36, 0.44], [0.58, 0.56], [0.86, 0.22]];
    for (let i = 0; i < pts.length - 1; i++) c.seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 0.09, color);
    pts.forEach((p) => c.fillCircle(p[0], p[1], 0.06, color));
  },
  sparkle(c, color) {
    c.poly([
      [0.46, 0.12], [0.552, 0.448], [0.88, 0.54], [0.552, 0.632],
      [0.46, 0.96], [0.368, 0.632], [0.04, 0.54], [0.368, 0.448]
    ], color);
    c.poly([
      [0.80, 0.04], [0.835, 0.165], [0.96, 0.20], [0.835, 0.235],
      [0.80, 0.36], [0.765, 0.235], [0.64, 0.20], [0.765, 0.165]
    ], color);
  },
  doc(c, color) {
    c.roundRect(0.26, 0.10, 0.48, 0.80, 0.08, color);
    c.roundRect(0.35, 0.26, 0.30, 0.07, 0.035, WHITE);
    c.roundRect(0.35, 0.42, 0.30, 0.07, 0.035, WHITE);
    c.roundRect(0.35, 0.58, 0.20, 0.07, 0.035, WHITE);
  },
  bell(c, color) {
    c.fillCircle(0.5, 0.16, 0.06, color);
    c.fillCircle(0.5, 0.47, 0.27, color);
    c.fillRect(0.23, 0.46, 0.54, 0.17, color);
    c.roundRect(0.20, 0.62, 0.60, 0.11, 0.055, color);
    c.fillCircle(0.5, 0.81, 0.07, color);
  },
  sliders(c, color, knobColor) {
    [[0.28, 0.36], [0.50, 0.64], [0.72, 0.45]].forEach(([y, kx]) => {
      c.seg(0.16, y, 0.84, y, 0.11, color);
      c.fillCircle(kx, y, 0.105, color);
      c.fillCircle(kx, y, 0.052, knobColor);
    });
  },
  thermo(c, color) {
    c.roundRect(0.43, 0.10, 0.14, 0.64, 0.07, color);
    c.fillCircle(0.5, 0.77, 0.135, color);
    c.roundRect(0.468, 0.30, 0.064, 0.42, 0.032, WHITE);
    c.fillCircle(0.5, 0.77, 0.062, WHITE);
  },
  router(c, color) {
    c.seg(0.34, 0.56, 0.24, 0.22, 0.06, color);
    c.seg(0.66, 0.56, 0.76, 0.22, 0.06, color);
    c.fillCircle(0.24, 0.20, 0.045, color);
    c.fillCircle(0.76, 0.20, 0.045, color);
    c.roundRect(0.13, 0.54, 0.74, 0.25, 0.10, color);
    [0.28, 0.42, 0.56].forEach((x) => c.fillCircle(x, 0.665, 0.045, WHITE));
  },
  magnifier(c, color) {
    c.ring(0.42, 0.42, 0.21, 0.31, color);
    c.seg(0.61, 0.61, 0.81, 0.81, 0.12, color);
  },
  alert(c, color) {
    c.poly([[0.5, 0.10], [0.94, 0.86], [0.06, 0.86]], color);
    c.roundRect(0.468, 0.40, 0.064, 0.24, 0.032, WHITE);
    c.fillCircle(0.5, 0.74, 0.05, WHITE);
  },
  heart(c, color) {
    c.fillCircle(0.35, 0.36, 0.17, color);
    c.fillCircle(0.65, 0.36, 0.17, color);
    c.poly([[0.18, 0.44], [0.82, 0.44], [0.5, 0.86]], color);
  },
  breath(c, color) {
    const pts = [[0.08, 0.56], [0.22, 0.30], [0.36, 0.56], [0.50, 0.30], [0.64, 0.56], [0.78, 0.30], [0.92, 0.56]];
    for (let i = 0; i < pts.length - 1; i++) c.seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 0.085, color);
  },
  snore(c, color) {
    c.fillCircle(0.28, 0.5, 0.09, color);
    c.ringArc(0.24, 0.5, 0.18, 0.27, 295, 360, color);
    c.ringArc(0.24, 0.5, 0.18, 0.27, 0, 65, color);
    c.ringArc(0.24, 0.5, 0.33, 0.42, 295, 360, color);
    c.ringArc(0.24, 0.5, 0.33, 0.42, 0, 65, color);
  },
  turn(c, color) {
    c.ringArc(0.5, 0.5, 0.28, 0.38, 210, 320, color);
    c.ringArc(0.5, 0.5, 0.28, 0.38, 30, 140, color);
    c.poly([[0.80, 0.18], [0.88, 0.34], [0.68, 0.32]], color);
    c.poly([[0.20, 0.82], [0.12, 0.66], [0.32, 0.68]], color);
  },
  bed(c, color) {
    c.fillRect(0.10, 0.26, 0.09, 0.50, color);
    c.roundRect(0.10, 0.56, 0.80, 0.20, 0.07, color);
    c.fillCircle(0.30, 0.46, 0.085, color);
    c.roundRect(0.40, 0.44, 0.38, 0.13, 0.06, color);
  },
  zzz(c, color) {
    const z = (x, y, w, h, lw) => {
      c.seg(x, y, x + w, y, lw, color);
      c.seg(x + w, y, x, y + h, lw, color);
      c.seg(x, y + h, x + w, y + h, lw, color);
    };
    z(0.26, 0.16, 0.28, 0.26, 0.07);
    z(0.52, 0.46, 0.18, 0.18, 0.06);
    z(0.38, 0.70, 0.12, 0.12, 0.05);
  },
  moon(c, color) {
    // 新月：外圆减去右上偏移圆，取两圆弧围成的区域
    const O1 = [0.50, 0.50], r1 = 0.37;
    const O2 = [0.65, 0.38], r2 = 0.30;
    const outer = [], inner = [];
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const p = [O1[0] + r1 * Math.cos(a), O1[1] + r1 * Math.sin(a)];
      if (Math.hypot(p[0] - O2[0], p[1] - O2[1]) > r2) outer.push(p);
      const q = [O2[0] + r2 * Math.cos(a), O2[1] + r2 * Math.sin(a)];
      if (Math.hypot(q[0] - O1[0], q[1] - O1[1]) > r1) inner.push(q);
    }
    c.poly(outer.concat(inner.reverse()), color);
  },
  stars(c, color) {
    c.fillCircle(0.30, 0.30, 0.06, color);
    c.fillCircle(0.62, 0.20, 0.045, color);
    c.fillCircle(0.80, 0.44, 0.05, color);
    c.poly([[0.5, 0.4], [0.545, 0.56], [0.7, 0.6], [0.545, 0.64], [0.5, 0.8], [0.455, 0.64], [0.3, 0.6], [0.455, 0.56]], color);
  }
};

/* ---------------- 输出 ---------------- */
const GRAY = hex('#9AA3B2');
const BLUE = hex('#3D7EFF');

function out(rel, icon) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, icon.toPNG());
  console.log('√', rel);
}

/* tabbar 图标：81px 透明底 */
[['home', 'home'], ['message', 'message'], ['profile', 'profile']].forEach(([name, glyph]) => {
  out(`assets/images/tabbar/${name}.png`, drawIcon(81, (c) => glyphs[glyph](c, GRAY)));
  out(`assets/images/tabbar/${name}-active.png`, drawIcon(81, (c) => glyphs[glyph](c, BLUE)));
});

/* 应用/功能图标：120px 渐变圆角底 + 白色字形 */
const appIcons = [
  ['icon-device', grad('#5B8DFF', '#6A5CFF'), 'bt'],
  ['icon-network', grad('#2DD4BF', '#0D9488'), 'wifi'],
  ['icon-dashboard', grad('#8B5CF6', '#6D28D9'), 'bars'],
  ['icon-history', grad('#FBBF24', '#F97316'), 'curve'],
  ['icon-ai', grad('#F472B6', '#A855F7'), 'sparkle'],
  ['icon-report', grad('#38BDF8', '#3D7EFF'), 'doc'],
  ['icon-alert', grad('#FB7185', '#EF4444'), 'bell'],
  ['icon-message', grad('#F59E0B', '#F97316'), 'message'],
  ['icon-settings', grad('#94A3B8', '#475569'), 'sliders'],
  ['icon-sensor', grad('#34D399', '#059669'), 'thermo'],
  ['icon-gateway', grad('#818CF8', '#4F46E5'), 'router'],
  ['icon-heart', grad('#FB7185', '#E11D48'), 'heart'],
  ['icon-breath', grad('#38BDF8', '#0284C7'), 'breath'],
  ['icon-snore', grad('#F59E0B', '#EA580C'), 'snore'],
  ['icon-turn', grad('#34D399', '#059669'), 'turn'],
  ['icon-bed', grad('#8B5CF6', '#6D28D9'), 'bed'],
  ['icon-moon', grad('#6366F1', '#3B82F6'), 'moon'],
  ['icon-sleep', grad('#4F8CFF', '#6A5CFF'), 'zzz']
];
appIcons.forEach(([name, bg, glyph]) => {
  out(`assets/images/icons/${name}.png`, drawIcon(120, (c) => {
    c.roundRect(0, 0, 1, 1, 0.26, bg);
    glyphs[glyph](c, WHITE, hex('#334155'));
  }));
});

/* 默认资源 */
out('assets/images/default/avatar.png', drawIcon(200, (c) => {
  const bg = hex('#E3EAF5'), fg = hex('#94A9CE');
  c.fillCircle(0.5, 0.5, 0.5, bg);
  c.fillCircle(0.5, 0.36, 0.14, fg);
  c.fillCircle(0.5, 0.95, 0.28, fg, 1, (x, y) => y <= 0.95 && (x - 0.5) ** 2 + (y - 0.5) ** 2 <= 0.49 ** 2);
}));
out('assets/images/default/placeholder.png', drawIcon(240, (c) => {
  c.roundRect(0, 0, 1, 1, 0.06, hex('#EEF1F6'));
  c.fillCircle(0.68, 0.30, 0.075, hex('#F5B14C'));
  c.poly([[0.10, 0.74], [0.38, 0.40], [0.55, 0.62], [0.66, 0.50], [0.90, 0.74]], hex('#C3CCDA'));
}));
out('assets/images/default/empty.png', drawIcon(240, (c) => glyphs.magnifier(c, hex('#C9D2DE'))));

/* App Logo：夜空 + 月亮 + 星 */
out('assets/images/icons/logo.png', drawIcon(144, (c) => {
  c.roundRect(0, 0, 1, 1, 0.24, grad('#1E2A5E', '#4F46E5'));
  glyphs.moon(c, hex('#FDE68A'));
  glyphs.stars(c, hex('#FFFFFF'));
}));

function drawIcon(size, painter) {
  const c = new Icon(size);
  painter(c);
  return c;
}

console.log('done: assets/images 生成完毕');
