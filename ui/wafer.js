// Wafer plot of drop-in site values (issue #16): the wafer outline with a dot at each site,
// coloured by its value on a diverging scale around the mean, and the value printed beside it.
// Not a die map: aikidoe works with a few test sites per wafer (spec §7.2).
import { h } from './dom.js';
import { num } from '../js/format.js';

/**
 * waferPlot({ sites: Map id → { x, y, R }, values: Map id → number, title, size }) → SVG.
 * values may miss sites (drawn hollow).
 */
export function waferPlot({ sites, values, size = 240, title = '' }) {
  const R = Math.max(1, ...[...sites.values()].map(p => p.R || Math.hypot(p.x, p.y) * 1.15));
  const c = size / 2, sc = (size / 2 - 22) / R;
  const vals = [...values.values()].filter(Number.isFinite);
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const span = Math.max(1e-12, ...vals.map(v => Math.abs(v - mean)));
  const fill = (v) => {
    if (!Number.isFinite(v)) return 'none';
    const t = (v - mean) / span;                       // −1 … 1
    return t >= 0 ? `color-mix(in srgb, var(--hot, #c2410c) ${Math.round(100 * t)}%, var(--panel))` : `color-mix(in srgb, var(--cold, #1d4ed8) ${Math.round(-100 * t)}%, var(--panel))`;
  };
  const S = (tag, attrs, ...kids) => h(`svg:${tag}`, attrs, ...kids);
  return h('figure', { class: 'wafer' }, title ? h('figcaption', {}, title) : null,
    S('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img', 'aria-label': title || 'wafer plot', class: 'waferplot' },
      S('circle', { cx: c, cy: c, r: R * sc, class: 'wafer-outline' }),
      S('path', { d: `M ${c - 8} ${c + R * sc} L ${c + 8} ${c + R * sc}`, class: 'wafer-notch' }),
      [...sites].map(([id, p]) => {
        const v = values.get(id), x = c + p.x * sc, y = c - p.y * sc;
        return S('g', { 'data-site': id },
          S('circle', { cx: x, cy: y, r: 9, class: Number.isFinite(v) ? 'site-dot' : 'site-dot empty', style: `fill: ${fill(v)}` }, S('title', {}, `${id}: ${Number.isFinite(v) ? num(v) : 'no data'}`)),
          S('text', { x, y: y + 22, class: 'site-label' }, Number.isFinite(v) ? num(v, 3) : id));
      })));
}
