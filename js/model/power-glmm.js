// Power for counts and proportions in a split-plot (issue #64): the analysis fits a random
// whole-plot intercept (glmm.js), so a hard-to-change factor is judged against the variation from
// one whole plot to the next, not against the counts' own scatter.
//
// The Wald approximation. With the means μ the model expects (the intercept at the baseline, the
// term at its effect, the others zero, every whole plot's shift 0), the working variable of run i
// has variance 1/w_i, w_i = m_i μ′(η_i)²/V(μ_i), and runs of one whole plot share a shift of
// variance σ² on the link scale. So
//
//   V_g = diag(1/w)_g + σ² 11ᵀ,   V_g⁻¹ = W_g − σ² W_g 1 1ᵀ W_g / (1 + σ² Σ_g w),
//   Cov(β̂) ≈ (Xᵀ V⁻¹ X)⁻¹
//
// (penalised quasi-likelihood at the anticipated means; it ignores that a log-normal shift also
// changes the counts' variance, which makes it a little optimistic for large σ). The test is the
// analysis's: a term whose columns are all constant within every whole plot has λ divided by
// m/(m − q) (the standard errors the analysis widens) and is an F on (df, m − q), m whole plots
// and q such columns, the intercept among them; other terms are χ² on df. σ = 0 gives the GLM's
// power for the coefficients that vary within whole plots, and the F on m − q for the others.
//
// By simulation: experiments are simulated from the GLMM (each whole plot's shift drawn), fitted
// with fitGLMM with and without the term, and the analysis's likelihood-ratio test (F on m − q for
// whole-plot terms) counted at α.
import { qr } from '../linalg.js';
import { fDist, ncf, chi2 as CHI2, ncChi2, normal } from '../dist.js';
import { parseFormula, modelMatrix } from './formula.js';
import { family, LINKS, canonicalLink, DISTRIBUTIONS as GLM_DISTRIBUTIONS, _draw } from './glm.js';
import { ratioCoefficient } from './power.js';
import { fitGLMM, glmmCompare } from './glmm.js';
import { rng } from '../design/rng.js';

const glmDistribution = (d) => (d === 'bernoulli' ? 'binomial' : d);

function solveSym(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}

function invert(A) {
  const n = A.length;
  return A.map((_, j) => solveSym(A, A.map((__, i) => (i === j ? 1 : 0)))).map((col, j, cols) => cols.map(c => c[j]));
}

/** Group labels → { idx, m, rows }. */
function groupsOf(labels) {
  const map = new Map(), idx = labels.map(l => { const k = String(l); if (!map.has(k)) map.set(k, map.size); return map.get(k); });
  const rows = Array.from({ length: map.size }, () => []);
  idx.forEach((g, i) => rows[g].push(i));
  return { idx, m: map.size, rows };
}

/**
 * Power of a count or proportion response with a random intercept per whole plot (or block).
 * mm: model matrix (formula.js); groups: a label per run. opts: as glmPowerFromMatrix (distribution
 * poisson, binomial or bernoulli; link, baseline, ratio, trials, exposure, alpha) plus sigma, the
 * standard deviation of the whole-plot shift on the link scale. Returns { n, groups, dfGroups,
 * groupLevel, sigma, alpha, distribution, link, baseline, terms: [{ term, df, ratio, lambda, ddf?,
 * test: 'chi2' | 'F', power }], lambdaAt, powerOf }.
 */
export function glmmPowerFromMatrix(mm, groupLabels, { distribution, link, baseline, ratio = 2, trials = 1, exposure = 1, sigma, alpha = 0.05 } = {}) {
  const d = glmDistribution(distribution);
  if (!['poisson', 'binomial'].includes(d)) throw new Error(`power with a random whole-plot effect is for Poisson counts, binomial proportions and pass/fail results, not ${distribution}`);
  if (!(sigma >= 0)) throw new Error('give σ of the whole-plot shift on the link scale (0 or more): how much whole plots differ beyond the counts\' own variation');
  const lk = link ?? canonicalLink(d), counts = GLM_DISTRIBUTIONS[d].counts;
  if (!(baseline > 0) || (!counts && !(baseline < 1))) throw new Error(counts ? 'the baseline mean count must be positive' : 'the baseline proportion must lie between 0 and 1');
  if (!(alpha > 0 && alpha < 1)) throw new Error('α must be between 0 and 1');
  const fam = family(d, lk), L = fam.link;
  const { X, columns, assign, model } = mm, n = X.length;
  if (groupLabels.length !== n) throw new Error(`${groupLabels.length} whole-plot labels for ${n} runs`);
  const G = groupsOf(groupLabels);
  if (G.m < 2) throw new Error('a random whole-plot effect needs at least two whole plots');
  const per = (v) => X.map((_, i) => (Array.isArray(v) ? v[i % v.length] : v));
  const m = d.includes('binomial') ? per(trials) : X.map(() => 1), expo = counts ? per(exposure) : X.map(() => 1);
  const icpt = columns.findIndex((_, j) => assign[j] === -1), b0 = L.fun(baseline);
  const ratioOf = (label) => (typeof ratio === 'number' ? ratio : ratio[label] ?? ratio.default ?? 2);
  // the columns constant within every whole plot, among the estimable ones
  const f0 = qr(X, { tol: 1e-11 }), est = columns.map((_, j) => !f0.aliased.includes(j));
  const level = columns.map((_, j) => est[j] && G.rows.every(I => I.every(i => X[i][j] === X[I[0]][j])));
  const q = level.filter(Boolean).length, dfG = G.m - q, kG = dfG >= 1 ? G.m / dfG : NaN;
  const lambdaFor = (S, bS) => {
    const beta = columns.map((_, j) => (j === icpt ? b0 : 0));
    S.forEach((j, k) => { beta[j] = bS[k]; });
    const eta = X.map((r, i) => r.reduce((s, v, j) => s + v * beta[j], 0) + (counts && L.name === 'log' ? Math.log(expo[i]) : 0));
    const mu = eta.map(L.inv);
    if (counts && L.name !== 'log') mu.forEach((v, i) => { mu[i] = v * expo[i]; });
    if (mu.some(v => !fam.validMu(v))) return NaN;
    const w = mu.map((v, i) => m[i] * L.deriv(eta[i]) ** 2 / fam.variance(v));
    // Xᵀ V⁻¹ X, whole plot by whole plot
    const J = est.map((e, j) => j).filter(j => est[j]), p = J.length;
    const M = Array.from({ length: p }, () => new Array(p).fill(0));
    for (const I of G.rows) {
      const sw = I.reduce((s, i) => s + w[i], 0), c = sigma * sigma / (1 + sigma * sigma * sw);
      const u = J.map(j => I.reduce((s, i) => s + w[i] * X[i][j], 0));     // Xᵀ W 1 for this whole plot
      for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) {
        let s = 0; for (const i of I) s += X[i][J[a]] * w[i] * X[i][J[b]];
        M[a][b] += s - c * u[a] * u[b];
      }
    }
    const V = invert(M), idx = S.map(j => J.indexOf(j));
    if (idx.some(k => k < 0)) return NaN;
    const A = idx.map(a => idx.map(b => V[a][b]));
    const x = solveSym(A, bS);
    const lam = bS.reduce((s, v, i) => s + v * x[i], 0);
    return S.every(j => level[j]) ? lam / kG : lam;
  };
  const isWP = (S) => S.length > 0 && S.every(j => level[j]);
  const powerOf = (df, lambda, wp) => {
    if (!Number.isFinite(lambda)) return NaN;
    if (wp) return dfG >= 1 ? ncf.sf(fDist.isf(alpha, df, dfG), df, dfG, lambda) : NaN;
    return ncChi2.sf(CHI2.ppf(1 - alpha, df), df, lambda);
  };
  const colsOf = (ti) => columns.map((_, j) => j).filter(j => assign[j] === ti);
  const lambdaAt = (label, r) => {
    const ti = model.terms.findIndex(t => t.label === label), S = colsOf(ti);
    return lambdaFor(S, S.map(() => ratioCoefficient(d, lk, baseline, r)));
  };
  const terms = model.terms.map((t, ti) => {
    const S = colsOf(ti), r = ratioOf(t.label), wp = isWP(S);
    if (t.block) return { term: t.label, df: S.length, ratio: r, lambda: NaN, power: NaN, block: true };
    const lambda = lambdaFor(S, S.map(() => ratioCoefficient(d, lk, baseline, r)));
    return { term: t.label, df: S.length, ratio: r, lambda, test: wp ? 'F' : 'chi2', ...(wp ? { ddf: dfG } : {}), wholePlot: wp, power: powerOf(S.length, lambda, wp) };
  });
  return { n, rank: est.filter(Boolean).length, dfRes: n - est.filter(Boolean).length, groups: G.m, dfGroups: dfG, groupLevel: columns.filter((_, j) => level[j]), sigma, alpha, distribution, link: lk, baseline, ratio, terms,
    lambdaAt, powerOf: (df, lambda, term) => powerOf(df, lambda, terms.find(t => t.term === term)?.wholePlot) };
}

/**
 * Smallest ratio detectable with the given power for each term of a glmmPowerFromMatrix result,
 * by bisection on its log. [{ term, ratio }] (NaN when not reached below 1000).
 */
export function detectableGlmmRatio(result, { power = 0.8 } = {}) {
  return result.terms.filter(t => !t.block).map(t => {
    const pw = (r) => result.powerOf(t.df, result.lambdaAt(t.term, r), t.term);
    if (!(pw(1000) >= power)) return { term: t.term, ratio: NaN };
    let lo = 0, hi = Math.log(1000);
    for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (pw(Math.exp(mid)) >= power) hi = mid; else lo = mid; }
    return { term: t.term, ratio: Math.exp(hi) };
  });
}

const binomialDraw = (R, n, p) => { let k = 0; for (let i = 0; i < n; i++) if (R.random() < p) k++; return k; };

/**
 * Power by simulation from the GLMM: for each term, nsim experiments with each whole plot's shift
 * drawn from N(0, σ²), fitted by fitGLMM (nAGQ, default 25) with and without the term; the
 * likelihood-ratio test counted at α (F on m − q df for a whole-plot term, as the analysis).
 * Returns [{ term, power, se, nsim }].
 */
export function simulateGlmmPower(mm, groupLabels, opts = {}) {
  const { distribution, link, baseline, ratio = 2, trials = 1, exposure = 1, sigma, alpha = 0.05, nsim = 200, seed = 1, nAGQ = 25 } = opts;
  const approx = glmmPowerFromMatrix(mm, groupLabels, opts);
  const d = glmDistribution(distribution), lk = link ?? canonicalLink(d), counts = GLM_DISTRIBUTIONS[d].counts, L = LINKS[lk];
  const R = rng(seed), { X, columns, assign, model } = mm, G = groupsOf(groupLabels);
  const per = (v) => X.map((_, i) => (Array.isArray(v) ? v[i % v.length] : v));
  const m = d.includes('binomial') ? per(trials) : X.map(() => 1), expo = counts ? per(exposure) : X.map(() => 1);
  const icpt = columns.findIndex((_, j) => assign[j] === -1), b0 = L.fun(baseline);
  const ratioOf = (label) => (typeof ratio === 'number' ? ratio : ratio[label] ?? ratio.default ?? 2);
  const offset = counts ? expo.map(Math.log) : undefined;
  const o = { distribution: d, link: lk, weights: counts ? undefined : m, offset, nAGQ, group: 'whole plot' };
  return model.terms.filter(t => !t.block).map(t => {
    const ti = model.terms.indexOf(t), S = columns.map((_, j) => j).filter(j => assign[j] === ti);
    const wp = approx.terms.find(x => x.term === t.label)?.wholePlot;
    const beta = columns.map((_, j) => (j === icpt ? b0 : S.includes(j) ? ratioCoefficient(d, lk, baseline, ratioOf(t.label)) : 0));
    const eta = X.map((r) => r.reduce((s, v, j) => s + v * beta[j], 0));
    const keep = columns.map((_, j) => j).filter(j => !S.includes(j));
    const small = { ...mm, X: X.map(r => keep.map(j => r[j])), columns: keep.map(j => columns[j]), assign: keep.map(j => assign[j]) };
    let hits = 0, done = 0;
    for (let s = 0; s < nsim; s++) {
      const shift = Array.from({ length: G.m }, () => sigma * normal.ppf(Math.min(1 - 1e-12, Math.max(1e-12, R.random()))));
      const y = eta.map((e, i) => {
        const mu = L.inv(e + shift[G.idx[i]]);
        return counts ? _draw.poisson(R, mu * expo[i]) : binomialDraw(R, m[i], mu) / m[i];
      });
      try {
        const big = fitGLMM(mm, y, groupLabels, o), sm = fitGLMM(small, y, groupLabels, o);
        const c = glmmCompare(big, sm);
        const p = wp && !big.boundary ? (big.dfGroups >= 1 ? fDist.sf(c.chi2 / c.df, c.df, big.dfGroups) : NaN) : c.p;
        if (Number.isFinite(p)) { done++; if (p < alpha) hits++; }
      } catch { /* a degenerate simulated data set: not counted */ }
    }
    const p = done ? hits / done : NaN;
    return { term: t.label, power: p, se: Math.sqrt(p * (1 - p) / Math.max(1, done)), nsim: done };
  });
}

/** The study's design with its whole plots (or blocks: random: 'block'): the model matrix and labels. */
export function studyGlmmMatrix(study, model = 'main', { random = 'wholePlot' } = {}) {
  if (!study.design) throw new Error('the study has no design yet');
  const runs = study.design.runs.filter(r => r.kind !== 'confirm');
  const key = random === 'block' ? 'block' : 'wholePlot';
  if (!runs.every(r => r[key] !== undefined)) throw new Error(random === 'block' ? 'the design has no blocks' : 'the design has no whole plots');
  const mm = modelMatrix(parseFormula(model, study.factors), study.factors, runs.map(r => r.settings));
  return { mm, groups: runs.map(r => String(r[key])) };
}

/** Power of the study's split-plot (or blocked, random: 'block') design for a count or proportion response. */
export function studyGlmmPower(study, { model = 'main', random = 'wholePlot', ...opts } = {}) {
  const { mm, groups } = studyGlmmMatrix(study, model, { random });
  return { model: parseFormula(model, study.factors), ...glmmPowerFromMatrix(mm, groups, opts) };
}
