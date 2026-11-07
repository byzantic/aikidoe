// Analyse step for counts and proportions (issue #64): a generalised linear model's coefficients with
// rate or odds ratios and profile intervals, the deviance, the analysis of deviance, the checks
// (overdispersion, separation) with the remedy one click away, and residual plots.
import { h, select, help, dataTable, messages } from './dom.js';
import { plot } from './plot.js';
import { num, pval } from '../js/format.js';
import { normal } from '../js/dist.js';
import { anova } from '../js/model/fit.js';
import { glmConfint } from '../js/model/glm.js';
import { noiseOf } from '../js/model/noise.js';
import { hierarchyViolations } from '../js/model/formula.js';

export function glmAnalysis(ctx, fit, { ui, set, setFormula, rhs, resp }) {
  const { state, update } = ctx, study = state.study;
  const nm = noiseOf(fit), ratioName = fit.link === 'log' ? 'rate ratio' : fit.link === 'logit' ? 'odds ratio' : null;
  const setDist = (d) => update(x => { const r = x.responses.find(y => y.id === resp.id); r.distribution = d; delete r.link; });
  const notes = [];
  for (const v of hierarchyViolations(fit.model)) notes.push(`${v.term} is in the model without ${v.missing.join(', ')}.`);
  if (fit.aliased.length) notes.push(`Not estimable (aliased with earlier terms): ${fit.aliased.join(', ')}.`);
  if (study.design.runs.some(r => r.wholePlot !== undefined)) notes.push('Split-plot design: this model treats every run as independent, so tests of the hard-to-change factors are too optimistic (random effects for counts and proportions come later).');

  // the checks, with their remedies
  const checks = [];
  if (fit.overdispersion?.detected) checks.push(h('div', { class: 'msg warning', id: 'glm-overdispersion' },
    `Overdispersion: the counts vary ${num(fit.overdispersion.ratio, 3)} times as much as the ${fit.distribution === 'poisson' ? 'Poisson' : 'binomial'} model allows (Pearson χ²/df, p ${pval(fit.overdispersion.p)}), so its standard errors are too small and its tests too optimistic. `,
    fit.distribution === 'poisson' ? [h('button', { class: 'btn small', id: 'use-negbin', onclick: () => setDist('negbin') }, 'use the negative binomial'), ' ', h('button', { class: 'btn small', onclick: () => setDist('quasipoisson') }, 'quasi-Poisson')]
      : h('button', { class: 'btn small', id: 'use-quasibinomial', onclick: () => setDist('quasibinomial') }, 'use the quasi-binomial')));
  if (fit.separation) checks.push(h('div', { class: 'msg warning', id: 'glm-separation' },
    'Separation: some settings give only passes or only failures, so the estimates run off to infinity and their standard errors mean nothing. Firth’s penalised likelihood gives finite estimates. ',
    h('button', { class: 'btn small', id: 'use-firth', onclick: () => set({ firth: true }) }, 'use Firth’s method')));
  if (fit.firth) checks.push(h('div', { class: 'msg', id: 'glm-firth' }, 'Firth’s penalised likelihood (estimates shrunk slightly towards zero; Wald tests and intervals). ', h('button', { class: 'btn small', onclick: () => set({ firth: false }) }, 'ordinary maximum likelihood')));
  for (const w of fit.warnings.filter(w => !/overdispersion|separated/.test(w))) checks.push(h('div', { class: 'msg warning' }, w));

  // coefficients with ratios and intervals (profile likelihood unless Firth)
  let ci = [];
  try { ci = glmConfint(fit); } catch { /* none */ }
  const rows = fit.columns.map((c, j) => ({ term: c, est: fit.coef[j], se: fit.se[j], z: fit.t[j], p: fit.p[j], assign: fit.assign[j], termLabel: fit.assign[j] >= 0 ? fit.model.terms[fit.assign[j]].label : '', ci: ci.find(x => x.name === c) })).filter(r => Number.isFinite(r.est));
  const summary = h('section', { class: 'panel' }, h('h2', {}, 'Fit', help('analysis', 'counts-and-proportions')),
    h('p', { class: 'small' }, h('b', {}, nm.label), `, ${fit.link} link${fit.distribution === 'negbin' ? `, θ = ${num(fit.theta, 4)} (s.e. ${num(fit.thetaSE, 3)}; variance μ + μ²/θ)` : ''}${fit.offset.some(v => v !== 0) ? '; exposure as an offset, so the model is for the rate per unit exposure' : ''}.`),
    messages(notes, 'warning'), checks,
    h('div', { class: 'row small', id: 'fit-stats' },
      h('span', { class: 'stat' }, h('b', {}, fit.n), ' observations'), h('span', { class: 'stat' }, h('b', {}, fit.rank), ' coefficients'), h('span', { class: 'stat' }, h('b', {}, fit.dfRes), ' residual df'),
      h('span', { class: 'stat' }, 'deviance ', h('b', {}, num(fit.deviance, 4)), ` (null ${num(fit.nullDeviance, 4)})`),
      h('span', { class: 'stat' }, 'explained ', h('b', {}, `${num(100 * fit.devExplained, 3)}%`)),
      Number.isFinite(fit.aic) ? h('span', { class: 'stat' }, 'AIC ', h('b', {}, num(fit.aic, 5))) : null,
      fit.dispersionEstimated ? h('span', { class: 'stat' }, 'dispersion ', h('b', {}, num(fit.dispersion, 4))) : null,
      fit.overdispersion && !fit.overdispersion.detected ? h('span', { class: 'stat' }, 'Pearson χ²/df ', h('b', {}, num(fit.overdispersion.ratio, 3))) : null),
    dataTable([
      { key: 'term', label: 'term' }, { key: 'est', label: 'estimate', cls: 'n', fmt: (v) => num(v) },
      { key: 'se', label: 'std. error', cls: 'n', fmt: (v) => num(v) }, { key: 'z', label: fit.statistic, cls: 'n', fmt: (v) => num(v, 3) },
      { key: 'p', label: 'p', cls: 'n', fmt: (v) => h('span', { class: v < 0.05 ? 'sig' : '' }, pval(v)) },
      ...(ratioName ? [{ key: 'ci', label: ratioName, cls: 'n', fmt: (v) => (v ? num(v.ratio.estimate, 4) : '') },
        { key: 'ci', label: `95% interval (${ci[0]?.method ?? ''})`, cls: 'n', fmt: (v) => (v ? `${num(v.ratio.lower, 4)} … ${num(v.ratio.upper, 4)}` : '') }] : []),
      { key: 'drop', label: '', fmt: (_, r) => (r.assign >= 0 ? h('button', { class: 'btn small', title: `remove ${r.termLabel} from the model`, onclick: () => setFormula(`${resp.id} ~ ${rhs} - ${r.termLabel}`) }, '−') : null) },
    ], rows, { rowAttrs: (r) => ({ 'data-term': r.term }) }),
    h('p', { class: 'muted small' }, ratioName
      ? `Coefficients are on the ${fit.link} scale, in coded units. A ${ratioName} is the factor by which the ${fit.link === 'log' ? 'mean count (rate)' : 'odds'} ${fit.link === 'log' ? 'changes' : 'change'} per coded unit; from a factor's low to its high setting, square it.`
      : `Coefficients are on the ${fit.link} scale, in coded units.`));

  // analysis of deviance
  const type = ui.anovaType ?? 1, tests = anova(fit, fit.firth ? 2 : type), F = tests.some(r => r.F !== undefined);
  const testsPanel = h('section', { class: 'panel', id: 'glm-tests' },
    h('h2', {}, fit.firth ? 'Wald tests' : `Analysis of deviance (type ${['', 'I', 'II', 'III'][type]})`, help('analysis', 'counts-and-proportions')),
    dataTable([{ key: 'term', label: 'source' }, { key: 'df', label: 'df', cls: 'n' },
      ...(fit.firth ? [] : [{ key: 'deviance', label: 'deviance', cls: 'n', fmt: (v) => num(v) }]),
      { key: F ? 'F' : 'chi2', label: F ? 'F' : 'χ²', cls: 'n', fmt: (v) => (v === undefined ? '' : num(v)) },
      { key: 'p', label: 'p', cls: 'n', fmt: (v) => (v === undefined ? '' : h('span', { class: v < 0.05 ? 'sig' : '' }, pval(v))) }], tests),
    h('p', { class: 'muted small' }, fit.firth ? 'Each term tested by its Wald χ² (the penalised likelihood is not a likelihood for ratio tests).'
      : F ? 'F tests: the deviance a term explains per df, against the estimated dispersion.' : 'Likelihood-ratio tests: the deviance a term explains is χ² on its df when the term does nothing.'));

  // diagnostics: deviance residuals
  let diag = null;
  if (fit.dfRes > 0) {
    const pts = fit.rows.map((r, i) => ({ fitted: fit.linear[i], res: fit.rstandard[i], order: r.order, run: r.run })).filter(p => Number.isFinite(p.res));
    const sorted = pts.slice().sort((a, b) => a.res - b.res);
    const qq = sorted.map((p, i) => ({ x: normal.ppf((i + 0.5) / sorted.length), y: p.res, hi: Math.abs(p.res) > 3, title: `run ${p.run}` }));
    const big = pts.filter(p => Math.abs(p.res) > 3);
    diag = h('section', { class: 'panel' }, h('h2', {}, 'Diagnostics', help('analysis', 'diagnostics')),
      h('div', { class: 'plots' },
        h('figure', {}, h('figcaption', {}, `Standardised deviance residuals against the linear predictor (${fit.link} scale)`), plot({ xLabel: `fitted (${fit.link})`, yLabel: 'std. deviance residual', height: 220, hlines: [{ y: 0 }], series: [{ points: pts.map(p => ({ x: p.fitted, y: p.res, title: `run ${p.run}` })) }] })),
        h('figure', {}, h('figcaption', {}, 'Normal plot of standardised deviance residuals'), plot({ xLabel: 'normal quantile', yLabel: 'std. deviance residual', height: 220, series: [{ points: qq }, { kind: 'line', cls: 'dash s2', points: [{ x: qq[0]?.x ?? -2, y: qq[0]?.x ?? -2 }, { x: qq.at(-1)?.x ?? 2, y: qq.at(-1)?.x ?? 2 }] }] })),
        h('figure', {}, h('figcaption', {}, 'In run order (drift?)'), plot({ xLabel: 'run order', yLabel: 'std. deviance residual', height: 220, hlines: [{ y: 0 }], series: [{ points: pts.map(p => ({ x: p.order, y: p.res, title: `run ${p.run}` })) }] }))),
      big.length ? h('div', { class: 'msg warning' }, `Standardised deviance residual beyond ±3: ${big.map(p => `run ${p.run} (${num(p.res, 3)})`).join(', ')}. Check those results.`) : null,
      h('p', { class: 'muted small' }, 'Deviance residuals are roughly normal when counts are not too small (above about 5) or trials not too few; with smaller counts, the plots are rough guides.'));
  }
  return [summary, testsPanel, diag];
}
