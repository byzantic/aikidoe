// Mixtures in the app (issue #62): the mixture-design panel (Design step), the ternary plot, and
// the mixture analysis (Analyse step): the grouped ANOVA, a ternary contour of the fitted response
// and the Cox-direction traces.
import { h, select, dataTable, help, toast } from './dom.js';
import { plot } from './plot.js';
import { num, pval } from '../js/format.js';
import { createStudy } from '../js/study.js';
import { lackOfFit } from '../js/model/ols.js';
import { platesWithoutWells } from '../js/plate.js';
import { mixtureOf, mixtureDesign, isSimplexRegion, mixtureAnova, coxTrace, ternaryGrid, extremeVertices } from '../js/design/mixture.js';

const S3 = Math.sqrt(3) / 2;
const numIn = (value, onchange, attrs = {}) => h('input', { class: 'num', type: 'number', step: 'any', value: value ?? '', onchange: (e) => onchange(e.target.value === '' ? undefined : Number(e.target.value)), ...attrs });

/**
 * A ternary plot: grid = ternaryGrid(…) with values y (NaN outside the region), points = design
 * blends ([{ z: [a, b, c], title }]), colour from low to high. Corners: the three components at
 * 100 % of what they share.
 */
export { shares };
export function ternaryPlot({ grid, points = [], label = 'y', width = 340, best = null, values = true }) {
  const W = width, pad = 46, side = W - 2 * pad, H = side * S3 + 2 * pad;
  const XY = (z) => [pad + side * (z[1] + z[2] / 2), pad + side * S3 * (1 - z[2])];
  const N = Math.round((-3 + Math.sqrt(1 + 8 * grid.points.length)) / 2);       // points = (N+1)(N+2)/2
  const at = new Map(grid.points.map(p => [`${Math.round(p.z[0] * N)},${Math.round(p.z[1] * N)}`, p]));
  const ys = grid.points.filter(p => p.feasible && Number.isFinite(p.y)).map(p => p.y), ymin = Math.min(...ys), ymax = Math.max(...ys);
  const col = (v) => { const t = ymax > ymin ? (v - ymin) / (ymax - ymin) : 0.5; return `color-mix(in srgb, var(--accent) ${Math.round(10 + 85 * t)}%, var(--panel))`; };
  const svg = h('svg:svg', { class: 'plot ternary', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${label} over ${grid.components.join(', ')}` });
  // small triangles of the grid, coloured by the mean of their corners
  for (let i = 0; i < N; i++) for (let j = 0; j < N - i; j++) {
    const tri = [[i, j], [i + 1, j], [i, j + 1]], tri2 = i + j < N - 1 ? [[i + 1, j], [i + 1, j + 1], [i, j + 1]] : null;
    for (const t of [tri, tri2]) {
      if (!t) continue;
      const ps = t.map(([a, b]) => at.get(`${a},${b}`));
      if (ps.some(p => !p)) continue;
      const ok = ps.every(p => p.feasible && Number.isFinite(p.y));
      const v = ok ? ps.reduce((s, p) => s + p.y, 0) / 3 : NaN;
      svg.append(h('svg:path', { class: ok ? 'tcell' : 'tcell out', d: ps.map((p, k) => `${k ? 'L' : 'M'}${XY(p.z).map(c => c.toFixed(1)).join(',')}`).join('') + 'Z', style: ok ? `fill:${col(v)}` : '' }, ok ? h('svg:title', {}, `${label} ≈ ${num(v, 4)}`) : null));
    }
  }
  const A = XY([1, 0, 0]), B = XY([0, 1, 0]), C = XY([0, 0, 1]);
  svg.append(h('svg:path', { class: 'tframe', d: `M${A}L${B}L${C}Z` }));
  const lo = grid.low ?? [0, 0, 0], span = grid.span ?? grid.left, lab = (k) => (lo.some(v => v > 0) ? `${grid.components[k]} ${num(lo[k] + span, 4)}` : grid.components[k]);
  svg.append(h('svg:text', { x: A[0] - 4, y: A[1] + 16, 'text-anchor': 'middle' }, lab(0)), h('svg:text', { x: B[0] + 4, y: B[1] + 16, 'text-anchor': 'middle' }, lab(1)), h('svg:text', { x: C[0], y: C[1] - 8, 'text-anchor': 'middle' }, lab(2)));
  for (const p of points) { const [x, y] = XY(p.z); svg.append(h('svg:circle', { class: 'tpt', cx: x, cy: y, r: 3 }, p.title ? h('svg:title', {}, p.title) : null)); }
  if (best) { const [x, y] = XY(best); svg.append(h('svg:path', { class: 'tbest', d: `M${x - 6},${y}L${x + 6},${y}M${x},${y - 6}L${x},${y + 6}` })); }
  return h('figure', { class: 'ternary-fig' }, svg, Number.isFinite(ymin) ? h('figcaption', { class: 'small muted' }, values ? `${label}: ${num(ymin, 4)} (light) … ${num(ymax, 4)} (dark); grey: outside the region.` : 'Shaded: the region the bounds leave.', lo.some(v => v > 0) ? ` Pseudo-components: at each corner that component has its value shown, the other two their lower bounds (${grid.components.map((id, k) => `${id} ${num(lo[k], 4)}`).join(', ')}).` : '') : null);
}

/** Shares of three components of a run's settings (for plotting a blend in a triangle). */
const shares = (s, comps, grid) => { const lo = grid?.low ?? [0, 0, 0], v = comps.map((id, k) => s[id] - lo[k]), t = v.reduce((a, x) => a + x, 0); return v.map(x => (t > 0 ? x / t : 1 / 3)); };

// ---------------------------------------------------------------- Design step

export function mixtureDesignPanel(ctx) {
  const { state, setDoc, setUI } = ctx;
  const study = state.study;
  if (!study.mixture) return null;
  const ui = state.ui.mixture ??= {}, set = (patch) => setUI({ mixture: { ...ui, ...patch } });
  const M = mixtureOf(study), simplex = isSimplexRegion(study);
  const kind = ui.kind ?? (simplex ? 'lattice' : 'vertices');
  const opts = { kind, degree: ui.degree ?? 2, axial: !!ui.axial, centre: ui.centre ?? (kind === 'vertices' ? 1 : 0), replicates: ui.replicates ?? 1,
    runs: ui.runs ?? (M.ids.length * (M.ids.length + 1) / 2 + 4) * (M.process.length ? 2 : 1), model: ui.model ?? 'mixquadratic', criterion: ui.criterion ?? 'D', seed: ui.seed ?? study.seed };
  let d = null, err = null;
  try { d = mixtureDesign(study, opts); } catch (e) { err = e.message; }
  const nObs = study.observations.length;
  const make = () => {
    const next = createStudy({ ...study, design: d, observations: [], ...platesWithoutWells(study), history: [{ stage: 'design', runs: d.runs.map(r => r.run), note: `mixture (${kind}), ${d.runs.length} runs` }] });
    state.step = 'run';
    setDoc(structuredClone(next));
    toast(`Mixture design: ${d.runs.length} runs`);
  };
  const ev = (() => { try { return extremeVertices(study); } catch { return null; } })();
  const dg = M.ids.length >= 3 && d ? ternaryGrid(study, () => 0, { components: M.ids.slice(0, 3), n: 24, pseudo: true }) : null;
  const tri = dg ? ternaryPlot({ grid: dg, label: 'design', values: false, points: d.runs.map(r => ({ z: shares(r.settings, M.ids.slice(0, 3), dg), title: `run ${r.run}: ${M.ids.map(id => `${id} ${num(r.settings[id], 4)}`).join(', ')}` })), width: 300 }) : null;
  return h('section', { class: 'panel', id: 'mixture-design' }, h('h2', {}, 'Mixture design', help('designs-mixture', '')),
    h('p', { class: 'small' }, `${M.ids.join(' + ')} = ${M.total}; ${simplex ? 'the bounds leave a simplex (a triangle for three components): lattice and centroid designs fit.' : 'upper bounds or constraints cut the simplex: extreme vertices or an optimal design.'}${M.process.length ? ` Process factors ${M.process.map(f => f.id).join(', ')} are crossed with the blends (each blend at their low and high settings).` : ''}${ev ? ` The region has ${ev.vertices.length} vertices.` : ''}`),
    h('div', { class: 'row' },
      h('label', { class: 'inline' }, 'design', select([
        { value: 'lattice', label: 'simplex lattice' }, { value: 'centroid', label: 'simplex centroid' },
        { value: 'vertices', label: 'extreme vertices and centroids' }, { value: 'optimal', label: 'optimal (D or I)' }], kind, (v) => set({ kind: v }), { 'aria-label': 'mixture design' })),
      kind === 'lattice' ? h('label', { class: 'inline' }, 'degree', select([1, 2, 3, 4], opts.degree, (v) => set({ degree: Number(v) }), { 'aria-label': 'lattice degree' })) : null,
      kind === 'optimal' ? [
        h('label', { class: 'inline' }, 'model', select(['mixlinear', 'mixquadratic', 'mixspecial', 'mixcubic'], opts.model, (v) => set({ model: v }), { 'aria-label': 'mixture model' })),
        h('label', { class: 'inline' }, 'runs', numIn(opts.runs, (v) => set({ runs: v }), { 'aria-label': 'mixture runs' })),
        h('label', { class: 'inline' }, 'criterion', select([{ value: 'D', label: 'D (coefficients)' }, { value: 'I', label: 'I (prediction)' }], opts.criterion, (v) => set({ criterion: v }), { 'aria-label': 'mixture criterion' }))] : null,
      kind !== 'optimal' ? h('label', { class: 'inline', title: 'check blends half way between the centroid and each vertex' }, h('input', { type: 'checkbox', checked: opts.axial, 'aria-label': 'axial blends', onchange: (e) => set({ axial: e.target.checked }) }), 'axial blends') : null,
      kind !== 'optimal' ? h('label', { class: 'inline' }, 'centroid runs', numIn(opts.centre, (v) => set({ centre: v ?? 0 }), { 'aria-label': 'centroid runs', min: 0 })) : null,
      h('label', { class: 'inline' }, 'replicates', numIn(opts.replicates, (v) => set({ replicates: v ?? 1 }), { 'aria-label': 'mixture replicates', min: 1 })),
      h('label', { class: 'inline' }, 'seed', numIn(opts.seed, (v) => set({ seed: v }), { 'aria-label': 'mixture seed' }))),
    err ? h('div', { class: 'msg error' }, err) : null,
    d ? h('div', { class: 'grid2' },
      h('div', {}, h('p', { class: 'small', id: 'mixture-preview' }, h('b', {}, `${d.runs.length} runs`), d.params.logdet !== undefined ? ` — ${d.params.criterion}-optimal for ${d.params.model}: log det ${num(d.params.logdet, 5)}, average prediction variance ${num(d.params.averageVariance, 3)}` : ''),
        h('p', { class: 'muted small' }, 'Lattice {q, m}: all blends in steps of 1/m — {q, 2} supports the quadratic model. Centroid: pure components, the binary 50:50 blends, … and the overall centroid — the special cubic. Extreme vertices: the corners of a constrained region, the centroids of its edges (and faces) and the overall centroid. Axial blends and centroid replicates add checks for lack of fit and pure error.')),
      tri) : null,
    h('div', { class: 'row' }, h('button', { class: `btn ${study.design && nObs ? 'danger' : 'primary'}`, id: 'mixture-create', disabled: !d, onclick: make },
      study.design ? (nObs ? `Replace the design and delete ${nObs} results` : 'Replace the design') : `Create this design (${d?.runs.length ?? 0} runs)`)));
}

// ---------------------------------------------------------------- Analyse step

/** The mixture ANOVA, the ternary contour of the fit, and the Cox traces. */
export function mixtureAnalysis(study, fit, ui, set, predictAt) {
  if (!study.mixture || !fit?.model.implied) return null;
  const M = mixtureOf(study);
  const A = mixtureAnova(fit);
  const lof = lackOfFit(fit);
  if (lof?.lackOfFit) { const res = A.pop(); A.push(res, { term: '  lack of fit', ...lof.lackOfFit }, { term: '  pure error', ...lof.pureError }); }
  const comps = (ui.ternary ?? M.ids.slice(0, 3)).filter(id => M.ids.includes(id));
  const three = comps.length === 3 ? comps : M.ids.slice(0, 3);
  const ag = M.ids.length >= 3 ? ternaryGrid(study, predictAt, { components: three, n: 30, pseudo: true }) : null;
  const tri = ag ? ternaryPlot({ grid: ag, label: fit.response, points: fit.rows.map(r => ({ z: shares(r.settings, three, ag), title: `run ${r.run}: ${num(r.y, 4)}` })) }) : null;
  const tr = coxTrace(study, predictAt, { points: 31 });
  const trPlot = plot({ xLabel: 'deviation from the reference blend', yLabel: fit.response, height: 240, width: 380,
    series: tr.map((t, k) => ({ kind: 'line', cls: `t${(k % 8) + 1}`, points: t.points.map(p => ({ x: p.dx, y: p.y })) })) });
  return h('section', { class: 'panel', id: 'mixture-analysis' }, h('h2', {}, 'Mixture', help('designs-mixture', 'analysis')),
    h('p', { class: 'small' }, `Coefficients are for L-pseudo-components (each component's share of what is left above the lower bounds, 0 … 1, scale ${num(M.scale, 6)}): a linear coefficient is the response of that pure pseudo-component; a positive A:B means A and B blend synergistically (better together than their average), a negative one antagonistically.`),
    h('h3', {}, 'ANOVA'),
    dataTable([{ key: 'term', label: 'source' }, { key: 'df', label: 'df', cls: 'n' }, { key: 'ss', label: 'sum of sq.', cls: 'n', fmt: (v) => num(v, 4) }, { key: 'ms', label: 'mean sq.', cls: 'n', fmt: (v) => num(v, 4) },
      { key: 'F', label: 'F', cls: 'n', fmt: (v) => (Number.isFinite(v) ? num(v, 4) : '') }, { key: 'p', label: 'p', cls: 'n', fmt: (v) => (Number.isFinite(v) ? pval(v) : '') }], A, { rowAttrs: (r) => ({ 'data-anova': r.term }) }),
    h('p', { class: 'muted small' }, 'Linear blending is tested against a constant (q − 1 df); each further term is added in order. R² and the F test above are likewise about the mean.'),
    h('div', { class: 'grid2' },
      tri ? h('div', {}, M.ids.length > 3 ? h('div', { class: 'row small' }, 'triangle of', ...[0, 1, 2].map(k => select(M.ids, comps[k] ?? M.ids[k], (v) => { const c = comps.slice(); c[k] = v; set({ ternary: c }); }, { 'aria-label': `ternary component ${k + 1}` })),
        h('span', { class: 'muted' }, 'the others at the region’s centroid')) : null, tri) : null,
      h('figure', {}, h('figcaption', {}, 'Traces along the Cox directions (each component changed, the others keeping their proportions), through the centroid of the region'),
        trPlot, h('div', { class: 'legend' }, tr.map((t, k) => h('span', {}, h('i', { style: `background: var(--trace-${(k % 8) + 1})` }), t.id))))));
}
