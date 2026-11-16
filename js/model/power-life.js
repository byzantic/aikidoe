// Power for times to failure (issue #83, phase 3): an accelerated-life test (Weibull or
// log-normal) in which units still working when the test stops are censored.
//
//   lifePower(mm, opts)          from the expected information, with the censoring the test end
//                                implies at each run's settings (Wald tests; fast)
//   simulateLifePower(mm, opts)  by simulation: life tests drawn from the anticipated model,
//                                censored at the test end, fitted (survreg.js) and each term's
//                                likelihood-ratio test counted
//   detectableTimeRatio(res)     the time ratio each term needs for the power asked
//   studyLifePower(study, opts)  for the study's design
//
// opts: distribution ('weibull' | 'lognormal'), median (the median life at the centre of the
// design), ratio (the time ratio, high over low setting, that matters: a number, or { term: r,
// default }; below 1 the factor shortens the life), shape (Weibull β, default 2) or sigma (σ of
// log time, log-normal, default 0.5), unitsPerRun (default 1), testEnd (the time the test stops:
// Infinity for no censoring), alpha (0.05).
//
// Censoring costs information: a censored unit says only that its life is longer than the test.
// The expected information per unit falls roughly in proportion to the fraction that fails, so a
// test stopped when few units have failed needs many more units, or harsher conditions.

import { qr, inv } from '../linalg.js';
import { normal, chi2 as CHI2, ncChi2 } from '../dist.js';
import { parseFormula, modelMatrix } from './formula.js';
import { fitSurvreg, survCompare, SURV_DISTRIBUTIONS } from './survreg.js';
import { rng } from '../design/rng.js';
import { withNuisanceFor } from './power.js';

// 64-point Gauss–Legendre on [0, 1]
const GL = (() => {
  const n = 64, x = [], w = [];
  for (let i = 1; i <= n; i++) {
    let z = Math.cos(Math.PI * (i - 0.25) / (n + 0.5)), pp = 0;
    for (let it = 0; it < 100; it++) {
      let p1 = 1, p2 = 0;
      for (let j = 1; j <= n; j++) { const p3 = p2; p2 = p1; p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j; }
      pp = n * (z * p1 - p2) / (z * z - 1);
      const z1 = z; z = z1 - p1 / pp;
      if (Math.abs(z - z1) < 1e-15) break;
    }
    x.push((1 - z) / 2); w.push(1 / ((1 - z * z) * pp * pp));
  }
  return { x, w };
})();

/**
 * The expected information per unit about (location, log σ), in units where σ = 1, when the unit
 * is censored at standardised time zc: { A, B, C, failed } with the information matrix for
 * (β, τ) at a row x being [[A xx'/σ², B x/σ], [B x'/σ, C]]. failed: the chance the unit fails
 * before the test ends.
 */
export function unitInformation(distribution, zc = Infinity) {
  const D = SURV_DISTRIBUTIONS[distribution];
  const Fc = Number.isFinite(zc) ? D.cdf(zc) : 1;
  let A = 0, B = 0, C = 0;
  // failures: E over z < zc of −(ℓ'', ℓ''z + ℓ', ℓ''z² + ℓ'z) of the density, by u = F(z), on
  // pieces that crowd towards both ends of (0, Fc) where z runs off
  const cuts = [0, 1e-12, 1e-8, 1e-5, 1e-3, 0.02, 0.2, 0.5, 0.8, 0.98, 1 - 1e-3, 1 - 1e-5, 1 - 1e-8, 1 - 1e-12].filter(c => c < Fc).concat([Fc]);
  for (let piece = 0; piece + 1 < cuts.length; piece++) {
    const a = cuts[piece], len = cuts[piece + 1] - a;
    for (let k = 0; k < GL.x.length; k++) {
      const z = D.quantile(a + GL.x[k] * len);
      if (!Number.isFinite(z)) continue;
      const [, l1, l2] = D.event(z), w = GL.w[k] * len;
      A -= w * l2; B -= w * (l2 * z + l1); C -= w * (l2 * z * z + l1 * z);
    }
  }
  // still working at the end: the survival term at zc
  if (Number.isFinite(zc) && Fc < 1) {
    const [, l1, l2] = D.censor(zc), S = 1 - Fc;
    A -= S * l2; B -= S * (l2 * zc + l1); C -= S * (l2 * zc * zc + l1 * zc);
  }
  return { A, B, C, failed: Fc };
}

const settle = (opts) => {
  const { distribution = 'weibull', median, ratio = 2, shape = 2, sigma, unitsPerRun = 1, testEnd = Infinity, alpha = 0.05 } = opts;
  const D = SURV_DISTRIBUTIONS[distribution];
  if (!D) throw new Error(`unknown distribution "${distribution}" for times to failure (weibull or lognormal)`);
  if (!(median > 0)) throw new Error('give the median life you expect at the centre of the design (a positive time)');
  const s = distribution === 'weibull' ? (sigma ?? 1 / shape) : (sigma ?? 0.5);
  if (!(s > 0)) throw new Error(distribution === 'weibull' ? 'the Weibull shape must be positive' : 'σ of log time must be positive');
  if (!(testEnd > 0)) throw new Error('the test end must be a positive time (or Infinity: every unit runs to failure)');
  if (!(alpha > 0 && alpha < 1)) throw new Error('α must be between 0 and 1');
  // the intercept: the median at the centre, log t_50 = b0 + σ w_0.5
  const b0 = Math.log(median) - s * D.quantile(0.5);
  const ratioOf = (label) => (typeof ratio === 'number' ? ratio : ratio[label] ?? ratio.default ?? 2);
  return { D, distribution, sigma: s, b0, ratioOf, unitsPerRun, testEnd, alpha };
};
const colsOf = (mm, ti) => mm.columns.map((_, j) => j).filter(j => mm.assign[j] === ti);
const coefOf = (r) => Math.log(r) / 2;

/**
 * Power from the expected information (Wald tests at α), each term at its time ratio with the
 * others at the centre. Returns { n, units, rank, alpha, distribution, sigma, median, testEnd,
 * terms: [{ term, df, ratio, lambda, power, powerUncensored, failed: [min, max] }], failedAtCentre,
 * lambdaAt(term, r), powerOf(df, λ) }. powerUncensored: the same test run until every unit fails.
 */
export function lifePower(mm, opts = {}) {
  const P = settle(opts), { X, columns, assign, model } = mm, n = X.length;
  const per = (v) => X.map((_, i) => (Array.isArray(v) ? v[i % v.length] : v));
  const m = per(P.unitsPerRun);
  const icpt = columns.findIndex((_, j) => assign[j] === -1);
  const rank0 = qr(X).rank;
  const crit = (df) => CHI2.ppf(1 - P.alpha, df);
  const powerOf = (df, lambda) => (Number.isFinite(lambda) ? ncChi2.sf(crit(df), df, lambda) : NaN);
  const lc = Math.log(P.testEnd);
  // λ for the columns S at coefficients bS (the other non-intercept columns at 0)
  // The information is taken at the null (every run at the centre's life), the local-alternative
  // non-centrality of the likelihood-ratio test the analysis uses: it agrees with simulation far
  // better than the information at the alternative when many units are censored. failed: the
  // fraction of units expected to fail before the test end at each run, with the term at its effect.
  const lambdaFor = (S, bS, censor = true) => {
    const beta = columns.map((_, j) => (j === icpt ? P.b0 : 0));
    const p = columns.length, I = Array.from({ length: p + 1 }, () => new Array(p + 1).fill(0));
    const failed = X.map(x => (censor && Number.isFinite(lc) ? P.D.cdf((lc - x.reduce((a, v, j) => a + v * (j === icpt ? P.b0 : S.includes(j) ? bS[S.indexOf(j)] : 0), 0)) / P.sigma) : 1));
    const u = unitInformation(P.distribution, censor && Number.isFinite(lc) ? (lc - P.b0) / P.sigma : Infinity);
    X.forEach((x, i) => {
      for (let a = 0; a < p; a++) {
        for (let b = 0; b < p; b++) I[a][b] += m[i] * u.A * x[a] * x[b] / (P.sigma * P.sigma);
        I[a][p] += m[i] * u.B * x[a] / P.sigma; I[p][a] = I[a][p];
      }
      I[p][p] += m[i] * u.C;
    });
    const f = qr(X, { tol: 1e-11 });
    if (S.some(j => f.aliased.includes(j))) return { lambda: NaN, failed };
    const keep = [...columns.map((_, j) => j).filter(j => !f.aliased.includes(j)), p];
    let V;
    try { V = inv(keep.map(a => keep.map(b => I[a][b]))); } catch { return { lambda: NaN, failed }; }
    const idx = S.map(j => keep.indexOf(j)), A = idx.map(a => idx.map(b => V[a][b]));
    const x = inv(A).map(r => r.reduce((s, v, k) => s + v * bS[k], 0));
    return { lambda: bS.reduce((s, v, k) => s + v * x[k], 0), failed };
  };
  const lambdaAt = (label, r, censor = true) => { const ti = model.terms.findIndex(t => t.label === label), S = colsOf(mm, ti); return lambdaFor(S, S.map(() => coefOf(r)), censor).lambda; };
  const terms = model.terms.map((t, ti) => {
    const S = colsOf(mm, ti), r = P.ratioOf(t.label);
    if (t.block) return { term: t.label, df: S.length, ratio: r, lambda: NaN, power: NaN, block: true };
    const c = lambdaFor(S, S.map(() => coefOf(r))), u = lambdaFor(S, S.map(() => coefOf(r)), false);
    return { term: t.label, df: S.length, ratio: r, lambda: c.lambda, power: powerOf(S.length, c.lambda), powerUncensored: powerOf(S.length, u.lambda),
      failed: [Math.min(...c.failed), Math.max(...c.failed)] };
  });
  const atCentre = Number.isFinite(lc) ? P.D.cdf((lc - P.b0) / P.sigma) : 1;
  return { n, units: m.reduce((a, b) => a + b, 0), rank: rank0, alpha: P.alpha, distribution: P.distribution, sigma: P.sigma, ...(P.distribution === 'weibull' ? { shape: 1 / P.sigma } : {}),
    median: opts.median, testEnd: P.testEnd, ratio: opts.ratio ?? 2, terms, failedAtCentre: atCentre, lambdaAt, powerOf };
}

/** The time ratio (below 1: the factor shortens the life) each term needs for the power asked; NaN beyond 1000-fold. */
export function detectableTimeRatio(result, { power = 0.8 } = {}) {
  return result.terms.filter(t => !t.block).map(t => {
    const pw = (r) => result.powerOf(t.df, result.lambdaAt(t.term, r));
    const down = t.ratio < 1;
    if (!(pw(down ? 1e-3 : 1e3) >= power)) return { term: t.term, ratio: NaN };
    let lo = 0, hi = Math.log(1000);
    for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2, p = pw(Math.exp(down ? -mid : mid)); if (p >= power) hi = mid; else lo = mid; }
    return { term: t.term, ratio: Math.exp(down ? -hi : hi) };
  });
}

/**
 * Power by simulation: for each term, nsim life tests are drawn from the anticipated model (that
 * term at its time ratio, the others at the centre), censored at the test end, and the full model
 * and the model without the term fitted; the likelihood-ratio test is counted at α. opts as
 * lifePower, plus nsim (200) and seed. Returns [{ term, power, se, nsim, failed }] (failed: the
 * average fraction of units that failed). A test in which no unit fails is counted as a miss.
 */
export function simulateLifePower(mm, opts = {}) {
  const P = settle(opts), { nsim = 200, seed = 1 } = opts, R = rng(seed);
  const { X, columns, assign, model } = mm;
  const per = (v) => X.map((_, i) => (Array.isArray(v) ? v[i % v.length] : v));
  const m = per(P.unitsPerRun);
  // a row per unit
  const rows = X.flatMap((x, i) => Array.from({ length: m[i] }, () => x));
  const icpt = columns.findIndex((_, j) => assign[j] === -1);
  const big = { ...mm, X: rows };
  const W = P.distribution === 'weibull' ? () => Math.log(-Math.log(1 - R.random())) : () => normal.ppf(R.random() || 1e-300);
  return model.terms.filter(t => !t.block).map(t => {
    const ti = model.terms.indexOf(t), S = colsOf(mm, ti);
    const beta = columns.map((_, j) => (j === icpt ? P.b0 : S.includes(j) ? coefOf(P.ratioOf(t.label)) : 0));
    const eta = rows.map(x => x.reduce((a, v, j) => a + v * beta[j], 0));
    const keep = columns.map((_, j) => j).filter(j => !S.includes(j));
    const small = { ...mm, X: rows.map(r => keep.map(j => r[j])), columns: keep.map(j => columns[j]), assign: keep.map(j => assign[j]) };
    let hits = 0, done = 0, failed = 0;
    for (let s = 0; s < nsim; s++) {
      const t0 = eta.map(e => Math.exp(e + P.sigma * W()));
      const time = t0.map(v => Math.min(v, P.testEnd)), status = t0.map(v => (v < P.testEnd ? 1 : 0));
      const f = status.reduce((a, b) => a + b, 0) / status.length;
      failed += f; done++;
      if (!f) continue;
      try {
        const b = fitSurvreg(big, time, { distribution: P.distribution, status }), sm = fitSurvreg(small, time, { distribution: P.distribution, status });
        if (survCompare(b, sm).p < P.alpha) hits++;
      } catch { /* a degenerate simulated test: a miss */ }
    }
    const p = hits / done;
    return { term: t.label, power: p, se: Math.sqrt(p * (1 - p) / done), nsim: done, failed: failed / done };
  });
}

/** The model matrix of the study's design for a model (confirmation and path runs left out). */
export function studyMatrix(study, model = 'main') {
  if (!study.design) throw new Error('the study has no design yet');
  const runs = study.design.runs.filter(r => r.kind !== 'confirm' && r.kind !== 'path');
  const parsed = parseFormula(model, study.factors);
  const m = withNuisanceFor(study, parsed, runs);
  return modelMatrix(m.model, m.factors, m.settings);
}

/** Power of the study's design for a time-to-failure response (lifePower options, model). */
export function studyLifePower(study, { model = 'main', ...opts } = {}) {
  return { model: parseFormula(model, study.factors), ...lifePower(studyMatrix(study, model), opts) };
}
