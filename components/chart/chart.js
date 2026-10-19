// 图表组件：Canvas 2D 绘制折线/柱状/睡眠分期阶梯图
// 属性 type: line|bar|stage, categories: [], data: [], color, unit, height(rpx)
// stage 类型：data 为分期编码（0清醒 1REM 2浅睡 3深睡），按 SLEEP_STAGES 配色绘制色带
const dprUtil = require('./dpr');
const { SLEEP_STAGES } = require('../../utils/common/constants');

Component({
  properties: {
    type: { type: String, value: 'line' },
    categories: { type: Array, value: [] },
    data: {
      type: Array,
      value: [],
      observer() { this.scheduleRender(); }
    },
    color: { type: String, value: '#3D7EFF' },
    color2: { type: String, value: '' },       // 折线渐变副色
    unit: { type: String, value: '' },
    height: { type: Number, value: 420 },      // rpx
    showAvg: { type: Boolean, value: true },
    stageLegend: { type: Boolean, value: true }  // stage 类型是否绘制图例
  },
  data: { canvasId: '' },
  lifetimes: {
    attached() {
      this.setData({ canvasId: 'chart_' + Math.floor(Math.random() * 1e9) });
    },
    ready() {
      this.scheduleRender();
    }
  },
  methods: {
    scheduleRender() {
      // 合并一次帧内多次数据更新
      if (this._renderPending) return;
      this._renderPending = true;
      wx.nextTick(() => {
        this._renderPending = false;
        this.render();
      });
    },

    render() {
      const query = this.createSelectorQuery();
      query.select('.chart-canvas').fields({ node: true, size: true });
      query.exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const { node, width, height } = res[0];
        const dpr = dprUtil.getDpr();
        node.width = width * dpr;
        node.height = height * dpr;
        const ctx = node.getContext('2d');
        ctx.scale(dpr, dpr);
        this.draw(ctx, width, height);
      });
    },

    draw(ctx, W, H) {
      const data = this.data.data || [];
      const cats = this.data.categories || [];
      ctx.clearRect(0, 0, W, H);

      const padL = 38, padR = 12, padT = 26, padB = 26;
      const plotW = W - padL - padR;
      const plotH = H - padT - padB;

      const vals = data.filter((v) => typeof v === 'number');
      if (!vals.length) {
        ctx.fillStyle = '#C0C6D0';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('暂无数据', W / 2, H / 2);
        return;
      }

      // 睡眠分期：自绘时间轴/色带/图例，不用通用数值坐标
      if (this.data.type === 'stage') {
        this.drawStages(ctx, data, cats, W, H, padL, padR, padT, padB);
        return;
      }

      let min = Math.min.apply(null, vals);
      let max = Math.max.apply(null, vals);
      if (min === max) { min -= 1; max += 1; }
      const range = max - min;
      min -= range * 0.12;
      max += range * 0.12;

      const X = (i) => padL + (data.length <= 1 ? plotW / 2 : (plotW * i) / (data.length - 1));
      const Y = (v) => padT + plotH - ((v - min) / (max - min)) * plotH;

      // 横向网格 + Y 轴刻度
      ctx.strokeStyle = '#EEF1F6';
      ctx.lineWidth = 1;
      ctx.fillStyle = '#9CA3AF';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      const gridLines = 4;
      for (let g = 0; g <= gridLines; g++) {
        const v = min + ((max - min) * g) / gridLines;
        const y = Y(v);
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(W - padR, y);
        ctx.stroke();
        ctx.fillText(this.tickText(v), padL - 6, y + 3);
      }

      // X 轴标签（抽样显示避免重叠）
      ctx.textAlign = 'center';
      const step = Math.ceil(cats.length / 6);
      cats.forEach((c, i) => {
        if (i % step !== 0 && i !== cats.length - 1) return;
        ctx.fillText(c, X(i), H - 8);
      });

      if (this.data.type === 'bar') {
        this.drawBars(ctx, X, Y, data, plotW, padT, plotH);
      } else {
        this.drawLine(ctx, X, Y, data, padT, H);
      }

      // 均值线
      if (this.data.showAvg && vals.length > 1) {
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const y = Y(avg);
        ctx.strokeStyle = '#F59E0B';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(W - padR, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#F59E0B';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('均值 ' + this.tickText(avg), W - padR - 2, y - 4);
      }
    },

    drawBars(ctx, X, Y, data, plotW, padT, plotH) {
      const color = this.data.color;
      const bw = Math.max(8, (plotW / data.length) * 0.5);
      data.forEach((v, i) => {
        if (typeof v !== 'number') return;
        const x = X(i) - bw / 2;
        const y = Y(v);
        const h = padT + plotH - y;
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, color);
        g.addColorStop(1, color + '55');
        ctx.fillStyle = g;
        this.roundRectPath(ctx, x, y, bw, Math.max(h, 2), 3);
        ctx.fill();
      });
    },

    /**
     * 睡眠分期阶梯图：每格一条色带（0清醒 1REM 2浅睡 3深睡）
     * 同一分期连续段合并为整块，附时间轴与图例
     */
    drawStages(ctx, data, cats, W, H, padL, padR, padT, padB) {
      const n = data.length;
      if (!n) return;
      const plotW = W - padL - padR;
      const bandTop = padT + 18;
      const bandH = H - padB - bandTop - (this.data.stageLegend ? 18 : 6);
      const bw = plotW / n;

      // 时间轴（首/中/尾）
      ctx.fillStyle = '#9CA3AF';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      [0, Math.floor(n / 2), n - 1].forEach((i) => {
        ctx.fillText(cats[i] || '', padL + bw * (i + 0.5), bandTop - 6);
      });

      // 色带
      let i = 0;
      while (i < n) {
        const code = data[i];
        let j = i;
        while (j + 1 < n && data[j + 1] === code) j++;
        const def = SLEEP_STAGES[code] || SLEEP_STAGES[0];
        const g = ctx.createLinearGradient(0, bandTop, 0, bandTop + bandH);
        g.addColorStop(0, def.color);
        g.addColorStop(1, def.color + '66');
        ctx.fillStyle = g;
        this.roundRectPath(ctx, padL + i * bw, bandTop, (j - i + 1) * bw, bandH, 2);
        ctx.fill();
        i = j + 1;
      }

      // 图例
      if (this.data.stageLegend) {
        const names = SLEEP_STAGES.slice().reverse();
        let lx = padL;
        const ly = bandTop + bandH + 14;
        ctx.textAlign = 'left';
        ctx.font = '10px sans-serif';
        names.forEach((s) => {
          ctx.fillStyle = s.color;
          this.roundRectPath(ctx, lx, ly - 6, 10, 10, 2);
          ctx.fill();
          ctx.fillStyle = '#6B7280';
          ctx.fillText(s.name, lx + 14, ly + 2);
          lx += 14 + ctx.measureText(s.name).width + 12;
        });
      }
    },

    drawLine(ctx, X, Y, data, padT, H) {
      const color = this.data.color;
      const color2 = this.data.color2 || color;
      const pts = data.map((v, i) => [X(i), Y(v)]);

      // 面积渐变
      const grad = ctx.createLinearGradient(0, padT, 0, H);
      grad.addColorStop(0, color2 + '33');
      grad.addColorStop(1, color2 + '00');
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      pts.slice(1).forEach((p) => ctx.lineTo(p[0], p[1]));
      ctx.lineTo(pts[pts.length - 1][0], H - 26);
      ctx.lineTo(pts[0][0], H - 26);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // 折线
      const lineGrad = ctx.createLinearGradient(padT, 0, H, 0);
      lineGrad.addColorStop(0, color2);
      lineGrad.addColorStop(1, color);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      pts.slice(1).forEach((p) => ctx.lineTo(p[0], p[1]));
      ctx.strokeStyle = lineGrad;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // 数据点
      const step = Math.ceil(pts.length / 8);
      pts.forEach((p, i) => {
        if (pts.length > 8 && i % step !== 0 && i !== pts.length - 1) return;
        ctx.beginPath();
        ctx.arc(p[0], p[1], 3, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    },

    roundRectPath(ctx, x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    },

    tickText(v) {
      const a = Math.abs(v);
      if (a >= 10000) return (v / 1000).toFixed(0) + 'k';
      if (a >= 100) return v.toFixed(0);
      if (a >= 10) return v.toFixed(1).replace(/\.0$/, '');
      return v.toFixed(1);
    }
  }
});
