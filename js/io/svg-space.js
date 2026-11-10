// SVG pictures of where the runs sit (issue #88), as strings: the Design step inserts them, `doe
// plot` writes them to files. Text and lines use currentColor (they follow the page's theme); data
// colours are inline — the Okabe–Ito palette for groups and viridis for values, both readable with
// the common colour-vision deficiencies — and every mark has a <title> for screen readers.
//
//   pairsSVG(space, o)       scatterplot matrix of the runs in coded units: run kinds by shape,
//                            blocks or whole plots by colour, replicates as a count, infeasible
//                            areas (constraints) shaded
//   contourSVG(o)            a filled contour over two factors with contour lines and the runs
//   vdgSVG(curves, o)        the variance dispersion graph: min, mean and max against the radius
//   standalone(svg)          an SVG string as a file (xmlns, a default text colour)
import { num } from '../format.js';
import { ticks } from './ticks.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f1 = (v) => (Math.round(v * 10) / 10).toString();

/** Okabe–Ito: colour-blind safe categorical colours. */
export const GROUP_COLOURS = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00', '#F0E442', '#000000'];
const VIRIDIS = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
/** viridis at t in [0, 1] as #rrggbb. */
export function viridis(t) {
  const u = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (VIRIDIS.length - 1), i = Math.min(VIRIDIS.length - 2, Math.floor(u)), r = u - i;
  return '#' + VIRIDIS[i].map((c, k) => Math.round(c + (VIRIDIS[i + 1][k] - c) * r).toString(16).padStart(2, '0')).join('');
}

// run kinds: shape, label (most specific first when several kinds share a point)
export const KINDS = {
  factorial: { label: 'factorial', shape: 'circle' }, run: { label: 'run', shape: 'circle' },
  centre: { label: 'centre', shape: 'diamond' }, axial: { label: 'axial', shape: 'triangle' },
  optimal: { label: 'optimal', shape: 'square' }, augment: { label: 'augmented', shape: 'square-open' },
  foldover: { label: 'fold-over', shape: 'circle-open' }, confirm: { label: 'confirmation', shape: 'cross' },
};
const kindOf = (k) => KINDS[k] ?? KINDS.run;

function marker(shape, x, y, r, fill, title) {
  const t = title ? `<title>${esc(title)}</title>` : '';
  const X = f1(x), Y = f1(y);
  switch (shape) {
    case 'diamond': return `<path d="M${X},${f1(y - r * 1.3)}L${f1(x + r * 1.3)},${Y}L${X},${f1(y + r * 1.3)}L${f1(x - r * 1.3)},${Y}Z" fill="${fill}">${t}</path>`;
    case 'triangle': return `<path d="M${X},${f1(y - r * 1.3)}L${f1(x + r * 1.2)},${f1(y + r * 0.9)}L${f1(x - r * 1.2)},${f1(y + r * 0.9)}Z" fill="${fill}">${t}</path>`;
    case 'square': return `<rect x="${f1(x - r)}" y="${f1(y - r)}" width="${f1(2 * r)}" height="${f1(2 * r)}" fill="${fill}">${t}</rect>`;
    case 'square-open': return `<rect x="${f1(x - r)}" y="${f1(y - r)}" width="${f1(2 * r)}" height="${f1(2 * r)}" fill="none" stroke="${fill}" stroke-width="1.6">${t}</rect>`;
    case 'circle-open': return `<circle cx="${X}" cy="${Y}" r="${f1(r)}" fill="none" stroke="${fill}" stroke-width="1.6">${t}</circle>`;
    case 'cross': return `<path d="M${f1(x - r)},${f1(y - r)}L${f1(x + r)},${f1(y + r)}M${f1(x - r)},${f1(y + r)}L${f1(x + r)},${f1(y - r)}" stroke="${fill}" stroke-width="2" fill="none">${t}</path>`;
    default: return `<circle cx="${X}" cy="${Y}" r="${f1(r)}" fill="${fill}">${t}</circle>`;
  }
}

/** A factor's axis: coded positions of its values and the domain shown. */
function axisOf(factor, runs, j) {
  if (factor.type === 'categorical') {
    const L = factor.levels.length, pos = (i) => (L > 1 ? -1 + 2 * i / (L - 1) : 0);
    return { pos, domain: [-1.25, 1.25], ticks: factor.levels.map((l, i) => ({ v: pos(i), label: l })) };
  }
  const m = Math.max(1, ...runs.map(r => Math.abs(r.x[j])).filter(Number.isFinite));
  return { pos: (v) => v, domain: [-m * 1.12, m * 1.12], ticks: [-1, 0, 1].map(v => ({ v, label: v === 0 ? '0' : v > 0 ? '+1' : '−1' })) };
}

/**
 * Scatterplot matrix of the runs. space: codedRuns(study). opts: factors (indices, default the
 * first 6), cell (px, 120), group ('block' | 'wholePlot' | null: colour by it), feasible (i, j) →
 * feasibleSlice-like { xs, ys, ok } or null (shaded where false), natural: factors' low/high for the
 * diagonal labels ([{ low, high, units }]).
 */
export function pairsSVG(space, { factors, cell = 120, group = null, feasible = null, natural = [] } = {}) {
  const idx = factors ?? space.factors.map((_, j) => j).slice(0, 6), k = idx.length;
  const runs = space.runs, gap = 8, m = 22, W = m + k * cell + (k - 1) * gap + 6, H = W;
  const groups = group ? [...new Set(runs.map(r => r[group]).filter(v => v !== undefined))] : [];
  const colourOf = (r) => (group && r[group] !== undefined ? GROUP_COLOURS[groups.indexOf(r[group]) % GROUP_COLOURS.length] : 'currentColor');
  const axes = space.factors.map((f, j) => axisOf(f, runs, j));
  const out = [`<svg class="plot pairs" viewBox="0 0 ${W} ${H + 34}" width="${W}" height="${H + 34}" style="width:${W}px;max-width:100%;height:auto" role="img" aria-label="${esc(`where the ${runs.length} runs sit, every pair of ${idx.map(j => space.factors[j].id).join(', ')}, coded units`)}">`];
  out.push(`<desc>${esc(`${runs.length} runs; each panel plots one factor against another in coded units (−1 low, +1 high); a number beside a point counts the runs there.`)}</desc>`);
  const box = (a, b) => ({ x: m + b * (cell + gap), y: a * (cell + gap) });
  for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) {
    const { x: bx, y: by } = box(a, b), fi = idx[a], fj = idx[b], F = space.factors;
    if (a === b) {
      const nat = natural[fi];
      out.push(`<rect x="${bx}" y="${by}" width="${cell}" height="${cell}" fill="none" stroke="currentColor" stroke-opacity="0.25"/>`,
        `<text x="${bx + cell / 2}" y="${by + cell / 2 - 4}" text-anchor="middle" font-weight="600">${esc(F[fi].name ?? F[fi].id)}</text>`,
        nat && F[fi].type !== 'categorical' ? `<text x="${bx + cell / 2}" y="${by + cell / 2 + 12}" text-anchor="middle" font-size="9" opacity="0.75">${esc(`${num(nat.low, 4)} … ${num(nat.high, 4)}${nat.units ? ` ${nat.units}` : ''}`)}</text>` : '',
        F[fi].type === 'categorical' ? `<text x="${bx + cell / 2}" y="${by + cell / 2 + 12}" text-anchor="middle" font-size="9" opacity="0.75">${esc(F[fi].levels.join(', '))}</text>` : '');
      continue;
    }
    if (a < b) continue;                                              // lower triangle only
    const ax = axes[fj], ay = axes[fi], [x0, x1] = ax.domain, [y0, y1] = ay.domain;
    const X = (v) => bx + (v - x0) / (x1 - x0) * cell, Y = (v) => by + cell - (v - y0) / (y1 - y0) * cell;
    out.push(`<g class="panel" data-pair="${esc(F[fj].id)}:${esc(F[fi].id)}">`, `<rect x="${bx}" y="${by}" width="${cell}" height="${cell}" fill="none" stroke="currentColor" stroke-opacity="0.35"/>`);
    // the coded cube (−1 … +1) when the runs go beyond it
    if (F[fi].type !== 'categorical' && F[fj].type !== 'categorical' && (x1 > 1.2 || y1 > 1.2)) out.push(`<rect x="${f1(X(-1))}" y="${f1(Y(1))}" width="${f1(X(1) - X(-1))}" height="${f1(Y(-1) - Y(1))}" fill="none" stroke="currentColor" stroke-opacity="0.2" stroke-dasharray="3 2"/>`);
    const fz = feasible ? feasible(fj, fi) : null;
    if (fz) {
      const dx = (fz.xs[1] - fz.xs[0]) / 2, dy = (fz.ys[1] - fz.ys[0]) / 2;
      // each row's runs of infeasible cells as one rectangle (no seams)
      fz.ys.forEach((yv, r) => { for (let c = 0; c < fz.xs.length; c++) { if (fz.ok[r][c]) continue; let e = c; while (e + 1 < fz.xs.length && !fz.ok[r][e + 1]) e++;
        const xa = Math.max(x0, fz.xs[c] - dx), xb = Math.min(x1, fz.xs[e] + dx), ya = Math.max(y0, yv - dy), yb = Math.min(y1, yv + dy);
        if (xb > xa && yb > ya) out.push(`<rect class="infeasible" x="${f1(X(xa))}" y="${f1(Y(yb))}" width="${f1(X(xb) - X(xa))}" height="${f1(Y(ya) - Y(yb) + 0.3)}" fill="currentColor" fill-opacity="0.13"/>`); c = e; } });
    }
    for (const t of ax.ticks) out.push(`<line x1="${f1(X(t.v))}" x2="${f1(X(t.v))}" y1="${by + cell}" y2="${by + cell + 3}" stroke="currentColor" stroke-opacity="0.5"/>`);
    for (const t of ay.ticks) out.push(`<line x1="${bx - 3}" x2="${bx}" y1="${f1(Y(t.v))}" y2="${f1(Y(t.v))}" stroke="currentColor" stroke-opacity="0.5"/>`);
    if (a === k - 1) for (const t of ax.ticks) out.push(`<text x="${f1(X(t.v))}" y="${by + cell + 13}" text-anchor="middle" font-size="9">${esc(t.label)}</text>`);
    if (b === 0) for (const t of ay.ticks) out.push(`<text x="${bx - 5}" y="${f1(Y(t.v) + 3)}" text-anchor="end" font-size="9">${esc(t.label)}</text>`);
    // the runs projected onto this pair: one mark per point, kind and group; how many runs there
    const at = new Map();
    for (const r of runs) {
      const px = ax.pos(r.x[fj]), py = ay.pos(r.x[fi]), key = `${px.toFixed(6)},${py.toFixed(6)},${r.kind},${group ? r[group] : ''}`;
      if (!at.has(key)) at.set(key, { px, py, kind: r.kind, col: colourOf(r), runs: [] });
      at.get(key).runs.push(r.run);
    }
    const total = new Map();
    for (const p of at.values()) {
      const title = `${kindOf(p.kind).label} run${p.runs.length > 1 ? 's' : ''} ${p.runs.join(', ')}: ${F[fj].id} ${num(p.px, 3)}, ${F[fi].id} ${num(p.py, 3)} (coded)`;
      out.push(marker(kindOf(p.kind).shape, X(p.px), Y(p.py), 3.2, p.col, title));
      const pk = `${p.px.toFixed(6)},${p.py.toFixed(6)}`; total.set(pk, { p, n: (total.get(pk)?.n ?? 0) + p.runs.length });
    }
    // how many runs project onto each point (all kinds and groups together)
    for (const { p, n } of total.values()) if (n > 1) out.push(`<text x="${f1(X(p.px) + 5)}" y="${f1(Y(p.py) - 4)}" font-size="8.5">${n}</text>`);
    out.push('</g>');
  }
  // legend: the kinds present, the groups
  const kinds = [...new Set(runs.map(r => r.kind))];
  let lx = m, ly = H + 14;
  for (const kd of kinds) { out.push(marker(kindOf(kd).shape, lx + 4, ly - 3, 3.2, 'currentColor', null), `<text x="${lx + 11}" y="${ly}" font-size="10">${esc(kindOf(kd).label)}</text>`); lx += 22 + 6.2 * kindOf(kd).label.length; }
  if (groups.length) {
    out.push(`<text x="${lx + 4}" y="${ly}" font-size="10">${esc(group === 'block' ? 'blocks:' : 'whole plots:')}</text>`); lx += 70;
    for (const g of groups.slice(0, 12)) { out.push(`<circle cx="${lx}" cy="${ly - 3}" r="3.5" fill="${GROUP_COLOURS[groups.indexOf(g) % GROUP_COLOURS.length]}"/>`, `<text x="${lx + 6}" y="${ly}" font-size="10">${esc(g)}</text>`); lx += 14 + 6.2 * String(g).length; }
  }
  out.push('</svg>');
  return out.join('');
}

/** Marching squares: the segments of the level-c line through a grid (z rows over ys, values over xs). */
function isoSegments(xs, ys, z, c) {
  const seg = [];
  const lerp = (a, b, va, vb) => a + (b - a) * (c - va) / (vb - va);
  for (let r = 0; r < ys.length - 1; r++) for (let q = 0; q < xs.length - 1; q++) {
    const v = [z[r][q], z[r][q + 1], z[r + 1][q + 1], z[r + 1][q]];
    if (v.some(t => !Number.isFinite(t))) continue;
    const P = [[xs[q], ys[r]], [xs[q + 1], ys[r]], [xs[q + 1], ys[r + 1]], [xs[q], ys[r + 1]]];
    const pts = [];
    for (let e = 0; e < 4; e++) {
      const a = e, b = (e + 1) % 4;
      if ((v[a] < c) !== (v[b] < c)) pts.push([lerp(P[a][0], P[b][0], v[a], v[b]), lerp(P[a][1], P[b][1], v[a], v[b])]);
    }
    if (pts.length === 2) seg.push(pts);
    else if (pts.length === 4) { seg.push([pts[0], pts[1]]); seg.push([pts[2], pts[3]]); }
  }
  return seg;
}

/**
 * A filled contour: { xs, ys, z (rows over ys) } with optional runs [{ x, y, title, fade (0 … 1:
 * how far from the slice) }], best { x, y, title }, labels xLabel, yLabel, valueLabel, width,
 * levels (contour values; default ~7 nice ones), log (colour on the log scale), digits.
 */
export function contourSVG({ xs, ys, z, runs = [], best = null, xLabel = '', yLabel = '', valueLabel = 'value', width = 360, levels, log = false, digits = 3, title } = {}) {
  const m = { l: 44, r: 62, t: 10, b: 36 }, side = width - m.l - m.r, W = width, H = side + m.t + m.b;
  const x0 = xs[0], x1 = xs[xs.length - 1], y0 = ys[0], y1 = ys[ys.length - 1];
  const X = (v) => m.l + (v - x0) / (x1 - x0) * side, Y = (v) => m.t + side - (v - y0) / (y1 - y0) * side;
  const vals = z.flat().filter(Number.isFinite), lo = Math.min(...vals), hi = Math.max(...vals);
  const T = (v) => (log ? Math.log(v) : v), tl = T(lo), th = T(hi);
  const col = (v) => viridis(th > tl ? (T(v) - tl) / (th - tl) : 0.5);
  const out = [`<svg class="plot contour" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="width:${W}px;max-width:100%;height:auto" role="img" aria-label="${esc(title ?? `${valueLabel} over ${xLabel} and ${yLabel}`)}">`,
    `<desc>${esc(`${valueLabel} from ${num(lo, digits)} to ${num(hi, digits)} over ${xLabel} (${num(x0, 3)} … ${num(x1, 3)}) and ${yLabel} (${num(y0, 3)} … ${num(y1, 3)}).`)}</desc>`];
  // cells centred on the grid points
  const dx = (xs[1] - xs[0]) / 2, dy = (ys[1] - ys[0]) / 2;
  ys.forEach((yv, r) => xs.forEach((xv, q) => {
    const v = z[r][q];
    if (!Number.isFinite(v)) return;
    const xa = Math.max(x0, xv - dx), xb = Math.min(x1, xv + dx), ya = Math.max(y0, yv - dy), yb = Math.min(y1, yv + dy);
    out.push(`<rect x="${f1(X(xa))}" y="${f1(Y(yb))}" width="${f1(X(xb) - X(xa) + 0.5)}" height="${f1(Y(ya) - Y(yb) + 0.5)}" fill="${col(v)}"/>`);
  }));
  // contour lines, labelled where they are longest
  const lv = levels ?? (log ? ticks(tl, th, 6).map(Math.exp) : ticks(lo, hi, 6)).filter(c => c > lo && c < hi);
  for (const c of lv) {
    const segs = isoSegments(xs, ys, z, c);
    if (!segs.length) continue;
    const dark = th > tl ? (T(c) - tl) / (th - tl) < 0.55 : false;
    out.push(`<path d="${segs.map(([p, q]) => `M${f1(X(p[0]))},${f1(Y(p[1]))}L${f1(X(q[0]))},${f1(Y(q[1]))}`).join('')}" stroke="${dark ? '#ffffff' : '#222222'}" stroke-opacity="0.7" stroke-width="0.9" fill="none"><title>${esc(`${valueLabel} = ${num(c, digits)}`)}</title></path>`);
    const mid = segs[Math.floor(segs.length / 2)][0];
    out.push(`<text x="${f1(X(mid[0]))}" y="${f1(Y(mid[1]))}" font-size="8.5" fill="${dark ? '#ffffff' : '#222222'}" paint-order="stroke" stroke="${dark ? '#222222' : '#ffffff'}" stroke-width="2" stroke-opacity="0.6">${esc(num(c, digits))}</text>`);
  }
  // axes
  out.push(`<rect x="${m.l}" y="${m.t}" width="${side}" height="${side}" fill="none" stroke="currentColor" stroke-opacity="0.5"/>`);
  for (const v of ticks(x0, x1, 4)) out.push(`<line x1="${f1(X(v))}" x2="${f1(X(v))}" y1="${m.t + side}" y2="${m.t + side + 4}" stroke="currentColor"/><text x="${f1(X(v))}" y="${m.t + side + 15}" text-anchor="middle" font-size="9.5">${esc(num(v, 3))}</text>`);
  for (const v of ticks(y0, y1, 4)) out.push(`<line x1="${m.l - 4}" x2="${m.l}" y1="${f1(Y(v))}" y2="${f1(Y(v))}" stroke="currentColor"/><text x="${m.l - 6}" y="${f1(Y(v) + 3)}" text-anchor="end" font-size="9.5">${esc(num(v, 3))}</text>`);
  out.push(`<text x="${m.l + side / 2}" y="${H - 4}" text-anchor="middle">${esc(xLabel)}</text><text transform="translate(11 ${m.t + side / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`);
  // the runs: white-ringed dots, faded when away from the slice
  for (const r of runs) {
    if (r.x < x0 - 1e-9 || r.x > x1 + 1e-9 || r.y < y0 - 1e-9 || r.y > y1 + 1e-9) continue;
    const op = 1 - 0.75 * Math.min(1, Math.max(0, r.fade ?? 0));
    out.push(`<circle class="run" cx="${f1(X(r.x))}" cy="${f1(Y(r.y))}" r="3.3" fill="#111111" stroke="#ffffff" stroke-width="1.2" opacity="${op.toFixed(2)}">${r.title ? `<title>${esc(r.title)}</title>` : ''}</circle>`);
  }
  if (best) out.push(`<path class="best" d="M${f1(X(best.x) - 7)},${f1(Y(best.y))}L${f1(X(best.x) + 7)},${f1(Y(best.y))}M${f1(X(best.x))},${f1(Y(best.y) - 7)}L${f1(X(best.x))},${f1(Y(best.y) + 7)}" stroke="#ff2a6d" stroke-width="2.4"><title>${esc(best.title ?? 'best')}</title></path>`);
  // colour bar
  const bx = m.l + side + 14, bw = 10;
  for (let i = 0; i < 40; i++) { const t = i / 39, v = log ? Math.exp(tl + (th - tl) * t) : lo + (hi - lo) * t; out.push(`<rect x="${bx}" y="${f1(m.t + side - (i + 1) * side / 40)}" width="${bw}" height="${f1(side / 40 + 0.5)}" fill="${col(v)}"/>`); }
  out.push(`<text x="${bx + bw + 3}" y="${m.t + 8}" font-size="9">${esc(num(hi, digits))}</text><text x="${bx + bw + 3}" y="${m.t + side}" font-size="9">${esc(num(lo, digits))}</text>`,
    `<text transform="translate(${bx + bw + 28} ${m.t + side / 2}) rotate(90)" text-anchor="middle" font-size="9.5">${esc(valueLabel)}</text>`);
  out.push('</svg>');
  return out.join('');
}

/** Lines of the variance dispersion graph: curves [{ radius, min, mean, max }]. opts: label, cube (radius of the cube corners or faces to mark), width, height, compare ([{ label, curves }]). */
export function vdgSVG(curves, { width = 420, height = 240, label = 'scaled prediction variance', marks = [], title } = {}) {
  const m = { l: 50, r: 12, t: 10, b: 36 }, W = width, H = height;
  const xs = curves.map(c => c.radius), all = curves.flatMap(c => [c.min, c.max]);
  const x0 = 0, x1 = Math.max(...xs) * 1.02 || 1, y0 = 0, y1 = Math.max(...all) * 1.08 || 1;
  const X = (v) => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r), Y = (v) => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b);
  const out = [`<svg class="plot vdg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="width:${W}px;max-width:100%;height:auto" role="img" aria-label="${esc(title ?? `${label} against the distance from the centre`)}">`,
    `<desc>${esc(curves.map(c => `radius ${num(c.radius, 3)}: ${num(c.min, 4)} … ${num(c.max, 4)} (mean ${num(c.mean, 4)})`).join('; '))}</desc>`];
  for (const v of ticks(x0, x1, 5)) out.push(`<line x1="${f1(X(v))}" x2="${f1(X(v))}" y1="${m.t}" y2="${H - m.b}" stroke="currentColor" stroke-opacity="0.12"/><text x="${f1(X(v))}" y="${H - m.b + 14}" text-anchor="middle" font-size="9.5">${esc(num(v, 3))}</text>`);
  for (const v of ticks(y0, y1, 5)) out.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${f1(Y(v))}" y2="${f1(Y(v))}" stroke="currentColor" stroke-opacity="0.12"/><text x="${m.l - 5}" y="${f1(Y(v) + 3)}" text-anchor="end" font-size="9.5">${esc(num(v, 3))}</text>`);
  for (const mk of marks) out.push(`<line x1="${f1(X(mk.x))}" x2="${f1(X(mk.x))}" y1="${m.t}" y2="${H - m.b}" stroke="currentColor" stroke-dasharray="4 3" stroke-opacity="0.5"/><text x="${f1(X(mk.x) - 3)}" y="${H - m.b - 5}" text-anchor="end" font-size="9">${esc(mk.label)}</text>`);
  const line = (key, style) => `<path d="${curves.map((c, i) => `${i ? 'L' : 'M'}${f1(X(c.radius))},${f1(Y(c[key]))}`).join('')}" fill="none" stroke="${style.colour}" stroke-width="${style.w}"${style.dash ? ` stroke-dasharray="${style.dash}"` : ''}><title>${esc(key)}</title></path>`;
  out.push(line('max', { colour: '#0072B2', w: 2 }), line('mean', { colour: '#009E73', w: 1.6, dash: '6 3' }), line('min', { colour: '#D55E00', w: 2, dash: '2 2' }));
  out.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="currentColor"/><line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${H - m.b}" stroke="currentColor"/>`,
    `<text x="${(m.l + W - m.r) / 2}" y="${H - 6}" text-anchor="middle">distance from the centre (coded units)</text><text transform="translate(12 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">${esc(label)}</text>`);
  // legend
  [['max', '#0072B2', ''], ['mean', '#009E73', '6 3'], ['min', '#D55E00', '2 2']].forEach(([k, c, d], i) => out.push(`<line x1="${m.l + 10 + 62 * i}" x2="${m.l + 30 + 62 * i}" y1="${m.t + 6}" y2="${m.t + 6}" stroke="${c}" stroke-width="2"${d ? ` stroke-dasharray="${d}"` : ''}/><text x="${m.l + 34 + 62 * i}" y="${m.t + 9}" font-size="9.5">${k}</text>`));
  out.push('</svg>');
  return out.join('');
}

/** An SVG string as a standalone file: the namespace, a font and a default colour. */
export function standalone(svg) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" font-family="Helvetica, Arial, sans-serif" font-size="11" color="#1b1d21" style="background:#ffffff" ')}\n`;
}
