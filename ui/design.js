// Design step: compare candidate designs, set options, inspect diagnostics, create the design
// (spec §12 step 2).
import { h, select, messages, dataTable, help } from './dom.js';
import { plot } from './plot.js';
import { num } from '../js/format.js';
import { estimableProjections } from '../js/design/projectivity.js';
import { spacePanel } from './space.js';
import { fullFactorial, fractionalFactorial, toStudyDesign } from '../js/design/factorial.js';
import { plackettBurman, correlationTable, PB_RUNS } from '../js/design/pb.js';
import { ccd, boxBehnken } from '../js/design/rsm.js';
import { CATALOGUE } from '../js/design/catalogue.js';
import * as T from '../js/design/twolevel.js';
import { createStudy, feasible, decode, covariatesWithoutValues } from '../js/study.js';
import { definitiveScreening, dsdOrder } from '../js/design/dsd.js';
import { diagnoseCoded, compileModel } from '../js/design/optimal.js';
import { parseFormula, modelMatrix } from '../js/model/formula.js';
import { nextStagePanel } from './augment.js';
import { covariateDesignPanel } from './allocate.js';
import { platePanel } from './plates.js';
import { doseDesignPanel } from './dose.js';
import { mixtureDesignPanel } from './mixture.js';
import { platesWithoutWells } from '../js/plate.js';
import { designPower, detectableEffect, detectableRatio, simulatePower } from '../js/model/power.js';
import { glmmPowerFromMatrix, detectableGlmmRatio, simulateGlmmPower } from '../js/model/power-glmm.js';
import { splitPlotFraction, splitPlotFull } from '../js/design/splitplot.js';
import { candidates, buildCandidate, intendedModel, wholePlotChoices, defaultWholePlots, recommend, GOALS, defaultBlockSize } from '../js/design/recommend.js';

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
  optimal: 'designs-optimal', lhs: 'designs-space-filling', rcbd: 'designs-comparative', latin: 'designs-comparative', bibd: 'designs-comparative', crossover: 'designs-comparative' })[kind] ?? (kind.startsWith('sp-') ? 'designs-split-plot' : 'designs-factorial')];

export function render(ctx) {
  const { state, setDoc, setUI } = ctx;
  const study = state.study;
  // a mixture: the components add up to a total, so the factorial / response-surface designs do not apply
  if (study.mixture) return h('div', {}, study.design ? platePanel(ctx) : null, covariateDesignPanel(ctx), mixtureDesignPanel(ctx));
  const next = study.design && study.design.kind !== 'dose-response' ? nextStagePanel(ctx) : null;
  const ui = state.ui.design ??= {};
  const cands = candidates(study, { budget: ui.budget });
  if (!cands.length) return h('section', { class: 'panel' }, h('h2', {}, 'Design'), h('div', { class: 'msg warning' }, 'No design is available for these factors yet.'));
  const cand = cands.find(c => c.id === ui.id) ?? cands.find(c => (c.kind === 'fraction' || c.kind === 'sp-frac') && c.res >= 4) ?? cands[0];
  const set = (patch) => setUI({ design: { ...ui, ...patch } });

  // ---------------------------------------------------------------- recommender (shared with `doe recommend`)
  const counts = countsSpec(study, ui.power);
  const recKey = JSON.stringify([study.factors, study.simulator?.adapter ?? null, ui.goal ?? null, ui.budget ?? null, counts]);
  const rec = ui.rec?.key === recKey ? ui.rec.result : null;
  const recRow = h('div', { class: 'row', id: 'recommend' },
    h('label', { class: 'inline' }, 'goal', select([{ value: '', label: 'auto' }, ...Object.entries(GOALS).map(([value, g]) => ({ value, label: `${value} — ${g.what}` }))], ui.goal ?? '', (v) => set({ goal: v || undefined }), { 'aria-label': 'recommend goal' })),
    h('label', { class: 'inline' }, 'budget (runs)', h('input', { class: 'num', type: 'number', min: 1, value: ui.budget ?? '', placeholder: 'any', 'aria-label': 'recommend budget', onchange: (e) => set({ budget: e.target.value === '' ? undefined : Number(e.target.value) }) })),
    h('button', { class: 'btn primary', id: 'recommend-btn', onclick: () => {
      try { set({ rec: { key: recKey, result: recommend(study, { goal: ui.goal, budget: ui.budget, ...(counts ? { counts } : {}) }) }, recError: null }); } catch (e) { set({ recError: e.message }); }
    } }, 'Recommend'),
    rec ? h('span', { class: 'muted small' }, `ranked for: ${rec.goalText} (${rec.model}, ${rec.terms} terms); power at ${rec.counts ? `${ratioWord(rec.counts.distribution)} ${rec.counts.ratio} for ${ui.power.response} (baseline ${rec.counts.baseline})` : `Δ = ${rec.delta}σ`}`) : null);
  const recOf = (id) => rec?.options.find(o => o.id === id);
  const rows = rec ? [...cands].sort((a, b) => (recOf(a.id)?.rank ?? 1e9) - (recOf(b.id)?.rank ?? 1e9)) : cands;
  const list = h('section', { class: 'panel' }, h('h2', {}, `Designs for ${study.factors.length} factors`, help('getting-started','choosing-a-design')), recRow, ui.recError ? h('div', { class: 'msg error' }, ui.recError) : null,
    dataTable([
      ...(rec ? [{ key: 'rank', label: '#', cls: 'n', fmt: (_, r) => recOf(r.id)?.rank ?? '—' }] : []),
      { key: 'label', label: 'design' }, { key: 'runs', label: 'runs', cls: 'n', fmt: (v, r) => recOf(r.id)?.runs ?? v },
      { key: 'res', label: 'resolution', fmt: (v, r) => (r.kind === 'pb' && r.gres !== null ? h('span', { title: 'generalised resolution (Deng & Tang): between III and IV — main effects only partially aliased with 2fis' }, num(r.gres, 3)) : ['ccd', 'bbd', 'dsd', 'optimal', 'sp-optimal', 'sp-full', 'lhs', 'rcbd', 'latin', 'bibd', 'crossover'].includes(r.kind) ? (r.kind === 'sp-full' ? roman(Infinity) : '—') : roman(v)) },
      ...(rec ? [{ key: 'proj', label: 'P', cls: 'n', fmt: (_, r) => { const o = recOf(r.id); return h('span', { title: 'projectivity: any P factors form a full two-level factorial' }, o?.projectivity != null && o.projectivity < study.factors.length ? `${o.projectivity}${o.projectivityCapped ? '+' : ''}` : '—'); } }] : []),
      ...(rec ? [{ key: 'pw', label: 'min power', cls: 'n', fmt: (_, r) => { const o = recOf(r.id); return o?.minPower != null ? num(o.minPower, 2) : '—'; } }] : []),
      { key: 'note', label: '', fmt: (v, r) => { const o = recOf(r.id); if (!o) return v; return h('div', { class: 'small', 'data-reasons': r.id }, o.reasons.length ? h('div', {}, o.reasons.join('; ')) : null, o.warnings.length ? h('div', { class: 'warn-text' }, o.warnings.join('; ')) : null); } },
    ], rows, { rowAttrs: (r) => ({ class: `click ${r.id === cand.id ? 'sel' : ''} ${rec && !recOf(r.id)?.rank ? 'muted' : ''}`, 'data-design': r.id, onclick: () => {
      const o = recOf(r.id), patch = { id: r.id, centre: undefined, blocks: undefined, rsmBlocks: false };
      if (o && (r.kind === 'optimal' || r.kind === 'sp-optimal')) Object.assign(patch, { optRuns: o.runs, optModel: rec.model, ...(o.wholePlots ? { optWholePlots: o.wholePlots } : {}) });
      if (o && r.kind === 'sp-full' && o.runs > r.runs) patch.replicates = Math.round(o.runs / r.runs);
      set(patch);
    } }) }),
    h('p', { class: 'muted small' }, 'Resolution III: main effects aliased with two-factor interactions; IV: main effects clear, 2fis aliased with each other; V: main effects and 2fis clear. Plackett–Burman designs sit between III and IV (generalised resolution, e.g. 3.67): their 2fis are spread thinly over the main effects. P (projectivity): any P factors form a full two-level factorial, so if only that many matter, their interactions can be estimated from the same runs. Response-surface designs (central composite, Box–Behnken) estimate a full quadratic.', help('designs-screening', 'projectivity')));

  // ---------------------------------------------------------------- options
  const isRSM = cand.kind === 'ccd' || cand.kind === 'bbd' || cand.kind === 'dsd' || cand.kind === 'optimal' || cand.kind === 'sp-optimal' || cand.kind === 'lhs';
  const isSP = cand.kind.startsWith('sp-');
  // designs for comparing the levels of one factor (issue #80): their own options only
  const isCmp = !!cand.comparative;
  const field = (label, el) => h('label', { class: 'inline' }, label, el);
  const numIn = (key, attrs = {}) => h('input', { class: 'num', type: 'number', min: 0, value: ui[key] ?? '', 'aria-label': key, ...attrs, onchange: (e) => set({ [key]: e.target.value === '' ? undefined : Number(e.target.value) }) });
  const textIn = (key, placeholder, label) => h('input', { type: 'text', style: 'width:8em', value: ui[key] ?? '', placeholder, 'aria-label': label, onchange: (e) => set({ [key]: e.target.value.trim() || undefined }) });
  const tLev = isCmp ? (study.factors[0].levels?.length ?? 0) : 0;
  const options = isCmp ? h('div', { class: 'row' },
    cand.kind === 'rcbd' ? field('blocks', numIn('cbBlocks', { min: 2, placeholder: '4', 'aria-label': 'complete blocks' })) : null,
    cand.kind === 'latin' ? [field('rows are', textIn('rowName', 'Row', 'latin rows')), field('columns are', textIn('colName', 'Column', 'latin columns')),
      field('squares', numIn('squares', { min: 1, placeholder: tLev === 3 ? '2' : '1', 'aria-label': 'squares' }))] : null,
    cand.kind === 'bibd' ? [field('block holds', select([...Array(tLev - 2).keys()].map(i => ({ value: i + 2, label: `${i + 2} runs` })), ui.blockSize ?? defaultBlockSize(tLev), (v) => set({ blockSize: Number(v), bibdBlocks: undefined }), { 'aria-label': 'block size' })),
      field('blocks', numIn('bibdBlocks', { min: 2, placeholder: 'smallest balanced', 'aria-label': 'incomplete blocks' }))] : null,
    cand.kind === 'crossover' ? [field('subjects', numIn('subjects', { min: 2, placeholder: 'auto', 'aria-label': 'subjects' })), field('subjects are', textIn('subjectName', 'Subject', 'crossover subjects')), field('periods are', textIn('periodName', 'Period', 'crossover periods'))] : null,
    field('seed', h('input', { class: 'num', type: 'number', value: ui.seed ?? study.seed, 'aria-label': 'seed', onchange: (e) => set({ seed: Number(e.target.value) }) })))
    : h('div', { class: 'row' },
    cand.kind === 'lhs' ? field('runs', numIn('lhsRuns', { min: 2, placeholder: String(cand.runs), 'aria-label': 'lhs runs' })) : null,
    cand.kind !== 'pb' && cand.kind !== 'optimal' && cand.kind !== 'lhs' && !isSP ? field('centre points', numIn('centre', { placeholder: isRSM ? 'auto' : '0', 'aria-label': 'centre points' })) : null,
    cand.kind === 'sp-frac' ? (() => { const htc = study.factors.map(x => !!x.htc), k1 = htc.filter(Boolean).length; const ch = wholePlotChoices(k1, htc.length - k1, cand.opts.runs);
      return field('whole plots', select(ch.map(W => ({ value: W, label: `${W} of ${cand.opts.runs / W} runs` })), ui.wholePlots ?? defaultWholePlots(k1, htc.length - k1, cand.opts.runs), (v) => set({ wholePlots: Number(v) }), { 'aria-label': 'whole plots' })); })() : null,
    cand.kind === 'sp-optimal' ? optimalOptions(study, ui, set, true) : null,
    cand.kind === 'dsd' ? field('fake factors', select([0, 1, 2, 3, 4], ui.fake ?? (study.factors.length <= 4 ? 6 - study.factors.length : 0), (v) => set({ fake: Number(v) }), { 'aria-label': 'fake factors', title: 'extra conference-matrix columns, dropped; 2 improves estimation of second-order effects (Jones & Nachtsheim 2013)' })) : null,
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
    isCmp ? comparativeInfo(study, d) : diagnostics(study, d, cand.kind === 'dsd' || cand.kind === 'lhs' ? 'quadratic' : null),
    cand.kind === 'lhs' ? h('p', { class: 'small' }, `Each factor’s range is cut into ${d.X.length} equal slices with one run in each; among such designs this one keeps the runs as far apart as it can (smallest distance ${num(d.params.minDist, 3)} in coded units). A simulator gives the same answer every time, so there is no replication, randomisation or power: the question is how well a surrogate model fitted to these runs predicts between them — its cross-validated error, shown with the yield analysis.`)
      : powerSection(study, d, cand, ui, set));
  const detail = h('section', { class: 'panel' }, h('h2', {}, cand.label, help(...designHelp(cand.kind))), options, body);
  // where the candidate's runs would sit (issue #88)
  let candSpace = null;
  if (d && !err) try { candSpace = spacePanel({ ...study, design: toStudyDesign(study, d, { seed: 1, randomise: 'none' }) }, { ui, set, key: 'space', intended: cand.kind === 'dsd' || cand.kind === 'lhs' ? 'quadratic' : intendedModel(study, d), title: `Where the runs are: ${cand.label}` }); } catch { /* not drawable */ }
  if (!d) err = err ?? 'not searched';

  // ---------------------------------------------------------------- create
  const nObs = study.observations.length;
  let create = null;
  if (!err) {
    const seed = ui.seed ?? study.seed;
    const make = () => {
      const design = toStudyDesign(study, d, { seed });
      const next = createStudy({ ...study, seed, design, observations: [], ...platesWithoutWells(study), ...covariatesWithoutValues(study), history: [{ stage: 'design', runs: design.runs.map(r => r.run), note: `${cand.label}, ${design.runs.length} runs` }] });
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
  // the study's own design, with any stages added since
  let curSpace = null;
  if (study.design && study.design.kind !== 'dose-response') try { curSpace = spacePanel(study, { ui, set, key: 'spaceCurrent', intended: study.design.params?.model ?? (['ccd', 'box-behnken', 'definitive-screening'].includes(study.design.kind) ? 'quadratic' : undefined), title: `Where the runs are: this study's design (${study.design.runs.length} runs)` }); } catch { /* not drawable */ }
  return h('div', {}, plates, doseDesignPanel(ctx), covariateDesignPanel(ctx), next, curSpace, next ? h('h2', { class: 'section-title' }, 'Or start again with a new design') : null, list, detail, candSpace, create);
}

// what a design for comparing treatments does, and its layout (issue #80)
function comparativeInfo(study, d) {
  const f = study.factors[0], lv = (i) => String(f.levels[i - 1]), p = d.params;
  const label = (x) => String(f.levels[f.levels.length === 2 ? (x + 1) / 2 : x]);
  const grid = (rowsOf, colsOf, rowHead, colHead) => {
    const R = [...new Set(rowsOf)], C = [...new Set(colsOf)].sort((a, b) => a - b);
    const cell = new Map(d.X.map((x, i) => [`${rowsOf[i]}|${colsOf[i]}`, label(x[0])]));
    return h('table', { class: 'data layout', 'data-layout': '' }, h('thead', {}, h('tr', {}, h('th', {}, `${rowHead} \\ ${colHead}`), ...C.map(c => h('th', {}, String(c))))),
      h('tbody', {}, ...R.map(r => h('tr', {}, h('th', {}, String(r)), ...C.map(c => h('td', {}, cell.get(`${r}|${c}`) ?? ''))))));
  };
  if (d.kind === 'complete-blocks') return h('div', {}, h('p', { class: 'small' }, `${p.blocks} blocks, each with every level of ${f.name} once, in random order within the block. Run a block in one go (a day, a batch, a plate): the analysis takes out the differences between blocks, so they do not blur the comparison.`));
  if (d.kind === 'latin-square') {
    const [r, c] = d.blocking;
    return h('div', {}, h('p', { class: 'small' }, `Each level of ${f.name} once in every ${r.name.toLowerCase()} and once in every ${c.name.toLowerCase()}: the analysis takes out both, so neither blurs the comparison. ${t3note(p)}The ${r.name.toLowerCase()}s are run in turn.`),
      grid(r.labels, c.labels, r.name, c.name));
  }
  if (d.kind === 'bibd') {
    return h('div', {}, h('p', { class: 'small' }, `${p.blocks} blocks of ${p.blockSize}; each level ${p.replicates} times${p.balanced ? `, every pair of levels together in ${p.lambda} block${p.lambda > 1 ? 's' : ''}, so every comparison is equally precise` : ' — not balanced: no balanced design was found with that many blocks, so some comparisons are less precise than others'}. `,
      `Efficiency ${num(p.efficiency, 3)}: the comparisons are as precise as with complete blocks and ${num(p.efficiency * p.replicates, 3)} runs of each level. With the blocks as random (Analyse), some of the information between blocks is recovered.`),
      h('table', { class: 'data layout', 'data-layout': '' }, h('tbody', {}, ...p.layout.map((b, j) => h('tr', {}, h('th', {}, `block ${j + 1}`), ...b.map(i => h('td', {}, lv(i))))))));
  }
  const [s, per] = d.blocking;
  return h('div', {}, h('p', { class: 'small' }, `${p.design === 'AB/BA' ? 'AB/BA' : 'Williams'} sequences: each ${s.name.toLowerCase()} has every level of ${f.name}, one per ${per.name.toLowerCase()}${p.design === 'AB/BA' ? '' : ', and each level follows every other equally often'}, so differences between ${s.name.toLowerCase()}s drop out of the comparison and carry-over (an effect lasting into the next ${per.name.toLowerCase()}) can be allowed for. `,
    p.balanced ? '' : h('b', {}, `${p.subjects} is not a multiple of the ${p.sequences.length} sequences, so the design is not balanced. `), `Leave a wash-out between ${per.name.toLowerCase()}s.`),
    grid(s.labels, per.labels, s.name, per.name));
}
const t3note = (p) => (p.treatments === 3 && p.squares === 1 ? 'One 3 × 3 square leaves only 2 degrees of freedom for the error: use two squares. ' : '');

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
    parts.push(h('p', { class: 'muted small' }, 'Analysis: the Analyse step fits a mixed model (REML for measurements; for counts and proportions a model with a random whole-plot shift), testing whole-plot effects against the whole-plot variation.'));
  }
  if (d.kind === 'full-factorial' && !d.block) parts.push(h('p', { class: 'small' }, 'Every main effect and interaction can be estimated.'));
  if (d.kind === 'optimal' || d.kind === 'definitive-screening' || d.kind === 'lhs') {
    const g = d.diagnostics ?? diagnoseCoded(study, d.X, { model: modelFor });
    if (d.kind === 'definitive-screening') parts.push(h('p', { class: 'small' }, `Built from a conference matrix of order ${d.params.order}${d.params.fake ? ` (${d.params.fake} column${d.params.fake > 1 ? 's' : ''} dropped)` : ''}. Main effects are orthogonal to each other${d.params.categorical ? ' (up to a small correlation with the categorical factors)' : ''} and to every two-factor interaction and quadratic term; no two second-order terms are completely aliased. ${(() => { const cont = d.X[0].map((_, j) => j).filter(j => !(d.params.categorical ?? []).includes(j)); return cont.length < 3 ? '' : estimableProjections(d.X, 3, { columns: cont }).share === 1 ? 'The full quadratic in any 3 factors can be fitted from these runs (in 4 factors only with 12 or more factors, and then not in all sets).' : `In ${d.X.length} runs the full quadratic cannot be fitted in every 3 factors: choose ${Math.max(1, 6 - d.X[0].length)} or more fake factors.`; })()}`));
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

// counts and proportions (issue #64): power for a rate or odds ratio, for a response chosen in the
// power section; the recommender ranks by it too
const isProp = (d) => String(d).includes('binomial') || d === 'bernoulli';
const ratioWord = (d) => (isProp(d) ? 'odds ratio' : 'rate ratio');
function countsSpec(study, pw = {}) {
  const r = study.responses.find(x => x.id === pw.response && x.distribution);
  if (!r) return null;
  const c = pw.counts?.[r.id] ?? {}, d = r.distribution;
  return { distribution: d, ...(r.link ? { link: r.link } : {}), baseline: c.baseline ?? (isProp(d) ? 0.5 : 10), ratio: c.ratio ?? 2,
    ...(isProp(d) ? { trials: d === 'bernoulli' ? 1 : r.trials ?? c.trials ?? 20 } : {}), ...(d === 'negbin' ? { theta: c.theta ?? 5 } : {}), ...(d.startsWith('quasi') ? { dispersion: c.dispersion ?? 1.5 } : {}) };
}

function countsPowerSection(study, d, cand, ui, set, model, alpha, controlsHead) {
  const pw = ui.power ?? {}, r = study.responses.find(x => x.id === pw.response), spec = countsSpec(study, pw);
  const c = pw.counts?.[r.id] ?? {};
  const setC = (patch) => set({ power: { ...pw, counts: { ...(pw.counts ?? {}), [r.id]: { ...c, ...patch } }, sim: null } });
  const numIn = (key, label, title, value, attrs = {}) => h('label', { class: 'inline', title }, label,
    h('input', { class: 'num', type: 'number', step: 'any', value, 'aria-label': `power ${key}`, onchange: (e) => setC({ [key]: Number(e.target.value) }), ...attrs }));
  const prop = isProp(spec.distribution), rw = ratioWord(spec.distribution);
  const controls = h('div', { class: 'row' }, controlsHead,
    numIn('baseline', prop ? 'baseline proportion' : 'baseline count', prop ? 'the proportion of successes you expect at the centre of the design' : 'the mean count you expect at the centre of the design (per unit exposure)', spec.baseline, { min: 0 }),
    numIn('ratio', rw, prop ? 'the odds ratio from a factor’s low to its high setting that matters' : 'the ratio of mean counts, high over low setting, that matters', spec.ratio, { min: 1, step: 0.1 }),
    prop && spec.distribution !== 'bernoulli' && r.trials === undefined ? numIn('trials', 'trials per run', 'the number of trials (cells, seeds …) in each run', spec.trials, { min: 1, step: 1 }) : null,
    spec.distribution === 'negbin' ? numIn('theta', 'θ', 'the overdispersion you expect: variance μ + μ²/θ (smaller θ, more variable)', spec.theta, { min: 0 }) : null,
    spec.distribution.startsWith('quasi') ? numIn('dispersion', 'dispersion', 'variance as a multiple of the Poisson or binomial variance', spec.dispersion, { min: 1 }) : null);
  // a split-plot with Poisson or negative binomial counts, binomial or pass/fail results: the analysis's random whole-plot effect, with σ on the link scale
  const wpSigma = d.wholePlot && ['poisson', 'negbin', 'binomial', 'bernoulli'].includes(spec.distribution) ? (c.sigmaWp ?? 0.3) : null;
  if (wpSigma !== null) controls.append(numIn('sigmaWp', `whole-plot σ (${prop ? 'logit' : 'log'} scale)`, 'how much whole plots differ beyond the run-to-run variation, as the standard deviation of their shift on the link scale (0.3 on the log scale: whole plots about 30 % apart)', wpSigma, { min: 0, step: 0.05 }));
  let res, err = null;
  try {
    res = wpSigma !== null ? glmmPowerFromMatrix(designMatrix(study, d, model), d.wholePlot.map(String), { ...spec, alpha, sigma: wpSigma })
      : designPower(study, d.X, { model, block: d.block, alpha, ...spec });
  } catch (e) { err = e.message; }
  if (err) return h('div', { id: 'power' }, h('h3', {}, 'Power'), controls, h('div', { class: 'msg error' }, err));
  const det = Object.fromEntries((wpSigma !== null ? detectableGlmmRatio(res, { power: 0.8 }) : detectableRatio(res, { power: 0.8 })).map(x => [x.term, x.ratio]));
  const nsim = wpSigma !== null ? 100 : 200;
  const simKey = JSON.stringify([cand.id, model, spec, alpha, wpSigma]);
  const sim = pw.sim?.key === simKey ? Object.fromEntries(pw.sim.result.map(x => [x.term, x])) : null;
  const runSim = () => {
    const m = designMatrix(study, d, model);
    set({ power: { ...pw, sim: { key: simKey, result: wpSigma !== null ? simulateGlmmPower(m, d.wholePlot.map(String), { ...spec, alpha, sigma: wpSigma, nsim, seed: study.seed })
      : simulatePower(m, { ...spec, alpha, nsim, seed: study.seed }) } } });
  };
  const rows = res.terms.filter(t => !t.block);
  return h('div', { id: 'power' }, h('h3', {}, 'Power'), controls,
    d.wholePlot && wpSigma === null ? h('div', { class: 'msg warning' }, 'Split-plot: this power treats every run as independent (a random whole-plot effect is available for Poisson, binomial and pass/fail results only), so it overstates the power for hard-to-change factors.') : null,
    wpSigma !== null ? h('p', { class: 'small', id: 'power-splitplot' }, `Split-plot: ${res.groups} whole plots. A factor that changes only between whole plots is judged against how much they differ (an F test on ${res.dfGroups} df, as in the analysis); the others against the run-to-run variation.`) : null,
    wpSigma !== null && res.dfGroups < 1 ? h('div', { class: 'msg warning' }, `${res.groups} whole plots leave nothing to judge the hard-to-change factors against: add replicates (more whole plots).`) : null,
    dataTable([{ key: 'term', label: 'term' }, { key: 'df', label: 'df', cls: 'n' },
      ...(wpSigma !== null ? [{ key: 'wholePlot', label: 'tested against', fmt: (v) => (v ? 'whole plots' : 'runs') }] : []),
      { key: 'power', label: `power at ${rw} ${spec.ratio}`, cls: 'n', fmt: (v, t) => (Number.isNaN(v) ? h('span', { class: 'muted' }, t.wholePlot && res.dfGroups < 1 ? 'no df' : 'aliased') : h('span', { class: v < 0.8 ? 'low-power' : '' }, num(v, 3))) },
      ...(sim ? [{ key: 'sim', label: 'simulated', cls: 'n', fmt: (v) => (v ? `${num(v.power, 2)} ± ${num(v.se, 1)}` : '') }] : []),
      { key: 'det', label: `${rw} for 80%`, cls: 'n', fmt: (v) => (Number.isFinite(v) ? num(v, 3) : '> 1000') }],
    rows.map(t => ({ ...t, det: det[t.term], sim: sim?.[t.term] })), { rowAttrs: () => ({ 'data-power': '' }) }),
    h('div', { class: 'row small' }, h('button', { class: 'btn small', id: 'power-simulate', onclick: runSim }, `check by simulation (${nsim} experiments${wpSigma !== null ? ', a few seconds' : ''})`),
      h('span', { class: 'muted' }, `${prop ? `Odds ratio: the odds of success at a factor’s high setting over its low setting (${spec.trials} trials per run).` : 'Rate ratio: the mean count at a factor’s high setting over its low setting.'} Each term is assessed alone with the others at the baseline: Wald tests with the information at the expected ${prop ? 'proportions' : 'counts'}${spec.dispersion ? ', F with the dispersion' : ''}; the simulation runs the likelihood-ratio test the analysis uses.`)));
}

/** The design's model matrix for a model (as designPower builds it, without blocks). */
function designMatrix(study, d, model) {
  const settings = d.X.map(r => Object.fromEntries(study.factors.map((f, j) => [f.id, f.type === 'categorical' ? (f.levels.length === 2 && (r[j] === -1 || r[j] === 1) ? f.levels[r[j] < 0 ? 0 : 1] : f.levels[r[j]]) : decode(f, r[j])])));
  return modelMatrix(parseFormula(model, study.factors), study.factors, settings);
}

function powerSection(study, d, cand, ui, set) {
  const pw = ui.power ?? {}, model = pw.models?.[cand.id] ?? intendedModel(study, d);
  const ratio = pw.ratio ?? 2, alpha = pw.alpha ?? 0.05;
  const setP = (patch) => set({ power: { ...pw, ...patch } });
  // which response the power is for: a measurement (Δ/σ) or a count or proportion (a ratio)
  const glmResps = study.responses.filter(r => r.distribution);
  const forSel = glmResps.length ? h('label', { class: 'inline' }, 'for', select([{ value: '', label: 'a measurement (Δ/σ)' }, ...glmResps.map(r => ({ value: r.id, label: `${r.name} (${ratioWord(r.distribution)})` }))],
    countsSpec(study, pw) ? pw.response : '', (v) => setP({ response: v || undefined, sim: null }), { 'aria-label': 'power for' })) : null;
  if (countsSpec(study, pw)) {
    const head = [forSel,
      h('label', { class: 'inline' }, 'model', h('input', { type: 'text', class: 'formula', style: 'width:16em', value: model, 'aria-label': 'power model',
        onchange: (e) => setP({ models: { ...(pw.models ?? {}), [cand.id]: e.target.value.replace(/^.*~/, '').trim() || 'main' } }) })),
      h('label', { class: 'inline' }, 'α', select([0.01, 0.05, 0.1], alpha, (v) => setP({ alpha: Number(v) }), { 'aria-label': 'power alpha' }))];
    return countsPowerSection(study, d, cand, ui, set, model, alpha, head);
  }
  const controls = h('div', { class: 'row' }, forSel,
    h('label', { class: 'inline' }, 'model', h('input', { type: 'text', class: 'formula', style: 'width:16em', value: model, 'aria-label': 'power model',
      onchange: (e) => setP({ models: { ...(pw.models ?? {}), [cand.id]: e.target.value.replace(/^.*~/, '').trim() || 'main' } }) })),
    h('label', { class: 'inline', title: 'the change in the response from the low to the high setting that matters, in units of the run-to-run standard deviation σ' }, 'effect Δ/σ',
      h('input', { class: 'num', type: 'number', min: 0.1, step: 0.1, value: ratio, 'aria-label': 'effect size', onchange: (e) => setP({ ratio: Number(e.target.value) }) })),
    h('label', { class: 'inline' }, 'α', select([0.01, 0.05, 0.1], alpha, (v) => setP({ alpha: Number(v) }), { 'aria-label': 'power alpha' })),
    d.wholePlot ? h('label', { class: 'inline', title: 'assumed ratio of whole-plot variance to run-to-run variance' }, 'η = σ²wp/σ²',
      h('input', { class: 'num', type: 'number', min: 0, step: 0.5, value: pw.eta ?? 1, 'aria-label': 'power eta', onchange: (e) => setP({ eta: Number(e.target.value) }) })) : null,
    // a covariate (issue #82): its correlation with the response takes σ to σ√(1 − ρ²)
    study.covariates?.length && !d.wholePlot ? h('label', { class: 'inline', title: 'the correlation you expect between the response and the covariate, run to run (0: no covariate in the analysis)' }, 'covariate ρ',
      h('input', { class: 'num', type: 'number', min: 0, max: 0.99, step: 0.05, value: pw.rho ?? 0, 'aria-label': 'power covariate rho', onchange: (e) => setP({ rho: Math.max(0, Math.min(0.99, Number(e.target.value) || 0)) }) })) : null);
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
  const rho = study.covariates?.length && !d.wholePlot ? pw.rho ?? 0 : 0;
  try { res = designPower(study, d.X, { model, block: d.block, ...(d.blocking ? { blocking: d.blocking, carryover: d.carryover } : {}), delta: ratio, alpha, ...(d.wholePlot ? { wholePlot: d.wholePlot, eta: pw.eta ?? 1 } : {}), ...(rho ? { rho } : {}) }); } catch (e) { err = e.message; }
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
      h('p', { class: 'muted small' }, `${res.strata ? `Split-plot: whole-plot terms are tested against the whole-plot error (${res.strata[0].df} df), the others against the residual (${res.strata[1].df} df), with σ²wp = η σ². ` : `${res.dfRes} residual df. `}${res.terms.some(t => t.block) ? (d.blocking ? `${d.blocking.map(b => b.name).join(' and ')}${d.carryover ? ' and carry-over' : ''} fitted. ` : 'Blocks fitted. ') : ''}Power of each term’s F test (two-sided t for one df) to detect a change Δ from low to high, given σ. `,
        rho ? `With the covariate in the analysis (ρ = ${rho}), the residual σ is σ·√(1 − ρ²) = ${num(Math.sqrt(1 - rho * rho), 3)} σ and one residual df goes to it; Δ/σ is still in units of σ without it. ` : '',
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
