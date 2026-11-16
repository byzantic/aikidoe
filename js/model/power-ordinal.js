// Power for ordinal scores (issue #83, phase 3): the proportional-odds model (ordinal.js).
//
//   ordinalPower(mm, opts)          from the expected information of the scores (exact for the
//                                   multinomial: Σ_j ∂p_j ∂p_j' / p_j per score), at the null, as
//                                   the likelihood-ratio test's local non-centrality
//   simulateOrdinalPower(mm, opts)  by simulation: scores drawn from the anticipated model, the
//                                   model fitted with and without each term, the
//                                   likelihood-ratio test counted
//   detectableOddsRatio(res)        the odds ratio each term needs for the power asked
//   studyOrdinalPower(study, opts)  for the study's design
//
// opts: baseline (the chance of each category at the centre of the design, lowest first; default
// equal), ratio (the odds ratio, high over low setting, for a higher score: a number, or { term: r,
// default }), scoresPerRun (default 1), alpha (0.05). Always the logit link.

import { qr, inv } from '../linalg.js';
import { chi2 as CHI2, ncChi2 } from '../dist.js';
import { parseFormula } from './formula.js';
import { fitOrdinal, ordinalCompare, ORDINAL_LINKS } from './ordinal.js';
import { rng } from '../design/rng.js';
import { studyMatrix } from './power-life.js';

const L = ORDINAL_LINKS.logit;
const settle = (opts) => {
  const { baseline, K: K0, ratio = 2, scoresPerRun = 1, alpha = 0.05 } = opts;
  const K = baseline?.length ?? K0 ?? 4;
  const p = baseline ?? Array.from({ length: K }, () => 1 / K);
  if (K < 3) throw new Error('an ordinal score needs three or more categories');
  if (p.some(v => !(v > 0)) || Math.abs(p.reduce((a, b) => a + b, 0) - 1) > 1e-6) throw new Error('the chances of the categories at the centre must be positive and add up to 1 (100 %)');
  if (!(alpha > 0 && alpha < 1)) throw new Error('α must be between 0 and 1');
  // the cut points at the centre (η = 0)
  let c = 0;
  const theta = p.slice(0, -1).map(v => { c += v; return L.Finv(Math.min(c, 1 - 1e-12)); });
  const ratioOf = (label) => (typeof ratio === 'number' ? ratio : ratio[label] ?? ratio.default ?? 2);
  return { K, p, theta, ratioOf, scoresPerRun, alpha };
};
const colsOf = (mm, ti) => mm.columns.map((_, j) => j).filter(j => mm.assign[j] === ti);
const coefOf = (r) => Math.log(r) / 2;

// the expected information about (θ, β) from one score at linear predictor eta, row x (non-intercept columns)
function scoreInformation(theta, x, eta, P) {
  const K = theta.length + 1, q = x.length, D = K - 1 + q;
  const a = theta.map(t => t - eta), F = a.map(L.F), f = a.map(L.f);
  const I = Array.from({ length: D }, () => new Array(D).fill(0));
  for (let j = 0; j < K; j++) {
    const pj = (j < K - 1 ? F[j] : 1) - (j > 0 ? F[j - 1] : 0);
    const g = new Array(D).fill(0);
    if (j < K - 1) g[j] += f[j];
    if (j > 0) g[j - 1] -= f[j - 1];
    const fd = (j < K - 1 ? f[j] : 0) - (j > 0 ? f[j - 1] : 0);
    for (let k = 0; k < q; k++) g[K - 1 + k] = -x[k] * fd;
    for (let r = 0; r < D; r++) if (g[r]) for (let s = 0; s < D; s++) I[r][s] += P * g[r] * g[s] / pj;
  }
  return I;
}

/**
 * Power from the expected information (Wald χ² at α with the information at the null, the
 * likelihood-ratio test's local non-centrality). Returns { n, scores, K, baseline, alpha, terms:
 * [{ term, df, ratio, lambda, power }], lambdaAt, powerOf }.
 */
export function ordinalPower(mm, opts = {}) {
  const P = settle(opts), { X, columns, assign, model } = mm, n = X.length;
  const per = (v) => X.map((_, i) => (Array.isArray(v) ? v[i % v.length] : v));
  const m = per(P.scoresPerRun);
  const icpt = columns.findIndex((_, j) => assign[j] === -1);
  const others = columns.map((_, j) => j).filter(j => j !== icpt);
  const f = qr(X.map(r => [1, ...others.map(j => r[j])]), { tol: 1e-11 });
  const est = others.filter((_, a) => !f.aliased.includes(a + 1));
  // the information at the null (η = 0 at every run)
  const D = P.K - 1 + est.length, I = Array.from({ length: D }, () => new Array(D).fill(0));
  X.forEach((r, i) => { const J = scoreInformation(P.theta, est.map(j => r[j]), 0, m[i]); for (let a = 0; a < D; a++) for (let b = 0; b < D; b++) I[a][b] += J[a][b]; });
  let V = null;
  try { V = inv(I); } catch { /* singular: no power */ }
  const crit = (df) => CHI2.ppf(1 - P.alpha, df);
  const powerOf = (df, lambda) => (Number.isFinite(lambda) ? ncChi2.sf(crit(df), df, lambda) : NaN);
  const lambdaFor = (S, bS) => {
    if (!V || S.some(j => !est.includes(j))) return NaN;
    const idx = S.map(j => P.K - 1 + est.indexOf(j)), A = idx.map(a => idx.map(b => V[a][b]));
    const x = inv(A).map(r => r.reduce((s, v, k) => s + v * bS[k], 0));
    return bS.reduce((s, v, k) => s + v * x[k], 0);
  };
  const lambdaAt = (label, r) => { const S = colsOf(mm, model.terms.findIndex(t => t.label === label)); return lambdaFor(S, S.map(() => coefOf(r))); };
  const terms = model.terms.map((t, ti) => {
    const S = colsOf(mm, ti), r = P.ratioOf(t.label);
    if (t.block) return { term: t.label, df: S.length, ratio: r, lambda: NaN, power: NaN, block: true };
    const lambda = lambdaFor(S, S.map(() => coefOf(r)));
    return { term: t.label, df: S.length, ratio: r, lambda, power: powerOf(S.length, lambda) };
  });
  return { n, scores: m.reduce((a, b) => a + b, 0), K: P.K, baseline: P.p, alpha: P.alpha, ratio: opts.ratio ?? 2, terms, lambdaAt, powerOf };
}

/** The odds ratio each term needs for the power asked (NaN beyond 1000). */
export function detectableOddsRatio(result, { power = 0.8 } = {}) {
  return result.terms.filter(t => !t.block).map(t => {
    const pw = (r) => result.powerOf(t.df, result.lambdaAt(t.term, r));
    if (!(pw(1000) >= power)) return { term: t.term, ratio: NaN };
    let lo = 0, hi = Math.log(1000);
    for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (pw(Math.exp(mid)) >= power) hi = mid; else lo = mid; }
    return { term: t.term, ratio: Math.exp(hi) };
  });
}

/**
 * Power by simulation: for each term, nsim experiments are drawn from the anticipated model (that
 * term at its odds ratio, the others at the centre), the model fitted with and without the term,
 * and the likelihood-ratio test counted at α. opts as ordinalPower, plus nsim (200) and seed.
 * Returns [{ term, power, se, nsim }]. A simulated experiment in which a category is never used,
 * or that cannot be fitted, counts as a miss.
 */
export function simulateOrdinalPower(mm, opts = {}) {
  const P = settle(opts), { nsim = 200, seed = 1 } = opts, R = rng(seed);
  const { X, columns, assign, model } = mm;
  const per = (v) => X.map((_, i) => (Array.isArray(v) ? v[i % v.length] : v));
  const m = per(P.scoresPerRun);
  const rows = X.flatMap((x, i) => Array.from({ length: m[i] }, () => x));
  const big = { ...mm, X: rows };
  return model.terms.filter(t => !t.block).map(t => {
    const ti = model.terms.indexOf(t), S = colsOf(mm, ti), b = coefOf(P.ratioOf(t.label));
    const eta = rows.map(x => S.reduce((a, j) => a + x[j] * b, 0));
    const keep = columns.map((_, j) => j).filter(j => !S.includes(j));
    const small = { ...mm, X: rows.map(r => keep.map(j => r[j])), columns: keep.map(j => columns[j]), assign: keep.map(j => assign[j]) };
    let hits = 0;
    for (let s = 0; s < nsim; s++) {
      // a latent logistic value per score, cut at the thresholds
      const y = eta.map(e => { const u = R.random() || 1e-300, z = e + Math.log(u / (1 - u)); let k = 0; while (k < P.K - 1 && z > P.theta[k]) k++; return k + 1; });
      try {
        const fb = fitOrdinal(big, y, { K: P.K }), fs = fitOrdinal(small, y, { K: P.K });
        if (ordinalCompare(fb, fs).p < P.alpha) hits++;
      } catch { /* a category never used: a miss */ }
    }
    const p = hits / nsim;
    return { term: t.label, power: p, se: Math.sqrt(p * (1 - p) / nsim), nsim };
  });
}

/** Power of the study's design for an ordinal response (ordinalPower options, model). */
export function studyOrdinalPower(study, { model = 'main', ...opts } = {}) {
  return { model: parseFormula(model, study.factors), ...ordinalPower(studyMatrix(study, model), opts) };
}
