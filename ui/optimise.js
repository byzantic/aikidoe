// The Optimise step (issue #18): desirability goals for the responses, the best settings over
// the fitted models, a prediction profiler and a two-factor overlay of the desirability.
import { h, select, dataTable, messages } from './dom.js';
import { plot } from './plot.js';
import { num } from '../js/format.js';
import { fittedModels, optimiseDesirability, profile, desirabilityGrid, dValue, dOverall } from '../js/model/desirability.js';
import { decode, code } from '../js/study.js';

const GOALS = [{ value: 'none', label: '—' }, { value: 'maximize', label: 'maximise' }, { value: 'minimize', label: 'minimise' }, { value: 'target', label: 'target' }, { value: 'range', label: 'in range' }];

// fitted models, cached per study document and formulas (mixed fits take a moment)
let cache = { key: null, doc: null, value: null };
function models(state) {
  const formulas = state.ui.analyse?.formulas ?? {};
  const key = JSON.stringify(formulas);
  if (cache.doc !== state.doc || cache.key !== key) cache = { doc: state.doc, key, value: fittedModels(state.study, { formulas }) };
  return cache.value;
}

export function render(ctx) {
  const { state, update, setUI } = ctx, study = state.study;
  const ui = state.ui.optimise ??= {};
  const set = (patch) => setUI({ optimise: { ...ui, ...patch } });
  const numIn = (r, key, label) => h('input', { class: 'num', type: 'number', step: 'any', value: r[key] ?? '', 'aria-label': `${r.id} ${label}`,
    onchange: (e) => update(d => { const o = d.responses.find(x => x.id === r.id); if (e.target.value === '') delete o[key]; else o[key] = Number(e.target.value); }) });
  const goals = h('section', { class: 'panel' }, h('h2', {}, 'Goals'),
    h('p', { class: 'small' }, 'For each response, what is wanted and where it stops being acceptable. Maximise: unacceptable below lower, fully satisfactory at target (or upper). Minimise: fully satisfactory at target (or lower), unacceptable above upper. Target: lower – target – upper. The weight shapes the desirability curve (1 linear, > 1 stricter, < 1 more lenient); importance weights a response in the overall desirability.'),
    dataTable([{ key: 'id', label: 'response' }, { key: 'goal', label: 'goal' }, { key: 'lower', label: 'lower' }, { key: 'target', label: 'target' }, { key: 'upper', label: 'upper' },
      { key: 'weight', label: 'weight' }, { key: 'importance', label: 'importance' }, { key: 'formula', label: 'model' }],
    study.responses.filter(r => !r.derived || true).map(r => ({
      id: r.units ? `${r.id} (${r.units})` : r.id,
      goal: select(GOALS, r.goal, (v) => update(d => { d.responses.find(x => x.id === r.id).goal = v; }), { 'aria-label': `${r.id} goal` }),
      lower: numIn(r, 'lower', 'lower'), target: numIn(r, 'target', 'target'), upper: numIn(r, 'upper', 'upper'),
      weight: h('input', { class: 'num', type: 'text', value: Array.isArray(r.weight) ? r.weight.join(', ') : r.weight ?? '', placeholder: '1', 'aria-label': `${r.id} weight`, title: 'a number, or two (below, above) for a target',
        onchange: (e) => update(d => { const o = d.responses.find(x => x.id === r.id); const v = e.target.value.split(',').map(x => Number(x.trim())).filter(Number.isFinite); if (!v.length) delete o.weight; else o.weight = v.length === 2 ? v : v[0]; }) }),
      importance: numIn(r, 'importance', 'importance'),
      formula: h('input', { type: 'text', class: 'formula', style: 'width:15em', value: state.ui.analyse?.formulas?.[r.id] ?? '', placeholder: 'as on Analyse', 'aria-label': `${r.id} model`,
        onchange: (e) => setUI({ analyse: { ...(state.ui.analyse ?? {}), formulas: { ...(state.ui.analyse?.formulas ?? {}), [r.id]: e.target.value || undefined } } }) }),
    }))));
  let fm;
  try { fm = models(state); } catch (e) { return h('div', {}, goals, h('div', { class: 'msg error' }, e.message)); }
  const { models: ms, missing } = fm;
  const notes = missing.map(m => `${m.id}: ${m.reason}`);
  if (!ms.length) return h('div', {}, goals, messages([...notes, 'Give at least one response with results a goal and its limits (lower / target / upper) to optimise.'], 'warning'));

  // current settings: chosen by the user, else the optimum, else the centre
  const centre = Object.fromEntries(study.factors.map(f => [f.id, f.type === 'categorical' ? f.levels[0] : decode(f, 0)]));
  const at = { ...centre, ...(ui.result?.settings ?? {}), ...(ui.at ?? {}) };
  const isCCD = ['ccd'].includes(study.design?.kind) || study.design?.params?.stages?.some(s => s.kind === 'axial');
  const region = ui.region ?? 'cube';
  const controls = h('div', { class: 'row' },
    h('label', { class: 'inline' }, 'region', select([{ value: 'cube', label: 'factor ranges (cube)' }, { value: 'sphere', label: `sphere${isCCD ? ' (to the axial points)' : ''}` }], region, (v) => set({ region: v }), { 'aria-label': 'region' })),
    h('label', { class: 'inline', title: 'half-width of the cube or radius of the sphere, in coded units' }, region === 'sphere' ? 'radius' : 'half-width',
      h('input', { class: 'num', type: 'number', min: 0.1, step: 0.05, value: ui.radius ?? (region === 'sphere' ? (study.design?.params?.alpha ?? +Math.sqrt(study.factors.filter(f => f.type !== 'categorical').length).toFixed(3)) : 1), 'aria-label': 'radius', onchange: (e) => set({ radius: Number(e.target.value) }) })),
    h('label', { class: 'inline' }, 'hold', ...study.factors.map(f => h('label', { class: 'inline small' }, h('input', { type: 'checkbox', checked: !!ui.hold?.[f.id], 'aria-label': `hold ${f.id}`, onchange: (e) => set({ hold: { ...(ui.hold ?? {}), [f.id]: e.target.checked } }) }), f.id))),
    h('button', { class: 'btn primary', id: 'optimise', onclick: () => {
      try {
        const fixed = Object.fromEntries(study.factors.filter(f => ui.hold?.[f.id]).map(f => [f.id, at[f.id]]));
        const radius = ui.radius ?? (region === 'sphere' ? (study.design?.params?.alpha ?? Math.sqrt(study.factors.filter(f => f.type !== 'categorical').length)) : 1);
        const r = optimiseDesirability(study, ms, { region, radius, fixed, seed: study.seed });
        set({ result: { settings: r.settings, D: r.D, d: r.d }, at: null, error: null });
      } catch (e) { set({ error: e.message }); }
    } }, 'Find best settings'));
  const ds = ms.map(m => { const y = m.predict(at); return { id: m.id, y, d: dValue(m.spec, y) }; });
  const D = dOverall(ds.map(x => x.d), ms.map(m => m.spec.importance ?? 1));
  const res = h('div', { id: 'opt-result' },
    ui.error ? h('div', { class: 'msg error' }, ui.error) : null,
    h('div', { class: 'row small' }, h('span', { class: 'stat' }, `overall desirability ${ui.at ? 'at these settings' : ui.result ? 'at the optimum' : 'at the centre'} `, h('b', { 'data-d': D }, num(D, 4))),
      ...ds.map(x => h('span', { class: 'stat' }, `${x.id} `, h('b', {}, num(x.y)), ` d = ${num(x.d, 3)} `, h('span', { class: 'dbar' }, h('span', { style: `width:${(100 * x.d).toFixed(0)}%` }))))),
    dataTable([{ key: 'f', label: 'factor' }, { key: 'v', label: 'setting' }], study.factors.map(f => ({ f: f.units ? `${f.id} (${f.units})` : f.id,
      v: f.type === 'categorical' ? select(f.levels, at[f.id], (v) => set({ at: { ...at, [f.id]: v } }), { 'aria-label': `at ${f.id}` })
        : h('input', { class: 'num', type: 'number', step: 'any', value: +Number(at[f.id]).toPrecision(5), 'aria-label': `at ${f.id}`, onchange: (e) => set({ at: { ...at, [f.id]: Number(e.target.value) } }) }) }))),
    D === 0 ? h('p', { class: 'muted small' }, 'D = 0: at least one response is outside its acceptable range here.') : null);

  // profiler
  const prof = profile(study, ms, at, { points: 25 });
  const cont = study.factors;
  const grid = h('div', { class: 'profiler', style: `grid-template-columns: 90px repeat(${cont.length}, minmax(150px, 1fr))` },
    h('div', {}), ...cont.map(f => h('div', { class: 'colhead' }, f.units ? `${f.id} (${f.units})` : f.id)),
    ...ms.flatMap((m, i) => [h('div', { class: 'rowhead' }, m.id, h('br'), h('span', { class: 'muted' }, num(ds[i].y))),
      ...prof.map(p => {
        const f = study.factors.find(x => x.id === p.factor), c = p.curves[i];
        const xv = f.type === 'categorical' ? p.xs.map((_, j) => j) : p.xs.map(x => code(f, x));
        const lim = [m.spec.low, m.spec.target, m.spec.high].filter(Number.isFinite);
        return h('div', { class: 'cell', 'data-profile': `${m.id}:${f.id}`, title: 'click to set this factor', onclick: (e) => {
          const svg = e.currentTarget.querySelector('svg'), b = svg.getBoundingClientRect(), u = (e.clientX - b.left) / b.width * 240;
          const t = Math.max(0, Math.min(1, (u - 52) / (240 - 52 - 14)));
          set({ at: { ...at, [f.id]: f.type === 'categorical' ? f.levels[Math.round(t * (f.levels.length - 1))] : decode(f, -1 + 2 * t) } });
        } }, plot({ width: 240, height: 130, xDomain: f.type === 'categorical' ? [-0.5, f.levels.length - 0.5] : [-1.05, 1.05],
          series: [{ kind: 'ribbon', points: xv.map((x, j) => ({ x, lo: c.lower[j], hi: c.upper[j] })) }, { kind: f.type === 'categorical' ? 'points' : 'line', points: xv.map((x, j) => ({ x, y: c.fit[j] })) }],
          vlines: [{ x: f.type === 'categorical' ? f.levels.indexOf(at[f.id]) : code(f, at[f.id]), cls: 'cur' }], hlines: lim.map(y => ({ y, cls: 'lim' })),
          xLabel: '', yLabel: '' }));
      })]));
  const profPanel = h('section', { class: 'panel', id: 'profiler' }, h('h2', {}, 'Prediction profiler'),
    h('p', { class: 'small' }, 'Each response against each factor (coded −1 … +1) with the others held at the settings above, with 95% confidence bands; dashed lines mark the response’s limits. Click a plot to move that factor.'), grid);

  // overlay of D over two continuous factors
  const contF = study.factors.filter(f => f.type !== 'categorical');
  let overlay = null;
  if (contF.length >= 2) {
    const fx = ui.ox ?? contF[0].id, fy = ui.oy ?? contF[1].id;
    const gr = desirabilityGrid(study, ms, at, fx, fy, { n: 41 });
    const W = 320, Hh = 320, n = gr.xs.length, cw = W / n, ch = Hh / n;
    const svg = h('svg:svg', { class: 'heat', viewBox: `0 0 ${W + 50} ${Hh + 36}`, role: 'img', 'aria-label': `overall desirability over ${fx} and ${fy}` },
      ...gr.cells.flatMap((row, j) => row.map((c, i) => h('svg:rect', { x: 44 + i * cw, y: (n - 1 - j) * ch, width: cw + 0.5, height: ch + 0.5, class: c.ok ? '' : 'infeasible',
        style: c.ok ? `fill: color-mix(in srgb, var(--accent) ${Math.round(100 * c.D)}%, var(--panel))` : '' }))),
      h('svg:circle', { cx: 44 + (code(study.factors.find(f => f.id === fx), at[fx]) + 1) / 2 * W, cy: Hh - (code(study.factors.find(f => f.id === fy), at[fy]) + 1) / 2 * Hh, r: 5, class: 'site-dot' }),
      ...[[gr.xs[0], 44, 'start'], [gr.xs[n - 1], 44 + W, 'end']].map(([v, x, a]) => h('svg:text', { x, y: Hh + 14, 'text-anchor': a, class: 'site-label' }, num(v, 4))),
      ...[[gr.ys[0], Hh], [gr.ys[n - 1], 10]].map(([v, y]) => h('svg:text', { x: 40, y, 'text-anchor': 'end', class: 'site-label' }, num(v, 4))),
      h('svg:text', { x: 44 + W / 2, y: Hh + 28, 'text-anchor': 'middle', class: 'site-label' }, fx), h('svg:text', { x: 12, y: Hh / 2, 'text-anchor': 'middle', class: 'site-label', transform: `rotate(-90 12 ${Hh / 2})` }, fy));
    overlay = h('section', { class: 'panel', id: 'overlay' }, h('h2', {}, 'Overlay'),
      h('div', { class: 'row small' }, h('label', { class: 'inline' }, 'x', select(contF.map(f => f.id), fx, (v) => set({ ox: v }), { 'aria-label': 'overlay x' })),
        h('label', { class: 'inline' }, 'y', select(contF.map(f => f.id), fy, (v) => set({ oy: v }), { 'aria-label': 'overlay y' }))),
      svg, h('p', { class: 'muted small' }, `Overall desirability over ${fx} and ${fy} (the factor ranges), the other factors at the settings above. Grey: some response outside its acceptable range (or a constraint violated) — the sweet spot is the coloured region.`));
  }
  return h('div', {}, goals, messages(notes, 'warning'), h('section', { class: 'panel' }, h('h2', {}, 'Best settings'), controls, res), profPanel, overlay);
}
