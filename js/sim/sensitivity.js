// Global sensitivity: Sobol first-order and total indices (spec §10, issue #20).
//
// With A, B independent N × k sample matrices and A_B^(i) = A with column i from B,
//   V = Var(f(A), f(B)),  S_i = mean((f(B) − f̄) (f(A_B^i) − f(A))) / V  (Saltelli et al. 2010; centring
//   on the sample mean f̄ keeps the estimator's variance from growing with the response's mean),
//   ST_i = mean((f(A) − f(A_B^i))²) / (2V)                       (Jansen 1999).
// (k + 2) N evaluations. A and B are drawn together as 2k-dimensional quasi-random points from the
// R_d (generalised golden-ratio, Roberts 2018) sequence, which needs no direction-number tables
// and converges much faster than plain Monte Carlo on smooth functions. The N points are split into
// R independently randomly-shifted replicates (Cranley–Patterson rotation); the estimate is their
// mean and the confidence interval is the t interval over replicates.
import { rng } from '../design/rng.js';
import { studentT } from '../dist.js';

/** The R_d sequence's generator vector for dimension d. */
function rdAlpha(d) {
  let x = 2; for (let i = 0; i < 200; i++) x = Math.pow(1 + x, 1 / (d + 1));
  return Array.from({ length: d }, (_, j) => Math.pow(1 / x, j + 1) % 1);
}

/**
 * fn(row) → number; samplers: [(u) → value] per input, each consuming exactly one uniform from
 * u() by inverse CDF (the deviation samplers in sample.js do). opts: N (2^14 base points in all),
 * replicates (8), seed, level (0.95), qmc (true; false = plain Monte Carlo).
 * Returns { V, mean, first: [{ S, lower, upper }], total: [{ S, lower, upper }], evaluations }.
 */
export function sobolIndices(fn, samplers, { N = 16384, replicates = 8, seed = 1, level = 0.95, qmc = true } = {}) {
  const k = samplers.length, g = rng(seed), D = 2 * k;
  if (!k) throw new Error('no inputs to analyse');
  if (!(replicates >= 2)) throw new Error('need at least 2 replicates for an interval');
  const n = Math.max(2, Math.floor(N / replicates)), alpha = rdAlpha(D);
  const reps = [];
  for (let r = 0; r < replicates; r++) {
    const shift = Array.from({ length: D }, () => g.random());
    const fA = new Float64Array(n), fB = new Float64Array(n), fAB = Array.from({ length: k }, () => new Float64Array(n));
    for (let t = 0; t < n; t++) {
      const us = qmc ? alpha.map((a, j) => { const v = (shift[j] + (t + 1) * a) % 1; return v > 0 ? v : 2 ** -53; })
        : alpha.map(() => g.random() * (1 - 2 ** -52) + 2 ** -53);
      const A = samplers.map((s, i) => s(() => us[i])), B = samplers.map((s, i) => s(() => us[k + i]));
      fA[t] = fn(A); fB[t] = fn(B);
      for (let i = 0; i < k; i++) { const x = A.slice(); x[i] = B[i]; fAB[i][t] = fn(x); }
    }
    let m = 0; for (let t = 0; t < n; t++) m += fA[t] + fB[t]; m /= 2 * n;
    let V = 0; for (let t = 0; t < n; t++) V += (fA[t] - m) ** 2 + (fB[t] - m) ** 2; V /= 2 * n - 1;
    const S = [], T = [];
    for (let i = 0; i < k; i++) {
      let s1 = 0, st = 0;
      for (let t = 0; t < n; t++) { const d = fAB[i][t] - fA[t]; s1 += (fB[t] - m) * d; st += d * d; }
      S.push(V > 0 ? s1 / n / V : 0); T.push(V > 0 ? st / n / (2 * V) : 0);
    }
    reps.push({ m, V, S, T });
  }
  const tq = studentT.ppf(1 - (1 - level) / 2, replicates - 1);
  const summ = (vals) => {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const se = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1) / vals.length);
    return { S: mean, lower: mean - tq * se, upper: mean + tq * se };
  };
  const avg = (vals) => vals.reduce((a, b) => a + b, 0) / vals.length;
  return {
    V: avg(reps.map(r => r.V)), mean: avg(reps.map(r => r.m)), evaluations: (k + 2) * n * replicates, replicates,
    first: samplers.map((_, i) => summ(reps.map(r => r.S[i]))), total: samplers.map((_, i) => summ(reps.map(r => r.T[i]))),
  };
}
