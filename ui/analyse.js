// Analyse step: fit a model, ANOVA, effects, diagnostics (spec §12 step 4).
import { h, select, messages, dataTable } from './dom.js';
import { plot } from './plot.js';
import { num, pval } from '../js/format.js';
import { fitModel, anova, lackOfFit, boxCox, lenth, halfNormal, twoLevelEffects } from '../js/model/ols.js';
import { hierarchyViolations } from '../js/model/formula.js';
import { normal } from '../js/dist.js';

/** A sensible first model for the study's design. */
export function defaultFormula(study, response) {
  const d = study.design, k = study.factors.length;
  if (!d) return `${response} ~ main`;
  if (d.kind === 'ccd' || d.kind === 'box-behnken') return `${response} ~ quadratic`;
  if (d.kind === 'plackett-burman') return `${response} ~ main`;
  if (d.kind === 'fractional-factorial') return `${response} ~ ${d.params.resolution >= 5 ? '2fi' : 'main'}`;
  const twoLevel = study.factors.every(f => f.type === 'continuous' || f.levels.length === 2);
  return `${response} ~ ${twoLevel && d.runs.length >= 1 + k + k * (k - 1) / 2 ? '2fi' : 'main'}`;
}

export function render({ state, setUI }) {
  const study = state.study, ui = state.ui.analyse ??= {};
  const withData = study.responses.filter(r => study.observations.some(o => o.response === r.id && o.value !== null));
  const resp = withData.find(r => r.id === ui.response) ?? withData[0];
  const formula = ui.formulas?.[resp.id] ?? defaultFormula(study, resp.id);
  const set = (patch) => setUI({ analyse: { ...ui, ...patch } });
  const setFormula = (f) => set({ formulas: { ...(ui.formulas ?? {}), [resp.id]: f } });
  const rhs = formula.includes('~') ? formula.slice(formula.indexOf('~') + 1).trim() : formula;

  const fIn = h('input', { type: 'text', class: 'formula', id: 'formula', value: formula, 'aria-label': 'model formula', spellcheck: 'false',
    onchange: (e) => setFormula(e.target.value.includes('~') ? e.target.value : `${resp.id} ~ ${e.target.value}`) });
  const controls = h('section', { class: 'panel' }, h('h2', {}, 'Model'),
    h('div', { class: 'row', style: 'margin-bottom:8px' },
      withData.length > 1 ? h('label', { class: 'inline' }, 'response', select(withData.map(r => ({ value: r.id, label: r.name })), resp.id, (v) => set({ response: v }), { 'aria-label': 'response' })) : h('span', {}, h('b', {}, resp.name), resp.units ? ` (${resp.units})` : ''),
      ['main', '2fi', 'quadratic'].map(s => h('button', { class: 'btn', onclick: () => setFormula(`${resp.id} ~ ${s}`), title: { main: 'main effects', '2fi': 'main effects and two-factor interactions', quadratic: 'full quadratic (response surface)' }[s] }, s)),
      h('button', { class: 'btn', onclick: () => setFormula(defaultFormula(study, resp.id)) }, 'reset'),
      h('label', { class: 'inline' }, 'ANOVA', select([{ value: 1, label: 'type I (sequential)' }, { value: 2, label: 'type II' }, { value: 3, label: 'type III' }], ui.anovaType ?? 1, (v) => set({ anovaType: Number(v) }), { 'aria-label': 'ANOVA type' }))),
    fIn,
    h('p', { class: 'muted small' }, 'R-style formula over factor ids: ', h('span', { class: 'mono' }, 'A*B'), ' = A + B + A:B, ', h('span', { class: 'mono' }, '(A+B+C)^2'), ', ', h('span', { class: 'mono' }, 'I(T^2)'), ', ', h('span', { class: 'mono' }, '- A:B'), '. Coefficients are in coded units (−1 … +1).'));

  let fit;
  try { fit = fitModel(study, formula); } catch (e) { return h('div', {}, controls, h('div', { class: 'msg error' }, e.message)); }

  const notes = [];
  if (fit.rows.some(r => r.n > 1)) notes.push('Repeated observations of a run (wafers, sites, repeats) are averaged: this least-squares fit uses run means. Mixed models for nested measurements come in a later version.');
  for (const v of hierarchyViolations(fit.model)) notes.push(`${v.term} is in the model without ${v.missing.join(', ')}.`);
  if (fit.aliased.length) notes.push(`Not estimable (aliased with earlier terms): ${fit.aliased.join(', ')}.`);
  const missingRuns = study.design.runs.length - fit.n;
  if (missingRuns) notes.push(`${missingRuns} run(s) have no result yet and are left out.`);

  // ---------------------------------------------------------------- summary and coefficients
  const summary = h('section', { class: 'panel' }, h('h2', {}, 'Fit'),
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
  if (fit.dfRes > 0) {
    const rows = anova(fit, ui.anovaType ?? 1);
    const lof = lackOfFit(fit);
    if (lof?.lackOfFit) { const res = rows.pop(); rows.push(res, { term: '  lack of fit', ...lof.lackOfFit }, { term: '  pure error', ...lof.pureError }); }
    anovaPanel = h('section', { class: 'panel' }, h('h2', {}, `ANOVA (type ${['', 'I', 'II', 'III'][ui.anovaType ?? 1]})`),
      dataTable([{ key: 'term', label: 'source' }, { key: 'df', label: 'df', cls: 'n' }, { key: 'ss', label: 'sum of squares', cls: 'n', fmt: (v) => num(v) }, { key: 'ms', label: 'mean square', cls: 'n', fmt: (v) => num(v) },
        { key: 'F', label: 'F', cls: 'n', fmt: (v) => (v === undefined ? '' : num(v)) }, { key: 'p', label: 'p', cls: 'n', fmt: (v) => (v === undefined ? '' : h('span', { class: v < 0.05 ? 'sig' : '' }, pval(v))) }], rows),
      lof?.lackOfFit ? h('p', { class: 'muted small' }, lof.lackOfFit.p < 0.05 ? 'Lack of fit is significant: the model misses curvature or interactions that the replicated runs reveal.' : 'No evidence of lack of fit against pure error from the replicated runs.') : null);
  }

  // ---------------------------------------------------------------- effects (two-level)
  let effectsPanel = null;
  const twoLevel = study.factors.every(f => f.type === 'continuous' || f.levels.length === 2) && !['ccd', 'box-behnken'].includes(study.design.kind) && !fit.model.terms.some(t => t.comps.some(c => c.I));
  const eff = twoLevelEffects(fit);
  if (twoLevel && eff.length >= 3) {
    const L = lenth(eff.map(e => e.effect)), hn = halfNormal(eff.map(e => e.effect));
    effectsPanel = h('section', { class: 'panel' }, h('h2', {}, 'Effects'),
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
    diag = h('section', { class: 'panel' }, h('h2', {}, 'Diagnostics'), h('div', { class: 'plots' }, figs),
      big.length ? h('div', { class: 'msg warning' }, `Studentised residual beyond ±3: ${big.map(p => `run ${p.run} (${num(p.st, 3)})`).join(', ')}. Check those results.`) : null);
  }
  return h('div', {}, controls, summary, anovaPanel, effectsPanel, diag);
}
