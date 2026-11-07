// Analyse step: fit a model, ANOVA, effects, diagnostics (spec §12 step 4).
import { h, select, messages, dataTable, help } from './dom.js';
import { plot } from './plot.js';
import { num, pval } from '../js/format.js';
import { defaultFormula } from '../js/model/defaults.js';
export { defaultFormula };
import { fitModel, anova, predict } from '../js/model/fit.js';
import { lackOfFit, boxCox, lenth, halfNormal, twoLevelEffects } from '../js/model/ols.js';
import { hierarchyViolations } from '../js/model/formula.js';
import { normal } from '../js/dist.js';
import { confirmPanel } from './augment.js';
import { reduceModel } from '../js/model/reduce.js';
import { fitMixedModel, observationTable, randomEffects } from '../js/model/mixed.js';
import { observationsOf, availablePositionTerms, sitePositions } from '../js/model/sites.js';
import { waferPlot } from './wafer.js';
import { plateAnalysisPanel } from './plates.js';
import { doseAnalysis } from './dose.js';
import { mixtureAnalysis } from './mixture.js';
import { glmAnalysis } from './glm.js';

/** A sensible first model for the study's design. */

// one background job at a time in a worker (mixed-model reduction)
let job = null;
function background(msg, onDone) {
  job?.terminate();
  job = new Worker(new URL('./optimal-worker.js', import.meta.url), { type: 'module' });
  job.onmessage = (e) => { onDone(e.data); job.terminate(); job = null; };
  job.onerror = (e) => { onDone({ ok: false, error: e.message || 'the computation failed' }); job = null; };
  job.postMessage({ ...msg, id: 0 });
}

function reduction(r, response, undoTo, close) {
  if (!r || r.response !== response) return null;
  if (r.running) return h('div', { class: 'msg', id: 'reduction' }, `Reducing the mixed model (${r.method === 'p' ? 'Kenward–Roger p-values' : 'AICc of maximum-likelihood fits'}); each step refits the model…`);
  if (r.error) return h('div', { class: 'msg warning', id: 'reduction' }, r.error, ' ', h('button', { class: 'btn small', onclick: close }, 'ok'));
  return h('div', { class: 'msg', id: 'reduction' },
    h('div', {}, h('b', {}, `Reduced ${r.mixed ? 'the mixed model ' : ''}${r.method === 'p' ? `by ${r.mixed ? 'Kenward–Roger ' : ''}p-value (drop while p > 0.10)` : r.mixed ? 'by AICc (maximum likelihood)' : 'by AICc'}`), ', hierarchy kept: ',
      r.steps.length ? r.steps.map((st, i) => [i ? ', ' : '', h('span', { class: 'mono' }, st.drop), r.method === 'p' ? ` (p ${pval(st.p)})` : '']) : 'nothing to remove', '.'),
    h('div', { class: 'row small', style: 'margin-top:6px' }, 'This is a suggestion: edit the formula to put a term back.',
      h('button', { class: 'btn small', onclick: () => undoTo(r.start) }, 'undo'), h('button', { class: 'btn small', onclick: close }, 'hide')));
}

export function render(ctx) {
  const { state, setUI } = ctx;
  const study = state.study, ui = state.ui.analyse ??= {};
  const withData = study.responses.filter(r => observationsOf(study, r.id).some(o => o.value !== null));
  const resp = withData.find(r => r.id === ui.response) ?? withData[0];
  const formula = ui.formulas?.[resp.id] ?? defaultFormula(study, resp.id);
  const set = (patch) => setUI({ analyse: { ...ui, ...patch } });
  // a dose–response design: the curve fit is the analysis (the linear model on request)
  if (study.design?.kind === 'dose-response' && !ui.linear) return h('div', {}, doseAnalysis(ctx));
  const backToDose = study.design?.kind === 'dose-response' ? h('div', { class: 'msg' }, 'A linear model of a dose–response design treats the dose as a straight-line effect. ', h('button', { class: 'btn small', id: 'dose-analysis-back', onclick: () => set({ linear: false }) }, 'back to the dose–response fit')) : null;
  const setFormula = (f) => set({ formulas: { ...(ui.formulas ?? {}), [resp.id]: f } });
  const rhs = formula.includes('~') ? formula.slice(formula.indexOf('~') + 1).trim() : formula;

  const fIn = h('input', { type: 'text', class: 'formula', id: 'formula', value: formula, 'aria-label': 'model formula', spellcheck: 'false',
    onchange: (e) => setFormula(e.target.value.includes('~') ? e.target.value : `${resp.id} ~ ${e.target.value}`) });
  const controls = h('section', { class: 'panel' }, h('h2', {}, 'Model', help('analysis','formulas')),
    h('div', { class: 'row', style: 'margin-bottom:8px' },
      withData.length > 1 ? h('label', { class: 'inline' }, 'response', select(withData.map(r => ({ value: r.id, label: r.name })), resp.id, (v) => set({ response: v }), { 'aria-label': 'response' })) : h('span', {}, h('b', {}, resp.name), resp.units ? ` (${resp.units})` : ''),
      (study.mixture ? ['mixlinear', 'mixquadratic', 'mixspecial'] : ['main', '2fi', 'quadratic']).map(s => h('button', { class: 'btn', onclick: () => setFormula(`${resp.id} ~ ${s}`), title: { main: 'main effects', '2fi': 'main effects and two-factor interactions', quadratic: 'full quadratic (response surface)', mixlinear: 'Scheffé linear blending', mixquadratic: 'Scheffé quadratic: linear blending and the binary blending terms', mixspecial: 'Scheffé special cubic: the quadratic and the three-way terms' }[s] }, s)),
      h('button', { class: 'btn', onclick: () => setFormula(defaultFormula(study, resp.id)) }, 'reset'),
      ['p', 'aicc'].map(m => h('button', { class: 'btn', id: `reduce-${m}`, title: m === 'p' ? 'backward elimination: drop the least significant term while p > 0.10, keeping the model hierarchical' : 'backward elimination by AICc, keeping the model hierarchical',
        onclick: () => {
          try {
            let mixed = false; try { mixed = !ui.ols && randomEffects(observationTable(study, resp.id)).length > 0; } catch { /* no */ }
            if (mixed) {
              // mixed models: each step refits by REML (and ML for AICc), so run it in the worker
              set({ reduce: { response: resp.id, method: m, start: formula, running: true, mixed: true } });
              background({ reduce: { study, formula, method: m } }, (res) => {
                const cur = state.ui.analyse ?? {};
                if (!res.ok) { setUI({ analyse: { ...cur, reduce: { response: resp.id, error: res.error } } }); return; }
                setUI({ analyse: { ...cur, reduce: { response: resp.id, method: m, start: formula, steps: res.steps, mixed: true }, formulas: { ...(cur.formulas ?? {}), [resp.id]: res.formula } } });
              });
              return;
            }
            const r = reduceModel(study, formula, { method: m, ...(ui.firth && resp.distribution ? { firth: true } : {}) }); ui.reduce = { response: resp.id, method: m, start: formula, steps: r.steps }; setFormula(r.formula); }
          catch (e) { set({ reduce: { response: resp.id, error: e.message } }); }
        } }, m === 'p' ? 'reduce (p)' : 'reduce (AICc)')),
      h('label', { class: 'inline' }, resp.distribution ? 'tests' : 'ANOVA', select([{ value: 1, label: 'type I (sequential)' }, { value: 2, label: 'type II' }, { value: 3, label: 'type III' }], ui.anovaType ?? 1, (v) => set({ anovaType: Number(v) }), { 'aria-label': 'ANOVA type' }))),
    fIn,
    reduction(ui.reduce, resp.id, (f) => set({ formulas: { ...(ui.formulas ?? {}), [resp.id]: f }, reduce: null }), () => set({ reduce: null })),
    h('p', { class: 'muted small' }, 'R-style formula over factor ids: ', h('span', { class: 'mono' }, 'A*B'), ' = A + B + A:B, ', h('span', { class: 'mono' }, '(A+B+C)^2'), ', ', h('span', { class: 'mono' }, 'I(T^2)'), ', ', h('span', { class: 'mono' }, '- A:B'), study.mixture ? '. Mixture components: mixquadratic, mixspecial, mixcubic, mixlinear (Scheffé models, no intercept), e.g. mixquadratic + mixlinear:(T); coefficients are in L-pseudo-components (0 … 1).' : '. Coefficients are in coded units (−1 … +1).'));

  let fit = null, fitErr = null;
  try { fit = fitModel(study, formula, { ...(ui.noPosition ? { position: false } : {}), ...(ui.firth && resp.distribution ? { firth: true } : {}) }); } catch (e) { fitErr = e; }
  // counts and proportions: a generalised linear model (no mixed models yet)
  if (resp.distribution) {
    if (fitErr) return h('div', {}, controls, h('div', { class: 'msg error' }, fitErr.message));
    return h('div', {}, controls, glmAnalysis(ctx, fit, { ui, set, setFormula, rhs, resp }), confirmPanel(ctx, fit));
  }

  // split-plot or nested readings: the mixed model is the analysis (least squares on request)
  let rand = [];
  try { rand = randomEffects(observationTable(study, resp.id)); } catch { /* none */ }
  if (rand.length && !ui.ols) {
    let m;
    try { m = fitMixedModel(study, formula); } catch (e) { return h('div', {}, controls, h('div', { class: 'msg error' }, e.message)); }
    const avail = availablePositionTerms(study, observationsOf(study, resp.id).filter(o => o.value !== null));
    const used = new Set(formula.match(/[A-Za-z_][A-Za-z0-9_]*/g));
    const chips = avail.length ? h('div', { class: 'row small', id: 'position-terms', style: 'margin-top:6px' }, 'position terms:',
      avail.map(t => h('button', { class: 'btn small', disabled: used.has(t.id), title: t.name, onclick: () => setFormula(`${formula} + ${t.id}`) }, `+ ${t.id}`))) : null;
    return h('div', {}, controls, chips, mixedPanel(m, ui, set), sitesPanel(study, m, ui, set), confirmPanel(ctx, m));
  }
  const olsNote = rand.length ? h('div', { class: 'msg warning' }, 'Least squares on run means, as if the runs were completely randomised: whole-plot and nested structure ignored. ',
    h('button', { class: 'btn small', id: 'use-mixed', onclick: () => set({ ols: false }) }, 'back to the mixed model')) : null;
  if (fitErr) return h('div', {}, backToDose, controls, olsNote, h('div', { class: 'msg error' }, fitErr.message));

  const notes = [];
  if (fit.rows.some(r => r.n > 1)) notes.push('Repeated observations of a run (wafers, sites, repeats) are averaged: this least-squares fit uses run means. Mixed models for nested measurements come in a later version.');
  for (const v of hierarchyViolations(fit.model)) notes.push(`${v.term} is in the model without ${v.missing.join(', ')}.`);
  if (fit.aliased.length) notes.push(`Not estimable (aliased with earlier terms): ${fit.aliased.join(', ')}.`);
  const missingRuns = study.design.runs.filter(r => r.kind !== 'confirm').length - fit.n;
  const blockF = fit.factors.find(f => f.block && !f.position);
  if (blockF) notes.push(`The design has ${blockF.levels.length} blocks (${study.plates?.wells.length ? 'plates' : 'stages'}); a block term is fitted first so shifts between them do not bias the effects.`);
  if (missingRuns) notes.push(`${missingRuns} run(s) have no result yet and are left out.`);

  // ---------------------------------------------------------------- summary and coefficients
  const summary = h('section', { class: 'panel' }, h('h2', {}, 'Fit', help('analysis','least-squares-fits')),
    messages(notes, 'warning'),
    h('div', { class: 'row small', id: 'fit-stats' },
      h('span', { class: 'stat' }, h('b', {}, fit.n), ' runs'), h('span', { class: 'stat' }, h('b', {}, fit.rank), ' coefficients'), h('span', { class: 'stat' }, h('b', {}, fit.dfRes), ' residual df'),
      fit.dfRes > 0 ? [h('span', { class: 'stat' }, 'σ = ', h('b', {}, num(fit.sigma))), h('span', { class: 'stat' }, 'R² = ', h('b', {}, num(fit.r2))),
        h('span', { class: 'stat' }, 'adj. R² = ', h('b', {}, num(fit.adjR2))), h('span', { class: 'stat' }, 'pred. R² = ', h('b', {}, num(fit.predR2))),
        Number.isFinite(fit.fP) ? h('span', { class: 'stat' }, 'model F test p ', h('b', {}, pval(fit.fP))) : null] : null),
    dataTable([
      { key: 'term', label: 'term' }, { key: 'est', label: 'estimate', cls: 'n', fmt: (v) => num(v) },
      ...(fit.dfRes > 0 ? [{ key: 'se', label: 'std. error', cls: 'n', fmt: (v) => num(v) }, { key: 't', label: 't', cls: 'n', fmt: (v) => num(v, 3) }, { key: 'p', label: 'p', cls: 'n', fmt: (v) => h('span', { class: v < 0.05 ? 'sig' : '' }, pval(v)) }] : []),
      { key: 'drop', label: '', fmt: (_, r) => (r.assign >= 0 ? h('button', { class: 'btn small', title: `remove ${r.termLabel} from the model`, onclick: () => setFormula(`${resp.id} ~ ${rhs} - ${r.termLabel}`) }, '−') : null) },
    ], fit.columns.map((c, j) => ({ term: c, est: fit.coef[j], se: fit.se[j], t: fit.t[j], p: fit.p[j], assign: fit.assign[j], termLabel: fit.assign[j] >= 0 ? fit.model.terms[fit.assign[j]].label : '' })).filter(r => Number.isFinite(r.est))));

  // ---------------------------------------------------------------- ANOVA
  let anovaPanel = null;
  const mixPanel = study.mixture && fit.model.implied && fit.dfRes > 0 ? mixtureAnalysis(study, fit, ui, set, (st) => predict(fit, [st])[0].fit) : null;
  if (fit.dfRes > 0 && !mixPanel) {
    const rows = anova(fit, ui.anovaType ?? 1);
    const lof = lackOfFit(fit);
    if (lof?.lackOfFit) { const res = rows.pop(); rows.push(res, { term: '  lack of fit', ...lof.lackOfFit }, { term: '  pure error', ...lof.pureError }); }
    anovaPanel = h('section', { class: 'panel' }, h('h2', {}, `ANOVA (type ${['', 'I', 'II', 'III'][ui.anovaType ?? 1]})`, help('analysis','anova')),
      dataTable([{ key: 'term', label: 'source' }, { key: 'df', label: 'df', cls: 'n' }, { key: 'ss', label: 'sum of squares', cls: 'n', fmt: (v) => num(v) }, { key: 'ms', label: 'mean square', cls: 'n', fmt: (v) => num(v) },
        { key: 'F', label: 'F', cls: 'n', fmt: (v) => (v === undefined ? '' : num(v)) }, { key: 'p', label: 'p', cls: 'n', fmt: (v) => (v === undefined ? '' : h('span', { class: v < 0.05 ? 'sig' : '' }, pval(v))) }], rows),
      lof?.lackOfFit ? h('p', { class: 'muted small' }, lof.lackOfFit.p < 0.05 ? 'Lack of fit is significant: the model misses curvature or interactions that the replicated runs reveal.' : 'No evidence of lack of fit against pure error from the replicated runs.') : null);
  }

  // ---------------------------------------------------------------- effects (two-level)
  let effectsPanel = null;
  const twoLevel = study.factors.every(f => f.type === 'continuous' || f.levels.length === 2) && !['ccd', 'box-behnken'].includes(study.design.kind) && !fit.model.terms.some(t => t.comps.some(c => c.I))
    && !(study.design.kind === 'sequential' && study.design.params.stages.some(s => s.kind === 'axial'));
  const eff = twoLevelEffects(fit);
  if (twoLevel && !study.mixture && eff.length >= 3) {
    const L = lenth(eff.map(e => e.effect)), hn = halfNormal(eff.map(e => e.effect));
    effectsPanel = h('section', { class: 'panel' }, h('h2', {}, 'Effects', help('analysis','effects-and-lenths-method')),
      h('p', { class: 'small' }, `Lenth’s method: PSE = ${num(L.pse)}; effects beyond ME = ${num(L.me)} are likely active, beyond SME = ${num(L.sme)} active even allowing for looking at all ${eff.length}.`, fit.dfRes > 0 ? ' (With residual degrees of freedom the t-tests above are usually preferable; Lenth is shown for comparison.)' : ''),
      h('div', { class: 'grid2' },
        h('figure', {}, h('figcaption', {}, 'Half-normal plot of |effects|'), plot({ xLabel: '|effect|', yLabel: 'half-normal quantile', height: 260,
          series: [{ points: hn.map(p => ({ x: p.abs, y: p.q, label: eff[p.index].name, hi: Math.abs(eff[p.index].effect) > L.me, title: `${eff[p.index].name}: ${num(eff[p.index].effect)}` })) }],
          vlines: [{ x: L.me, label: 'ME' }, { x: L.sme, label: 'SME', cls: 's2' }] })),
        dataTable([{ key: 'name', label: 'effect' }, { key: 'effect', label: 'estimate', cls: 'n', fmt: (v) => num(v) }, { key: 'flag', label: '', fmt: (v) => (v ? h('span', { class: 'sig' }, v) : '') }],
          eff.map((e, i) => ({ ...e, flag: L.activeSME[i] ? '> SME' : L.active[i] ? '> ME' : '' })).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)))),
      h('p', { class: 'muted small' }, 'Effect = change in the response from the low to the high setting (2 × coefficient).'));
  }

  // ---------------------------------------------------------------- diagnostics
  let diag = null;
  if (fit.dfRes > 0) {
    const pts = fit.rows.map((r, i) => ({ fitted: fit.fitted[i], res: fit.residuals[i], st: fit.rstudent[i], order: r.order, run: r.run }));
    const sorted = pts.filter(p => Number.isFinite(p.st)).sort((a, b) => a.st - b.st);
    const qq = sorted.map((p, i) => ({ x: normal.ppf((i + 0.5) / sorted.length), y: p.st, label: `run ${p.run}`, hi: Math.abs(p.st) > 3, title: `run ${p.run}` }));
    const figs = [
      h('figure', {}, h('figcaption', {}, 'Residuals against fitted values'), plot({ xLabel: 'fitted', yLabel: 'residual', height: 220, hlines: [{ y: 0 }], series: [{ points: pts.map(p => ({ x: p.fitted, y: p.res, title: `run ${p.run}` })) }] })),
      h('figure', {}, h('figcaption', {}, 'Normal plot of studentised residuals'), plot({ xLabel: 'normal quantile', yLabel: 'studentised residual', height: 220, series: [{ points: qq }, { kind: 'line', cls: 'dash s2', points: [{ x: qq[0]?.x ?? -2, y: qq[0]?.x ?? -2 }, { x: qq[qq.length - 1]?.x ?? 2, y: qq[qq.length - 1]?.x ?? 2 }] }] })),
      h('figure', {}, h('figcaption', {}, 'Residuals in run order (drift?)'), plot({ xLabel: 'run order', yLabel: 'residual', height: 220, hlines: [{ y: 0 }], series: [{ kind: 'line', points: pts.slice().sort((a, b) => a.order - b.order).map(p => ({ x: p.order, y: p.res })) }, { points: pts.map(p => ({ x: p.order, y: p.res, title: `run ${p.run}` })) }] })),
    ];
    if (fit.y.every(v => v > 0)) {
      try {
        const b = boxCox(fit);
        figs.push(h('figure', {}, h('figcaption', {}, `Box–Cox: λ̂ = ${num(b.best, 3)}, 95% interval ${num(b.ci[0], 3)} … ${num(b.ci[1], 3)}${b.ci[0] <= 1 && b.ci[1] >= 1 ? ' (no transform needed)' : b.ci[0] <= 0 && b.ci[1] >= 0 ? ' (consider log)' : ''}`),
          plot({ xLabel: 'λ', yLabel: 'log-likelihood', height: 220, band: { x0: b.ci[0], x1: b.ci[1] }, series: [{ kind: 'line', points: b.lambda.map((l, i) => ({ x: l, y: b.loglik[i] })) }], vlines: [{ x: b.best }] })));
      } catch { /* not available for this fit */ }
    }
    const big = pts.filter(p => Math.abs(p.st) > 3);
    diag = h('section', { class: 'panel' }, h('h2', {}, 'Diagnostics', help('analysis','diagnostics')), h('div', { class: 'plots' }, figs),
      big.length ? h('div', { class: 'msg warning' }, `Studentised residual beyond ±3: ${big.map(p => `run ${p.run} (${num(p.st, 3)})`).join(', ')}. Check those results.`) : null);
  }
  return h('div', {}, backToDose, controls, olsNote, summary, mixPanel, anovaPanel, effectsPanel, diag, plateAnalysisPanel(study, fit, { noPosition: !!ui.noPosition, setNoPosition: (v) => set({ noPosition: v }) }), confirmPanel(ctx, fit));
}

// site values on a wafer outline, and against radius (issue #16)
function sitesPanel(study, m, ui, set) {
  const P = sitePositions(study);
  if (!P.size || !m.rows.every(r => r.obs.site !== undefined)) return null;
  const view = ui.waferView ?? 'mean';
  // within-wafer deviations: the site pattern without the furnace, run and wafer offsets
  const wkey = (r) => `${r.run}|${r.obs.wafer ?? ''}`;
  const within = (v) => { const g = new Map(); m.rows.forEach((r, i) => { const k = wkey(r); if (!g.has(k)) g.set(k, []); g.get(k).push(v[i]); });
    const mean = new Map([...g].map(([k, x]) => [k, x.reduce((a, b) => a + b, 0) / x.length])); return v.map((x, i) => x - mean.get(wkey(m.rows[i]))); };
  const vals = view === 'residual' ? within(m.residuals) : m.rows.map(r => r.y);
  const dev = view === 'residual' ? vals : within(vals);
  const by = new Map();
  m.rows.forEach((r, i) => { const k = String(r.obs.site); if (!by.has(k)) by.set(k, []); by.get(k).push(vals[i]); });
  const means = new Map([...by].map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length]));
  const radial = m.rows.map((r, i) => ({ x: P.get(String(r.obs.site))?.rho, y: dev[i] })).filter(p => Number.isFinite(p.x));
  return h('section', { class: 'panel', id: 'sites' }, h('h2', {}, 'Sites', help('process','wafers-and-sites')),
    h('div', { class: 'row small', style: 'margin-bottom:8px' }, h('label', { class: 'inline' }, 'show', select([{ value: 'mean', label: `${m.response}, mean at each site` }, { value: 'residual', label: 'residual from the model, within wafer' }],
      view, (v) => set({ waferView: v }), { 'aria-label': 'wafer view' }))),
    h('div', { class: 'wafers' },
      waferPlot({ sites: P, values: means, title: view === 'residual' ? 'Mean within-wafer residual at each site' : `Mean ${m.response} at each site` }),
      h('figure', { style: 'flex:1; min-width:260px' }, h('figcaption', {}, `${view === 'residual' ? 'Residuals' : m.response} within each wafer (reading − wafer mean) against r / R`),
        plot({ xLabel: 'r / R (centre → edge)', yLabel: view === 'residual' ? 'residual − wafer mean' : 'reading − wafer mean', height: 220, hlines: [{ y: 0 }], series: [{ points: radial }] }))),
    h('p', { class: 'muted small' }, view === 'residual'
      ? 'A pattern left in the residuals (a bowl, a tilt) means the position terms in the model do not capture it: try radius2, edge, waferX or waferY.'
      : 'Readings from every wafer, averaged per site. A systematic radial pattern belongs in the model as radius2 (or edge); random site-to-site scatter is the residual.'));
}

function mixedPanel(m, ui, set) {
  const total = m.varcomp.reduce((a, v) => a + v.variance, 0);
  const nRuns = new Set(m.rows.map(r => r.run)).size;
  const cont = ui.dfMethod === 'containment';
  const notes = [];
  if (!m.converged) notes.push('The REML optimisation did not fully converge; treat the results with care.');
  if (m.aliased.length) notes.push(`Not estimable (aliased): ${m.aliased.join(', ')}.`);
  if (m.boundary.length) notes.push(`${m.boundary.join(', ')} variance estimated as 0: no variation at that level beyond what the levels below explain.`);
  const residualIs = m.random.some(r => r.id === 'wafer') ? 'within wafer (sites, repeats)' : m.random.some(r => r.id === 'run') ? 'within run (wafers, repeats)' : 'run to run';
  const terms = m.terms.filter(t => t.df > 0 && !m.model.terms.find(x => x.label === t.term)?.block);
  return h('section', { class: 'panel', id: 'mixed' }, h('h2', {}, 'Mixed model (REML)', help('analysis','mixed-models')),
    h('p', { class: 'small' }, `${m.n} readings from ${nRuns} runs. Random effects: ${m.random.map(r => `${r.name.toLowerCase()} (${new Set(r.labels).size})`).join(', ')}; residual: ${residualIs}. Each term is tested against the variation at the level where it was applied — whole-plot factors against the whole-plot variance.`),
    messages(notes, 'warning'),
    h('h3', {}, 'Variance components'),
    dataTable([{ key: 'name', label: 'source' }, { key: 'variance', label: 'variance', cls: 'n', fmt: (v) => num(v) }, { key: 'sd', label: 'std. dev.', cls: 'n', fmt: (v) => num(v) },
      { key: 'ci', label: '95% interval (variance)' }, { key: 'pct', label: '% of total', cls: 'n', fmt: (v) => num(v, 3) }, { key: 'bar', label: '' }],
    m.varcomp.map(v => ({ ...v, ci: v.boundary ? 'on the boundary (0)' : `${num(v.lower)} … ${num(v.upper)}`, pct: 100 * v.variance / total,
      bar: h('span', { class: 'vbar' }, h('span', { style: `width:${(100 * v.variance / total).toFixed(1)}%` })) }))),
    h('h3', {}, `Tests of model terms (${cont ? 'containment df' : 'Kenward–Roger'})`),
    h('div', { class: 'row small', style: 'margin-bottom:6px' },
      h('label', { class: 'inline' }, 'df', select([{ value: 'kr', label: 'Kenward–Roger' }, { value: 'containment', label: 'containment' }], ui.dfMethod ?? 'kr', (v) => set({ dfMethod: v }), { 'aria-label': 'df method' })),
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', id: 'compare-ols', checked: !!ui.compare, onchange: (e) => set({ compare: e.target.checked }) }), 'compare with treating every reading as independent'),
      h('button', { class: 'btn small', onclick: () => set({ ols: true }), title: 'least squares on run means, ignoring whole plots' }, 'least squares instead')),
    dataTable([{ key: 'term', label: 'term' }, { key: 'F', label: 'F', cls: 'n', fmt: (v) => num(v) }, { key: 'df', label: 'ndf', cls: 'n' }, { key: 'ddf', label: 'ddf', cls: 'n', fmt: (v) => num(v, 4) },
      { key: 'p', label: 'p', cls: 'n', fmt: (v) => h('span', { class: v < 0.05 ? 'sig' : '' }, pval(v)) }, { key: 'stratum', label: 'tested in' },
      ...(ui.compare ? [{ key: 'naiveP', label: 'p if independent', cls: 'n', fmt: (v, r) => h('span', { class: (v < 0.05) !== (r.p < 0.05) ? 'low-power' : '' }, pval(v)) }] : [])],
    terms.map(t => ({ ...t, F: cont ? t.F : t.FKR, ddf: cont ? t.ddfContainment : t.ddfKR, p: cont ? t.pContainment : t.pKR, stratum: t.stratum === 'Residual' ? 'residual' : (t.stratum ?? '').toLowerCase() })),
    { rowAttrs: () => ({ 'data-term': '' }) }),
    ui.compare ? h('p', { class: 'muted small' }, `"p if independent": least squares on the same ${m.n} readings as if each were an independent run — what an analysis ignoring whole plots, runs and wafers would claim. Highlighted where the conclusion at 5% changes.`) : null,
    m.strata ? h('p', { class: 'muted small' }, `Strata (containment df): ${m.strata.map(st => `${st.name === 'Residual' ? 'residual' : st.name.toLowerCase()} ${st.df}`).join(', ')}.`) : null,
    h('h3', {}, 'Coefficients'),
    dataTable([{ key: 'term', label: 'term' }, { key: 'est', label: 'estimate', cls: 'n', fmt: (v) => num(v) }, { key: 'se', label: 'std. error (KR)', cls: 'n', fmt: (v) => num(v) },
      { key: 'df', label: 'df', cls: 'n', fmt: (v) => num(v, 4) }, { key: 'p', label: 'p', cls: 'n', fmt: (v) => h('span', { class: v < 0.05 ? 'sig' : '' }, pval(v)) }],
    m.columns.map((c, j) => ({ term: c, est: m.coef[j], se: m.seKR[j], df: m.dfKR[j], p: m.pKR[j] })).filter(r => Number.isFinite(r.est))),
    h('p', { class: 'muted small' }, `Coefficients in coded units (−1 … +1), estimated by generalised least squares. REML criterion ${num(m.REML, 8)}.`));
}
