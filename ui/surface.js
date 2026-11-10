// Analyse step: the fitted response over two factors (issue #88, phase 2) — a contour of the fit
// with the runs on it (coloured by response or residual, faded when away from the slice), and for a
// second-order fit the stationary point with its canonical axes.
import { h, help, select, dataTable } from './dom.js';
import { num } from '../js/format.js';
import { decode } from '../js/study.js';
import { responseSlice, stationaryPoint, runsOnSlice, canonicalAxesOn } from '../js/model/surface.js';
import { contourSVG, viridis } from '../js/io/svg-space.js';
import { svgEl } from './space.js';

const KIND = { maximum: 'a maximum', minimum: 'a minimum', saddle: 'a saddle point (a maximum in some directions, a minimum in others)' };

/** The panel for a fit (least squares, GLM, mixed or GLMM). resp: the response; ui/set: the Analyse step's state. */
export function surfacePanel(study, fit, { ui, set, resp }) {
  const F = study.factors, st = ui.surface ?? {}, upd = (patch) => set({ surface: { ...st, ...patch } });
  // continuous factors in the model
  const inModel = new Set((fit.model?.terms ?? []).flatMap(t => t.comps.flatMap(c => (c.f !== undefined ? [c.f] : Object.keys(c.I ?? {})))));
  const cont = F.map((f, j) => j).filter(j => F[j].type !== 'categorical' && inModel.has(F[j].id));
  if (cont.length < 2 || study.mixture) return null;
  // default pair: the two largest main effects
  const size = (j) => { const c = fit.columns?.indexOf(F[j].id) ?? -1; return c >= 0 ? Math.abs(fit.coef[c]) : 0; };
  const byEffect = cont.slice().sort((a, b) => size(b) - size(a));
  const pickIdx = (id, fallback) => { const j = F.findIndex(f => f.id === id); return cont.includes(j) ? j : fallback; };
  const xi = pickIdx(st.x, byEffect[0]), yi0 = pickIdx(st.y, byEffect[1]), yi = yi0 === xi ? byEffect.find(j => j !== xi) : yi0;
  const at = st.at ?? {};
  let sl, err = null;
  try { sl = responseSlice(study, fit, { x: xi, y: yi, at, n: 41 }); } catch (e) { err = e.message; }
  if (err) return h('section', { class: 'panel', id: 'surface' }, h('h2', {}, 'Fitted response'), h('div', { class: 'msg warning' }, err));
  const others = F.map((f, j) => j).filter(j => j !== xi && j !== yi);
  const runs = runsOnSlice(study, fit, { x: xi, y: yi, at });
  const colourBy = st.colour ?? 'response';
  const maxRes = Math.max(...runs.map(r => Math.abs(r.residual)).filter(Number.isFinite), 1e-300);
  const fillOf = (r) => {
    if (colourBy === 'response' && Number.isFinite(r.observed)) return viridis(sl.max > sl.min ? (r.observed - sl.min) / (sl.max - sl.min) : 0.5);
    if (colourBy === 'residual' && Number.isFinite(r.residual)) return r.residual >= 0 ? '#0072B2' : '#E69F00';
    return undefined;
  };
  const sp = (() => { try { return stationaryPoint(study, fit); } catch { return null; } })();
  const onSlice = sp && sp.factors.includes(F[xi].id) && sp.factors.includes(F[yi].id);
  const name = (j) => `${F[j].id}${F[j].units ? ` (${F[j].units})` : ''}`;
  const nat = (j, c) => num(decode(F[j], c), 4);
  const pick = (label, val, on) => h('label', { class: 'inline' }, label, select(cont.map(j => ({ value: F[j].id, label: F[j].id })), F[val].id, on, { 'aria-label': `surface ${label}` }));
  const sliders = others.map(j => (F[j].type === 'categorical'
    ? h('label', { class: 'inline small' }, F[j].id, select(F[j].levels.map((l, i) => ({ value: i, label: l })), at[F[j].id] ?? 0, (v) => upd({ at: { ...at, [F[j].id]: Number(v) } }), { 'aria-label': `surface hold ${F[j].id}` }))
    : h('label', { class: 'inline small' }, `${F[j].id} = ${nat(j, at[F[j].id] ?? 0)}`, h('input', { type: 'range', min: -1, max: 1, step: 0.05, value: at[F[j].id] ?? 0, 'aria-label': `surface hold ${F[j].id}`, onchange: (e) => upd({ at: { ...at, [F[j].id]: Number(e.target.value) } }) }))));
  const valueLabel = `${resp.name ?? resp.id}${resp.units ? ` (${resp.units})` : ''}${fit.kind === 'glmm' ? ', typical group' : ''}`;
  const svg = contourSVG({
    xs: sl.xs, ys: sl.ys, z: sl.z, xLabel: `${F[xi].id} (coded)`, yLabel: `${F[yi].id} (coded)`, valueLabel, digits: 4,
    runs: runs.map(r => ({ x: r.x, y: r.y, fade: others.length ? Math.min(1, r.distance / 1.5) : 0, fill: fillOf(r), r: colourBy === 'residual' && Number.isFinite(r.residual) ? 2.5 + 3 * Math.abs(r.residual) / maxRes : 3.3,
      title: `run ${r.run}: ${num(r.observed, 4)} (fitted ${num(r.fitted, 4)}, residual ${num(r.residual, 3)})${others.length ? `, ${num(r.distance, 2)} from this slice` : ''}` })),
    best: onSlice ? { x: sp.x[F[xi].id], y: sp.x[F[yi].id], title: `stationary point: ${sp.kind}, ${num(sp.value, 4)}` } : null,
    axes: canonicalAxesOn(sp, F[xi].id, F[yi].id).map(t => ({ ...t, label: `canonical axis (eigenvalue ${num(t.value, 3)})` })),
  });
  const spText = sp ? h('div', { class: `msg ${sp.inside ? '' : 'warning'}`, id: 'stationary' },
    `Stationary point of the fitted surface: ${KIND[sp.kind]} at ${sp.factors.map(id => { const j = F.findIndex(f => f.id === id); return `${id} = ${nat(j, sp.x[id])}`; }).join(', ')}, fitted ${num(sp.value, 4)}. `,
    sp.inside ? '' : 'It lies outside the region of the runs, so the fit there is an extrapolation: treat it as a direction to explore, not a prediction. ',
    `Canonical eigenvalues ${sp.eigen.map(e => num(e.value, 3)).join(', ')}${sp.eigen.some(e => Math.abs(e.value) < 0.1 * Math.max(...sp.eigen.map(x => Math.abs(x.value)))) ? ': one is close to 0, a ridge — many settings along it give nearly the same response' : ''}. `,
    others.some(j => sp.factors.includes(F[j].id)) ? h('button', { class: 'btn small', id: 'slice-to-stationary', onclick: () => upd({ at: { ...at, ...Object.fromEntries(sp.factors.filter(id => id !== F[xi].id && id !== F[yi].id).map(id => [id, Math.max(-1, Math.min(1, sp.x[id]))])) } }) }, 'slice through it') : null) : null;
  return h('section', { class: 'panel', id: 'surface' }, h('h2', {}, 'Fitted response', help('analysis', 'fitted-response')),
    h('div', { class: 'row small' }, pick('across', xi, (v) => upd({ x: v })), pick('up', yi, (v) => upd({ y: v })),
      h('label', { class: 'inline' }, 'runs coloured by', select([{ value: 'response', label: 'response' }, { value: 'residual', label: 'residual' }, { value: 'none', label: 'nothing' }], colourBy, (v) => upd({ colour: v }), { 'aria-label': 'surface run colour' })),
      others.length ? h('span', { class: 'muted' }, 'others held at:') : null, sliders),
    h('div', { class: 'plots' }, svgEl(svg, { id: 'surface-contour', 'data-runs': runs.length })),
    h('p', { class: 'muted small' }, `The fitted ${valueLabel} over ${name(xi)} (${nat(xi, sl.xs[0])} … ${nat(xi, sl.xs[sl.xs.length - 1])}) and ${name(yi)} (${nat(yi, sl.ys[0])} … ${nat(yi, sl.ys[sl.ys.length - 1])}), from ${num(sl.min, 4)} to ${num(sl.max, 4)}${others.length ? '; the other factors held as set above, and runs away from this slice faded' : ''}. `,
      colourBy === 'response' ? 'Each run is filled with its own result on the same colour scale: a run that stands out from the surface around it is one the model fits poorly.' : colourBy === 'residual' ? 'Blue: the run came out above the fit; orange: below; larger: further off.' : '',
      onSlice ? ' ✚ marks the stationary point, the dashed lines its canonical axes.' : ''),
    spText,
    h('details', {}, h('summary', { class: 'small' }, 'the runs on this slice'), dataTable([{ key: 'run', label: 'run', cls: 'n' }, { key: 'x', label: `${F[xi].id} (coded)`, cls: 'n', fmt: (v) => num(v, 3) }, { key: 'y', label: `${F[yi].id} (coded)`, cls: 'n', fmt: (v) => num(v, 3) },
      { key: 'observed', label: 'result', cls: 'n', fmt: (v) => num(v, 4) }, { key: 'fitted', label: 'fitted', cls: 'n', fmt: (v) => num(v, 4) }, { key: 'residual', label: 'residual', cls: 'n', fmt: (v) => num(v, 3) }, ...(others.length ? [{ key: 'distance', label: 'off the slice', cls: 'n', fmt: (v) => num(v, 2) }] : [])], runs)));
}
