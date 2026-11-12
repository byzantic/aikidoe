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
// analysis's: a term whose columns are all constant within every whole plot is an F on (df, m − q),
// m whole plots and q such columns, the intercept among them, with its λ from V with σ² widened by
// m/(m − q) — the small-sample correction applied to the whole-plot variance it is meant for (the
// maximum-likelihood σ̂² is biased low by about (m − q)/m), not to the runs' own scatter within whole
// plots; other terms are χ² on df, with σ² as given. (#77 divided the whole λ by m/(m − q) instead:
// against glmer and glmmTMB simulations of the analysis that was 2–10 points low for whole-plot
// factors, most for the negative binomial, whose within-whole-plot scatter is largest; this is
// 0.5–8 points low.) σ = 0 gives the GLM's power, with the F on m − q for whole-plot terms. For the
// negative binomial, V(μ) = μ + μ²/θ in w, θ as anticipated (the analysis estimates it).
//
// Nested groupings (blocks ⊃ whole plots; issue #78): V = W⁻¹ + Σ σ_k² Z_k Z_kᵀ, block-diagonal over
// the outermost groups; each term's stratum as the analysis's (the outermost grouping within whose
// groups its columns are constant: units = its groups less those of the grouping outside it, df =
// units − q), only that stratum's σ² widened by units/df, and an F on that df.
//
// By simulation: experiments are simulated from the GLMM (each whole plot's shift drawn), fitted
// with fitGLMM with and without the term, and the analysis's likelihood-ratio test (F on m − q for
// whole-plot terms) counted at α.
import { qr } from '../linalg.js';
import { fDist, ncf, chi2 as CHI2, ncChi2, normal } from '../dist.js';
import { parseFormula, modelMatrix } from './formula.js';
import { family, LINKS, canonicalLink, DISTRIBUTIONS as GLM_DISTRIBUTIONS, _draw } from './glm.js';
import { ratioCoefficient } from './power.js';
import { fitGLMM, glmmDropTest } from './glmm.js';
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
 * poisson, negbin (with theta), binomial or bernoulli; link, baseline, ratio, trials, exposure, alpha) plus sigma, the
 * standard deviation of the whole-plot shift on the link scale. Returns { n, groups, dfGroups,
 * groupLevel, sigma, alpha, distribution, link, baseline, terms: [{ term, df, ratio, lambda, ddf?,
 * test: 'chi2' | 'F', power }], lambdaAt, powerOf }.
 */
export function glmmPowerFromMatrix(mm, groupLabels, { distribution, link, baseline, ratio = 2, trials = 1, exposure = 1, theta, sigma, alpha = 0.05 } = {}) {
  const d = glmDistribution(distribution);
  if (!['poisson', 'negbin', 'binomial'].includes(d)) throw new Error(`power with a random whole-plot effect is for Poisson and negative binomial counts, binomial proportions and pass/fail results, not ${distribution}`);
  if (d === 'negbin' && !(theta > 0)) throw new Error('the negative binomial needs θ (within a whole plot the variance is μ + μ²/θ): give the θ you expect');
  // one grouping (labels, σ a number) or several nested ([{ name, labels }] outermost first, σ an array)
  const nestedIn = groupLabels.length && groupLabels[0] && typeof groupLabels[0] === 'object' && 'labels' in groupLabels[0];
  const levels = nestedIn ? groupLabels : [{ name: 'whole plot', labels: groupLabels }], K = levels.length;
  const sigmas = Array.isArray(sigma) ? sigma : [sigma];
  if (sigmas.length !== K) throw new Error(`${sigmas.length} σ's for ${K} groupings`);
  if (!sigmas.every(v => v >= 0)) throw new Error(K > 1 ? 'give σ (0 or more) on the link scale for each grouping' : 'give σ of the whole-plot shift on the link scale (0 or more): how much whole plots differ beyond the counts\' own variation');
  const lk = link ?? canonicalLink(d), counts = GLM_DISTRIBUTIONS[d].counts;
  if (!(baseline > 0) || (!counts && !(baseline < 1))) throw new Error(counts ? 'the baseline mean count must be positive' : 'the baseline proportion must lie between 0 and 1');
  if (!(alpha > 0 && alpha < 1)) throw new Error('α must be between 0 and 1');
  const fam = family(d, lk, d === 'negbin' ? theta : undefined), L = fam.link;
  const { X, columns, assign, model } = mm, n = X.length;
  for (const l of levels) if (l.labels.length !== n) throw new Error(`${l.labels.length} ${l.name} labels for ${n} runs`);
  const Gs = levels.map(l => groupsOf(l.labels));
  Gs.forEach((G, k) => { if (G.m < 2) throw new Error(`a random ${levels[k].name} effect needs at least two ${levels[k].name}s`); });
  for (let k = 1; k < K; k++) {
    const o = new Map();
    for (let i = 0; i < n; i++) { const g = Gs[k].idx[i]; if (o.has(g) && o.get(g) !== Gs[k - 1].idx[i]) throw new Error(`the ${levels[k].name}s are not nested within the ${levels[k - 1].name}s`); o.set(g, Gs[k - 1].idx[i]); }
  }
  const per = (v) => X.map((_, i) => (Array.isArray(v) ? v[i % v.length] : v));
  const m = d.includes('binomial') ? per(trials) : X.map(() => 1), expo = counts ? per(exposure) : X.map(() => 1);
  const icpt = columns.findIndex((_, j) => assign[j] === -1), b0 = L.fun(baseline);
  const ratioOf = (label) => (typeof ratio === 'number' ? ratio : ratio[label] ?? ratio.default ?? 2);
  // each column's stratum: the outermost grouping within whose groups it is constant (as the analysis)
  const f0 = qr(X, { tol: 1e-11 }), est = columns.map((_, j) => !f0.aliased.includes(j));
  const levelOf = columns.map((_, j) => (est[j] ? Gs.findIndex(G => G.rows.every(I => I.every(i => X[i][j] === X[I[0]][j]))) : -1));
  const strata = Gs.map((G, k) => { const units = G.m - (k ? Gs[k - 1].m : 0), q = levelOf.filter(v => v === k).length, df = units - q; return { units, q, df, scale: df >= 1 ? units / df : NaN }; });
  const levelOfTerm = (S) => (S.length && levelOf[S[0]] >= 0 && S.every(j => levelOf[j] === levelOf[S[0]]) ? levelOf[S[0]] : -1);
  const J = est.map((e, j) => j).filter(j => est[j]), p = J.length;
  const lambdaFor = (S, bS) => {
    // a term in stratum k: σ_k² widened by its units/df (see the header)
    const lt = levelOfTerm(S), s2 = sigmas.map((v, k) => v * v * (k === lt ? strata[k].scale : 1));
    const beta = columns.map((_, j) => (j === icpt ? b0 : 0));
    S.forEach((j, k) => { beta[j] = bS[k]; });
    const eta = X.map((r, i) => r.reduce((s, v, j) => s + v * beta[j], 0) + (counts && L.name === 'log' ? Math.log(expo[i]) : 0));
    const mu = eta.map(L.inv);
    if (counts && L.name !== 'log') mu.forEach((v, i) => { mu[i] = v * expo[i]; });
    if (mu.some(v => !fam.validMu(v)) || !s2.every(Number.isFinite)) return NaN;
    const w = mu.map((v, i) => m[i] * L.deriv(eta[i]) ** 2 / fam.variance(v));
    const M = Array.from({ length: p }, () => new Array(p).fill(0));
    if (K === 1) {
      // Xᵀ V⁻¹ X, whole plot by whole plot (Woodbury)
      for (const I of Gs[0].rows) {
        const sw = I.reduce((s, i) => s + w[i], 0), c = s2[0] / (1 + s2[0] * sw);
        const u = J.map(j => I.reduce((s, i) => s + w[i] * X[i][j], 0));     // Xᵀ W 1 for this whole plot
        for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) {
          let s = 0; for (const i of I) s += X[i][J[a]] * w[i] * X[i][J[b]];
          M[a][b] += s - c * u[a] * u[b];
        }
      }
    } else {
      // nested: V = W⁻¹ + Σ σ_k² Z_k Z_kᵀ, block-diagonal over the outermost groups
      for (const I of Gs[0].rows) {
        const Vc = I.map((i, a) => I.map((i2, b) => (a === b ? 1 / w[i] : 0) + s2.reduce((s, v, k) => s + (Gs[k].idx[i] === Gs[k].idx[i2] ? v : 0), 0)));
        const Vi = invert(Vc);
        for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) {
          let s = 0; for (let x = 0; x < I.length; x++) for (let y = 0; y < I.length; y++) s += X[I[x]][J[a]] * Vi[x][y] * X[I[y]][J[b]];
          M[a][b] += s;
        }
      }
    }
    const V = invert(M), idx = S.map(j => J.indexOf(j));
    if (idx.some(k => k < 0)) return NaN;
    const A = idx.map(a => idx.map(b => V[a][b]));
    const x = solveSym(A, bS);
    return bS.reduce((s, v, i) => s + v * x[i], 0);
  };
  const powerOf = (df, lambda, lt) => {
    if (!Number.isFinite(lambda)) return NaN;
    if (lt >= 0) { const dd = strata[lt].df; return dd >= 1 ? ncf.sf(fDist.isf(alpha, df, dd), df, dd, lambda) : NaN; }
    return ncChi2.sf(CHI2.ppf(1 - alpha, df), df, lambda);
  };
  const colsOf = (ti) => columns.map((_, j) => j).filter(j => assign[j] === ti);
  const lambdaAt = (label, r) => {
    const ti = model.terms.findIndex(t => t.label === label), S = colsOf(ti);
    return lambdaFor(S, S.map(() => ratioCoefficient(d, lk, baseline, r)));
  };
  const terms = model.terms.map((t, ti) => {
    const S = colsOf(ti), r = ratioOf(t.label), lt = levelOfTerm(S);
    if (t.block) return { term: t.label, df: S.length, ratio: r, lambda: NaN, power: NaN, block: true };
    const lambda = lambdaFor(S, S.map(() => ratioCoefficient(d, lk, baseline, r)));
    return { term: t.label, df: S.length, ratio: r, lambda, test: lt >= 0 ? 'F' : 'chi2', ...(lt >= 0 ? { ddf: strata[lt].df, level: levels[lt].name } : {}), wholePlot: lt >= 0, power: powerOf(S.length, lambda, lt) };
  });
  const out = { n, rank: p, dfRes: n - p, groups: Gs[K - 1].m, groupLevel: columns.filter((_, j) => levelOf[j] >= 0), alpha, distribution, link: lk, baseline, ratio, ...(d === 'negbin' ? { theta } : {}), terms,
    levels: levels.map((l, k) => ({ name: l.name, m: Gs[k].m, sigma: sigmas[k], units: strata[k].units, df: strata[k].df, coefficients: columns.filter((_, j) => levelOf[j] === k) })),
    lambdaAt, powerOf: (df, lambda, term) => powerOf(df, lambda, levelOfTerm(colsOf(model.terms.findIndex(t => t.label === term)))) };
  return K === 1 ? { ...out, dfGroups: strata[0].df, sigma: sigmas[0] } : { ...out, sigma: sigmas };
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
 * drawn from N(0, σ²) (nested groupings: each level's shifts, with its σ), fitted by fitGLMM (nAGQ,
 * default 25; 1 for nested groupings) with and without the term; the analysis's likelihood-ratio
 * test counted at α (F on its stratum's df for a term that varies only between groups).
 * Returns [{ term, power, se, nsim }].
 */
export function simulateGlmmPower(mm, groupLabels, opts = {}) {
  const { distribution, link, baseline, ratio = 2, trials = 1, exposure = 1, theta, sigma, alpha = 0.05, nsim = 200, seed = 1 } = opts;
  const approx = glmmPowerFromMatrix(mm, groupLabels, opts);
  const d = glmDistribution(distribution), lk = link ?? canonicalLink(d), counts = GLM_DISTRIBUTIONS[d].counts, L = LINKS[lk];
  const nestedIn = typeof groupLabels[0] === 'object' && groupLabels[0] !== null && 'labels' in groupLabels[0];
  const Gs = (nestedIn ? groupLabels : [{ labels: groupLabels }]).map(l => groupsOf(l.labels)), sigmas = Array.isArray(sigma) ? sigma : [sigma];
  const nAGQ = opts.nAGQ ?? (nestedIn && groupLabels.length > 1 ? 1 : 25);
  const R = rng(seed), { X, columns, assign, model } = mm;
  const per = (v) => X.map((_, i) => (Array.isArray(v) ? v[i % v.length] : v));
  const m = d.includes('binomial') ? per(trials) : X.map(() => 1), expo = counts ? per(exposure) : X.map(() => 1);
  const icpt = columns.findIndex((_, j) => assign[j] === -1), b0 = L.fun(baseline);
  const ratioOf = (label) => (typeof ratio === 'number' ? ratio : ratio[label] ?? ratio.default ?? 2);
  const offset = counts ? expo.map(Math.log) : undefined;
  const o = { distribution: d, link: lk, weights: counts ? undefined : m, offset, nAGQ, group: 'whole plot' };
  return model.terms.filter(t => !t.block).map(t => {
    const ti = model.terms.indexOf(t), S = columns.map((_, j) => j).filter(j => assign[j] === ti);
    const beta = columns.map((_, j) => (j === icpt ? b0 : S.includes(j) ? ratioCoefficient(d, lk, baseline, ratioOf(t.label)) : 0));
    const eta = X.map((r) => r.reduce((s, v, j) => s + v * beta[j], 0));
    const keep = columns.map((_, j) => j).filter(j => !S.includes(j));
    const small = { ...mm, X: X.map(r => keep.map(j => r[j])), columns: keep.map(j => columns[j]), assign: keep.map(j => assign[j]) };
    let hits = 0, done = 0;
    for (let s = 0; s < nsim; s++) {
      const shifts = Gs.map((G, k) => Array.from({ length: G.m }, () => sigmas[k] * normal.ppf(Math.min(1 - 1e-12, Math.max(1e-12, R.random())))));
      const y = eta.map((e, i) => {
        const mu = L.inv(e + Gs.reduce((s, G, k) => s + shifts[k][G.idx[i]], 0));
        // the negative binomial as a Poisson with a gamma-distributed mean (shape θ, mean 1); θ is estimated in the fits, as the analysis does
        return counts ? _draw.poisson(R, mu * expo[i] * (d === 'negbin' ? _draw.gamma(R, theta) / theta : 1)) : binomialDraw(R, m[i], mu) / m[i];
      });
      try {
        const big = fitGLMM(mm, y, groupLabels, o), sm = fitGLMM(small, y, groupLabels, o);
        const p = glmmDropTest(big, sm, t.label).p;              // the analysis's test (F on its stratum's df for a whole-plot term)
        if (Number.isFinite(p)) { done++; if (p < alpha) hits++; }
      } catch { /* a degenerate simulated data set: not counted */ }
    }
    const p = done ? hits / done : NaN;
    return { term: t.label, power: p, se: Math.sqrt(p * (1 - p) / Math.max(1, done)), nsim: done };
  });
}

/**
 * The study's design with its whole plots (or blocks: random 'block'; or both, nested: 'block,wholePlot',
 * blocks outermost): the model matrix and the labels (a list of { name, labels } for several).
 */
export function studyGlmmMatrix(study, model = 'main', { random = 'wholePlot' } = {}) {
  if (!study.design) throw new Error('the study has no design yet');
  const runs = study.design.runs.filter(r => r.kind !== 'confirm' && r.kind !== 'path');
  const keys = String(random).split(',').map(x => x.trim()).sort((a, b) => (a === 'block' ? -1 : b === 'block' ? 1 : 0));
  for (const key of keys) {
    if (!['block', 'wholePlot'].includes(key)) throw new Error(`power with a random "${key}" effect: use wholePlot, block or block,wholePlot`);
    if (!runs.every(r => r[key] !== undefined)) throw new Error(key === 'block' ? 'the design has no blocks' : 'the design has no whole plots');
  }
  const mm = modelMatrix(parseFormula(model, study.factors), study.factors, runs.map(r => r.settings));
  if (keys.length === 1) return { mm, groups: runs.map(r => String(r[keys[0]])) };
  return { mm, groups: keys.map(key => ({ name: key === 'block' ? 'block' : 'whole plot', labels: runs.map(r => String(r[key])) })) };
}

/** Power of the study's split-plot (or blocked, random: 'block') design for a count or proportion response. */
export function studyGlmmPower(study, { model = 'main', random = 'wholePlot', ...opts } = {}) {
  const { mm, groups } = studyGlmmMatrix(study, model, { random });
  return { model: parseFormula(model, study.factors), ...glmmPowerFromMatrix(mm, groups, opts) };
}
