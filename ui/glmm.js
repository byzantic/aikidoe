// Analyse step for counts and proportions with a random intercept (issue #64, phase 5): the whole
// plots of a split-plot, or blocks when asked. The fixed effects with rate or odds ratios, σ of the
// random effect and its test, the likelihood-ratio tests of the terms, and the estimated whole-plot
// or block effects.
import { h, help, dataTable, messages } from './dom.js';
import { plot } from './plot.js';
import { num, pval } from '../js/format.js';
import { glmmTests, glmmConfint } from '../js/model/glmm.js';
import { noiseOf } from '../js/model/noise.js';
import { hierarchyViolations } from '../js/model/formula.js';

// fits and tests take a few hundred milliseconds: kept per study object (studies are replaced, not
// changed, on every edit)
const cache = new WeakMap();
export function cached(study, key, make) {
  let m = cache.get(study);
  if (!m) { m = new Map(); cache.set(study, m); }
  if (!m.has(key)) { try { m.set(key, { value: make() }); } catch (e) { m.set(key, { error: e }); } }
  const r = m.get(key);
  if (r.error) throw r.error;
  return r.value;
}

export function glmmAnalysis(ctx, fit, { ui, set, setFormula, rhs, resp }) {
  const study = ctx.state.study;
  const nm = noiseOf(fit), ratioName = fit.link === 'log' ? 'rate ratio' : fit.link === 'logit' ? 'odds ratio' : null;
  const R = fit.randoms, nested = R.length > 1;
  const adj = (name) => name.replace(' ', '-');                                           // as an adjective (whole-plot)
  const g = R[R.length - 1].name, gs = `${g}s`;                                            // the innermost grouping
  const which = nested ? `random ${R.map(r => adj(r.name)).join(' and ')} effects` : `a random ${adj(g)} effect`;
  const notes = [];
  for (const v of hierarchyViolations(fit.model)) notes.push(`${v.term} is in the model without ${v.missing.join(', ')}.`);
  if (fit.aliased.length) notes.push(`Not estimable (aliased with earlier terms): ${fit.aliased.join(', ')}.`);
  for (const w of fit.warnings.filter(w => !/^overdispersion/.test(w))) notes.push(w);
  const od = fit.overdispersion?.detected ? h('div', { class: 'msg warning', id: 'glmm-overdispersion' },
    `Overdispersion within ${gs}: the counts vary ${num(fit.overdispersion.ratio, 3)} times as much as the Poisson model allows (Pearson χ²/df, p ${pval(fit.overdispersion.p)}), beyond the shifts between ${gs}, so the standard errors are too small. `,
    h('button', { class: 'btn small', id: 'use-negbin', onclick: () => ctx.update(x => { const r = x.responses.find(y => y.id === resp.id); r.distribution = 'negbin'; delete r.link; }) }, 'use the negative binomial')) : null;

  const ci = glmmConfint(fit);
  const rows = fit.columns.map((c, j) => ({ term: c, est: fit.coef[j], se: fit.se[j], z: fit.z[j], df: fit.df[j], p: fit.p[j], ci: ci.find(x => x.name === c), assign: fit.assign[j],
    termLabel: fit.assign[j] >= 0 ? fit.model.terms[fit.assign[j]].label : null })).filter(r => !Number.isNaN(r.est));
  const design = study.design.runs.some(r => r.wholePlot !== undefined) && fit.random.id === 'wholePlot' ? 'split-plot' : 'blocked design';
  const intro = nested
    ? `Observations in the same ${g} share a shift on the ${fit.link} scale, ${R.slice(0, -1).reverse().map(r => `${R[R.indexOf(r) + 1].name}s in the same ${r.name} share another`).join(', and ')}: each level's shifts are drawn from a normal distribution with its own σ, and the ${R.map(r => `${r.name}s`).join(' and ')} are a sample of the ones that could have been used. Fitted by the Laplace approximation over all the shifts.`
    : `Runs in the same ${g} share a shift on the ${fit.link} scale, drawn from a normal distribution with standard deviation σ: the model for a ${design} whose ${gs} are a sample of the ones that could have been run.`;
  const act = R.filter(r => !r.boundary && r.coefficients.length);
  const strata = act.map(r => { const t = R.filter(x => !x.boundary).indexOf(r), outer = t ? R.filter(x => !x.boundary)[t - 1] : null;
    const one = r.coefficients.length === 1;
    return `${r.coefficients.join(', ')} change${one ? 's' : ''} only between ${r.name}s${outer ? ` within ${outer.name}s` : ''}, so ${one ? 'it is' : 'they are'} judged against the variation from one ${r.name} to the next: t on ${r.df} df${nested ? '' : ` (${r.m} ${r.name}s − ${r.coefficients.length})`}, with standard errors widened for the few ${r.name}s.`; });
  const summary = h('section', { class: 'panel', id: 'glmm-fit' },
    h('h2', {}, `Fit: ${nm.label} with ${which}`, help('analysis', 'random-effects-for-counts-and-proportions')),
    h('p', { class: 'small' }, intro),
    messages(notes, 'warning'), od,
    h('div', { class: 'row small', id: 'glmm-stats' },
      h('span', { class: 'stat' }, h('b', {}, fit.n), ' observations'),
      R.map((r, k) => [h('span', { class: 'stat' }, h('b', {}, r.m), ` ${r.name}s`),
        h('span', { class: 'stat' }, `${r.name} σ = `, h('b', { id: nested ? `glmm-sigma-${k}` : 'glmm-sigma' }, num(r.sigma, 3)), ` (${fit.link} scale)`),
        r.boundary ? h('span', { class: 'stat' }, nested ? `no variation between ${r.name}s beyond the other levels` : `no variation between ${gs} beyond the noise: the fit is the ordinary model's`)
          : h('span', { class: 'stat' }, 'σ = 0 test p ', h('b', {}, pval(r.test.p)))]),
      fit.theta !== undefined ? h('span', { class: 'stat', title: `the counts' variation within a ${g}: variance μ + μ²/θ` }, 'θ = ', h('b', { id: 'glmm-theta' }, num(fit.theta, 3))) : null,
      h('span', { class: 'stat' }, 'log-likelihood ', h('b', {}, num(fit.loglik))), h('span', { class: 'stat' }, 'AIC ', h('b', {}, num(fit.aic)))),
    dataTable([
      { key: 'term', label: 'term' }, { key: 'est', label: 'estimate', cls: 'n', fmt: (v) => num(v) }, { key: 'se', label: 'std. error', cls: 'n', fmt: (v) => num(v) },
      { key: 'z', label: 'z or t', cls: 'n', fmt: (v) => num(v, 3) }, { key: 'df', label: 'df', cls: 'n', fmt: (v) => (v === Infinity ? 'z' : String(v)) },
      { key: 'p', label: 'p', cls: 'n', fmt: (v) => h('span', { class: v < 0.05 ? 'sig' : '' }, pval(v)) },
      ...(ratioName ? [{ key: 'ratio', label: ratioName, cls: 'n', fmt: (_, r) => num(r.ci?.ratio?.estimate, 4) }, { key: 'rci', label: '95% interval', cls: 'n', fmt: (_, r) => (r.ci?.ratio ? `${num(r.ci.ratio.lower, 4)} … ${num(r.ci.ratio.upper, 4)}` : '') }] : []),
      { key: 'drop', label: '', fmt: (_, r) => (r.assign >= 0 ? h('button', { class: 'btn small', title: `remove ${r.termLabel} from the model`, onclick: () => setFormula(`${resp.id} ~ ${rhs} - ${r.termLabel}`) }, '−') : null) },
    ], rows, { rowAttrs: (r) => ({ 'data-term': r.term }) }),
    h('p', { class: 'muted small' }, `Coded units (−1 … +1)${ratioName ? `; ${ratioName === 'odds ratio' ? 'an' : 'a'} ${ratioName} is the factor of change per coded unit, squared from low to high` : ''}. `,
      strata.length ? `${strata.join(' ')} The others change within ${gs}: z tests.` : 'z tests (Wald).'),
    h('div', { class: 'row small' }, h('button', { class: 'btn small', id: 'glmm-off', onclick: () => set({ countRandom: 'none' }) }, `fit without the random ${nested ? 'effects' : `${adj(g)} effect`}`)));

  const type = ui.anovaType ?? 1;
  const tests = cached(study, JSON.stringify(['tests', fit.columns, fit.random.id, fit.nAGQ, fit.noise, fit.link, type]), () => glmmTests(fit, type));
  const F = tests.some(r => r.F !== undefined);
  const testsPanel = h('section', { class: 'panel', id: 'glmm-tests' },
    h('h2', {}, `Likelihood-ratio tests (type ${['', 'I', 'II', 'III'][type]})`, help('analysis', 'random-effects-for-counts-and-proportions')),
    dataTable([{ key: 'term', label: 'source' }, { key: 'df', label: 'df', cls: 'n' }, { key: 'chi2', label: 'χ²', cls: 'n', fmt: (v) => num(v) },
      ...(F ? [{ key: 'F', label: 'F', cls: 'n', fmt: (v) => (v === undefined ? '' : num(v)) }, { key: 'ddf', label: 'on df', cls: 'n', fmt: (v) => (v === undefined ? '' : String(v)) }] : []),
      { key: 'p', label: 'p', cls: 'n', fmt: (v) => h('span', { class: v < 0.05 ? 'sig' : '' }, pval(v)) }], tests),
    h('p', { class: 'muted small' }, `Each term's χ² compares the fits with and without it, σ${nested ? '’s' : ''}${fit.theta !== undefined ? ' and θ' : ''} re-estimated in each.${F ? ` Terms that change only between ${nested ? 'groups are F tests on the df of their level' : `${gs} are F tests on ${R[0].df} df`}.` : ''}`));

  // the estimated effects of each level's groups
  const effPanel = R.every(r => r.boundary) ? null : h('section', { class: 'panel', id: 'glmm-effects' },
    h('h2', {}, nested ? 'Effects of each level' : `${g[0].toUpperCase()}${g.slice(1)} effects`),
    h('div', { class: 'plots' }, R.filter(r => !r.boundary).map(r => {
      const eff = Object.entries(r.modes).map(([k, v]) => ({ k, v }));
      return h('figure', {}, h('figcaption', {}, `Estimated shift of each ${r.name} on the ${fit.link} scale (shrunk towards 0, more so for ${r.name}s with little data)`),
        plot({ xLabel: r.name, yLabel: `shift (${fit.link} scale)`, height: 220, hlines: [{ y: 0 }], series: [{ points: eff.map((e, i) => ({ x: i + 1, y: e.v, title: `${r.name} ${e.k}: ${num(e.v, 3)}` })) }] }));
    })));
  return [summary, testsPanel, effPanel];
}
