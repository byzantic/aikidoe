// Design step: where the runs sit (issue #88) — the scatterplot matrix of the runs, the scaled
// prediction variance over two factors for a model, and the variance dispersion graph. Shown for a
// candidate design before it is created, and for the study's design (with any stages added since).
import { h, help, select, dataTable } from './dom.js';
import { num } from '../js/format.js';
import { codedRuns, spvSlice, vdg, feasibleSlice, spvFunction } from '../js/design/space.js';
import { pairsSVG, contourSVG, vdgSVG } from '../js/io/svg-space.js';

/** An SVG string as an element. */
export function svgEl(str, attrs = {}) { const d = h('div', { class: 'svg-wrap', ...attrs }); d.innerHTML = str; return d; }

/** The models offered for the variance pictures, the first the default: the intended one, then the usual ones the design can estimate. */
function modelsFor(study, X, intended) {
  const out = [];
  for (const m of [intended, 'quadratic', '2fi', 'main'].filter(Boolean)) {
    if (out.includes(m)) continue;
    try { spvFunction(study, X, m); out.push(m); } catch { /* not estimable */ }
  }
  return out;
}

/**
 * The panel. withDesign: the study with the design to show (a candidate's, or its own); key: a
 * name for the UI state (several panels may be on the page); intended: the design's intended model.
 */
export function spacePanel(withDesign, { ui, set, key = 'space', intended, title = 'Where the runs are' }) {
  const study = withDesign, st = ui[key] ?? {}, upd = (patch) => set({ [key]: { ...st, ...patch } });
  let sp;
  try { sp = codedRuns(study); } catch { return null; }
  if (!sp.runs.length) return null;
  const F = study.factors, k = F.length, X = sp.runs.map(r => r.x);
  const cont = F.map((f, j) => j).filter(j => F[j].type !== 'categorical');
  const parts = [];

  // ---------------------------------------------------------------- scatterplot matrix
  const shown = (st.pairs ?? F.map(f => f.id).slice(0, 6)).map(id => F.findIndex(f => f.id === id)).filter(j => j >= 0);
  const group = sp.runs.some(r => r.block !== undefined) ? 'block' : sp.runs.some(r => r.wholePlot !== undefined) ? 'wholePlot' : null;
  const n = 31, lim = (j) => Math.max(1, ...X.map(r => Math.abs(r[j])).filter(Number.isFinite)) * 1.12;
  const feas = study.constraints?.length ? (i, j) => feasibleSlice(study, { x: i, y: j, xs: [...Array(n).keys()].map(t => -lim(i) + 2 * lim(i) * t / (n - 1)), ys: [...Array(n).keys()].map(t => -lim(j) + 2 * lim(j) * t / (n - 1)) }) : null;
  parts.push(h('div', { class: 'row small' }, k > 2 ? ['factors:', F.map(f => h('button', { class: `btn small ${shown.includes(F.indexOf(f)) ? 'sel' : ''}`, 'aria-pressed': shown.includes(F.indexOf(f)) ? 'true' : 'false',
    onclick: () => { const cur = shown.map(j => F[j].id), next = cur.includes(f.id) ? cur.filter(x => x !== f.id) : [...cur, f.id].slice(-6); if (next.length >= 2) upd({ pairs: F.map(x => x.id).filter(x => next.includes(x)) }); } }, f.id))] : null),
    svgEl(pairsSVG(sp, { factors: shown, group, feasible: feas, natural: F.map(f => (f.type === 'categorical' ? null : { low: f.low, high: f.high, units: f.units })) }), { id: `${key}-pairs`, 'data-runs': sp.runs.length }),
    h('p', { class: 'muted small' }, `Every pair of factors in coded units (−1 low, +1 high), ${sp.runs.length} runs: the shape tells the kind of run, a number how many runs land on the same point in that pair${group ? `, the colour the ${group === 'block' ? 'block' : 'whole plot'}` : ''}${feas ? '; shaded: where the constraints rule settings out (the other factors at their centre)' : ''}. Up to 6 factors at once.`));

  // ---------------------------------------------------------------- prediction variance
  const models = modelsFor(study, X, intended);
  if (models.length && cont.length >= 2) {
    const model = models.includes(st.model) ? st.model : models[0];
    const xi = cont.includes(F.findIndex(f => f.id === st.x)) ? F.findIndex(f => f.id === st.x) : cont[0];
    const yi = cont.includes(F.findIndex(f => f.id === st.y)) && F.findIndex(f => f.id === st.y) !== xi ? F.findIndex(f => f.id === st.y) : cont.find(j => j !== xi);
    const at = st.at ?? {};
    let sl = null, err = null;
    try { sl = spvSlice(study, X, model, { x: xi, y: yi, at, n: 41 }); } catch (e) { err = e.message; }
    const others = F.map((f, j) => j).filter(j => j !== xi && j !== yi);
    const heldOf = (j) => (F[j].type === 'categorical' ? (at[F[j].id] ?? 0) : (at[F[j].id] ?? 0));
    const dist = (r) => Math.sqrt(others.reduce((s, j) => s + (F[j].type === 'categorical' ? (r.x[j] === heldOf(j) ? 0 : 1) : (r.x[j] - heldOf(j)) ** 2), 0));
    const pick = (label, val, on) => h('label', { class: 'inline' }, label, select(cont.map(j => ({ value: F[j].id, label: F[j].id })), F[val].id, on, { 'aria-label': `variance ${label}` }));
    const sliders = others.map(j => (F[j].type === 'categorical'
      ? h('label', { class: 'inline small' }, `${F[j].id}`, select(F[j].levels.map((l, i) => ({ value: i, label: l })), heldOf(j), (v) => upd({ at: { ...at, [F[j].id]: Number(v) } }), { 'aria-label': `hold ${F[j].id}` }))
      : h('label', { class: 'inline small' }, `${F[j].id} = ${num(heldOf(j), 2)}`, h('input', { type: 'range', min: -1, max: 1, step: 0.05, value: heldOf(j), 'aria-label': `hold ${F[j].id}`, onchange: (e) => upd({ at: { ...at, [F[j].id]: Number(e.target.value) } }) }))));
    parts.push(h('h3', {}, 'Prediction variance', help('concepts', 'prediction-variance')),
      h('div', { class: 'row small' }, h('label', { class: 'inline' }, 'model', select(models.map(m => ({ value: m, label: m })), model, (v) => upd({ model: v }), { 'aria-label': 'variance model' })),
        pick('across', xi, (v) => upd({ x: v })), pick('up', yi, (v) => upd({ y: v })), others.length ? h('span', { class: 'muted' }, 'others held at:') : null, sliders),
      err ? h('div', { class: 'msg warning' }, err) : h('div', { class: 'plots' },
        svgEl(contourSVG({ xs: sl.xs, ys: sl.ys, z: sl.z, xLabel: `${F[xi].id} (coded)`, yLabel: `${F[yi].id} (coded)`, valueLabel: 'scaled prediction variance', log: sl.max / sl.min > 20,
          runs: sp.runs.map(r => ({ x: r.x[xi], y: r.x[yi], fade: others.length ? Math.min(1, dist(r) / 1.5) : 0, title: `run ${r.run} (${r.kind})${others.length ? `, ${num(dist(r), 2)} from this slice` : ''}` })) }), { id: `${key}-spv` })),
      err ? null : h('p', { class: 'muted small' }, `N · Var(ŷ)/σ² for ${model}: how precisely the design predicts at each point (low is precise), with ${others.length ? 'the other factors held as set above; runs away from this slice are faded' : 'the runs on it'}. Over this slice it runs from ${num(sl.min, 3)} to ${num(sl.max, 3)}; ${sl.max > 2 * sl.min ? 'predictions near the edges are much less precise than in the middle' : 'it is fairly even'}.`));

    // ---------------------------------------------------------------- variance dispersion graph
    if (cont.length === k && k >= 2) {
      let g = null;
      try { g = vdg(study, X, model).curves; } catch { /* not estimable */ }
      if (g) parts.push(h('h3', {}, 'Variance dispersion', help('concepts', 'prediction-variance')),
        svgEl(vdgSVG(g, { marks: [{ x: 1, label: 'faces' }, ...(k > 1 ? [{ x: Math.sqrt(k), label: 'corners' }] : [])] }), { id: `${key}-vdg` }),
        h('p', { class: 'muted small' }, `The smallest, average and largest scaled prediction variance over all directions at each distance from the centre, for ${model}. A rotatable design has one line; a flat line means the same precision near the centre as further out. Compare designs on it before choosing.`),
        h('details', {}, h('summary', { class: 'small' }, 'values'), dataTable([{ key: 'radius', label: 'distance', cls: 'n', fmt: (v) => num(v, 3) }, { key: 'min', label: 'min', cls: 'n', fmt: (v) => num(v, 4) }, { key: 'mean', label: 'mean', cls: 'n', fmt: (v) => num(v, 4) }, { key: 'max', label: 'max', cls: 'n', fmt: (v) => num(v, 4) }], g)));
    }
  }
  return h('section', { class: 'panel', id: `${key}-panel` }, h('h2', {}, title, help('concepts', 'where-the-runs-are')), parts);
}
