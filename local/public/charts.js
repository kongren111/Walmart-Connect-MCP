// charts.js — 极简 SVG 图表（折线 / 柱状 / 横向条形），无外部依赖，可离线运行

function el(tag, attrs, children = []) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) e.appendChild(c);
  return e;
}

function text(x, y, str, opts = {}) {
  const t = el('text', {
    x, y,
    'font-size': opts.size || 11,
    fill: opts.fill || '#334155',
    'text-anchor': opts.anchor || 'start',
    'font-family': 'system-ui, sans-serif',
  });
  t.textContent = str;
  return t;
}

// 折线图（可多序列）。series: [{label, color, points:[{x,y}]}], xLabels: string[]
export function lineChart(container, xLabels, series, opts = {}) {
  container.innerHTML = '';
  const W = container.clientWidth || 640;
  const H = opts.height || 240;
  const pad = { l: 48, r: 16, t: 16, b: 36 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });

  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  const maxY = Math.max(1, ...allY);
  const minY = Math.min(0, ...allY);
  const n = xLabels.length;
  const xAt = (i) => pad.l + (n <= 1 ? iw / 2 : (iw * i) / (n - 1));
  const yAt = (v) => pad.t + ih - ((v - minY) / (maxY - minY || 1)) * ih;

  // y 网格
  for (let g = 0; g <= 4; g++) {
    const v = minY + ((maxY - minY) * g) / 4;
    const y = yAt(v);
    svg.appendChild(el('line', { x1: pad.l, y1: y, x2: W - pad.r, y2: y, stroke: '#e2e8f0', 'stroke-width': 1 }));
    svg.appendChild(text(pad.l - 6, y + 3, fmtShort(v), { anchor: 'end', fill: '#94a3b8' }));
  }
  // x 轴标签（抽样）
  const step = Math.ceil(n / 8);
  xLabels.forEach((lab, i) => {
    if (i % step === 0 || i === n - 1) svg.appendChild(text(xAt(i), H - pad.b + 16, lab, { anchor: 'middle', fill: '#94a3b8' }));
  });
  // 序列
  series.forEach((s) => {
    const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(p.y).toFixed(1)}`).join(' ');
    svg.appendChild(el('path', { d, fill: 'none', stroke: s.color || '#2563eb', 'stroke-width': 2 }));
  });
  container.appendChild(svg);

  // 图例
  if (series.length > 1) {
    const lg = document.createElement('div');
    lg.className = 'legend';
    series.forEach((s) => {
      const span = document.createElement('span');
      span.innerHTML = `<i style="background:${s.color || '#2563eb'}"></i>${s.label}`;
      lg.appendChild(span);
    });
    container.appendChild(lg);
  }
}

// 柱状图。data: [{label, value, color?}]
export function barChart(container, data, opts = {}) {
  container.innerHTML = '';
  const W = container.clientWidth || 640;
  const H = opts.height || 240;
  const pad = { l: 48, r: 16, t: 16, b: 56 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  const maxY = Math.max(1, ...data.map((d) => d.value));
  const n = data.length || 1;
  const bw = (iw / n) * 0.7;
  const gap = (iw / n) * 0.3;
  for (let g = 0; g <= 4; g++) {
    const v = (maxY * g) / 4;
    const y = pad.t + ih - (v / maxY) * ih;
    svg.appendChild(el('line', { x1: pad.l, y1: y, x2: W - pad.r, y2: y, stroke: '#e2e8f0' }));
    svg.appendChild(text(pad.l - 6, y + 3, fmtShort(v), { anchor: 'end', fill: '#94a3b8' }));
  }
  data.forEach((d, i) => {
    const x = pad.l + gap / 2 + (iw / n) * i;
    const h = (d.value / maxY) * ih;
    const y = pad.t + ih - h;
    svg.appendChild(el('rect', { x, y, width: bw, height: Math.max(0, h), fill: d.color || '#2563eb', rx: 3 }));
    if (opts.showValue) svg.appendChild(text(x + bw / 2, y - 4, fmtShort(d.value), { anchor: 'middle', fill: '#475569', size: 10 }));
    svg.appendChild(text(x + bw / 2, H - pad.b + 14, clip(d.label, 10), { anchor: 'middle', fill: '#64748b', size: 10 }));
  });
  container.appendChild(svg);
}

function fmtShort(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return Number(v).toFixed(v < 10 ? 1 : 0);
}
function clip(s, n) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
