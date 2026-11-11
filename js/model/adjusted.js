// Adjusted means and the test of equal slopes (ANCOVA, phase 2 of issue #82).
//
//   adjustedMeans(fit, factorId, opts)   the mean response at each level of a factor, with the
//                                        other factors and the covariates held at the same values
//                                        for every level — emmeans' estimated marginal means — and
//                                        the pairwise comparisons, Tukey-adjusted
//   equalSlopes(study, fit, covariateId) whether a covariate's slope is the same at every setting
//                                        of the factors: the model with every factor × covariate
//                                        interaction against the model without
//
// The reference grid (emmeans' default): the factor in question at each of its levels (a
// continuous one at its low and high settings); every other categorical factor at each of its
// levels, and a continuous factor run at only two settings at each of them, averaged with equal
// weight (emmeans' cov.keep = "2": the centre of a two-level factor, whatever the balance of the
// runs); every other continuous factor and every covariate at its mean over the rows the model
// used; blocks averaged with equal weight (the model's average block). The
// adjusted mean of a level is the average of the model's predictions over that grid: one linear
// function lβ of the coefficients, with standard error √(l V lᵀ).
//
//   - least squares: V = σ² (XᵀX)⁻¹, t on the residual df;
//   - counts and proportions (GLM, GLMM): on the link scale with z (t when the dispersion is
//     estimated), then back-transformed: the mean and the ends of its interval; the standard
//     error by the delta method. Comparisons are ratios of rates (log link) or odds ratios (logit);
//   - mixed models: the Kenward–Roger covariance and df, per function (emmeans with pbkrtest).
//
// Pairwise comparisons: the difference of two adjusted means, its standard error, and a p value
// and confidence interval adjusted for all k(k − 1)/2 comparisons by Tukey's method (the
// studentized range for k means; a plain t test for two levels).

import { modelMatrix } from './formula.js';
import { studentT, normal, tukey, fDist, chi2 } from '../dist.js';
import { LINKS } from './glm.js';
import { krLinear } from './mixed.js';
import { decode } from '../study.js';

const mean = (v) => v.reduce((a, x) => a + x, 0) / v.length;

/** The kind of a fit for this module: 'ols', 'glm', 'glmm' or 'mixed'. */
function kindOf(fit) {
  if (fit.kind === 'mixed') return 'mixed';
  if (fit.kind === 'glmm') return 'glmm';
  if (fit.distribution) return 'glm';
  return 'ols';
}

/** The covariance used for linear functions of a fit's coefficients (all columns; aliased rows NaN). */
function covOf(fit, kind) {
  if (kind === 'glmm') return fit.covWald ?? fit.cov;
  return fit.cov;
}

/**
 * The reference-grid settings for each level of factorId: [{ label, value, settings: [ … ] }], each
 * settings list being the grid rows (natural units) to average.
 */
export function referenceGrid(fit, factorId, { at = {} } = {}) {
  const F = fit.factors, target = F.find(f => f.id === factorId);
  if (!target) throw new Error(`no factor "${factorId}" in the model`);
  if (target.covariate) throw new Error(`${factorId} is a covariate: it has a slope, not levels (the fit reports it)`);
  if (target.block) throw new Error(`${factorId} is the block term: its levels are not compared`);
  const inModel = new Set(fit.model.terms.flatMap(t => t.comps.flatMap(c => (c.f !== undefined ? [c.f] : Object.keys(c.I ?? {})))));
  if (!inModel.has(factorId)) throw new Error(`${factorId} is not in the model`);
  const rows = fit.rows;
  // the others: continuous at their mean over the rows (a covariate's mean is its coded 0),
  // categorical over all levels
  const fixed = {}, crossed = [];
  for (const f of F) {
    if (f.id === factorId || !inModel.has(f.id)) continue;
    if (at[f.id] !== undefined) { fixed[f.id] = at[f.id]; continue; }
    if (f.block) continue;                                    // left out: the average block
    if (f.type === 'categorical') { crossed.push({ f, values: f.levels.map((l, i) => i) }); continue; }
    const v = rows.map(r => r.settings[f.id]).filter(x => x !== undefined && x !== null);
    const distinct = [...new Set(v)];
    if (!f.covariate && distinct.length === 2) { crossed.push({ f, values: distinct.sort((a, b) => a - b) }); continue; }
    if (v.length) fixed[f.id] = mean(v);
  }
  let grid = [{ ...fixed }];
  for (const { f, values } of crossed) grid = grid.flatMap(g => values.map(x => ({ ...g, [f.id]: x })));
  const levels = target.type === 'categorical'
    ? target.levels.map((l, i) => ({ label: String(l), value: i, key: i }))
    : [-1, 1].map(c => ({ label: `${target.id} = ${num4(decode(target, c))}`, value: decode(target, c), key: c }));
  return { target, levels: levels.map(L => ({ ...L, settings: grid.map(g => ({ ...g, [factorId]: L.value })) })), fixed, averagedOver: crossed.map(c => c.f.id) };
}

const num4 = (v) => String(Number(v.toPrecision(6)));

/**
 * Adjusted (estimated marginal) means of a factor's levels, and their pairwise comparisons.
 * opts: at ({ id: value } in natural units, for any other factor or covariate, instead of its mean
 * or the average over its levels), level (0.95).
 * Returns { factor, kind, scale, df, levels: [{ label, mean, se, df, lower, upper, raw, n }],
 * pairs: [{ a, b, estimate, se, df, stat, p, lower, upper }], held: { id: value },
 * averagedOver: [ids], comparison: 'difference' | 'ratio' | 'odds ratio' }. For counts and
 * proportions, mean/lower/upper are on the response scale (se by the delta method) and the pairs
 * are ratios (log link) or odds ratios (logit).
 */
export function adjustedMeans(fit, factorId, { at = {}, level = 0.95 } = {}) {
  const kind = kindOf(fit), g = referenceGrid(fit, factorId, { at });
  const ncol = fit.columns.length;
  // one row l per level: the average of the model-matrix rows over the grid
  const L = g.levels.map(Lv => {
    const X = modelMatrix(fit.model, fit.factors, Lv.settings).X;
    return Array.from({ length: ncol }, (_, j) => mean(X.map(r => r[j])));
  });
  const coef = fit.coef;
  const lost = (l) => l.some((v, j) => Math.abs(v) > 1e-12 && Number.isNaN(coef[j]));
  let lin;                                                    // [{ est, se, df }] for any rows
  if (kind === 'mixed') lin = (rows) => krLinear(fit, rows, { joint: false }).rows;
  else {
    const V = covOf(fit, kind);
    const df = kind === 'ols' ? fit.dfRes : fit.dispersionEstimated ? fit.dfRes : Infinity;
    lin = (rows) => rows.map(l => {
      if (lost(l)) return { est: NaN, se: NaN, df };
      let e = 0, v = 0;
      for (let i = 0; i < ncol; i++) {
        if (Number.isNaN(coef[i]) || l[i] === 0) continue;
        e += l[i] * coef[i];
        for (let j = 0; j < ncol; j++) if (!Number.isNaN(coef[j]) && l[j] !== 0) v += l[i] * V[i][j] * l[j];
      }
      return { est: e, se: Math.sqrt(v), df };
    });
  }
  const crit = (df) => (Number.isFinite(df) ? studentT.ppf(1 - (1 - level) / 2, df) : normal.ppf(1 - (1 - level) / 2));
  const link = kind === 'glm' || kind === 'glmm' ? LINKS[fit.link] : null;
  const means = lin(L);
  // the raw means: the rows of the fit at each level
  const yOf = (r) => r.y;
  const levels = g.levels.map((Lv, i) => {
    const m = means[i], c = crit(m.df);
    const at0 = fit.rows.filter(r => (g.target.type === 'categorical' ? r.settings[factorId] === Lv.value || r.settings[factorId] === Lv.label : Math.abs(r.settings[factorId] - Lv.value) < 1e-9 * Math.max(1, Math.abs(Lv.value))));
    const raw = at0.length ? mean(at0.map(yOf)) : NaN;
    if (!link) return { label: Lv.label, mean: m.est, se: m.se, df: m.df, lower: m.est - c * m.se, upper: m.est + c * m.se, raw, n: at0.length };
    const mu = link.inv(m.est);
    return { label: Lv.label, mean: mu, se: Math.abs(link.deriv(m.est)) * m.se, df: m.df, lower: link.inv(m.est - c * m.se), upper: link.inv(m.est + c * m.se),
      link: { mean: m.est, se: m.se }, raw, n: at0.length };
  });
  // pairs: level a − level b, for a before b
  const k = levels.length, pairIdx = [];
  for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) pairIdx.push([a, b]);
  const D = lin(pairIdx.map(([a, b]) => L[a].map((v, j) => v - L[b][j])));
  const comparison = !link || link.name === 'identity' ? 'difference' : link.name === 'log' ? 'ratio' : link.name === 'logit' ? 'odds ratio' : 'difference (link scale)';
  const back = comparison === 'ratio' || comparison === 'odds ratio' ? Math.exp : (x) => x;
  const pairs = pairIdx.map(([a, b], i) => {
    const d = D[i], stat = d.est / d.se;
    // Tukey: P(Q > |t|√2) for k means; the interval from the studentized range's quantile
    const p = k > 2 ? tukey.sf(Math.abs(stat) * Math.SQRT2, k, d.df) : 2 * (Number.isFinite(d.df) ? studentT.sf(Math.abs(stat), d.df) : normal.sf(Math.abs(stat)));
    const q = k > 2 ? tukey.isf(1 - level, k, d.df) / Math.SQRT2 : crit(d.df);
    return { a: levels[a].label, b: levels[b].label, estimate: back(d.est), se: comparison === 'ratio' || comparison === 'odds ratio' ? Math.exp(d.est) * d.se : d.se,
      df: d.df, stat, p, lower: back(d.est - q * d.se), upper: back(d.est + q * d.se), ...(back !== Math.exp ? {} : { link: { estimate: d.est, se: d.se } }) };
  });
  return { factor: factorId, kind, scale: link ? `response (from the ${link.name} link)` : 'response', comparison, adjust: k > 2 ? 'tukey' : 'none',
    levels, pairs, held: { ...g.fixed }, averagedOver: g.averagedOver, df: means[0]?.df };
}

/**
 * Is the slope of covariate id the same at every setting of the factors? The fit's model with
 * every factor × covariate interaction added (for the factors in the model's main effects, the
 * interactions it does not already have) against the model as it is: an F test for least
 * squares, a likelihood-ratio test for counts and proportions, a Kenward–Roger F test for mixed
 * models. Also each added interaction's own test (type II, or Kenward–Roger) in the larger model.
 * formula: the formula the fit was made from; fitWith(formula): fits the larger model (the
 * caller's fitting function, so with the same options); anova(fit, 2): the type II tests (least
 * squares and GLMs).
 * Returns { covariate, formula, added: [terms], df1, df2?, stat, statName, p, terms: [{ term, df,
 * stat, p }] } or { added: [] } when there is nothing to add.
 */
export function equalSlopes(fit, covariateId, { formula: formula0, fitWith, anova } = {}) {
  const kind = kindOf(fit);
  const cov = (fit.covariates ?? []).find(c => c.id === covariateId);
  if (!cov) throw new Error(`${covariateId} is not a covariate in the model`);
  const labels = new Set(fit.model.terms.map(t => t.label));
  const mains = fit.model.terms.filter(t => t.comps.length === 1 && t.comps[0].f !== undefined && !t.block && !t.position).map(t => t.comps[0].f)
    .filter(id => { const f = fit.factors.find(x => x.id === id); return f && !f.covariate && !f.block; });
  const added = mains.map(id => `${id}:${covariateId}`).filter(t => !labels.has(t) && !labels.has(t.split(':').reverse().join(':')));
  if (!added.length) return { covariate: covariateId, added: [], formula: formula0 };
  const rhs0 = String(formula0).slice(String(formula0).indexOf('~') + 1).trim();
  const formula = `${fit.response} ~ ${rhs0} + ${added.join(' + ')}`;
  const big = fitWith(formula);
  if (big.rows.length !== fit.rows.length) throw new Error('the larger model used different runs');
  const out = { covariate: covariateId, formula, added };
  if (kind === 'ols') {
    const df1 = fit.dfRes - big.dfRes, df2 = big.dfRes;
    const F = ((fit.rss - big.rss) / df1) / big.sigma2;
    Object.assign(out, { df1, df2, stat: F, statName: 'F', p: df1 > 0 && df2 > 0 ? fDist.sf(F, df1, df2) : NaN });
  } else if (kind === 'glm' || kind === 'glmm') {
    const df1 = big.rank !== undefined && fit.rank !== undefined ? big.rank - fit.rank : added.length;
    const dev = kind === 'glmm' ? -2 * (fit.loglik - big.loglik) : fit.deviance - big.deviance;
    const est = big.dispersionEstimated;
    if (est) { const F = (dev / df1) / big.dispersion; Object.assign(out, { df1, df2: big.dfRes, stat: F, statName: 'F', p: fDist.sf(F, df1, big.dfRes) }); }
    else Object.assign(out, { df1, stat: dev, statName: 'χ²', p: dev > 0 ? chi2.sf(dev, df1) : 1 });
  } else {
    const cols = big.columns.map((c, j) => (added.some(t => termOfColumn(big, j) === t) ? j : -1)).filter(j => j >= 0);
    const L = cols.map(j => big.columns.map((_, i) => (i === j ? 1 : 0)));
    const k = krLinear(big, L);
    Object.assign(out, { df1: k.df1, df2: k.df2, stat: k.F, statName: 'F', p: k.p });
  }
  // each added interaction's own test in the larger model
  const tests = kind === 'mixed' ? big.terms : anova ? anova(big, 2) : [];
  out.terms = added.map(t => {
    const r = tests.find(x => x.term === t);
    if (!r) return { term: t };
    if (kind === 'mixed') return { term: t, df: r.df, stat: r.FKR, df2: r.ddfKR, p: r.pKR };
    return { term: t, df: r.df, stat: r.F ?? r.chisq ?? r.stat, p: r.p };
  });
  out.big = big;
  return out;
}

function termOfColumn(fit, j) {
  const assign = fit.assign ?? modelMatrix(fit.model, fit.factors, fit.rows.slice(0, 1).map(r => r.settings)).assign;
  const a = assign[j];
  return a >= 0 ? fit.model.terms[a].label : null;
}
