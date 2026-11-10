// Small SVG charts for the UI: scatter / line plots with axes, reference lines and labels.
// Colours come from CSS classes (css/app.css), so plots follow the light / dark theme.
import { h } from './dom.js';
import { num } from '../js/format.js';

import { ticks } from '../js/io/ticks.js';
export { ticks };

const extent = (vals) => { const f = vals.filter(Number.isFinite); return f.length ? [Math.min(...f), Math.max(...f)] : [0, 1]; };
const pad = ([a, b], f = 0.06) => { const d = (b - a) || Math.abs(a) || 1; return [a - f * d, b + f * d]; };

/**
 * plot({ series: [{ points: [{ x, y, label?, hi? }], kind: 'points' | 'line', cls }  or  { kind: 'ribbon', points: [{ x, lo, hi }] }],
 *        hlines: [{ y, label, cls }], vlines: [{ x, label, cls }], band: { x0, x1 },
 *        xLabel, yLabel, width, height, xDomain, yDomain, labelPoints, xTicks: [{ x, label }] })
 * xTicks replaces the x axis's ticks (e.g. a log axis: x = log10 dose, labels 0.1, 1, 10).
 */
export function plot(o) {
  const W = o.width ?? 420, H = o.height ?? 260, m = { l: 52, r: 14, t: 10, b: 38 };
  const all = o.series.flatMap(s => s.points);
  const xs = all.map(p => p.x).concat((o.vlines ?? []).map(v => v.x)), ys = all.flatMap(p => (p.lo !== undefined ? [p.lo, p.hi] : [p.y])).concat((o.hlines ?? []).map(v => v.y));
  const [x0, x1] = o.xDomain ?? pad(extent(xs)), [y0, y1] = o.yDomain ?? pad(extent(ys));
  const X = (v) => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r), Y = (v) => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b);
  const svg = h('svg:svg', { class: 'plot', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.title ?? `${o.yLabel ?? ''} against ${o.xLabel ?? ''}` });
  const g = (cls, ...c) => h('svg:g', { class: cls }, ...c);
  const xt = o.xTicks ? o.xTicks.map(t => t.x) : ticks(x0, x1), yt = ticks(y0, y1);
  // tick labels with as many decimals as the step needs (50.85, 50.9 … not 50.9, 50.9)
  const tickFmt = (t) => { const st = t.length > 1 ? Math.abs(t[1] - t[0]) : 1, dec = Math.max(0, Math.min(8, -Math.floor(Math.log10(st) + 1e-9)));
    return (v) => (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-4 && v !== 0) ? num(v, 3) : v.toFixed(dec)); };
  const fx0 = tickFmt(xt), fy = tickFmt(yt);
  const fx = o.xTicks ? (v) => o.xTicks.find(t => t.x === v)?.label ?? '' : fx0;
  svg.append(g('grid', ...xt.map(v => h('svg:line', { x1: X(v), x2: X(v), y1: m.t, y2: H - m.b })), ...yt.map(v => h('svg:line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }))));
  if (o.band) svg.append(h('svg:rect', { class: 'band', x: X(o.band.x0), width: Math.max(0, X(o.band.x1) - X(o.band.x0)), y: m.t, height: H - m.t - m.b }));
  svg.append(g('axis',
    h('svg:line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b }), h('svg:line', { x1: m.l, x2: m.l, y1: m.t, y2: H - m.b }),
    ...xt.map(v => h('svg:text', { x: X(v), y: H - m.b + 14, 'text-anchor': 'middle' }, fx(v))),
    ...yt.map(v => h('svg:text', { x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end' }, fy(v))),
    o.xLabel ? h('svg:text', { x: (m.l + W - m.r) / 2, y: H - 6, 'text-anchor': 'middle' }, o.xLabel) : null,
    o.yLabel ? h('svg:text', { x: 12, y: (m.t + H - m.b) / 2, 'text-anchor': 'middle', transform: `rotate(-90 12 ${(m.t + H - m.b) / 2})` }, o.yLabel) : null));
  for (const r of o.hlines ?? []) svg.append(h('svg:line', { class: `ref ${r.cls ?? ''}`, x1: m.l, x2: W - m.r, y1: Y(r.y), y2: Y(r.y) }),
    r.label ? h('svg:text', { class: 'lbl', x: W - m.r - 2, y: Y(r.y) - 3, 'text-anchor': 'end' }, r.label) : null);
  (o.vlines ?? []).forEach((r, i) => svg.append(h('svg:line', { class: `ref ${r.cls ?? ''}`, x1: X(r.x), x2: X(r.x), y1: m.t, y2: H - m.b }),
    r.label ? h('svg:text', { class: 'lbl', x: X(r.x) + 3, y: m.t + 10 + 12 * i }, r.label) : null));   // staggered labels
  for (const s of o.series) {
    // a confidence band: points { x, lo, hi }
    if (s.kind === 'ribbon') { const pts = s.points.filter(p => Number.isFinite(p.lo) && Number.isFinite(p.hi));
      if (pts.length) svg.append(h('svg:path', { class: `ribbon ${s.cls ?? ''}`, d: pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.hi).toFixed(1)}`).join('') + pts.slice().reverse().map(p => `L${X(p.x).toFixed(1)},${Y(p.lo).toFixed(1)}`).join('') + 'Z' })); continue; }
    if (s.kind === 'line') svg.append(h('svg:path', { class: `ln ${s.cls ?? ''}`, d: s.points.filter(p => Number.isFinite(p.y)).map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('') }));
    else for (const p of s.points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      svg.append(h('svg:circle', { class: `pt ${p.hi ? 'hi' : ''} ${s.cls ?? ''}`, cx: X(p.x), cy: Y(p.y), r: 3.2 }, p.title ? h('svg:title', {}, p.title) : null));
      if (p.label && (o.labelPoints === 'all' || p.hi)) svg.append(h('svg:text', { class: 'lbl', x: X(p.x) - 5, y: Y(p.y) + 3.5, 'text-anchor': 'end' }, p.label));
    }
  }
  return svg;
}
