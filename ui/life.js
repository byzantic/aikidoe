// Analyse step for times to an event (issue #83): an accelerated-life model (Weibull or
// log-normal) with right censoring — time ratios, likelihood-ratio tests, the life (B10 and
// median) at each condition tested, and the probability plot.
import { h, select, help, dataTable, messages } from './dom.js';
import { num, pval } from '../js/format.js';
import { anova } from '../js/model/fit.js';
import { timeRatios, lifeAtConditions, probabilityPlot } from '../js/model/survreg.js';
import { probabilitySVG } from '../js/io/svg-space.js';
import { noiseOf } from '../js/model/noise.js';
import { hierarchyViolations } from '../js/model/formula.js';
import { svgEl } from './space.js';

export function lifeAnalysis(ctx, fit, { ui, set, setFormula, rhs, resp }) {
  const { update } = ctx, study = ctx.state.study;
  const nm = noiseOf(fit), u = resp.units ? ` (${resp.units})` : '';
  const other = fit.distribution === 'weibull' ? 'lognormal' : 'weibull';
  const notes = [];
  for (const v of hierarchyViolations(fit.model)) notes.push(`${v.term} is in the model without ${v.missing.join(', ')}.`);
  if (fit.aliased.length) notes.push(`Not estimable (aliased with earlier terms): ${fit.aliased.join(', ')}.`);
  const checks = fit.warnings.map(w => h('div', { class: 'msg warning' }, w));
  // conditions where nothing failed: their life is extrapolated from the model
  const life = lifeAtConditions(fit);
  const none = life.filter(c => c.failures === 0);
  if (none.length) checks.push(h('div', { class: 'msg', id: 'life-no-failures' }, `No failures at ${none.length === 1 ? 'one condition' : `${none.length} conditions`} (${none.map(c => `run${c.runs.length > 1 ? 's' : ''} ${c.runs.join(', ')}`).join('; ')}): its life comes from the model, fitted to the other conditions, and the censored units only say it is longer than the test.`));
  if (study.design.runs.some(r => r.wholePlot !== undefined)) checks.push(h('div', { class: 'msg warning' }, 'Split-plot design: this model treats every unit as independent, so tests of the hard-to-change factors are too optimistic.'));

  const tr = timeRatios(fit);
  const summary = h('section', { class: 'panel' }, h('h2', {}, 'Fit', help('analysis', 'times-to-failure')),
    h('p', { class: 'small' }, h('b', {}, nm.label), '. ',
      fit.distribution === 'weibull' ? `Weibull shape β = ${num(1 / fit.scale, 4)} (${1 / fit.scale > 1 ? 'the failure rate rises with age: wear-out' : 'the failure rate falls with age: early failures'}); ` : `σ of log time = ${num(fit.scale, 4)}; `,
      `scale on log time σ = ${num(fit.scale, 4)}. `,
      h('button', { class: 'btn small', id: 'use-other-life', onclick: () => update(x => { x.responses.find(y => y.id === resp.id).distribution = other; }) }, `try the ${other === 'weibull' ? 'Weibull' : 'log-normal'} model`)),
    messages(notes, 'warning'), checks,
    h('div', { class: 'row small', id: 'fit-stats' },
      h('span', { class: 'stat' }, h('b', {}, fit.n), ' units'), h('span', { class: 'stat' }, h('b', {}, fit.events), ' failed'), h('span', { class: 'stat' }, h('b', {}, fit.censored), ' still working at the end (censored)'),
      h('span', { class: 'stat' }, 'log-likelihood ', h('b', {}, num(fit.loglik, 5))), h('span', { class: 'stat' }, 'AIC ', h('b', {}, num(fit.aic, 5)))),
    dataTable([
      { key: 'term', label: 'term' }, { key: 'estimate', label: 'estimate', cls: 'n', fmt: (v) => num(v) },
      { key: 'se', label: 'std. error', cls: 'n', fmt: (v) => num(v) }, { key: 'z', label: 'z', cls: 'n', fmt: (v) => num(v, 3) },
      { key: 'p', label: 'p', cls: 'n', fmt: (v) => h('span', { class: v < 0.05 ? 'sig' : '' }, pval(v)) },
      { key: 'ratio', label: 'time ratio', cls: 'n', fmt: (v, r) => (r.assign >= 0 ? num(v, 4) : '') },
      { key: 'ci', label: '95% interval', cls: 'n', fmt: (_, r) => (r.assign >= 0 ? `${num(r.lower, 4)} … ${num(r.upper, 4)}` : '') },
      { key: 'drop', label: '', fmt: (_, r) => (r.assign >= 0 ? h('button', { class: 'btn small', title: `remove ${fit.model.terms[r.assign].label} from the model`, onclick: () => setFormula(`${resp.id} ~ ${rhs} - ${fit.model.terms[r.assign].label}`) }, '−') : null) },
    ], tr.map(r => ({ ...r, z: r.estimate / r.se, p: fit.p[fit.columns.indexOf(r.term)] })), { rowAttrs: (r) => ({ 'data-term': r.term }) }),
    h('p', { class: 'muted small' }, 'Coefficients are on the log-time scale, in coded units. A time ratio is the factor by which every quantile of the life (the B10, the median …) is multiplied per coded unit; from a factor’s low to its high setting, square it. Below 1, the factor shortens the life.'));

  const type = ui.anovaType ?? 1, tests = anova(fit, type);
  const testsPanel = h('section', { class: 'panel', id: 'life-tests' },
    h('h2', {}, `Likelihood-ratio tests (type ${['', 'I', 'II', 'III'][type]})`, help('analysis', 'times-to-failure')),
    dataTable([{ key: 'term', label: 'source' }, { key: 'df', label: 'df', cls: 'n' },
      { key: 'chi2', label: 'χ²', cls: 'n', fmt: (v) => (v === undefined ? '' : num(v)) },
      { key: 'p', label: 'p', cls: 'n', fmt: (v) => (v === undefined ? '' : h('span', { class: v < 0.05 ? 'sig' : '' }, pval(v))) }], tests.filter(r => r.term !== 'Residuals')),
    h('p', { class: 'muted small' }, 'Each term’s χ² is twice the gain in log-likelihood from adding it; censored units count for what they show (that the life is at least that long).'));

  const lifeTable = h('section', { class: 'panel', id: 'life-conditions' }, h('h2', {}, 'Life at the conditions tested', help('analysis', 'times-to-failure')),
    dataTable([
      { key: 'cond', label: 'settings' }, { key: 'runs', label: 'run', cls: 'n', fmt: (v) => v.join(', ') },
      { key: 'units', label: 'units', cls: 'n' }, { key: 'failures', label: 'failed', cls: 'n' },
      { key: 'b10', label: `B10 life${u}`, cls: 'n', fmt: (q) => num(q.fit, 4) }, { key: 'b10', label: '95% interval', cls: 'n', fmt: (q) => `${num(q.lower, 4)} … ${num(q.upper, 4)}` },
      { key: 'b50', label: `median life${u}`, cls: 'n', fmt: (q) => num(q.fit, 4) }, { key: 'b50', label: '95% interval', cls: 'n', fmt: (q) => `${num(q.lower, 4)} … ${num(q.upper, 4)}` },
    ], life.map(c => ({ cond: Object.entries(c.settings).map(([k, v]) => `${k} = ${v}`).join(', '), runs: c.runs, units: c.units, failures: c.failures, b10: c.quantiles[0], b50: c.quantiles[1] }))),
    h('p', { class: 'muted small' }, 'B10: the time by which 10 % of units are expected to fail. Intervals are for the model’s estimate (delta method on the log scale), not for a single unit.'));

  const pp = probabilityPlot(fit);
  const plotPanel = h('section', { class: 'panel', id: 'life-plot' }, h('h2', {}, 'Probability plot', help('analysis', 'probability-plot')),
    svgEl(probabilitySVG(pp, { timeLabel: `${resp.name}${u}` }), { id: 'probability-plot' }),
    h('p', { class: 'muted small' }, `Each condition’s failures at their plotting positions (Kaplan–Meier, midway through each step, so the units still working count), on the ${pp.label} scale, with the model’s line. Points close to straight lines mean the ${pp.label} model fits; parallel lines mean one shape (σ) suits every condition, as the model assumes. A curve, or lines that fan out, suggest trying the ${other === 'weibull' ? 'Weibull' : 'log-normal'} model.`));
  return [summary, testsPanel, lifeTable, plotPanel];
}
