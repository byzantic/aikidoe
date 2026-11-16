// Analyse step for ordinal scores (issue #83, phase 2): a cumulative link model — odds ratios, the
// cut points, likelihood-ratio tests, the test of proportional odds, and the chance of each score
// at each condition tested beside the scores given.
import { h, help, dataTable, messages } from './dom.js';
import { num, pval } from '../js/format.js';
import { anova } from '../js/model/fit.js';
import { oddsRatios, proportionalOddsTest, scoresAtConditions } from '../js/model/ordinal.js';
import { scoresSVG } from '../js/io/svg-space.js';
import { noiseOf } from '../js/model/noise.js';
import { hierarchyViolations } from '../js/model/formula.js';
import { svgEl } from './space.js';
import { cached } from './glmm.js';

export function ordinalAnalysis(ctx, fit, { ui, setFormula, rhs, resp }) {
  const { update } = ctx, study = ctx.state.study, cats = resp.categories;
  const nm = noiseOf(fit);
  const notes = [];
  for (const v of hierarchyViolations(fit.model)) notes.push(`${v.term} is in the model without ${v.missing.join(', ')}.`);
  if (fit.aliased.length) notes.push(`Not estimable (aliased with earlier terms): ${fit.aliased.join(', ')}.`);
  const checks = fit.warnings.map(w => h('div', { class: 'msg warning' }, w));
  if (study.design.runs.some(r => r.wholePlot !== undefined)) checks.push(h('div', { class: 'msg warning' }, 'Split-plot design: this model treats every score as independent, so tests of the hard-to-change factors are too optimistic.'));
  if (fit.n > new Set(fit.rows.map(r => r.run)).size) checks.push(h('div', { class: 'msg', id: 'ordinal-judges' }, 'Several scores per run are treated as independent. If the same judges score every run and some judges score higher than others, the tests are a little optimistic.'));

  const or = oddsRatios(fit);
  const summary = h('section', { class: 'panel' }, h('h2', {}, 'Fit', help('analysis', 'ordinal-scores')),
    h('p', { class: 'small' }, h('b', {}, nm.label), `. ${cats.length} categories: ${cats.map((c, k) => `${k + 1} ${c}`).join(', ')}.`),
    messages(notes, 'warning'), checks,
    h('div', { class: 'row small', id: 'fit-stats' },
      h('span', { class: 'stat' }, h('b', {}, fit.n), ' scores'), ...fit.counts.map((c, k) => h('span', { class: 'stat' }, `${cats[k]} `, h('b', {}, c))),
      h('span', { class: 'stat' }, 'log-likelihood ', h('b', {}, num(fit.loglik, 5))), h('span', { class: 'stat' }, 'AIC ', h('b', {}, num(fit.aic, 5)))),
    dataTable([
      { key: 'term', label: 'term' }, { key: 'estimate', label: 'estimate', cls: 'n', fmt: (v) => num(v) },
      { key: 'se', label: 'std. error', cls: 'n', fmt: (v) => num(v) }, { key: 'z', label: 'z', cls: 'n', fmt: (v) => num(v, 3) },
      { key: 'p', label: 'p', cls: 'n', fmt: (v) => h('span', { class: v < 0.05 ? 'sig' : '' }, pval(v)) },
      ...(fit.link === 'logit' ? [{ key: 'ratio', label: 'odds ratio', cls: 'n', fmt: (v) => num(v, 4) }, { key: 'ci', label: '95% interval', cls: 'n', fmt: (_, r) => `${num(r.lower, 4)} … ${num(r.upper, 4)}` }] : []),
      { key: 'drop', label: '', fmt: (_, r) => h('button', { class: 'btn small', title: `remove ${fit.model.terms[r.assign].label} from the model`, onclick: () => setFormula(`${resp.id} ~ ${rhs} - ${fit.model.terms[r.assign].label}`) }, '−') },
    ], or, { rowAttrs: (r) => ({ 'data-term': r.term }) }),
    h('p', { class: 'muted small' }, fit.link === 'logit'
      ? 'Coefficients are in coded units; a positive one moves the scores up. An odds ratio is the factor by which the odds of a higher score rather than a lower one change per coded unit, the same at every split of the scale (proportional odds); from a factor’s low to its high setting, square it.'
      : `Coefficients are on the ${fit.link} scale of the hidden value behind the scores, in coded units; a positive one moves the scores up.`),
    h('details', {}, h('summary', { class: 'small' }, 'cut points'), dataTable([{ key: 'label', label: 'between' }, { key: 'estimate', label: 'estimate', cls: 'n', fmt: (v) => num(v) }, { key: 'se', label: 'std. error', cls: 'n', fmt: (v) => num(v) }],
      fit.thresholds.map((t, j) => ({ ...t, label: `${cats[j]} | ${cats[j + 1]}` }))),
    h('p', { class: 'muted small' }, 'Where the hidden value behind the scores crosses from one category to the next, at the centre of the factors (and the first level of categorical ones).')));

  const type = ui.anovaType ?? 1, tests = anova(fit, type);
  const testsPanel = h('section', { class: 'panel', id: 'ordinal-tests' },
    h('h2', {}, `Likelihood-ratio tests (type ${['', 'I', 'II', 'III'][type]})`, help('analysis', 'ordinal-scores')),
    dataTable([{ key: 'term', label: 'source' }, { key: 'df', label: 'df', cls: 'n' }, { key: 'chi2', label: 'χ²', cls: 'n', fmt: (v) => num(v) },
      { key: 'p', label: 'p', cls: 'n', fmt: (v) => h('span', { class: v < 0.05 ? 'sig' : '' }, pval(v)) }], tests.filter(r => r.term !== 'Residuals')));

  // proportional odds: each term's effects allowed to differ between cut points
  let po = [];
  try { po = cached(study, JSON.stringify(['po', fit.columns, fit.link, fit.n, fit.loglik]), () => proportionalOddsTest(fit)); } catch { /* none */ }
  const bad = po.filter(r => r.p < 0.05 && r.term !== 'all terms');
  const poPanel = po.length ? h('section', { class: 'panel', id: 'proportional-odds' }, h('h2', {}, 'Proportional odds', help('analysis', 'proportional-odds')),
    bad.length ? h('div', { class: 'msg warning' }, `${bad.map(r => r.term).join(', ')}: the effect differs between splits of the scale (p ${pval(Math.min(...bad.map(r => r.p)))}), so a single odds ratio does not describe it well. Look at the chance of each score below, rather than the odds ratio; or merge categories.`) : null,
    dataTable([{ key: 'term', label: 'term' }, { key: 'df', label: 'df', cls: 'n' }, { key: 'chi2', label: 'χ²', cls: 'n', fmt: (v) => (Number.isFinite(v) ? num(v) : 'not fitted') },
      { key: 'p', label: 'p', cls: 'n', fmt: (v) => (Number.isFinite(v) ? h('span', { class: v < 0.05 ? 'sig' : '' }, pval(v)) : '') }], po),
    h('p', { class: 'muted small' }, 'Each term’s effect is allowed to differ between the cut points (poor | fair, fair | good …), and the gain in likelihood tested. A large p: one odds ratio describes the term, as the model assumes. “Not fitted”: the freer model could not be fitted to these data.')) : null;

  const sc = scoresAtConditions(fit);
  const condPanel = h('section', { class: 'panel', id: 'ordinal-conditions' }, h('h2', {}, 'Scores at the conditions tested', help('analysis', 'ordinal-scores')),
    svgEl(scoresSVG(sc, cats), { id: 'scores-plot' }),
    dataTable([
      { key: 'cond', label: 'settings' }, { key: 'runs', label: 'run', cls: 'n', fmt: (v) => v.join(', ') }, { key: 'n', label: 'scores', cls: 'n' },
      ...cats.map((c, j) => ({ key: `p${j}`, label: `${c} %`, cls: 'n', fmt: (_, r) => `${num(100 * r.probs[j].p, 3)} (${r.observed[j]})` })),
      { key: 'mean', label: 'mean score', cls: 'n', fmt: (v, r) => `${num(v, 3)} (${num(r.observedMean, 3)})` },
    ], sc.map(r => ({ ...r, cond: Object.entries(r.settings).map(([k, v]) => `${k} = ${v}`).join(', ') }))),
    h('p', { class: 'muted small' }, 'The model’s chance of each score, with the number given in brackets; the mean score (1 = lowest) with the observed mean in brackets.'));
  return [summary, testsPanel, poPanel, condPanel];
}
