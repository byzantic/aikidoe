// Sequential experimentation in the UI (issue #11): the Design step's "Next stage" panel
// (fold-over, axial points, optimal augmentation) and the Analyse step's confirmation panel.
import { h, select, dataTable, messages, help } from './dom.js';
import { num } from '../js/format.js';
import { foldover, axialPoints, optimalAugment, confirmationRuns, appendStage, sequentialAliases, checkConfirmation } from '../js/design/augment.js';
import { predict } from '../js/model/ols.js';
import { predictMixed, runMeanWeights } from '../js/model/mixed.js';
import { decode } from '../js/study.js';

// optimal augmentation runs in the worker, as the optimal search does
let worker = null, searchId = 0;
function search(study, opts, onDone) {
  worker?.terminate();
  worker = new Worker(new URL('./optimal-worker.js', import.meta.url), { type: 'module' });
  const id = ++searchId;
  worker.onmessage = (e) => { if (e.data.id === id) { onDone(e.data); worker.terminate(); worker = null; } };
  worker.onerror = (e) => { onDone({ ok: false, error: e.message || 'the search failed' }); worker = null; };
  worker.postMessage({ study, opts, id, augment: true });
}
const augKey = (study, o) => JSON.stringify([study.design.runs.length, o.runs, o.model, o.criterion, o.restarts]);

const showValue = (v) => (typeof v === 'number' ? num(v, 6) : v);

/** "Next stage" panel for a study that already has a design. */
export function nextStagePanel({ state, setDoc, setUI }) {
  const study = state.study, ui = state.ui.augment ??= {};
  const set = (patch) => setUI({ augment: { ...ui, ...patch } });
  const kind = ui.kind ?? 'foldover';
  const field = (label, el) => h('label', { class: 'inline' }, label, el);
  const twoLevel = study.factors.filter(f => f.type === 'continuous' || f.levels.length === 2);
  const blocks = [...new Set(study.design.runs.map(r => r.block ?? 1))];

  const opts = { runs: ui.runs ?? Math.max(4, Math.ceil(study.factors.length / 2) * 2), model: ui.model ?? '2fi', criterion: ui.criterion ?? 'D', restarts: ui.restarts ?? 10 };
  const options = h('div', { class: 'row' },
    field('add', select([{ value: 'foldover', label: 'fold-over' }, { value: 'axial', label: 'axial points (→ central composite)' }, { value: 'optimal', label: 'optimal runs for a larger model' }], kind, (v) => set({ kind: v }), { 'aria-label': 'next stage' })),
    kind === 'foldover' ? field('reverse', select([{ value: '', label: 'every factor (full fold-over)' }, ...twoLevel.map(f => ({ value: f.id, label: `${f.id} only` }))], ui.factor ?? '', (v) => set({ factor: v || undefined }), { 'aria-label': 'fold-over factor' })) : null,
    kind === 'axial' ? [
      field('α', select([{ value: 'orthogonal', label: 'orthogonal blocking' }, { value: 'rotatable', label: 'rotatable' }, { value: 'faces', label: 'face-centred (1)' }], ui.alpha ?? 'orthogonal', (v) => set({ alpha: v }), { 'aria-label': 'axial alpha' })),
      field('centre points', h('input', { class: 'num', type: 'number', min: 0, value: ui.centre ?? 2, 'aria-label': 'axial centre points', onchange: (e) => set({ centre: Number(e.target.value) }) }))] : null,
    kind === 'optimal' ? [
      field('model', h('input', { type: 'text', class: 'formula', style: 'width:16em', value: opts.model, 'aria-label': 'augment model', onchange: (e) => set({ model: e.target.value.replace(/^.*~/, '').trim() || 'main' }) })),
      field('runs to add', h('input', { class: 'num', type: 'number', min: 1, value: opts.runs, 'aria-label': 'runs to add', onchange: (e) => set({ runs: Number(e.target.value) }) })),
      field('criterion', select(['D', 'I', 'A'], opts.criterion, (v) => set({ criterion: v }), { 'aria-label': 'augment criterion' })),
      h('button', { class: 'btn', id: 'search-augment', disabled: !!ui.searching, onclick: () => {
        const key = augKey(study, opts);
        set({ ...opts, searching: true, result: null });
        search(study, opts, (r) => set({ ...opts, searching: false, result: { ...r, key } }));
      } }, ui.searching ? 'Searching…' : 'Search')] : null);

  let stage = null, err = null;
  try {
    if (kind === 'foldover') stage = foldover(study, ui.factor ? { factor: ui.factor } : {});
    else if (kind === 'axial') stage = axialPoints(study, { alpha: ui.alpha ?? 'orthogonal', centre: ui.centre ?? 2 });
    else if (ui.result && ui.result.key === augKey(study, opts)) { if (!ui.result.ok) throw new Error(ui.result.error); stage = ui.result.stage; }
  } catch (e) { err = e.message; }

  let body;
  if (err) body = h('div', { class: 'msg error' }, err);
  else if (!stage) body = h('div', { class: 'msg' }, ui.searching ? 'Searching…' : 'Choose the model the combined design should support and the number of runs to add, then search. The existing runs stay as they are.');
  else {
    const next = appendStage(study, stage);
    const added = next.design.runs.slice(study.design.runs.length);
    const parts = [h('p', { class: 'small' }, `${stage.note}: `, h('b', {}, `${added.length} runs`), ` as block ${added[0].block}, ${next.design.runs.length} runs in all. The block term is fitted automatically, so a shift between stages does not bias the effects.`)];
    if (kind === 'foldover' || kind === 'optimal') {
      try {
        const a = sequentialAliases(next);
        parts.push(a.chains.length ? h('details', { open: a.chains.length <= 8 }, h('summary', {}, `combined design: ${a.chains.length} alias chain(s) among main effects and two-factor interactions`), h('div', { class: 'mono small', 'data-aliases': '' }, a.chains.map(c => h('div', {}, c.join(' = ')))))
          : h('div', { class: 'msg ok' }, 'Combined design: no aliasing among main effects and two-factor interactions.'));
      } catch { /* aliasing needs two-level runs */ }
    }
    if (kind === 'optimal' && stage.params) parts.push(h('div', { class: 'row small' }, h('span', { class: 'stat' }, 'D-efficiency (combined) ', h('b', {}, `${num(stage.params.dEfficiency, 4)}%`)), h('span', { class: 'stat' }, 'average prediction variance ', h('b', {}, num(stage.params.averageVariance, 4)))));
    if (kind === 'axial') parts.push(h('p', { class: 'muted small' }, (ui.alpha ?? 'orthogonal') === 'orthogonal' ? 'α chosen so the blocks are orthogonal to the quadratic terms: the block shift does not bias the curvature estimates.' : 'Blocks are not orthogonal to the quadratic terms with this α; the fit still adjusts for the block.'));
    parts.push(dataTable([{ key: 'run', label: 'run', cls: 'n' }, { key: 'kind', label: 'kind' }, ...study.factors.map(f => ({ key: f.id, label: f.id, cls: f.type === 'categorical' ? '' : 'n', fmt: showValue }))],
      added.map(r => ({ run: r.run, kind: r.kind, ...r.settings }))));
    parts.push(h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'add-stage', onclick: () => {
      // a larger design supports a larger model: let Analyse choose its default again
      state.ui.augment = { kind }; state.ui.analyse = { ...(state.ui.analyse ?? {}), formulas: {} }; state.step = 'run'; setDoc(structuredClone(next)); } }, `Add ${added.length} runs as block ${added[0].block}`),
      h('span', { class: 'muted small' }, 'The new runs are randomised within their block; earlier runs and results are kept.')));
    body = h('div', {}, parts);
  }
  const stages = study.design.kind === 'sequential' ? study.design.params.stages.map(s => s.kind).join(' → ') : study.design.kind;
  return h('section', { class: 'panel', id: 'next-stage' }, h('h2', {}, 'Next stage', help('designs-sequential')),
    h('p', { class: 'small' }, `Current design: ${stages}, ${study.design.runs.length} runs${blocks.length > 1 ? ` in ${blocks.length} blocks` : ''}. Add runs to resolve aliasing, estimate curvature or support a larger model.`),
    options, body);
}

/** Confirmation panel for the Analyse step: predictions at chosen settings, add confirmation runs, check results. */
export function confirmPanel({ state, setDoc, setUI }, fit) {
  const study = state.study, ui = state.ui.confirm ??= {};
  const set = (patch) => setUI({ confirm: { ...ui, ...patch } });
  const at = Object.fromEntries(study.factors.map(f => [f.id, ui.at?.[f.id] ?? (f.type === 'categorical' ? f.levels[0] : decode(f, 0))]));
  const setAt = (id, v) => set({ at: { ...at, [id]: v } });
  const inputs = h('div', { class: 'row' }, study.factors.map(f => h('label', { class: 'inline' }, f.id,
    f.type === 'categorical' ? select(f.levels, at[f.id], (v) => setAt(f.id, v), { 'aria-label': `confirm ${f.id}` })
      : h('input', { class: 'num', type: 'number', step: 'any', value: +at[f.id].toPrecision(6), 'aria-label': `confirm ${f.id}`, onchange: (e) => setAt(f.id, Number(e.target.value)) }))),
    h('label', { class: 'inline' }, 'replicates', h('input', { class: 'num', type: 'number', min: 1, value: ui.replicates ?? 2, 'aria-label': 'confirm replicates', onchange: (e) => set({ replicates: Math.max(1, Number(e.target.value)) }) })));

  const mixed = fit.kind === 'mixed', reps = ui.replicates ?? 2;
  const hasWP = mixed && fit.random.some(r => r.id === 'wholePlot');
  let pred = null, predN = null, err = null;
  try {
    if (mixed) {
      pred = predictMixed(fit, [at], { weights: runMeanWeights(fit) })[0];
      predN = reps > 1 ? predictMixed(fit, [at], { weights: runMeanWeights(fit, { runs: reps, inOneWholePlot: !ui.separate }) })[0] : null;
    } else { if (fit.dfRes < 1) throw new Error('A prediction interval needs residual degrees of freedom.'); pred = predict(fit, [at])[0]; }
  } catch (e) { err = e.message; }
  const out = err ? h('div', { class: 'msg warning' }, err) : h('div', {},
    h('div', { class: 'row small', id: 'prediction' },
      h('span', { class: 'stat' }, `predicted ${fit.response} `, h('b', {}, num(pred.fit))),
      h('span', { class: 'stat' }, `95% CI (mean${mixed ? ', KR' : ''}) `, h('b', {}, `${num(pred.lower)} … ${num(pred.upper)}`)),
      h('span', { class: 'stat' }, '95% PI (one run) ', h('b', {}, `${num(pred.predLower)} … ${num(pred.predUpper)}`)),
      predN ? h('span', { class: 'stat' }, `95% PI (mean of ${reps} runs) `, h('b', {}, `${num(predN.predLower)} … ${num(predN.predUpper)}`)) : null,
      fit.model.terms.some(t => t.block) ? h('span', { class: 'muted' }, fit.model.terms.some(t => t.position) ? '(average block, average well)' : '(average block)') : null),
    h('div', { class: 'row' }, h('button', { class: 'btn', id: 'add-confirm', onclick: () => {
      const next = appendStage(study, confirmationRuns(study, fit, [at], { replicates: reps, inOneWholePlot: !ui.separate }));
      state.step = 'run'; setDoc(structuredClone(next));
    } }, `Add ${ui.replicates ?? 2} confirmation run(s) here`),
    hasWP && reps > 1 ? h('label', { class: 'inline small' }, h('input', { type: 'checkbox', checked: !!ui.separate, 'aria-label': 'separate whole plots', onchange: (e) => set({ separate: e.target.checked }) }), 'each run in its own whole plot') : null,
    h('span', { class: 'muted small' }, 'The prediction is stored with the runs; confirmation results are compared with it and left out of the fit.')),
    mixed ? h('p', { class: 'muted small' }, `Mixed model: a run is measured like the others; the intervals include the ${fit.random.map(r => r.name.toLowerCase()).join(', ')} and within-${fit.random.some(r => r.id === 'wafer') ? 'wafer' : 'run'} variation${hasWP ? `. Replicates ${ui.separate ? 'in separate whole plots average out the whole-plot variation too' : 'in one new whole plot (one furnace load) share its whole-plot deviation, so more of them barely narrows the interval'}` : ''}.`) : null);

  const conf = checkConfirmation(study, fit.response);
  const check = conf.length ? h('div', {}, h('h3', {}, 'Confirmation results'),
    dataTable([{ key: 'at', label: 'settings' }, { key: 'n', label: 'n', cls: 'n' }, { key: 'observed', label: 'observed', cls: 'n', fmt: (v) => (v === null ? '—' : num(v)) },
      { key: 'predicted', label: 'predicted', cls: 'n', fmt: (v) => num(v) }, { key: 'iv', label: '95% interval' },
      { key: 'inside', label: '', fmt: (v) => (v === null ? h('span', { class: 'muted' }, 'no result yet') : v ? h('span', {}, 'confirmed') : h('span', { class: 'sig' }, 'outside')) }],
    conf.map(c => ({ ...c, at: Object.entries(c.settings).map(([k, v]) => `${k}=${showValue(v)}`).join(', '), iv: `${num(c.lower)} … ${num(c.upper)}` }))),
    conf.some(c => c.inside === false) ? messages(['A confirmation result is outside its prediction interval: the model may be missing a term, the process may have shifted, or the region of the optimum is not where the model says.'], 'warning') : null,
    h('p', { class: 'muted small' }, 'Each interval is the one stored when the runs were planned (for the mean of n runs where there are replicates), from the model then current.')) : null;

  return h('section', { class: 'panel', id: 'confirm' }, h('h2', {}, 'Predict and confirm', help('designs-sequential','confirmation-runs')),
    h('p', { class: 'small' }, `Predict ${fit.response} from this model at chosen settings, and plan confirmation runs there.`),
    inputs, out, check);
}
