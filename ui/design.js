// Design step: compare candidate designs, set options, inspect diagnostics, create the design
// (spec §12 step 2).
import { h, select, messages, dataTable, help } from './dom.js';
import { plot } from './plot.js';
import { num } from '../js/format.js';
import { fullFactorial, fractionalFactorial, toStudyDesign } from '../js/design/factorial.js';
import { plackettBurman, correlationTable, PB_RUNS } from '../js/design/pb.js';
import { ccd, boxBehnken, varianceProfile } from '../js/design/rsm.js';
import { CATALOGUE } from '../js/design/catalogue.js';
import * as T from '../js/design/twolevel.js';
import { createStudy, feasible } from '../js/study.js';
import { definitiveScreening, dsdOrder } from '../js/design/dsd.js';
import { diagnoseCoded, compileModel } from '../js/design/optimal.js';
import { parseFormula } from '../js/model/formula.js';
import { nextStagePanel } from './augment.js';
import { platePanel } from './plates.js';
import { doseDesignPanel } from './dose.js';
import { mixtureDesignPanel } from './mixture.js';
import { platesWithoutWells } from '../js/plate.js';
import { designPower, detectableEffect } from '../js/model/power.js';
import { splitPlotFraction, splitPlotFull } from '../js/design/splitplot.js';
import { candidates, buildCandidate, intendedModel, wholePlotChoices, defaultWholePlots, recommend, GOALS } from '../js/design/recommend.js';

// the optimal-design search runs in a worker; one search at a time
let worker = null, searchId = 0;
function search(study, opts, onDone, extra = {}) {
  worker?.terminate();
  worker = new Worker(new URL('./optimal-worker.js', import.meta.url), { type: 'module' });
  const id = ++searchId;
  worker.onmessage = (e) => { if (e.data.id === id) { onDone(e.data); worker.terminate(); worker = null; } };
  worker.onerror = (e) => { onDone({ ok: false, error: e.message || 'the search failed' }); worker = null; };
  worker.postMessage({ study, opts, id, ...extra });
}
const optKey = (o) => JSON.stringify([o.optRuns, o.optModel, o.optCriterion, o.optRestarts, o.seed, o.optWholePlots, o.optEta]);

const roman = (n) => (Number.isFinite(n) ? ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n) : 'full');

const lhsCache = { key: null, d: null };

/** Build the design object for a candidate and the UI options (optimal designs: the worker's result). */
function build(study, cand, o) {
  if (cand.kind === 'optimal' || cand.kind === 'sp-optimal') {
    const r = o.optResult;
    if (!r || r.key !== optKey(o)) return null;          // not searched yet for these options
    if (!r.ok) throw new Error(r.error);
    return r.design;
  }
  if (cand.kind === 'lhs') {
    const key = `${o.lhsRuns ?? cand.runs}:${o.seed ?? study.seed}:${study.factors.map(f => f.id).join()}`;
    if (lhsCache.key !== key) Object.assign(lhsCache, { key, d: buildCandidate(study, cand, o) });
    return lhsCache.d;
  }
  return buildCandidate(study, cand, o);
}

export { candidates };

const designHelp = (kind) => [({ full: 'designs-factorial', fraction: 'designs-factorial', pb: 'designs-screening', dsd: 'designs-screening', ccd: 'designs-rsm', bbd: 'designs-rsm',
  optimal: 'designs-optimal', lhs: 'designs-space-filling' })[kind] ?? (kind.startsWith('sp-') ? 'designs-split-plot' : 'designs-factorial')];

export function render(ctx) {
  const { state, setDoc, setUI } = ctx;
  const study = state.study;
  // a mixture: the components add up to a total, so the factorial / response-surface designs do not apply
  if (study.mixture) return h('div', {}, study.design ? platePanel(ctx) : null, mixtureDesignPanel(ctx));
  const next = study.design && study.design.kind !== 'dose-response' ? nextStagePanel(ctx) : null;
  const ui = state.ui.design ??= {};
  const cands = candidates(study);
  if (!cands.length) return h('section', { class: 'panel' }, h('h2', {}, 'Design'), h('div', { class: 'msg warning' }, 'No design is available for these factors yet.'));
  const cand = cands.find(c => c.id === ui.id) ?? cands.find(c => (c.kind === 'fraction' || c.kind === 'sp-frac') && c.res >= 4) ?? cands[0];
  const set = (patch) => setUI({ design: { ...ui, ...patch } });

  // ---------------------------------------------------------------- recommender (shared with `doe recommend`)
  const recKey = JSON.stringify([study.factors, study.simulator?.adapter ?? null, ui.goal ?? null, ui.budget ?? null]);
  const rec = ui.rec?.key === recKey ? ui.rec.result : null;
  const recRow = h('div', { class: 'row', id: 'recommend' },
    h('label', { class: 'inline' }, 'goal', select([{ value: '', label: 'auto' }, ...Object.entries(GOALS).map(([value, g]) => ({ value, label: `${value} — ${g.what}` }))], ui.goal ?? '', (v) => set({ goal: v || undefined }), { 'aria-label': 'recommend goal' })),
    h('label', { class: 'inline' }, 'budget (runs)', h('input', { class: 'num', type: 'number', min: 1, value: ui.budget ?? '', placeholder: 'any', 'aria-label': 'recommend budget', onchange: (e) => set({ budget: e.target.value === '' ? undefined : Number(e.target.value) }) })),
    h('button', { class: 'btn primary', id: 'recommend-btn', onclick: () => {
      try { set({ rec: { key: recKey, result: recommend(study, { goal: ui.goal, budget: ui.budget }) }, recError: null }); } catch (e) { set({ recError: e.message }); }
    } }, 'Recommend'),
    rec ? h('span', { class: 'muted small' }, `ranked for: ${rec.goalText} (${rec.model}, ${rec.terms} terms); power at Δ = ${rec.delta}σ`) : null);
  const recOf = (id) => rec?.options.find(o => o.id === id);
  const rows = rec ? [...cands].sort((a, b) => (recOf(a.id)?.rank ?? 1e9) - (recOf(b.id)?.rank ?? 1e9)) : cands;
  const list = h('section', { class: 'panel' }, h('h2', {}, `Designs for ${study.factors.length} factors`, help('getting-started','choosing-a-design')), recRow, ui.recError ? h('div', { class: 'msg error' }, ui.recError) : null,
    dataTable([
      ...(rec ? [{ key: 'rank', label: '#', cls: 'n', fmt: (_, r) => recOf(r.id)?.rank ?? '—' }] : []),
      { key: 'label', label: 'design' }, { key: 'runs', label: 'runs', cls: 'n', fmt: (v, r) => recOf(r.id)?.runs ?? v },
      { key: 'res', label: 'resolution', fmt: (v, r) => (['ccd', 'bbd', 'dsd', 'optimal', 'sp-optimal', 'sp-full', 'lhs'].includes(r.kind) ? (r.kind === 'sp-full' ? roman(Infinity) : '—') : roman(v)) },
      ...(rec ? [{ key: 'pw', label: 'min power', cls: 'n', fmt: (_, r) => { const o = recOf(r.id); return o?.minPower != null ? num(o.minPower, 2) : '—'; } }] : []),
      { key: 'note', label: '', fmt: (v, r) => { const o = recOf(r.id); if (!o) return v; return h('div', { class: 'small', 'data-reasons': r.id }, o.reasons.length ? h('div', {}, o.reasons.join('; ')) : null, o.warnings.length ? h('div', { class: 'warn-text' }, o.warnings.join('; ')) : null); } },
    ], rows, { rowAttrs: (r) => ({ class: `click ${r.id === cand.id ? 'sel' : ''} ${rec && !recOf(r.id)?.rank ? 'muted' : ''}`, 'data-design': r.id, onclick: () => {
      const o = recOf(r.id), patch = { id: r.id, centre: undefined, blocks: undefined, rsmBlocks: false };
      if (o && (r.kind === 'optimal' || r.kind === 'sp-optimal')) Object.assign(patch, { optRuns: o.runs, optModel: rec.model, ...(o.wholePlots ? { optWholePlots: o.wholePlots } : {}) });
      if (o && r.kind === 'sp-full' && o.runs > r.runs) patch.replicates = Math.round(o.runs / r.runs);
      set(patch);
    } }) }),
    h('p', { class: 'muted small' }, 'Resolution III: main effects aliased with two-factor interactions; IV: main effects clear, 2fis aliased with each other; V: main effects and 2fis clear. Response-surface designs (central composite, Box–Behnken) estimate a full quadratic.'));

  // ---------------------------------------------------------------- options
  const isRSM = cand.kind === 'ccd' || cand.kind === 'bbd' || cand.kind === 'dsd' || cand.kind === 'optimal' || cand.kind === 'sp-optimal' || cand.kind === 'lhs';
  const isSP = cand.kind.startsWith('sp-');
  const field = (label, el) => h('label', { class: 'inline' }, label, el);
  const numIn = (key, attrs = {}) => h('input', { class: 'num', type: 'number', min: 0, value: ui[key] ?? '', 'aria-label': key, ...attrs, onchange: (e) => set({ [key]: e.target.value === '' ? undefined : Number(e.target.value) }) });
  const options = h('div', { class: 'row' },
    cand.kind === 'lhs' ? field('runs', numIn('lhsRuns', { min: 2, placeholder: String(cand.runs), 'aria-label': 'lhs runs' })) : null,
    cand.kind !== 'pb' && cand.kind !== 'optimal' && cand.kind !== 'lhs' && !isSP ? field('centre points', numIn('centre', { placeholder: isRSM ? 'auto' : '0', 'aria-label': 'centre points' })) : null,
    cand.kind === 'sp-frac' ? (() => { const htc = study.factors.map(x => !!x.htc), k1 = htc.filter(Boolean).length; const ch = wholePlotChoices(k1, htc.length - k1, cand.opts.runs);
      return field('whole plots', select(ch.map(W => ({ value: W, label: `${W} of ${cand.opts.runs / W} runs` })), ui.wholePlots ?? defaultWholePlots(k1, htc.length - k1, cand.opts.runs), (v) => set({ wholePlots: Number(v) }), { 'aria-label': 'whole plots' })); })() : null,
    cand.kind === 'sp-optimal' ? optimalOptions(study, ui, set, true) : null,
    cand.kind === 'dsd' ? field('fake factors', select([0, 1, 2, 3, 4], ui.fake ?? 0, (v) => set({ fake: Number(v) }), { 'aria-label': 'fake factors', title: 'extra conference-matrix columns, dropped; 2 improves estimation of second-order effects (Jones & Nachtsheim 2013)' })) : null,
    cand.kind === 'optimal' ? optimalOptions(study, ui, set) : null,
    cand.kind === 'ccd' && ui.rsmBlocks ? field('in the axial block', numIn('centreAxial', { placeholder: 'same' })) : null,
    !isRSM && cand.kind !== 'pb' ? field('replicates', numIn('replicates', { min: 1, placeholder: '1' })) : null,
    !isRSM && !isSP && cand.kind !== 'pb' && study.factors.every(f => f.type === 'continuous' || f.levels?.length === 2) ? field('blocks', select([1, 2, 4, 8], ui.blocks ?? 1, (v) => set({ blocks: Number(v) }), { 'aria-label': 'blocks' })) : null,
    cand.kind === 'ccd' ? field('α', select([{ value: '', label: 'rotatable' }, { value: 'orthogonal', label: 'orthogonal' }, { value: 'spherical', label: 'spherical (√k)' }, { value: 'faces', label: 'face-centred (1)' }, { value: 'number', label: 'value…' }], ui.alpha ?? '', (v) => set({ alpha: v || undefined }), { 'aria-label': 'alpha' })) : null,
    cand.kind === 'ccd' && ui.alpha === 'number' ? h('input', { class: 'num', type: 'number', step: 0.01, value: ui.alphaValue ?? 1.5, onchange: (e) => set({ alphaValue: Number(e.target.value) }) }) : null,
    cand.kind === 'ccd' ? field('inscribed', h('input', { type: 'checkbox', checked: !!ui.inscribed, onchange: (e) => set({ inscribed: e.target.checked }) })) : null,
    (cand.kind === 'ccd' || (cand.kind === 'bbd' && [4, 5].includes(study.factors.length))) ? field(cand.kind === 'ccd' ? 'cube / axial blocks' : 'blocks', h('input', { type: 'checkbox', checked: !!ui.rsmBlocks, onchange: (e) => set({ rsmBlocks: e.target.checked }) })) : null,
    field('seed', h('input', { class: 'num', type: 'number', value: ui.seed ?? study.seed, 'aria-label': 'seed', onchange: (e) => set({ seed: Number(e.target.value) }) })));

  let d, err = null;
  try { d = build(study, cand, ui); } catch (e) { err = e.message; }
  let body;
  if (err) body = h('div', { class: 'msg error' }, err);
  else if (!d) body = h('div', { class: 'msg' }, ui.searching ? 'Searching… (several random starts of a coordinate-exchange search)' : 'Set the model, runs and criterion, then search.');
  else body = h('div', {}, cand.ignoresHtc ? h('div', { class: 'msg warning' }, `This design ignores the hard-to-change factors: runs are completely randomised, so ${study.factors.filter(f => f.htc).map(f => f.id).join(', ')} must be reset for every run. Split-plot versions are offered for factorial and optimal designs.`) : null,
    diagnostics(study, d, cand.kind === 'dsd' || cand.kind === 'lhs' ? 'quadratic' : null),
    cand.kind === 'lhs' ? h('p', { class: 'small' }, `Each factor’s range is cut into ${d.X.length} equal slices with one run in each; among such designs this one keeps the runs as far apart as it can (smallest distance ${num(d.params.minDist, 3)} in coded units). A simulator gives the same answer every time, so there is no replication, randomisation or power: the question is how well a surrogate model fitted to these runs predicts between them — its cross-validated error, shown with the yield analysis.`)
      : powerSection(study, d, cand, ui, set));
  const detail = h('section', { class: 'panel' }, h('h2', {}, cand.label, help(...designHelp(cand.kind))), options, body);
  if (!d) err = err ?? 'not searched';

  // ---------------------------------------------------------------- create
  const nObs = study.observations.length;
  let create = null;
  if (!err) {
    const seed = ui.seed ?? study.seed;
    const make = () => {
      const design = toStudyDesign(study, d, { seed });
      const next = createStudy({ ...study, seed, design, observations: [], ...platesWithoutWells(study), history: [{ stage: 'design', runs: design.runs.map(r => r.run), note: `${cand.label}, ${design.runs.length} runs` }] });
      state.ui.design = { ...ui, id: cand.id };
      state.step = 'run';
      setDoc(structuredClone(next));
    };
    const infeasible = study.constraints.length ? toStudyDesign(study, d, { seed }).runs.filter(r => !feasible(study, r.settings)).length : 0;
    create = h('section', { class: 'panel' },
      infeasible ? h('div', { class: 'msg warning' }, `${infeasible} run(s) of this design break a constraint. Optimal designs (coming in a later version) respect constraints; for now choose a design that fits, or edit the constraints.`) : null,
      study.design && nObs ? h('div', { class: 'msg warning' }, `The study already has a design with ${nObs} result(s). Creating a new design removes them.`) : null,
      h('div', { class: 'row' },
        h('button', { class: `btn ${study.design && nObs ? 'danger' : 'primary'}`, id: 'create-design', onclick: make }, study.design ? (nObs ? `Replace the design and delete ${nObs} results` : 'Replace the design') : `Create this design (${d.X.length} runs)`),
        h('span', { class: 'muted small' }, `Runs are put in a random order from seed ${seed}; the same seed always gives the same run sheet.`)));
  }
  const plates = study.design ? platePanel(ctx) : null;
  return h('div', {}, plates, doseDesignPanel(ctx), next, next ? h('h2', { class: 'section-title' }, 'Or start again with a new design') : null, list, detail, create);
}

function diagnostics(study, d, modelFor) {
  const ids = study.factors.map(f => f.id);
  const parts = [h('div', { class: 'row small' }, h('span', { class: 'stat' }, h('b', {}, d.X.length), ' runs'),
    d.block ? h('span', { class: 'stat' }, h('b', {}, new Set(d.block).size), ' blocks') : null,
    d.params.resolution ? h('span', { class: 'stat' }, 'resolution ', h('b', {}, roman(d.params.resolution))) : null,
    d.params.alpha ? h('span', { class: 'stat' }, 'α = ', h('b', {}, num(d.params.alpha, 4))) : null,
    d.params.centrePoints !== undefined ? h('span', { class: 'stat' }, 'centre points ', h('b', {}, typeof d.params.centrePoints === 'object' ? `${d.params.centrePoints.perCubeBlock} + ${d.params.centrePoints.axialBlock}` : d.params.centrePoints)) : null)];
  if (d.regular) {
    const r = d.regular, nm = (i) => ids[i];
    const gen = r.cols.slice(r.q).map((m, j) => { const p = []; for (let i = 0; m >> i; i++) if (m >> i & 1) p.push(nm(i)); return `${nm(r.q + j)} = ${p.join(':')}`; });
    const chains = T.aliasChains(r, 2, ids).filter(c => c.effects.length > 1);
    parts.push(h('h3', {}, 'Aliasing'), h('div', { class: 'mono small' }, `generators: ${gen.join(', ')}`), h('div', { class: 'mono small' }, `defining relation: I = ${T.definingRelation(r, ids).slice(0, 8).join(' = ')}${T.definingRelation(r).length > 8 ? ' = …' : ''}`),
      chains.length ? h('details', { open: chains.length <= 12 }, h('summary', {}, `${chains.length} alias chains among main effects and two-factor interactions`), h('div', { class: 'mono small', 'data-aliases': '' }, chains.map(c => h('div', {}, c.effects.join(' = ')))))
        : h('div', { class: 'msg ok' }, 'No aliasing among main effects and two-factor interactions.'));
  }
  if (d.params.blockGenerators) parts.push(h('div', { class: 'small' }, `Blocks are confounded with ${[...d.params.confoundedWithBlocks[2], ...d.params.confoundedWithBlocks[3]].join(', ') || 'higher-order interactions only'}.`));
  if (d.kind === 'plackett-burman') {
    const t = correlationTable(d.X, ids);
    const mx = t.length ? Math.max(...t.map(e => Math.abs(e.r))) : 0;
    parts.push(h('h3', {}, 'Partial aliasing'), h('p', { class: 'small' }, `Main effects are orthogonal to each other. Each two-factor interaction is partially correlated with main effects it does not contain (largest |r| = ${num(mx, 3)}), so a large interaction can bias main-effect estimates but cannot hide completely.`));
  }
  if (d.kind === 'ccd' || d.kind === 'box-behnken') {
    const p = varianceProfile(d.X, { block: d.block, radii: [...Array(25).keys()].map(i => i * Math.max(...d.X.map(r => Math.hypot(...r))) / 24) });
    parts.push(h('h3', {}, 'Prediction variance (full quadratic)'),
      h('div', { style: 'max-width:520px' }, plot({ xLabel: 'distance from centre (coded units)', yLabel: 'scaled prediction variance', height: 220,
        series: [{ kind: 'line', points: p.map(x => ({ x: x.radius, y: x.max })) }, { kind: 'line', cls: 's2 dash', points: p.map(x => ({ x: x.radius, y: x.min })) }],
        vlines: [{ x: 1, label: 'cube', cls: 's2' }] })),
      h('p', { class: 'muted small' }, p.every(x => x.max - x.min < 1e-6 * x.max) ? 'Rotatable: the variance depends only on the distance from the centre.' : 'Solid: largest, dashed: smallest variance over directions at each distance.'));
  }
  if (d.wholePlot) {
    const W = new Set(d.wholePlot).size, sizes = [...new Set(d.wholePlot)].map(w => d.wholePlot.filter(x => x === w).length);
    const wpF = study.factors.filter(f => f.htc).map(f => f.id);
    parts.push(h('h3', {}, 'Whole plots'), h('p', { class: 'small', 'data-whole-plots': W },
      `${W} whole plots of ${Math.min(...sizes) === Math.max(...sizes) ? sizes[0] : `${Math.min(...sizes)}–${Math.max(...sizes)}`} runs. ${wpF.join(', ')} ${wpF.length > 1 ? 'are' : 'is'} set once per whole plot; the other factors change from run to run inside it. Whole plots are run in random order, and runs in random order within each.`));
    if (d.params.wholePlotEffects) {
      const nWP = d.params.wholePlotEffects.length, df = W - 1 - nWP;
      parts.push(h('div', { class: 'mono small' }, `generators: ${d.params.generators.join(', ') || 'none'}`),
        h('div', { class: 'small' }, 'Whole-plot effects (estimated against the larger whole-plot variance): ', h('span', { class: 'mono' }, d.params.wholePlotEffects.join(', '))),
        d.params.aliasChains.length ? h('details', { open: d.params.aliasChains.length <= 12 }, h('summary', {}, `${d.params.aliasChains.length} alias chains among main effects and two-factor interactions`), h('div', { class: 'mono small', 'data-aliases': '' }, d.params.aliasChains.map(c => h('div', {}, c))))
          : h('div', { class: 'msg ok' }, 'No aliasing among main effects and two-factor interactions.'),
        W - 1 - nWP < 2 ? h('div', { class: 'msg warning' }, `${W} whole plots leave ${Math.max(0, df)} degrees of freedom for the whole-plot error after the whole-plot effects above: too few to test them. Use more whole plots or replicate.`) : null);
    }
    if (d.kind === 'optimal-split-plot') parts.push(h('div', { class: 'row small', 'data-efficiency': '' }, h('span', { class: 'stat' }, 'D-optimal for ', h('b', {}, d.params.model)), h('span', { class: 'stat' }, 'η = ', h('b', {}, d.params.eta)), h('span', { class: 'stat' }, 'log|XᵀV⁻¹X| = ', h('b', {}, num(d.params.logDet, 5)))));
    parts.push(h('p', { class: 'muted small' }, 'Analysis: the Analyse step fits a mixed model (REML), testing whole-plot effects against the whole-plot variance.'));
  }
  if (d.kind === 'full-factorial' && !d.block) parts.push(h('p', { class: 'small' }, 'Every main effect and interaction can be estimated.'));
  if (d.kind === 'optimal' || d.kind === 'definitive-screening' || d.kind === 'lhs') {
    const g = d.diagnostics ?? diagnoseCoded(study, d.X, { model: modelFor });
    if (d.kind === 'definitive-screening') parts.push(h('p', { class: 'small' }, `Built from a conference matrix of order ${d.params.order}${d.params.fake ? ` (${d.params.fake} column${d.params.fake > 1 ? 's' : ''} dropped)` : ''}. Main effects are orthogonal to each other${d.params.categorical ? ' (up to a small correlation with the categorical factors)' : ''} and to every two-factor interaction and quadratic term; no two second-order terms are completely aliased. With few active factors, the full quadratic in those factors can be fitted.`));
    parts.push(h('h3', {}, `Efficiency${d.kind === 'definitive-screening' || d.kind === 'lhs' ? ' for the full quadratic' : ` for ${d.params.model}`}`),
      h('div', { class: 'row small', 'data-efficiency': '' },
        h('span', { class: 'stat' }, 'D ', h('b', {}, `${num(g.dEfficiency, 4)}%`)), h('span', { class: 'stat' }, 'A ', h('b', {}, `${num(g.aEfficiency, 4)}%`)),
        h('span', { class: 'stat' }, 'G ', h('b', {}, `${num(g.gEfficiency, 4)}%`)), h('span', { class: 'stat' }, 'average prediction variance ', h('b', {}, num(g.averageVariance, 4)))),
      h('p', { class: 'muted small' }, 'D, A, G: relative to an ideal orthogonal design of the same size on the coded cube (100% is rarely attainable for quadratic models). Average prediction variance (in units of σ²) is what I-optimality minimises.'),
      h('div', { class: 'grid2' },
        h('figure', {}, h('figcaption', {}, 'Fraction of design space'), plot({ xLabel: 'fraction of the region', yLabel: 'relative prediction variance', height: 220, series: [{ kind: 'line', points: g.fds.map(x => ({ x: x.fraction, y: x.variance })) }] })),
        h('figure', {}, h('figcaption', {}, 'Correlations between model terms'), correlationMap(g.correlations))));
  }
  return h('div', {}, parts);
}

function powerSection(study, d, cand, ui, set) {
  const pw = ui.power ?? {}, model = pw.models?.[cand.id] ?? intendedModel(study, d);
  const ratio = pw.ratio ?? 2, alpha = pw.alpha ?? 0.05;
  const setP = (patch) => set({ power: { ...pw, ...patch } });
  const controls = h('div', { class: 'row' },
    h('label', { class: 'inline' }, 'model', h('input', { type: 'text', class: 'formula', style: 'width:16em', value: model, 'aria-label': 'power model',
      onchange: (e) => setP({ models: { ...(pw.models ?? {}), [cand.id]: e.target.value.replace(/^.*~/, '').trim() || 'main' } }) })),
    h('label', { class: 'inline', title: 'the change in the response from the low to the high setting that matters, in units of the run-to-run standard deviation σ' }, 'effect Δ/σ',
      h('input', { class: 'num', type: 'number', min: 0.1, step: 0.1, value: ratio, 'aria-label': 'effect size', onchange: (e) => setP({ ratio: Number(e.target.value) }) })),
    h('label', { class: 'inline' }, 'α', select([0.01, 0.05, 0.1], alpha, (v) => setP({ alpha: Number(v) }), { 'aria-label': 'power alpha' })),
    d.wholePlot ? h('label', { class: 'inline', title: 'assumed ratio of whole-plot variance to run-to-run variance' }, 'η = σ²wp/σ²',
      h('input', { class: 'num', type: 'number', min: 0, step: 0.5, value: pw.eta ?? 1, 'aria-label': 'power eta', onchange: (e) => setP({ eta: Number(e.target.value) }) })) : null);
  // from a gauge study: Δ in the response's units, σ = √(σ_process² + σ_meas²)
  const measured = study.responses.filter(r => r.measurement);
  let units = null;
  if (measured.length) {
    const r = measured.find(x => x.id === pw.response) ?? measured[0], sm = r.measurement.sigma;
    const apply = (patch) => { const q = { ...pw, response: r.id, ...patch }; const sig = Math.sqrt((q.sigmaProcess ?? 0) ** 2 + sm ** 2); setP({ ...q, ratio: q.deltaUnits > 0 ? +(q.deltaUnits / sig).toPrecision(3) : pw.ratio }); };
    units = h('div', { class: 'row small', id: 'power-units' },
      measured.length > 1 ? select(measured.map(x => x.id), r.id, (v) => setP({ response: v }), { 'aria-label': 'power response' }) : h('span', {}, r.id),
      `: σ_meas = ${num(sm, 4)} from its gauge study${r.measurement.pctGRR !== undefined ? ` (GRR ${num(r.measurement.pctGRR, 3)} %)` : ''}.`,
      h('label', { class: 'inline' }, `Δ (${r.units ?? 'units'})`, h('input', { class: 'num', type: 'number', min: 0, step: 'any', value: pw.deltaUnits ?? '', 'aria-label': 'delta in units', onchange: (e) => apply({ deltaUnits: Number(e.target.value) }) })),
      h('label', { class: 'inline', title: 'run-to-run process variation beyond the measurement' }, 'σ process', h('input', { class: 'num', type: 'number', min: 0, step: 'any', value: pw.sigmaProcess ?? '', 'aria-label': 'sigma process', onchange: (e) => apply({ sigmaProcess: Number(e.target.value) }) })),
      h('span', { class: 'muted' }, pw.deltaUnits > 0 ? `→ Δ/σ = ${num(pw.deltaUnits / Math.sqrt((pw.sigmaProcess ?? 0) ** 2 + sm ** 2), 3)}${pw.sigmaProcess ? '' : ' (measurement noise only: an upper bound on power)'}` : 'sets Δ/σ'));
  }
  let res, err = null;
  try { res = designPower(study, d.X, { model, block: d.block, delta: ratio, alpha, ...(d.wholePlot ? { wholePlot: d.wholePlot, eta: pw.eta ?? 1 } : {}) }); } catch (e) { err = e.message; }
  let body;
  if (err) body = h('div', { class: 'msg error' }, err);
  else if (res.dfRes < 1 && !res.strata) body = h('div', { class: 'msg warning' }, `${res.n} runs for ${res.rank} coefficients: no residual degrees of freedom, so no test and no power for this model. Add centre points or replicates, use a smaller model, or rely on Lenth’s method.`);
  else {
    const det = Object.fromEntries(detectableEffect(res, { power: 0.8 }).map(x => [x.term, x.ratio]));
    const rows = res.terms.filter(t => !t.block);
    body = h('div', {},
      dataTable([{ key: 'term', label: 'term' }, { key: 'df', label: 'df', cls: 'n' }, ...(res.strata ? [{ key: 'ddf', label: 'error df', cls: 'n' }] : []),
        { key: 'power', label: `power at Δ/σ = ${ratio}`, cls: 'n', fmt: (v) => (Number.isNaN(v) ? h('span', { class: 'muted' }, 'aliased') : h('span', { class: v < 0.8 ? 'low-power' : '' }, num(v, 3))) },
        { key: 'det', label: 'Δ/σ for 80%', cls: 'n', fmt: (v) => (Number.isFinite(v) ? num(v, 3) : '') }],
      rows.map(t => ({ ...t, det: det[t.term] })), { rowAttrs: () => ({ 'data-power': '' }) }),
      h('p', { class: 'muted small' }, `${res.strata ? `Split-plot: whole-plot terms are tested against the whole-plot error (${res.strata[0].df} df), the others against the residual (${res.strata[1].df} df), with σ²wp = η σ². ` : `${res.dfRes} residual df. `}${res.terms.some(t => t.block) ? 'Blocks fitted. ' : ''}Power of each term’s F test (two-sided t for one df) to detect a change Δ from low to high, given σ. `,
        'Power below 0.8 is marked; Δ/σ for 80% is the smallest effect this design would usually find.'));
  }
  return h('div', { id: 'power' }, h('h3', {}, 'Power'), controls, units, body);
}

function optimalOptions(study, ui, set, split = false) {
  const k = study.factors.length, allCont = study.factors.every(f => f.type === 'continuous');
  const model = ui.optModel ?? (allCont && k <= 6 ? 'quadratic' : k <= 8 ? '2fi' : 'main');
  let p = null; try { p = compileModel(parseFormula(model, study.factors), study.factors).p; } catch { /* shown when searching */ }
  const runs = ui.optRuns ?? (p ? p + Math.max(4, Math.ceil(p / 4)) : 12);
  const wpDefault = Math.max(2, Math.round(runs / 4));
  const opts = { ...ui, optModel: model, optRuns: runs, optCriterion: split ? 'D' : ui.optCriterion ?? (model === 'quadratic' ? 'I' : 'D'), optRestarts: ui.optRestarts ?? 20,
    ...(split ? { optWholePlots: ui.optWholePlots ?? wpDefault, optEta: ui.optEta ?? 1 } : {}) };
  const go = () => {
    const key = optKey(opts);
    set({ ...opts, searching: true, optResult: null });
    if (split) search(study, { runs: opts.optRuns, wholePlots: opts.optWholePlots, model: opts.optModel, eta: opts.optEta, restarts: opts.optRestarts, seed: opts.seed ?? study.seed },
      (r) => set({ ...opts, searching: false, optResult: { ...r, key } }), { splitPlot: true });
    else search(study, { runs: opts.optRuns, model: opts.optModel, criterion: opts.optCriterion, restarts: opts.optRestarts, seed: opts.seed ?? study.seed },
      (r) => set({ ...opts, searching: false, optResult: { ...r, key } }));
  };
  return [
    h('label', { class: 'inline' }, 'model', h('input', { type: 'text', class: 'formula', style: 'width:18em', value: model, 'aria-label': 'optimal model', onchange: (e) => set({ optModel: e.target.value.replace(/^.*~/, '').trim() || 'main', optResult: null }) })),
    p ? h('span', { class: 'muted small' }, `${p} coefficients`) : null,
    h('label', { class: 'inline' }, 'runs', h('input', { class: 'num', type: 'number', min: p ?? 1, value: runs, 'aria-label': 'optimal runs', onchange: (e) => set({ optRuns: Number(e.target.value), optResult: null }) })),
    split ? [
      h('label', { class: 'inline' }, 'whole plots', h('input', { class: 'num', type: 'number', min: 2, value: opts.optWholePlots, 'aria-label': 'optimal whole plots', onchange: (e) => set({ optWholePlots: Number(e.target.value), optResult: null }) })),
      h('label', { class: 'inline', title: 'assumed ratio of whole-plot to run-to-run variance; 1 is the usual default' }, 'η', h('input', { class: 'num', type: 'number', min: 0, step: 0.1, value: opts.optEta, 'aria-label': 'eta', onchange: (e) => set({ optEta: Number(e.target.value), optResult: null }) }))]
    : h('label', { class: 'inline' }, 'criterion', select([{ value: 'D', label: 'D (estimate coefficients)' }, { value: 'I', label: 'I (predict well)' }, { value: 'A', label: 'A' }], opts.optCriterion, (v) => set({ optCriterion: v, optResult: null }), { 'aria-label': 'criterion' })),
    h('label', { class: 'inline' }, 'starts', h('input', { class: 'num', type: 'number', min: 1, value: opts.optRestarts, 'aria-label': 'restarts', onchange: (e) => set({ optRestarts: Number(e.target.value), optResult: null }) })),
    h('button', { class: 'btn primary', id: 'search-optimal', disabled: !!ui.searching, onclick: go }, ui.searching ? 'Searching…' : 'Search'),
  ];
}

/** Heat map of |correlation| between model terms. */
function correlationMap({ names, r }) {
  if (names.length > 30) return h('p', { class: 'muted small' }, `${names.length} terms: too many to show.`);
  const cell = (v) => h('td', { style: `background: color-mix(in srgb, var(--accent) ${Math.round(100 * Math.min(1, v))}%, transparent); width: 14px; height: 14px; padding: 0`, title: num(v, 3) });
  return h('div', { class: 'table-wrap' }, h('table', { class: 'corr', style: 'border-collapse: collapse; font-size: 10px' },
    h('tbody', {}, r.map((row, i) => h('tr', {}, h('th', { style: 'text-align:right; padding-right:4px; font-weight:400; white-space:nowrap' }, names[i]), row.map(cell))))),
    h('p', { class: 'muted small' }, 'Darker = more correlated (|r| from 0 to 1); hover for values.'));
}
