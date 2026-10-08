// Portfolio chart: cost vs. market value (one shared money axis) plus a linked
// "% rentabilidad" strip underneath with its own axis. Crosshair + tooltip on both.

import { esc, fmtDate, fmtPct } from './util.js';

const NS = 'http://www.w3.org/2000/svg';

function compact(n, cur) {
  const p = cur === 'USD' ? 'US$' : '$';
  const a = Math.abs(n);
  const s = n < 0 ? '−' : '';
  if (a >= 1e6) return `${s}${p}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',')}M`;
  if (a >= 1e3) return `${s}${p}${(a / 1e3).toFixed(a >= 1e5 ? 0 : a >= 1e4 ? 0 : 1).replace('.', ',')}k`;
  return `${s}${p}${Math.round(a)}`;
}

function niceTicks(min, max, count = 4) {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks };
}

const el = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

export function renderPortfolioChart(root, points, { currency, fmt }) {
  root.innerHTML = '';
  const W = Math.max(280, root.clientWidth || 340);
  const padL = 46, padR = 54, padT = 12;
  const H1 = 190, gap = 26, H2 = 74, padB = 22;
  const H = padT + H1 + gap + H2 + padB;
  const iw = W - padL - padR;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'pchart', role: 'img', 'aria-label': 'Costo y valor del portafolio en el tiempo' });
  root.appendChild(svg);

  const n = points.length;
  const ts = points.map((p) => new Date(p.d + 'T12:00:00').getTime());
  const span = ts[n - 1] - ts[0] || 1;
  const xs = (i) => padL + (n === 1 ? iw / 2 : ((ts[i] - ts[0]) / span) * iw);

  // money panel
  const vals = points.flatMap((p) => [p.cost, p.value]);
  const m = niceTicks(Math.min(...vals, 0) < 0 ? Math.min(...vals) : Math.min(...vals) * 0.92, Math.max(...vals) * 1.04);
  const y1 = (v) => padT + H1 - ((v - m.lo) / (m.hi - m.lo)) * H1;

  const grid = el('g', { class: 'grid' });
  m.ticks.forEach((t) => {
    grid.appendChild(el('line', { x1: padL, x2: W - padR, y1: y1(t), y2: y1(t) }));
    const tx = el('text', { x: padL - 6, y: y1(t) + 3.5, 'text-anchor': 'end', class: 'tick' });
    tx.textContent = compact(t, currency);
    grid.appendChild(tx);
  });
  svg.appendChild(grid);

  const path = (key, yf) => points.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)} ${yf(p[key]).toFixed(1)}`).join('');

  // soft area under value
  if (n > 1) {
    const area = `${path('value', y1)}L${xs(n - 1)} ${padT + H1}L${xs(0)} ${padT + H1}Z`;
    svg.appendChild(el('path', { d: area, class: 'area-value' }));
  }
  svg.appendChild(el('path', { d: path('cost', y1), class: 'line line-cost' }));
  svg.appendChild(el('path', { d: path('value', y1), class: 'line line-value' }));

  if (n <= 2) {
    points.forEach((p, i) => {
      svg.appendChild(el('circle', { cx: xs(i), cy: y1(p.cost), r: 4, class: 'dot dot-cost' }));
      svg.appendChild(el('circle', { cx: xs(i), cy: y1(p.value), r: 4, class: 'dot dot-value' }));
    });
  }

  // direct end labels (nudged apart if they collide)
  const last = points[n - 1];
  let ly1 = y1(last.value), ly2 = y1(last.cost);
  if (Math.abs(ly1 - ly2) < 13) {
    const mid = (ly1 + ly2) / 2;
    const up = last.value >= last.cost;
    ly1 = mid + (up ? -7 : 7);
    ly2 = mid + (up ? 7 : -7);
  }
  const endLbl = (y, txt, cls) => {
    const t = el('text', { x: W - padR + 6, y: y + 3.5, class: `endlbl ${cls}` });
    t.textContent = txt;
    svg.appendChild(t);
  };
  endLbl(ly1, 'Valor', 'endlbl-value');
  endLbl(ly2, 'Costo', 'endlbl-cost');

  // % strip
  const pcts = points.map((p) => (p.cost ? (p.value - p.cost) / p.cost : 0));
  const top2 = padT + H1 + gap;
  const pr = niceTicks(Math.min(0, ...pcts), Math.max(0, ...pcts), 2);
  const y2 = (v) => top2 + H2 - ((v - pr.lo) / (pr.hi - pr.lo || 1)) * H2;

  const lbl = el('text', { x: padL, y: top2 - 8, class: 'strip-title' });
  lbl.textContent = '% rentabilidad (valor vs. costo)';
  svg.appendChild(lbl);

  const g2 = el('g', { class: 'grid' });
  pr.ticks.forEach((t) => {
    g2.appendChild(el('line', { x1: padL, x2: W - padR, y1: y2(t), y2: y2(t), class: t === 0 ? 'zero' : '' }));
    const tx = el('text', { x: padL - 6, y: y2(t) + 3.5, 'text-anchor': 'end', class: 'tick' });
    tx.textContent = fmtPct(t, { digits: 0 });
    g2.appendChild(tx);
  });
  svg.appendChild(g2);

  const id = 'c' + Math.random().toString(36).slice(2, 7);
  const defs = el('defs');
  const cpPos = el('clipPath', { id: `${id}p` });
  cpPos.appendChild(el('rect', { x: padL, y: top2 - 2, width: iw, height: Math.max(0, y2(0) - top2 + 2) }));
  const cpNeg = el('clipPath', { id: `${id}n` });
  cpNeg.appendChild(el('rect', { x: padL, y: y2(0), width: iw, height: Math.max(0, top2 + H2 - y2(0) + 2) }));
  defs.append(cpPos, cpNeg);
  svg.appendChild(defs);

  const pctPts = pcts.map((v, i) => `${xs(i).toFixed(1)} ${y2(v).toFixed(1)}`);
  if (n > 1) {
    const pa = `M${pctPts.join('L')}L${xs(n - 1)} ${y2(0)}L${xs(0)} ${y2(0)}Z`;
    svg.appendChild(el('path', { d: pa, class: 'area-pos', 'clip-path': `url(#${id}p)` }));
    svg.appendChild(el('path', { d: pa, class: 'area-neg', 'clip-path': `url(#${id}n)` }));
    svg.appendChild(el('path', { d: `M${pctPts.join('L')}`, class: 'line line-pct' }));
  } else {
    svg.appendChild(el('circle', { cx: xs(0), cy: y2(pcts[0]), r: 4, class: 'dot dot-pct' }));
  }
  const pl = el('text', { x: W - padR + 6, y: y2(pcts[n - 1]) + 3.5, class: `endlbl ${pcts[n - 1] >= 0 ? 'pos' : 'neg'}` });
  pl.textContent = fmtPct(pcts[n - 1], { digits: 0 });
  svg.appendChild(pl);

  // x labels
  const midT = ts[0] + span / 2;
  const midI = ts.reduce((best, t, i) => (Math.abs(t - midT) < Math.abs(ts[best] - midT) ? i : best), 0);
  const xl = [0, midI, n - 1].filter((v, i, a) => a.indexOf(v) === i && (v === 0 || v === n - 1 || Math.min(xs(v) - xs(0), xs(n - 1) - xs(v)) > 70));
  if (n === 1) xl.splice(0, xl.length, 0);
  xl.forEach((i) => {
    const t = el('text', { x: xs(i), y: H - 6, 'text-anchor': n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle', class: 'tick' });
    t.textContent = fmtDate(points[i].d);
    svg.appendChild(t);
  });

  // crosshair
  const cross = el('g', { class: 'cross', style: 'display:none' });
  const vline = el('line', { y1: padT, y2: top2 + H2, class: 'vline' });
  const dV = el('circle', { r: 5, class: 'dot dot-value ring' });
  const dC = el('circle', { r: 5, class: 'dot dot-cost ring' });
  const dP = el('circle', { r: 4.5, class: 'dot dot-pct ring' });
  cross.append(vline, dV, dC, dP);
  svg.appendChild(cross);

  const tip = document.createElement('div');
  tip.className = 'ctip';
  root.appendChild(tip);

  const hit = el('rect', { x: padL - 10, y: 0, width: iw + 20, height: H, fill: 'transparent' });
  svg.appendChild(hit);

  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    let k = 0;
    for (let i = 1; i < n; i++) if (Math.abs(xs(i) - x) < Math.abs(xs(k) - x)) k = i;
    const p = points[k];
    const cx = xs(k);
    cross.style.display = '';
    vline.setAttribute('x1', cx);
    vline.setAttribute('x2', cx);
    dV.setAttribute('cx', cx); dV.setAttribute('cy', y1(p.value));
    dC.setAttribute('cx', cx); dC.setAttribute('cy', y1(p.cost));
    dP.setAttribute('cx', cx); dP.setAttribute('cy', y2(pcts[k]));
    tip.innerHTML = `<div class="ctip-d">${esc(fmtDate(p.d))}</div>
      <div><i class="sw sw-value"></i>Valor <b>${fmt(p.value)}</b></div>
      <div><i class="sw sw-cost"></i>Costo <b>${fmt(p.cost)}</b></div>
      <div class="${pcts[k] >= 0 ? 'pos' : 'neg'}">${pcts[k] >= 0 ? '▲' : '▼'} ${fmtPct(pcts[k])} · ${fmt(p.value - p.cost)}</div>`;
    tip.style.display = 'block';
    const left = (cx / W) * r.width;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.max(4, Math.min(r.width - tw - 4, left + (left > r.width / 2 ? -tw - 12 : 12)))}px`;
    tip.style.top = `8px`;
  };
  const hide = () => {
    cross.style.display = 'none';
    tip.style.display = 'none';
  };
  hit.addEventListener('pointermove', (e) => show(e.clientX));
  hit.addEventListener('pointerdown', (e) => show(e.clientX));
  hit.addEventListener('pointerleave', hide);
}

// Single-series price history (TCGplayer market, USD) with crosshair + tooltip.
// points: [{ d: 'YYYY-MM-DD', v: number }] sorted by date. Time-scaled x axis.
export function renderPriceChart(root, points, { fmt, fmtAlt }) {
  root.innerHTML = '';
  const W = Math.max(280, root.clientWidth || 340);
  const padL = 50, padR = 14, padT = 12, padB = 24, H1 = 190;
  const H = padT + H1 + padB;
  const iw = W - padL - padR;
  const n = points.length;
  const ts = points.map((p) => new Date(p.d + 'T12:00:00').getTime());
  const span = ts[n - 1] - ts[0] || 1;
  const xs = (i) => padL + (n === 1 ? iw / 2 : ((ts[i] - ts[0]) / span) * iw);
  const vals = points.map((p) => p.v);
  const t = niceTicks(Math.min(...vals) * 0.95, Math.max(...vals) * 1.05);
  const y = (v) => padT + H1 - ((v - t.lo) / (t.hi - t.lo)) * H1;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'pchart', role: 'img', 'aria-label': 'Historial de precio' });
  root.appendChild(svg);
  const grid = el('g', { class: 'grid' });
  t.ticks.forEach((v) => {
    grid.appendChild(el('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v) }));
    const tx = el('text', { x: padL - 6, y: y(v) + 3.5, 'text-anchor': 'end', class: 'tick' });
    tx.textContent = compact(v, 'USD');
    grid.appendChild(tx);
  });
  svg.appendChild(grid);

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join('');
  if (n > 1) {
    svg.appendChild(el('path', { d: `${line}L${xs(n - 1)} ${padT + H1}L${xs(0)} ${padT + H1}Z`, class: 'area-value' }));
    svg.appendChild(el('path', { d: line, class: 'line line-value' }));
  }
  if (n <= 2) points.forEach((p, i) => svg.appendChild(el('circle', { cx: xs(i), cy: y(p.v), r: 4, class: 'dot dot-value' })));

  [0, n - 1]
    .filter((v, i, a) => a.indexOf(v) === i)
    .forEach((i) => {
      const tx = el('text', { x: xs(i), y: H - 6, 'text-anchor': n === 1 ? 'middle' : i === 0 ? 'start' : 'end', class: 'tick' });
      tx.textContent = fmtDate(points[i].d);
      svg.appendChild(tx);
    });

  const cross = el('g', { class: 'cross', style: 'display:none' });
  const vline = el('line', { y1: padT, y2: padT + H1, class: 'vline' });
  const dot = el('circle', { r: 5, class: 'dot dot-value ring' });
  cross.append(vline, dot);
  svg.appendChild(cross);
  const tip = document.createElement('div');
  tip.className = 'ctip';
  root.appendChild(tip);
  const hit = el('rect', { x: padL - 10, y: 0, width: iw + 20, height: H, fill: 'transparent' });
  svg.appendChild(hit);
  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    let k = 0;
    for (let i = 1; i < n; i++) if (Math.abs(xs(i) - x) < Math.abs(xs(k) - x)) k = i;
    const p = points[k];
    cross.style.display = '';
    vline.setAttribute('x1', xs(k));
    vline.setAttribute('x2', xs(k));
    dot.setAttribute('cx', xs(k));
    dot.setAttribute('cy', y(p.v));
    const ch = k > 0 && points[k - 1].v ? p.v / points[k - 1].v - 1 : null;
    tip.innerHTML = `<div class="ctip-d">${esc(fmtDate(p.d))}</div><div><b>${fmt(p.v)}</b> <span class="muted">${fmtAlt ? fmtAlt(p.v) : ''}</span></div>${ch != null && Math.abs(ch) >= 0.0005 ? `<div class="${ch > 0 ? 'pos' : 'neg'}">${ch > 0 ? '▲' : '▼'} ${fmtPct(ch)} vs. punto anterior</div>` : ''}`;
    tip.style.display = 'block';
    const left = (xs(k) / W) * r.width, tw = tip.offsetWidth;
    tip.style.left = `${Math.max(4, Math.min(r.width - tw - 4, left + (left > r.width / 2 ? -tw - 12 : 12)))}px`;
    tip.style.top = '8px';
  };
  hit.addEventListener('pointermove', (e) => show(e.clientX));
  hit.addEventListener('pointerdown', (e) => show(e.clientX));
  hit.addEventListener('pointerleave', () => ((cross.style.display = 'none'), (tip.style.display = 'none')));
}
