/* charts.js — tiny dependency-free canvas line charts */
(function (root) {
  'use strict';

  function niceStep(range, target) {
    const raw = range / Math.max(1, target);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
  }

  function setupCanvas(cv) {
    const dpr = window.devicePixelRatio || 1;
    const r = cv.getBoundingClientRect();
    const w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  /**
   * spec = { x:[], series:[{y:[], color, width, dash, label, fill}], hlines:[{y,color,dash,label}],
   *          cursorX, xLabel, yLabel, yMin, yMax, includeZero, fmtY }
   */
  function lineChart(cv, spec) {
    const { ctx, w, h } = setupCanvas(cv);
    const css = getComputedStyle(document.documentElement);
    const cText = css.getPropertyValue('--text-dim').trim() || '#9aa4b2';
    const cGrid = css.getPropertyValue('--grid').trim() || 'rgba(255,255,255,0.07)';
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 52, r: 12, t: 26, b: 30 };
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    const xs = spec.x;
    const x0 = xs[0], x1 = xs[xs.length - 1];
    let y0 = Infinity, y1 = -Infinity;
    for (const s of spec.series) for (const v of s.y) if (isFinite(v)) { y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
    for (const l of spec.hlines || []) { y0 = Math.min(y0, l.y); y1 = Math.max(y1, l.y); }
    if (spec.includeZero) { y0 = Math.min(y0, 0); y1 = Math.max(y1, 0); }
    if (spec.yMin != null) y0 = spec.yMin;
    if (spec.yMax != null) y1 = spec.yMax;
    if (!isFinite(y0)) { y0 = -1; y1 = 1; }
    if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
    const yp = (y1 - y0) * 0.06; y0 -= yp; y1 += yp;
    const X = (v) => pad.l + ((v - x0) / (x1 - x0)) * pw;
    const Y = (v) => pad.t + (1 - (v - y0) / (y1 - y0)) * ph;

    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = cText; ctx.strokeStyle = cGrid; ctx.lineWidth = 1;
    // grid + ticks
    const ys = niceStep(y1 - y0, ph / 38);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = Math.ceil(y0 / ys) * ys; v <= y1; v += ys) {
      const yy = Math.round(Y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(pad.l + pw, yy); ctx.stroke();
      ctx.fillText(spec.fmtY ? spec.fmtY(v) : +v.toFixed(6) + '', pad.l - 6, yy);
    }
    const xsStep = niceStep(x1 - x0, pw / 60);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let v = Math.ceil(x0 / xsStep) * xsStep; v <= x1 + 1e-9; v += xsStep) {
      const xx = Math.round(X(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(xx, pad.t); ctx.lineTo(xx, pad.t + ph); ctx.stroke();
      ctx.fillText(Math.round(v) + '°', xx, pad.t + ph + 5);
    }
    // zero line
    if (y0 < 0 && y1 > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.beginPath(); ctx.moveTo(pad.l, Y(0)); ctx.lineTo(pad.l + pw, Y(0)); ctx.stroke();
    }
    if (spec.yLabel) {
      ctx.save(); ctx.translate(12, pad.t + ph / 2); ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(spec.yLabel, 0, 0); ctx.restore();
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(pad.l, pad.t, pw, ph); ctx.clip();
    for (const l of spec.hlines || []) {
      ctx.strokeStyle = l.color; ctx.setLineDash(l.dash || [5, 4]); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(pad.l, Y(l.y)); ctx.lineTo(pad.l + pw, Y(l.y)); ctx.stroke();
      if (l.label) { ctx.fillStyle = l.color; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(l.label, pad.l + pw - 4, Y(l.y) - 2); }
    }
    ctx.setLineDash([]);
    for (const s of spec.series) {
      if (s.fill) {
        ctx.fillStyle = s.fill;
        ctx.beginPath(); ctx.moveTo(X(xs[0]), Y(Math.max(y0, Math.min(y1, 0))));
        s.y.forEach((v, i) => ctx.lineTo(X(xs[i]), Y(v)));
        ctx.lineTo(X(xs[xs.length - 1]), Y(Math.max(y0, Math.min(y1, 0)))); ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.6; ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      s.y.forEach((v, i) => (i ? ctx.lineTo(X(xs[i]), Y(v)) : ctx.moveTo(X(xs[i]), Y(v))));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (spec.cursorX != null) {
      const cx = X(spec.cursorX);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, pad.t); ctx.lineTo(cx, pad.t + ph); ctx.stroke();
      // dots
      const i = Math.max(0, Math.min(xs.length - 1, Math.round(((spec.cursorX - x0) / (x1 - x0)) * (xs.length - 1))));
      for (const s of spec.series) {
        if (s.noDot) continue;
        ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(cx, Y(s.y[i]), 3, 0, 7); ctx.fill();
      }
    }
    ctx.restore();

    // legend
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let lx = pad.l;
    for (const s of spec.series.concat((spec.hlines || []).filter((l) => l.legend))) {
      if (!s.label && !s.legend) continue;
      const label = s.label || s.legend;
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.6; ctx.setLineDash(s.dash || []);
      ctx.beginPath(); ctx.moveTo(lx, 11); ctx.lineTo(lx + 16, 11); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = cText; ctx.fillText(label, lx + 20, 11);
      lx += 28 + ctx.measureText(label).width;
    }
    return { X, Y, pad, pw, ph, x0, x1 };
  }

  root.Charts = { lineChart, setupCanvas };
})(window);
