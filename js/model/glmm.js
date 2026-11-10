// Generalised linear mixed models with one random intercept (issue #64, phase 5): counts and
// proportions whose runs fall in groups — blocks (days, batches) or the whole plots of a
// split-plot — that shift the response on the link scale.
//
//   η_i = x_iβ + o_i + σ z_g(i),   z_g ~ N(0, 1),   y_i | z ~ Poisson, negative binomial (variance
//   μ + μ²/θ, θ estimated with β and σ; issue #78) or binomial (or pass/fail)
//
// The likelihood is a product over groups of one-dimensional integrals over z_g, each approximated
// by adaptive Gauss–Hermite quadrature (nAGQ nodes, default 25) or the Laplace approximation
// (nAGQ = 1), centred at the conditional mode ẑ_g and scaled by H_g = 1 + σ² Σ w_i, w_i the Fisher
// weight m μ′(η)²/V(μ) at the mode — as lme4::glmer does (for canonical links the Fisher and
// observed curvatures agree). The log-likelihood is the full one (with Σ log y! and the binomial
// coefficients), as logLik gives for nAGQ = 1; lme4 leaves the saturated model's out for nAGQ > 1.
//
// The estimates maximise it over (β, σ) by Newton's method with a finite-difference Hessian (and
// step halving), from the GLM's estimates; σ = 0 is the boundary (no group-to-group variation),
// where the fit is the GLM. The covariance of β is the β-block of the inverse Hessian of −log L over
// (σ, β), as lme4's vcov (use.hessian = TRUE): seWald. σ = 0 against σ > 0 is tested by the
// likelihood ratio referred to ½χ²₀ + ½χ²₁ (the boundary).
//
// Small-sample correction (not in lme4): with few groups, z tests and intervals for coefficients
// that only vary between groups — a split-plot's whole-plot factors, and the intercept — are too
// optimistic (σ̂ is a maximum-likelihood estimate, biased low, and treated as known). Those
// group-level coefficients get, as REML and the containment degrees of freedom do for normal
// responses, standard errors scaled by √(m/(m − q)) and t tests and intervals on m − q df (m
// groups, q group-level coefficients); likelihood-ratio tests of terms at that level become F =
// χ²/df on (df, m − q) (the likelihood ratio re-estimates σ in each model, so it needs only the
// df); predictions use the scaled covariance and t, and add σ̂² m/(m − q) for a new group. In
// simulations of Poisson split-plots (two factors, one hard to change, whole-plot σ 0.5 on the log
// scale; 400 data sets each), the 95 % interval for the whole-plot factor covered in 82, 89, 92 and
// 94 % with lme4's Wald z for 8, 12, 16 and 24 whole plots, and in 92.5, 95, 96 and 97 % with the
// correction; the test of that factor under no effect rejected in 8, 8.5, 8 and 5 % by χ², and in
// 2.3, 5.8, 6.3 and 4 % by the F; the corrected interval for a new run in a new whole plot covered
// in 94–95 %. Coefficients that vary within groups keep z (their coverage is already right).
//
//   fitGLMM(mm, y, groups, o)     a model matrix, responses and group labels → the fit
//   glmmTests(fit, type)          likelihood-ratio tests of the terms (type 1, 2 or 3, as glmTests)
//   glmmCompare(big, small)       likelihood-ratio test of nested fits
//   glmmPredict(fit, X, o)        predictions for a typical group, and averaged over groups
//   fitCountMixedModel(study, formula, o)   a study's count or proportion response, with random
//                                 blocks, whole plots or runs (or several, nested: issue #78);
//                                 predictCountMixed(fit, settings, o)
import { qr, eigSym, chol, cholInverse } from '../linalg.js';
import { normal as N, chi2, fDist, studentT, lgamma } from '../dist.js';
import { LINKS, DISTRIBUTIONS, canonicalLink, family, fitGLM, predictiveInterval } from './glm.js';
import { containedIn, parseFormula, modelMatrix } from './formula.js';
import { responseTable, withBlockTerm } from './fit.js';
import { noiseModel, noiseModelOf } from './noise.js';

const sum = (a) => a.reduce((s, v) => s + v, 0);
const lchoose = (n, k) => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);

// Gauss–Hermite nodes and weights for ∫ e^{−t²} g(t) dt (Golub–Welsch)
const GH = new Map();
function gaussHermite(K) {
  if (!GH.has(K)) {
    const J = Array.from({ length: K }, (_, i) => Array.from({ length: K }, (__, j) => (Math.abs(i - j) === 1 ? Math.sqrt(Math.max(i, j) / 2) : 0)));
    const { values, vectors } = eigSym(J);
    GH.set(K, values.map((t, k) => ({ t, w: Math.sqrt(Math.PI) * vectors[0][k] ** 2 })).sort((a, b) => a.t - b.t));
  }
  return GH.get(K);
}

/** log f(y | μ) of one observation: Poisson or negative binomial count, or binomial proportion y of m trials. */
function logf(fam, y, mu, m) {
  if (fam.distribution === 'negbin') { const th = fam.theta; return lgamma(y + th) - lgamma(th) - lgamma(y + 1) + th * Math.log(th / (th + mu)) + (y > 0 ? y * Math.log(mu / (th + mu)) : 0); }
  if (fam.D.counts) return (y > 0 ? y * Math.log(mu) : 0) - mu - lgamma(y + 1);
  const k = Math.round(m * y);
  return lchoose(m, k) + (k > 0 ? k * Math.log(mu) : 0) + (m - k > 0 ? (m - k) * Math.log(1 - mu) : 0);
}

/**
 * The log-likelihood of (β, σ) and the groups' conditional modes ẑ_g. data: { X, y, w (trials or
 * 1), off, groups: { idx, m, rows: [[i…]] }, fam, nodes }.
 */
function loglik(data, beta, sigma, zStart) {
  const { X, y, w, off, groups, fam, nodes } = data, L = fam.link;
  const eta0 = X.map((r, i) => { let s = off[i]; for (let j = 0; j < r.length; j++) s += r[j] * beta[j]; return s; });
  let ll = 0;
  const modes = new Array(groups.m), curv = new Array(groups.m);
  for (let g = 0; g < groups.m; g++) {
    const I = groups.rows[g];
    const h = (z) => { let s = -z * z / 2; for (const i of I) s += logf(fam, y[i], L.inv(eta0[i] + sigma * z), w[i]); return s; };
    // the conditional mode by Fisher scoring (step halving if h falls)
    let z = zStart?.[g] ?? 0, hz = h(z), W = 0;
    for (let it = 0; it < 100; it++) {
      let sc = 0; W = 0;
      for (const i of I) {
        const e = eta0[i] + sigma * z, mu = L.inv(e), d = L.deriv(e), v = fam.variance(mu);
        sc += w[i] * (y[i] - mu) * d / v; W += w[i] * d * d / v;
      }
      const H = sigma * sigma * W + 1, step = (sigma * sc - z) / H;
      if (!Number.isFinite(step)) break;
      let zn = z + step, hn = h(zn);
      for (let k = 0; k < 30 && !(hn >= hz - 1e-12); k++) { zn = (z + zn) / 2; hn = h(zn); }
      const done = Math.abs(zn - z) < 1e-10 * (1 + Math.abs(z));
      z = zn; hz = hn;
      if (done) break;
    }
    // the curvature at the mode, from the Fisher weights there
    W = 0;
    for (const i of I) { const e = eta0[i] + sigma * z, mu = L.inv(e), d = L.deriv(e); W += w[i] * d * d / fam.variance(mu); }
    const H = sigma * sigma * W + 1;
    modes[g] = z; curv[g] = H;
    if (nodes.length === 1) { ll += hz - Math.log(H) / 2; continue; }
    // adaptive Gauss–Hermite: z = ẑ + √(2/H) t, ∫ φ(z) e^{h(z) + z²/2} dz = √(2/H)/√(2π) Σ w_k e^{h(z_k) + t_k²}
    const s = Math.sqrt(2 / H), terms = nodes.map(({ t, w: wk }) => Math.log(wk) + h(z + s * t) + t * t);
    const mx = Math.max(...terms);
    ll += mx + Math.log(sum(terms.map(v => Math.exp(v - mx)))) + Math.log(s) - Math.log(2 * Math.PI) / 2;
  }
  return { ll, modes, curv };
}

/** Group labels → { idx, m, names, rows }. */
function indexGroups(labels) {
  const map = new Map(), idx = labels.map(l => { const k = String(l); if (!map.has(k)) map.set(k, map.size); return map.get(k); });
  const rows = Array.from({ length: map.size }, () => []);
  idx.forEach((g, i) => rows[g].push(i));
  return { idx, m: map.size, names: [...map.keys()], rows };
}

/** Symmetric finite-difference Hessian and gradient of f at x (steps h_j). */
function hessian(f, x, h) {
  const p = x.length, f0 = f(x), H = Array.from({ length: p }, () => new Array(p).fill(0)), g = new Array(p);
  const at = (d) => f(x.map((v, j) => v + (d[j] ?? 0)));
  for (let a = 0; a < p; a++) {
    const fp = at({ [a]: h[a] }), fm = at({ [a]: -h[a] });
    g[a] = (fp - fm) / (2 * h[a]); H[a][a] = (fp - 2 * f0 + fm) / (h[a] * h[a]);
    for (let b = 0; b < a; b++) {
      const v = (at({ [a]: h[a], [b]: h[b] }) - at({ [a]: h[a], [b]: -h[b] }) - at({ [a]: -h[a], [b]: h[b] }) + at({ [a]: -h[a], [b]: -h[b] })) / (4 * h[a] * h[b]);
      H[a][b] = v; H[b][a] = v;
    }
  }
  return { f0, g, H };
}

/** Solve A x = b for symmetric A, by Cholesky (regularised if needed). */
function solveSPD(A, b) {
  let L;
  for (let lam = 0, k = 0; k < 12; k++, lam = lam ? lam * 10 : 1e-8 * Math.max(1, ...A.map((r, i) => Math.abs(r[i])))) {
    try { L = chol(A.map((r, i) => r.map((v, j) => v + (i === j ? lam : 0)))).L; break; } catch { /* more */ }
  }
  if (!L) return null;
  const n = b.length, z = new Array(n), x = new Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let j = 0; j < i; j++) s -= L[i][j] * z[j]; z[i] = s / L[i][i]; }
  for (let i = n - 1; i >= 0; i--) { let s = z[i]; for (let j = i + 1; j < n; j++) s -= L[j][i] * x[j]; x[i] = s / L[i][i]; }
  return x;
}

/**
 * Fit a GLMM with a random intercept for groups. mm: model matrix (formula.js); y: counts, or
 * proportions for the binomial; groups: a label per row (block, whole plot). o: distribution
 * ('poisson', 'binomial' or 'bernoulli'), link, weights (binomial trials), offset (log exposure),
 * nAGQ (25; 1 is the Laplace approximation), group (its name, for messages: 'block', 'whole plot').
 * groups may instead be a list [{ name, labels }] of nested groupings, outermost first: a random
 * intercept for each (fitNested below; the Laplace approximation). Every fit has randoms: one entry
 * per grouping, { name, m, sigma, sigmaSE, boundary, test, modes, coefficients, df, smallSample }.
 */
export function fitGLMM(mm, y, groupLabels, o = {}) {
  // several groupings ([{ name, labels }], outermost first): nested random intercepts
  if (groupLabels.length && groupLabels[0] && typeof groupLabels[0] === 'object' && 'labels' in groupLabels[0]) {
    if (groupLabels.length === 1) return fitGLMM(mm, y, groupLabels[0].labels, { ...o, group: groupLabels[0].name ?? o.group });
    return fitNested(mm, y, groupLabels, o);
  }
  const { X: X0, columns, assign, model } = mm, n = X0.length;
  if (y.length !== n || groupLabels.length !== n) throw new Error(`${y.length} responses and ${groupLabels.length} group labels for ${n} rows`);
  const noise = o.distribution ?? 'poisson', distribution = noise === 'bernoulli' ? 'binomial' : noise;
  if (!['poisson', 'binomial', 'negbin'].includes(distribution)) throw new Error(`random effects are available for Poisson and negative binomial counts, binomial proportions and pass/fail results, not ${noise}${noise.startsWith('quasi') ? ': a quasi model has no likelihood to integrate over the random effect (for counts that vary more than Poisson within groups, use the negative binomial)' : ''}`);
  const link = o.link ?? canonicalLink(distribution), nb = distribution === 'negbin';
  const famOf = nb ? (() => { const c = new Map(); return (th) => { if (!c.has(th)) { if (c.size > 64) c.clear(); c.set(th, family('negbin', link, th)); } return c.get(th); }; })() : () => family(distribution, link);
  const nAGQ = o.nAGQ ?? 25;
  if (!(Number.isInteger(nAGQ) && nAGQ >= 1 && nAGQ <= 50)) throw new Error('nAGQ must be a whole number from 1 (Laplace) to 50');
  const w = o.weights ?? y.map(() => 1), off = o.offset ?? y.map(() => 0);
  const groups = indexGroups(groupLabels), gname = o.group ?? 'group';
  if (groups.m < 2) throw new Error(`a random ${gname} effect needs at least two ${gname}s`);
  if (groups.m >= n) throw new Error(`every row is its own ${gname}: a random ${gname} effect needs ${gname}s of more than one run`);
  const warnings = [];
  if (groups.m < 5) warnings.push(`σ is estimated from only ${groups.m} ${gname}s, so it is uncertain (and the tests that rest on it are rough)`);
  // the estimable columns (as glm.fit)
  const f = qr(X0, { tol: 1e-11 }), keep = columns.map((_, j) => j).filter(j => !f.aliased.includes(j));
  const X = X0.map(r => keep.map(j => r[j])), p = keep.length;
  const glm = fitGLM({ ...mm, X, columns: keep.map(j => columns[j]), assign: keep.map(j => assign[j]) }, y, { distribution, link, weights: w, offset: off });
  // the parameters: β, σ, and for the negative binomial log θ (its likelihood is integrated over the random effect for each θ)
  const data = { X, y, w, off, groups, fam: famOf(glm.theta), nodes: nAGQ === 1 ? [{ t: 0, w: Math.sqrt(Math.PI) }] : gaussHermite(nAGQ) };
  const dataAt = (th) => (nb ? { ...data, fam: famOf(Math.exp(th[p + 1])) } : data);
  let zs = null;
  const negll = (th) => { const r = loglik(dataAt(th), th.slice(0, p), th[p], zs); return -r.ll; };
  // start: the GLM's β (and θ), and the best σ on a coarse grid
  let th = [...glm.coef, 0.3, ...(nb ? [Math.log(glm.theta)] : [])];
  { let best = Infinity; for (const s of [0.05, 0.15, 0.3, 0.6, 1, 1.6, 2.5]) { const v = negll([...glm.coef, s, ...th.slice(p + 1)]); if (v < best) { best = v; th[p] = s; } } }
  let converged = false, it = 0, Hlast = null;
  const steps = () => th.map((v, j) => 1e-4 * Math.max(j === p ? 0.1 : 0.5, Math.abs(v)));
  for (it = 1; it <= 60; it++) {
    zs = loglik(dataAt(th), th.slice(0, p), th[p]).modes;
    const { f0, g, H } = hessian(negll, th, steps());
    Hlast = H;
    let d = solveSPD(H, g.map(v => -v));
    if (!d) d = g.map(v => -v * 1e-2);
    // step halving on −log L
    let t = 1, next, fn;
    for (let k = 0; k < 40; k++) { next = th.map((v, j) => v + t * d[j]); fn = negll(next); if (fn <= f0 + 1e-12) break; t /= 2; }
    const change = Math.max(...d.map((v, j) => Math.abs(t * v) / (1 + Math.abs(th[j]))));
    if (!(fn <= f0 + 1e-12)) { converged = Math.max(...g.map(Math.abs)) < 1e-4; break; }
    th = next;
    if (change < 1e-8 || f0 - fn < 1e-12 * (1 + Math.abs(f0))) { converged = true; break; }
  }
  if (!converged) warnings.push(`the fit did not converge in ${it} iterations`);
  // the boundary: σ = 0 (the likelihood is even in σ)
  let sigma = Math.abs(th[p]), beta = th.slice(0, p), boundary = false, lth = th.slice(p + 1);
  const atGLM = [...glm.coef, 0, ...(nb ? [Math.log(glm.theta)] : [])];
  if (sigma < 1e-4) {
    const at0 = negll(atGLM), here = negll(th);
    if (at0 <= here + 1e-7) { boundary = true; sigma = 0; beta = glm.coef.slice(); lth = atGLM.slice(p + 1); }
  }
  th = [...beta, sigma, ...lth];
  const theta = nb ? Math.exp(lth[0]) : undefined, fam = famOf(theta);
  const final = loglik(dataAt(th), beta, sigma);
  // covariance: the β-block of the inverse Hessian of −log L over (σ, β); the GLM's at the boundary
  let covK, sigmaSE = NaN, thetaSE = nb && boundary ? glm.thetaSE : undefined;
  if (boundary) covK = glm.cov;
  else {
    zs = final.modes;
    const { H } = hessian(negll, th, steps());
    const L = chol(H.map((r, i) => r.map((v, j) => (v + H[j][i]) / 2))).L, V = cholInverse(L);
    covK = V.slice(0, p).map(r => r.slice(0, p));
    sigmaSE = Math.sqrt(V[p][p]);
    if (nb) thetaSE = theta * Math.sqrt(V[p + 1][p + 1]);
  }
  if (nb && theta > 1e3) warnings.push(`θ is very large (${theta.toPrecision(3)}): the counts vary no more than Poisson within ${gname}s, so the Poisson model with the random ${gname} effect is the simpler choice`);
  // the group-level columns (constant within every group) and the small-sample scaling for them
  const level = columns.map((_, j) => keep.includes(j) && groups.rows.every(I => I.every(i => X0[i][j] === X0[I[0]][j])));
  const q = level.filter(Boolean).length, dfG = groups.m - q;
  const kG = !boundary && dfG >= 1 ? groups.m / dfG : 1;
  if (!boundary && dfG < 1) warnings.push(`${q} coefficients vary only between ${gname}s and there are ${groups.m} ${gname}s: nothing is left to test them against`);
  const scale = columns.map((_, j) => (level[j] && !boundary ? Math.sqrt(kG) : 1));
  const coef = columns.map(() => NaN), covW = columns.map(() => columns.map(() => NaN));
  keep.forEach((j, a) => { coef[j] = beta[a]; keep.forEach((k, b) => { covW[j][k] = covK[a][b]; }); });
  const cov = covW.map((r, i) => r.map((v, j) => v * scale[i] * scale[j]));
  const seWald = coef.map((b, j) => (Number.isNaN(b) ? NaN : Math.sqrt(covW[j][j])));
  const se = coef.map((b, j) => (Number.isNaN(b) ? NaN : Math.sqrt(cov[j][j])));
  const df = columns.map((_, j) => (level[j] && !boundary ? (dfG >= 1 ? dfG : NaN) : Infinity));
  const z = coef.map((b, j) => b / se[j]);
  const pv = z.map((v, j) => (!Number.isFinite(v) ? NaN : df[j] === Infinity ? 2 * N.sf(Math.abs(v)) : Number.isFinite(df[j]) ? 2 * studentT.sf(Math.abs(v), df[j]) : NaN));
  // the group effects (conditional modes, on the link scale) and conditional fitted values
  const modes = final.modes.map(m => sigma * m);
  const eta = X.map((r, i) => r.reduce((s, v, j) => s + v * beta[j], off[i]) + modes[groups.idx[i]]);
  const mu = eta.map(e => fam.link.inv(e));
  const pearson = y.map((v, i) => (v - mu[i]) * Math.sqrt(w[i] / fam.variance(mu[i])));
  // σ = 0 against σ > 0: the likelihood ratio, referred to ½χ²₀ + ½χ²₁
  // overdispersion within groups (Poisson): Pearson χ² of the residuals at the conditional modes on
  // n − p − 1 df (σ counted), as the usual check for GLMMs; somewhat conservative, since the modes
  // are fitted
  let overdispersion = null;
  if (distribution === 'poisson' && n - p - 1 >= 1) {
    const X2 = sum(pearson.map(r => r * r)), df = n - p - 1, ratio = X2 / df, pv = chi2.sf(X2, df);
    overdispersion = { pearson: X2, df, ratio, p: pv, detected: ratio > 1.5 && pv < 0.05 };
    if (overdispersion.detected) warnings.push(`overdispersion within ${gname}s: Pearson χ²/df = ${ratio.toFixed(2)} (p = ${pv < 1e-4 ? pv.toExponential(1) : pv.toFixed(4)}); the negative binomial with the random ${gname} effect allows for it`);
  }
  const ll0 = -negll(atGLM), lr = Math.max(0, 2 * (final.ll - ll0));
  const k = p + 1 + (nb ? 1 : 0);
  return {
    kind: 'glmm', model, columns, assign, n, rank: p, aliased: f.aliased.map(j => columns[j]),
    noise, distribution, link, nAGQ, group: gname, ...(nb ? { theta, thetaSE } : {}),
    groups: { names: groups.names, m: groups.m, labels: groupLabels.map(String) },
    coef, se, cov, z, p: pv, df, statistic: 'z', seWald, covWald: covW, sigma, sigmaSE, boundary,
    groupLevel: columns.filter((_, j) => level[j]), dfGroups: dfG, smallSample: kG,
    sigmaTest: { chi2: lr, df: 1, p: lr > 0 ? 0.5 * chi2.sf(lr, 1) : 1 },
    modes: Object.fromEntries(groups.names.map((g, i) => [g, modes[i]])),
    // the same, as the list every fit has (one entry here; outermost first for nested fits)
    randoms: [{ name: gname, m: groups.m, sigma, sigmaSE, boundary, test: { chi2: lr, df: 1, p: lr > 0 ? 0.5 * chi2.sf(lr, 1) : 1 },
      modes: Object.fromEntries(groups.names.map((g, i) => [g, modes[i]])), coefficients: columns.filter((_, j) => level[j] && !boundary), df: boundary ? undefined : dfG, smallSample: kG, labels: groupLabels.map(String) }],
    loglik: final.ll, k, aic: -2 * final.ll + 2 * k, deviance: -2 * final.ll,
    fitted: mu, linear: eta, residuals: y.map((v, i) => v - mu[i]), pearson, overdispersion,
    converged, iter: it, warnings, glm,
    X0, y, weights: w, offset: off, dfRes: n - p - 1,
  };
}

// ---------------------------------------------------------------- nested random intercepts (issue #78)
//
//   η_i = x_iβ + o_i + Σ_k σ_k u_{k, g_k(i)},   u ~ N(0, I)
//
// for groupings k = 1 … K, each nested in the one before (whole plots within blocks, plates within
// runs within days). The likelihood factorises over the outermost groups; within one, the integral
// over all its random effects (one for the group, one for each group of every inner grouping in it)
// is by the Laplace approximation, as lme4::glmer does for several random effects: h(u) = Σ log f −
// |u|²/2 at its mode û (Fisher scoring), and log ∫ ≈ h(û) − ½ log det H, H = I + Λ Zᵀ W Z Λ with the
// Fisher weights W at û. (Adaptive quadrature stays for one random effect, as in lme4.)
//
// Small-sample correction, per stratum: each coefficient belongs to the outermost grouping (among
// those whose σ is not 0) within whose groups it is constant, or to the runs. Stratum t of the active
// groupings has u_t units (its groups, less those of the grouping outside it: whole plots within
// blocks) and q_t coefficients; those coefficients get standard errors × √(u_t/(u_t − q_t)) and t
// on u_t − q_t df, and likelihood-ratio tests of terms in the stratum F on that df — for one random
// effect, the m − q above. σ_k = 0 is tested by dropping grouping k (σ re-estimated in the others),
// against ½χ²₀ + ½χ²₁.

/** The Laplace log-likelihood of (β, σ_1 … σ_K) for nested groupings, and the modes per cluster. */
function loglikNested(data, beta, sigmas, uStart) {
  const { X, y, w, off, fam, clusters } = data, L = fam.link, K = sigmas.length;
  const eta0 = X.map((r, i) => { let s = off[i]; for (let j = 0; j < r.length; j++) s += r[j] * beta[j]; return s; });
  let ll = 0;
  const modes = new Array(clusters.length);
  for (let c = 0; c < clusters.length; c++) {
    const { rows, r, eff } = clusters[c];     // eff[a][k]: the local index of row rows[a]'s effect at grouping k
    let u = uStart?.[c] ? uStart[c].slice() : new Array(r).fill(0);
    const etaAt = (a, uu) => { let e = eta0[rows[a]]; for (let k = 0; k < K; k++) e += sigmas[k] * uu[eff[a][k]]; return e; };
    const h = (uu) => { let s = 0; for (const v of uu) s -= v * v / 2; for (let a = 0; a < rows.length; a++) { const i = rows[a]; s += logf(fam, y[i], L.inv(etaAt(a, uu)), w[i]); } return s; };
    const curvature = (uu) => {
      const H = Array.from({ length: r }, (_, i) => Array.from({ length: r }, (__, j) => (i === j ? 1 : 0))), g = uu.map(v => -v);
      for (let a = 0; a < rows.length; a++) {
        const i = rows[a], e = etaAt(a, uu), mu = L.inv(e), d = L.deriv(e), v = fam.variance(mu), Wt = w[i] * d * d / v, sc = w[i] * (y[i] - mu) * d / v;
        for (let k = 0; k < K; k++) {
          const x = eff[a][k]; g[x] += sigmas[k] * sc;
          for (let l = 0; l < K; l++) H[x][eff[a][l]] += Wt * sigmas[k] * sigmas[l];
        }
      }
      return { H, g };
    };
    let hu = h(u);
    for (let it = 0; it < 100; it++) {
      const { H, g } = curvature(u);
      const step = solveSPD(H, g);
      if (!step || !step.every(Number.isFinite)) break;
      let t = 1, un = u.map((v, j) => v + step[j]), hn = h(un);
      for (let k = 0; k < 30 && !(hn >= hu - 1e-12); k++) { t /= 2; un = u.map((v, j) => v + t * step[j]); hn = h(un); }
      const done = Math.max(...step.map((v, j) => Math.abs(t * v) / (1 + Math.abs(u[j])))) < 1e-10;
      u = un; hu = hn;
      if (done) break;
    }
    const { H } = curvature(u);
    const Lc = chol(H).L;
    let ld = 0; for (let j = 0; j < r; j++) ld += 2 * Math.log(Lc[j][j]);
    ll += hu - ld / 2;
    modes[c] = u;
  }
  return { ll, modes };
}

/** Nested groupings → clusters (by the outermost), with each row's local effect indices. Throws if not nested. */
function nestClusters(levels, n) {
  const idx = levels.map(l => indexGroups(l.labels));
  // nesting: each group of grouping k lies within one group of grouping k − 1
  for (let k = 1; k < levels.length; k++) {
    const outer = new Map();
    for (let i = 0; i < n; i++) {
      const g = idx[k].idx[i], o = idx[k - 1].idx[i];
      if (outer.has(g) && outer.get(g) !== o) throw new Error(`the ${levels[k].name}s are not nested within the ${levels[k - 1].name}s (${levels[k].name} ${idx[k].names[g]} is in more than one ${levels[k - 1].name}): crossed random effects are not available`);
      outer.set(g, o);
    }
    if (idx[k].m <= idx[k - 1].m) throw new Error(`each ${levels[k - 1].name} has only one ${levels[k].name}: the two random effects cannot be told apart`);
  }
  const clusters = idx[0].rows.map(rows => {
    const local = new Map(), key = (k, g) => `${k}:${g}`, at = (k, g) => { if (!local.has(key(k, g))) local.set(key(k, g), local.size); return local.get(key(k, g)); };
    const eff = rows.map(i => levels.map((_, k) => at(k, idx[k].idx[i])));
    return { rows, r: local.size, eff, local };
  });
  return { idx, clusters };
}

function fitNested(mm, y, levels, o) {
  const { X: X0, columns, assign, model } = mm, n = X0.length, K = levels.length;
  for (const l of levels) if (l.labels.length !== n) throw new Error(`${l.labels.length} ${l.name} labels for ${n} rows`);
  const noise = o.distribution ?? 'poisson', distribution = noise === 'bernoulli' ? 'binomial' : noise;
  if (!['poisson', 'binomial', 'negbin'].includes(distribution)) throw new Error(`random effects are available for Poisson and negative binomial counts, binomial proportions and pass/fail results, not ${noise}`);
  const nAGQ = o.nAGQ ?? 1;
  if (nAGQ !== 1) throw new Error('adaptive quadrature (nAGQ > 1) is for one random effect; with several, the fit is by the Laplace approximation (nAGQ 1), as lme4::glmer');
  const link = o.link ?? canonicalLink(distribution), nb = distribution === 'negbin';
  const famOf = nb ? (() => { const c = new Map(); return (th) => { if (!c.has(th)) { if (c.size > 64) c.clear(); c.set(th, family('negbin', link, th)); } return c.get(th); }; })() : () => family(distribution, link);
  const w = o.weights ?? y.map(() => 1), off = o.offset ?? y.map(() => 0);
  const { idx, clusters } = nestClusters(levels, n);
  const names = levels.map(l => l.name), gname = names.join(' / ');
  idx.forEach((g, k) => { if (g.m < 2) throw new Error(`a random ${names[k]} effect needs at least two ${names[k]}s`); });
  if (idx[K - 1].m >= n) throw new Error(`every row is its own ${names[K - 1]}: a random ${names[K - 1]} effect needs ${names[K - 1]}s of more than one row`);
  const warnings = [];
  if (idx[0].m < 5) warnings.push(`the ${names[0]} σ is estimated from only ${idx[0].m} ${names[0]}s, so it is uncertain (and the tests that rest on it are rough)`);
  const f = qr(X0, { tol: 1e-11 }), keep = columns.map((_, j) => j).filter(j => !f.aliased.includes(j));
  const X = X0.map(r => keep.map(j => r[j])), p = keep.length;
  const glm = fitGLM({ ...mm, X, columns: keep.map(j => columns[j]), assign: keep.map(j => assign[j]) }, y, { distribution, link, weights: w, offset: off });
  const data = { X, y, w, off, clusters, fam: famOf(glm.theta) };
  const dataAt = (th) => (nb ? { ...data, fam: famOf(Math.exp(th[p + K])) } : data);
  let us = null;
  const negll = (th) => -loglikNested(dataAt(th), th.slice(0, p), th.slice(p, p + K), us).ll;
  // start: the GLM's β (and θ); each σ from a coarse grid, the others at 0.3
  let th = [...glm.coef, ...levels.map(() => 0.3), ...(nb ? [Math.log(glm.theta)] : [])];
  for (let k = 0; k < K; k++) {
    let best = Infinity, bs = 0.3;
    for (const s of [0.05, 0.15, 0.3, 0.6, 1, 1.6]) { const t2 = th.slice(); t2[p + k] = s; const v = negll(t2); if (v < best) { best = v; bs = s; } }
    th[p + k] = bs;
  }
  const steps = () => th.map((v, j) => 1e-4 * Math.max(j >= p && j < p + K ? 0.1 : 0.5, Math.abs(v)));
  let converged = false, it = 0;
  for (it = 1; it <= 80; it++) {
    us = loglikNested(dataAt(th), th.slice(0, p), th.slice(p, p + K)).modes;
    const { f0, g, H } = hessian(negll, th, steps());
    let d = solveSPD(H, g.map(v => -v));
    if (!d) d = g.map(v => -v * 1e-2);
    let t = 1, next, fn;
    for (let k = 0; k < 40; k++) { next = th.map((v, j) => v + t * d[j]); fn = negll(next); if (fn <= f0 + 1e-12) break; t /= 2; }
    const change = Math.max(...d.map((v, j) => Math.abs(t * v) / (1 + Math.abs(th[j]))));
    if (!(fn <= f0 + 1e-12)) { converged = Math.max(...g.map(Math.abs)) < 1e-4; break; }
    th = next;
    if (change < 1e-8 || f0 - fn < 1e-12 * (1 + Math.abs(f0))) { converged = true; break; }
  }
  if (!converged) warnings.push(`the fit did not converge in ${it} iterations`);
  // σ's at the boundary (each likelihood is even in its σ): set to 0 when that is no worse
  for (let k = 0; k < K; k++) th[p + k] = Math.abs(th[p + k]);
  const zero = levels.map(() => false);
  for (let k = 0; k < K; k++) if (th[p + k] < 1e-4) { const t0 = th.slice(); t0[p + k] = 0; if (negll(t0) <= negll(th) + 1e-7) { th = t0; zero[k] = true; } }
  const beta = th.slice(0, p), sigmas = th.slice(p, p + K), theta = nb ? Math.exp(th[p + K]) : undefined, fam = famOf(theta);
  us = null;
  const final = loglikNested(dataAt(th), beta, sigmas);
  // covariance: the inverse Hessian over the free parameters (σ's at 0 held there)
  const free = th.map((_, j) => j).filter(j => !(j >= p && j < p + K && zero[j - p]));
  let covK, sigmaSE = levels.map(() => NaN), thetaSE;
  if (zero.every(Boolean)) { covK = glm.cov; thetaSE = nb ? glm.thetaSE : undefined; }
  else {
    us = final.modes;
    const sub = (x) => { const t2 = th.slice(); free.forEach((j, a) => { t2[j] = x[a]; }); return negll(t2); };
    const st = steps();
    const { H } = hessian(sub, free.map(j => th[j]), free.map(j => st[j]));
    const V = cholInverse(chol(H.map((r, i) => r.map((v, j) => (v + H[j][i]) / 2))).L);
    covK = V.slice(0, p).map(r => r.slice(0, p));
    free.forEach((j, a) => { if (j >= p && j < p + K) sigmaSE[j - p] = Math.sqrt(V[a][a]); if (nb && j === p + K) thetaSE = theta * Math.sqrt(V[a][a]); });
    us = null;
  }
  if (nb && theta > 1e3) warnings.push(`θ is very large (${theta.toPrecision(3)}): the counts vary no more than Poisson within ${names[K - 1]}s, so the Poisson model is the simpler choice`);
  // strata: the active groupings, outermost first
  const active = levels.map((_, k) => k).filter(k => !zero[k]);
  const constantIn = (k, j) => idx[k].rows.every(I => I.every(i => X0[i][j] === X0[I[0]][j]));
  const levelOf = columns.map((_, j) => (keep.includes(j) ? active.find(k => constantIn(k, j)) : undefined));
  const strata = active.map((k, t) => {
    const units = idx[k].m - (t ? idx[active[t - 1]].m : 0), q = columns.filter((_, j) => levelOf[j] === k).length, dfS = units - q;
    if (dfS < 1) warnings.push(`${q} coefficients vary only between ${names[k]}s${t ? ` within ${names[active[t - 1]]}s` : ''}, and there are ${units} such ${names[k]}s: nothing is left to test them against`);
    return { k, units, q, df: dfS, scale: dfS >= 1 ? units / dfS : 1 };
  });
  const stratumOf = (j) => strata.find(st => st.k === levelOf[j]);
  const scale = columns.map((_, j) => (stratumOf(j) ? Math.sqrt(stratumOf(j).scale) : 1));
  const coef = columns.map(() => NaN), covW = columns.map(() => columns.map(() => NaN));
  keep.forEach((j, a) => { coef[j] = beta[a]; keep.forEach((k, b) => { covW[j][k] = covK[a][b]; }); });
  const cov = covW.map((r, i) => r.map((v, j) => v * scale[i] * scale[j]));
  const seWald = coef.map((b, j) => (Number.isNaN(b) ? NaN : Math.sqrt(covW[j][j])));
  const se = coef.map((b, j) => (Number.isNaN(b) ? NaN : Math.sqrt(cov[j][j])));
  const df = columns.map((_, j) => (stratumOf(j) ? (stratumOf(j).df >= 1 ? stratumOf(j).df : NaN) : Infinity));
  const z = coef.map((b, j) => b / se[j]);
  const pv = z.map((v, j) => (!Number.isFinite(v) ? NaN : df[j] === Infinity ? 2 * N.sf(Math.abs(v)) : Number.isFinite(df[j]) ? 2 * studentT.sf(Math.abs(v), df[j]) : NaN));
  // the effects of each grouping's groups (σ_k û, link scale), and the conditional fitted values
  const modes = levels.map((_, k) => Object.fromEntries(idx[k].names.map((nm, g) => {
    const c = clusters.findIndex(cl => cl.local.has(`${k}:${g}`));
    return [nm, sigmas[k] * final.modes[c][clusters[c].local.get(`${k}:${g}`)]];
  })));
  const eta = X.map((r, i) => r.reduce((s, v, j) => s + v * beta[j], off[i]) + levels.reduce((s, _, k) => s + modes[k][idx[k].names[idx[k].idx[i]]], 0));
  const mu = eta.map(e => fam.link.inv(e));
  const pearson = y.map((v, i) => (v - mu[i]) * Math.sqrt(w[i] / fam.variance(mu[i])));
  let overdispersion = null;
  if (distribution === 'poisson' && n - p - K >= 1) {
    const X2 = sum(pearson.map(r => r * r)), dfo = n - p - K, ratio = X2 / dfo, po = chi2.sf(X2, dfo);
    overdispersion = { pearson: X2, df: dfo, ratio, p: po, detected: ratio > 1.5 && po < 0.05 };
    if (overdispersion.detected) warnings.push(`overdispersion within ${names[K - 1]}s: Pearson χ²/df = ${ratio.toFixed(2)} (p = ${po < 1e-4 ? po.toExponential(1) : po.toFixed(4)}); the negative binomial allows for it`);
  }
  // σ_k = 0: the fit without grouping k (the others re-estimated), ½χ²₀ + ½χ²₁
  const tests = levels.map((_, k) => {
    if (o.sigmaTests === false) return null;
    if (zero[k]) return { chi2: 0, df: 1, p: 1 };
    const rest = levels.filter((__, l) => l !== k);
    const without = fitGLMM({ ...mm, X: X0 }, y, rest, { distribution: noise, link, weights: w, offset: off, nAGQ: 1, group: rest.length === 1 ? rest[0].name : undefined, sigmaTests: false });
    const lr = Math.max(0, 2 * (final.ll - without.loglik));
    return { chi2: lr, df: 1, p: lr > 0 ? 0.5 * chi2.sf(lr, 1) : 1 };
  });
  const k = p + K + (nb ? 1 : 0);
  const randoms = levels.map((l, kk) => {
    const st = strata.find(x => x.k === kk);
    return { name: l.name, m: idx[kk].m, sigma: sigmas[kk], sigmaSE: sigmaSE[kk], boundary: zero[kk], test: tests[kk], modes: modes[kk],
      coefficients: columns.filter((_, j) => levelOf[j] === kk), ...(st ? { df: st.df, units: st.units, smallSample: st.scale } : { smallSample: 1 }), labels: l.labels.map(String) };
  });
  return {
    kind: 'glmm', model, columns, assign, n, rank: p, aliased: f.aliased.map(j => columns[j]),
    noise, distribution, link, nAGQ: 1, group: gname, ...(nb ? { theta, thetaSE } : {}),
    coef, se, cov, z, p: pv, df, statistic: 'z', seWald, covWald: covW, randoms,
    boundary: zero.every(Boolean), groupLevel: columns.filter((_, j) => levelOf[j] !== undefined),
    loglik: final.ll, k, aic: -2 * final.ll + 2 * k, deviance: -2 * final.ll,
    fitted: mu, linear: eta, residuals: y.map((v, i) => v - mu[i]), pearson, overdispersion,
    converged, iter: it, warnings, glm,
    X0, y, weights: w, offset: off, dfRes: n - p - K,
  };
}

// ---------------------------------------------------------------- tests

/** The same GLMM with only the model-matrix columns cols (indices): its log-likelihood and rank. */
function refit(fit, cols) {
  const mm = { X: fit.X0.map(r => cols.map(j => r[j])), columns: cols.map(j => fit.columns[j]), assign: cols.map(j => fit.assign[j]), model: fit.model };
  if (!cols.length) mm.X = fit.X0.map(() => []);
  const groups = fit.randoms.length > 1 ? fit.randoms.map(r => ({ name: r.name, labels: r.labels })) : fit.groups.labels;
  const r = cols.length ? fitGLMM(mm, fit.y, groups, { distribution: fit.noise, link: fit.link, weights: fit.weights, offset: fit.offset, nAGQ: fit.nAGQ, group: fit.group, sigmaTests: false })
    : null;
  return r ? { loglik: r.loglik, rank: r.rank } : { loglik: NaN, rank: 0 };
}

const lrRow = (big, small) => { const df = big.rank - small.rank, x = Math.max(0, 2 * (big.loglik - small.loglik)); return { df, chi2: x, p: df > 0 ? chi2.sf(x, df) : NaN }; };
// a term whose columns all vary only between groups: F = χ²/df on (df, m − q) — the likelihood ratio
// re-estimates σ in each model, so it needs only the denominator df, not the √(m/(m − q)) scaling
// (with nested groupings: a term whose columns all belong to one stratum, F on that stratum's df)
const lrTerm = (fit, cols, big, small) => {
  const r = lrRow(big, small);
  if (!cols.length || cols.some(j => fit.df[j] === Infinity)) return r;
  const ddf = fit.df[cols[0]];
  if (!cols.every(j => Object.is(fit.df[j], ddf))) return r;
  const F = r.chi2 / r.df;
  return { ...r, F, ddf, p: ddf >= 1 && r.df > 0 ? fDist.sf(F, r.df, ddf) : NaN };
};

/**
 * Likelihood-ratio tests of a GLMM's terms (σ re-estimated in each model). type 1: sequential;
 * type 2: each term against the model without it and the terms containing it; type 3: against the
 * model without it. Rows { term, df, chi2, p }, and for terms that vary only between groups F and ddf
 * (the small-sample correction above; p from F).
 */
export function glmmTests(fit, type = 2) {
  if (![1, 2, 3].includes(type)) throw new Error('the type of test must be 1, 2 or 3');
  const { model, assign } = fit, rows = [];
  const all = fit.columns.map((_, j) => j).filter(j => !fit.aliased.includes(fit.columns[j]));
  const colsOf = (ti) => all.filter(j => assign[j] === ti);
  const whole = { loglik: fit.loglik, rank: fit.rank };
  if (type === 1) {
    let cols = all.filter(j => assign[j] === -1), prev = refit(fit, cols);
    model.terms.forEach((t, ti) => {
      cols = cols.concat(colsOf(ti));
      const cur = cols.length === all.length ? whole : refit(fit, cols);
      if (cur.rank > prev.rank && !t.block) rows.push({ term: t.label, ...lrTerm(fit, colsOf(ti), cur, prev) });
      prev = cur;
    });
    return rows;
  }
  model.terms.forEach((t, ti) => {
    if (t.block || !colsOf(ti).length) return;
    const base = type === 2
      ? all.filter(j => { const a = assign[j]; return a === -1 || (a !== ti && !containedIn(t, model.terms[a])); })
      : all.filter(j => assign[j] !== ti);
    const r0 = refit(fit, base), r1 = type === 3 || base.length + colsOf(ti).length === all.length ? whole : refit(fit, base.concat(colsOf(ti)));
    rows.push({ term: t.label, ...lrTerm(fit, colsOf(ti), r1, r0) });
  });
  return rows;
}

/**
 * The test of dropping one term from a GLMM: big the fit with it, small the refit without it (σ
 * re-estimated). As glmmTests: χ² on df, or F = χ²/df on (df, m − q) when the term's columns vary
 * only between groups (and big's σ is not 0). A term with no estimable columns has df 0 and p 1.
 */
export function glmmDropTest(big, small, term) {
  const ti = big.model.terms.findIndex(t => t.label === term);
  if (ti < 0) throw new Error(`${term} is not a term of the model`);
  const cols = big.columns.map((_, j) => j).filter(j => big.assign[j] === ti && !big.aliased.includes(big.columns[j]));
  if (!cols.length) return { df: 0, chi2: 0, p: 1 };
  return lrTerm(big, cols, big, small);
}

/** Likelihood-ratio test of nested GLMM fits (small without some of big's terms): { df, chi2, p }. */
export function glmmCompare(big, small) {
  const r = lrRow(big, small);
  return { df: r.df, chi2: r.chi2, F: NaN, p: r.df > 0 ? r.p : 1 };
}

// ---------------------------------------------------------------- predictions

/**
 * Predictions at model-matrix rows X (offset 0: per unit exposure). fit, lower, upper: the mean for
 * a typical group (its random effect 0), with the interval transformed from the link scale.
 * marginal: the mean averaged over groups, E[g⁻¹(xβ + σZ)]. predLower, predUpper: the interval for
 * one new run (exposure, trials) in a new group — the group's effect integrated with the fit's
 * uncertainty — or, with group: 'same', in a group like the typical one.
 */
export function glmmPredict(fit, X, { level = 0.95, exposure = 1, trials, n = 1, group = 'new' } = {}) {
  const L = LINKS[fit.link], nodes = gaussHermite(30), zq = N.ppf(1 - (1 - level) / 2);
  // with the small-sample correction: t on the groups' df (every prediction involves the intercept)
  // (nested groupings: the outermost stratum with variation, where the intercept is judged)
  const top = fit.randoms.find(r => !r.boundary);
  const corrected = !!top && top.smallSample > 1 && top.df >= 1;
  const c = corrected ? studentT.ppf(1 - (1 - level) / 2, top.df) : zq;
  const s2all = sum(fit.randoms.map(r => r.sigma ** 2)), s2new = sum(fit.randoms.map(r => r.sigma ** 2 * (r.boundary ? 1 : r.smallSample)));
  const asGlm = { link: fit.link, distribution: fit.distribution, dispersionEstimated: false, dispersion: 1, weights: fit.weights, theta: fit.theta, thetaSE: fit.thetaSE };
  return X.map(x => {
    let e = 0, v = 0;
    for (let i = 0; i < x.length; i++) {
      if (Number.isNaN(fit.coef[i])) continue;
      e += x[i] * fit.coef[i];
      for (let j = 0; j < x.length; j++) if (!Number.isNaN(fit.coef[j])) v += x[i] * fit.cov[i][j] * x[j];
    }
    const s = Math.sqrt(v), m = L.inv(e);
    const marginal = s2all > 0 ? sum(nodes.map(({ t, w }) => w * L.inv(e + Math.SQRT2 * Math.sqrt(s2all) * t))) / Math.sqrt(Math.PI) : m;
    const sPred = Math.sqrt(v + (group === 'new' ? s2new : 0)) * c / zq;
    const pi = predictiveInterval(asGlm, e, sPred, { level, exposure, trials, n });
    return { fit: m, se: s * Math.abs(L.deriv(e)), lower: L.inv(e - c * s), upper: L.inv(e + c * s), marginal, predLower: pi.lower, predUpper: pi.upper, link: e, seLink: s };
  });
}

/**
 * The interval of each coefficient, with rate or odds ratios: Wald (z, as lme4's confint method
 * "Wald") for coefficients that vary within groups; for group-level ones, t on the groups' df with
 * the scaled standard error (the small-sample correction).
 */
export function glmmConfint(fit, { level = 0.95 } = {}) {
  const ratio = fit.link === 'log' || fit.link === 'logit';
  return fit.columns.map((name, j) => ({ name, j })).filter(c => !Number.isNaN(fit.coef[c.j])).map(({ name, j }) => {
    const df = fit.df[j], q = df === Infinity ? N.ppf(1 - (1 - level) / 2) : studentT.ppf(1 - (1 - level) / 2, df);
    const b = fit.coef[j], lower = b - q * fit.se[j], upper = b + q * fit.se[j];
    return { name, estimate: b, lower, upper, df, method: df === Infinity ? 'wald' : 'wald-t', ...(ratio ? { ratio: { estimate: Math.exp(b), lower: Math.exp(lower), upper: Math.exp(upper) } } : {}) };
  });
}

// ---------------------------------------------------------------- studies

// the groupings a random intercept can be for; run: the repeated observations of one run (plates,
// fields), a grouping of the observations rather than of the design's runs
const GROUPINGS = { block: { name: 'block', label: (run) => run.block }, wholePlot: { name: 'whole plot', label: (run) => run.wholePlot }, run: { name: 'run', label: (run) => run.run, observations: true } };

/**
 * The groupings a count or proportion response's random intercepts are for, outermost first:
 * requested 'auto' — the whole plots of a split-plot design, else null (blocks are fixed unless
 * asked for: a random block effect needs enough blocks to estimate σ) — or one or more of 'block',
 * 'wholePlot' and 'run' (an array, or a comma list), each nested in the one before. Returns
 * [{ id, name, m (groups) }] or null; throws when a grouping asked for is not in the design, or the
 * groupings are crossed rather than nested.
 */
export function randomGroupsOf(study, requested = 'auto') {
  const runs = (study.design?.runs ?? []).filter(r => r.kind !== 'confirm');
  const auto = requested === 'auto';
  const ids = auto ? ['wholePlot'] : (Array.isArray(requested) ? requested : String(requested).split(',')).map(x => x.trim()).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new Error(`a random effect is asked for twice (${ids.join(', ')})`);
  const out = [];
  for (const id of ids) {
    const G = GROUPINGS[id];
    if (!G) throw new Error(`unknown random effect "${id}" for counts and proportions (use block, wholePlot or run)`);
    if (G.observations) {
      const per = new Map();
      for (const o of study.observations ?? []) if (o.value !== null && o.value !== undefined) { const k = `${o.response}\u0000${o.run}`; per.set(k, (per.get(k) ?? 0) + 1); }
      const ok = [...per.values()].some(v => v > 1);
      if (ok) { out.push({ id, name: G.name, m: new Set([...per.keys()].map(k => k.split('\u0000')[1])).size }); continue; }
      if (!auto) throw new Error('random runs: no run has more than one observation (several plates or fields per run)');
      continue;
    }
    const labels = runs.map(G.label);
    const m = new Set(labels.map(String)).size;
    if (labels.every(l => l !== undefined) && m >= 2 && m < runs.length) { out.push({ id, name: G.name, m }); continue; }
    if (!auto) throw new Error(id === 'block' ? 'random blocks: the design needs at least two blocks, each of more than one run' : 'random whole plots: the design has no whole plots of more than one run');
  }
  if (!out.length) return null;
  // outermost first (fewest groups; runs innermost), and each nested in the one before
  out.sort((a, b) => (a.id === 'run') - (b.id === 'run') || a.m - b.m);
  for (let k = 1; k < out.length; k++) {
    if (out[k].id === 'run') continue;                       // a run lies in one block and one whole plot
    const outer = new Map(), G0 = GROUPINGS[out[k - 1].id], G1 = GROUPINGS[out[k].id];
    for (const r of runs) {
      const g = String(G1.label(r)), o = String(G0.label(r));
      if (outer.has(g) && outer.get(g) !== o) throw new Error(`the ${out[k].name}s are not nested within the ${out[k - 1].name}s (${out[k].name} ${g} is in more than one ${out[k - 1].name}): crossed random effects are not available`);
      outer.set(g, o);
    }
  }
  return out;
}

/**
 * The grouping (or groupings) of a count or proportion response's random intercept: as
 * randomGroupsOf, as one { id, name, m } — for several, id the comma list, name joined with ' / ',
 * and levels the list.
 */
export function randomGroupOf(study, requested = 'auto') {
  const L = randomGroupsOf(study, requested);
  if (!L) return null;
  if (L.length === 1) return L[0];
  return { id: L.map(x => x.id).join(','), name: L.map(x => x.name).join(' / '), m: L[L.length - 1].m, levels: L };
}

/**
 * A GLMM fit of a formula to a study's count or proportion response, with a random intercept for
 * its blocks, whole plots or runs, or several of them nested. opts: random ('auto', 'block',
 * 'wholePlot', 'run', or a list of them: randomGroupsOf), nAGQ, noise (a
 * distribution other than the response's), link, includeConfirm. A random block effect replaces the
 * fixed Block term; with whole plots, a fixed Block term stays when the design also has blocks.
 * Returns the fitGLMM result plus { response, model, factors, rows, random: { id, name, m } }.
 */
export function fitCountMixedModel(study, formula, opts = {}) {
  const parsed = parseFormula(formula, study.factors);
  const response = opts.response ?? parsed.response;
  if (!response) throw new Error('name the response: "y ~ …"');
  const noise = opts.noise ? noiseModel(opts.noise, { link: opts.link }) : noiseModelOf(study, response);
  if (noise.id === 'normal') throw new Error(`${response} is a measurement: its mixed model is the REML fit (fitMixedModel)`);
  const random = randomGroupOf(study, opts.random ?? 'auto');
  if (!random) throw new Error('no grouping for a random effect: the design has no whole plots (ask for random blocks if it has blocks)');
  const runs = new Map(study.design.runs.map(r => [r.run, r]));
  let rows = responseTable(study, response, { perObservation: true });
  if (!opts.includeConfirm) rows = rows.filter(r => r.kind !== 'confirm');
  if (!rows.length) throw new Error(`no results for ${response} yet`);
  const levels = random.levels ?? [random];
  const b = withBlockTerm(study, parsed, rows, { ...opts, ...(levels.some(l => l.id === 'block') ? { blocks: false } : {}) });
  const mm = modelMatrix(b.model, b.factors, b.rows.map(r => r.settings));
  const data = noise.prepare(b.rows);
  const labelsOf = (id) => b.rows.map(r => String(GROUPINGS[id].label(runs.get(r.run))));
  const groups = levels.length === 1 ? labelsOf(random.id) : levels.map(l => ({ name: l.name, labels: labelsOf(l.id) }));
  const fit = fitGLMM(mm, data.y, groups, { distribution: noise.id, link: noise.link.name, weights: data.weights, offset: data.offset, nAGQ: opts.nAGQ, group: random.name });
  return { ...fit, response, model: b.model, factors: b.factors, rows: b.rows, random };
}

/** Predictions of a fitCountMixedModel fit at settings (natural units): glmmPredict's rows. */
export function predictCountMixed(fit, settings, opts = {}) {
  return glmmPredict(fit, modelMatrix(fit.model, fit.factors, settings).X, opts);
}

/**
 * The log-likelihood that fitGLMM maximises, at given β (for the estimable columns, in order) and
 * σ: for checking the objective itself against another implementation's at its estimates.
 */
export function glmmLoglikAt(mm, y, groupLabels, o, beta, sigma) {
  const distribution = (o.distribution ?? 'poisson') === 'bernoulli' ? 'binomial' : (o.distribution ?? 'poisson');
  const fam = family(distribution, o.link ?? canonicalLink(distribution), o.theta), nAGQ = o.nAGQ ?? 25;
  const data = { X: mm.X, y, w: o.weights ?? y.map(() => 1), off: o.offset ?? y.map(() => 0), groups: indexGroups(groupLabels), fam,
    nodes: nAGQ === 1 ? [{ t: 0, w: Math.sqrt(Math.PI) }] : gaussHermite(nAGQ) };
  return loglik(data, beta, sigma).ll;
}

export const _gaussHermite = gaussHermite;
export { DISTRIBUTIONS };
