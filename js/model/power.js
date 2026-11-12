// Power of a design for the terms of a model (spec §6.4, issue #12).
//
// Each column of the model matrix X is given an anticipated coefficient b = Δ/2 (Δ: the change
// in the response from the low to the high setting, the "effect"; per term or for all), and σ is
// the run-to-run standard deviation. With V = (XᵀX)⁻¹ and S the columns of a term,
//
//   λ = bₛᵀ (V_SS)⁻¹ bₛ / σ²,   power = P(F'(|S|, N − rank, λ) > F_{1−α}(|S|, N − rank))
//
// for the term's F test ("effect power"), and the same with S = {j} for each coefficient's
// t test ("parameter power"; the two-sided t test with non-centrality b/(σ√V_jj) is exactly
// the F test with df1 = 1). This is the convention of skpr (effectsize = Δ/σ, default 2) and,
// for a single two-level factor, of the two-sample t test. Categorical factors use the effect
// coding of formula.js; b = Δ/2 on each of their columns.
//
// σ: give the process σ (from earlier data, or a measurement-system study when #17 lands);
// Δ and σ enter only through Δ/σ.
//
// The information XᵀX is that of normal noise; a noise model (noise.js, issue #64) can weight the
// runs by the information each carries at the anticipated mean (XᵀWX), as counts and proportions
// will need. For normal noise the weights are equal and nothing changes.
import { qr } from '../linalg.js';
import { fDist, ncf } from '../dist.js';
import { parseFormula, modelMatrix } from './formula.js';
import { decode } from '../study.js';
import { splitPlotInfo } from '../design/splitplot.js';
import { _containment as containment, _indexGroups as indexGroups } from './mixed.js';
import { noiseModel } from './noise.js';
import { family, LINKS, canonicalLink, fitGLM, glmCompare, DISTRIBUTIONS as GLM_DISTRIBUTIONS, _draw } from './glm.js';
import { chi2 as CHI2, ncChi2 } from '../dist.js';
import { rng } from '../design/rng.js';
import { withBlockTerm } from './fit.js';

/**
 * Power from a model matrix mm = { X, columns, assign, model } (formula.js).
 * opts: delta (number, or { termLabel: Δ } with default 2), sigma (1), alpha (0.05),
 * coef (optional anticipated coefficient per column, overriding Δ/2), noise (a noise model id,
 * default 'normal') and mean (the anticipated mean per run, for noise models whose information
 * depends on it).
 * Covariates (issue #82): rho, the correlation between the response and a covariate measured at
 * each run (for several, their multiple correlation R, with covariates their number): the residual
 * σ becomes σ√(1 − ρ²) and the residual df fall by the number of covariates — the power of the
 * analysis with the covariate in the model, when it is balanced against the factors (uncorrelated
 * with the model's columns; js/design/allocate.js arranges that for values known in advance).
 * Returns { n, rank, dfRes, terms: [{ term, df, lambda, power }], parameters: [{ name, term, lambda, power }] }.
 * Terms that are not estimable, nuisance (block) terms and, with dfRes = 0, everything get power NaN.
 */
export function powerFromMatrix(mm, { delta = 2, sigma: sigma0 = 1, alpha = 0.05, coef, wholePlot, eta = 1, noise = 'normal', mean, rho = 0, covariates = rho ? 1 : 0 } = {}) {
  const { columns, assign, model } = mm;
  if (!(sigma0 > 0)) throw new Error('σ must be positive');
  if (!(rho > -1 && rho < 1)) throw new Error('ρ must be between −1 and 1');
  if (rho && wholePlot) throw new Error('a covariate with a split-plot design: not yet (its effect on each stratum depends on where it varies)');
  const sigma = sigma0 * Math.sqrt(1 - rho * rho);
  if (!(alpha > 0 && alpha < 1)) throw new Error('α must be between 0 and 1');
  // rows weighted by their information (W^½ X), when the noise model's weights are not all equal
  const w = noiseModel(noise).weights(mm.X, { mean });
  const X = w ? mm.X.map((r, i) => r.map(v => v * Math.sqrt(w[i]))) : mm.X;
  const n = X.length, f = qr(X), rank = f.rank;
  let dfRes = n - rank - covariates, V = f.unscaledCov(), dfOf = () => dfRes, strata = null;
  const aliased = new Set(f.aliased);
  if (wholePlot) {
    // split-plot: GLS information Xᵀ V⁻¹ X with V = I + η Z Zᵀ (σ² units), and each term tested in
    // its stratum with the containment df (whole-plot terms against the whole-plot error)
    if (!(eta >= 0)) throw new Error('η must be ≥ 0');
    const keep = columns.map((_, j) => j).filter(j => !aliased.has(j));
    const Xk = X.map(r => keep.map(j => r[j]));
    const M = splitPlotInfo(Xk, wholePlot, eta);
    const Vk = solveSymMatrix(M);
    V = columns.map(() => columns.map(() => NaN));
    keep.forEach((i, a) => keep.forEach((j, b) => { V[i][j] = Vk[a][b]; }));
    const g = indexGroups(wholePlot);
    if (g.m >= 2 && g.m < n) {
      const c = containment(Xk, [g], [0]);
      const dfCol = new Map(keep.map((j, a) => [j, c.dfs[c.stratumOf[a]]]));
      dfOf = (S) => Math.min(...S.map(j => dfCol.get(j)));
      strata = [{ name: 'Whole plot', df: c.dfs[0] }, { name: 'Residual', df: c.dfs[1] }];
      dfRes = c.dfs[1];
    }
  }
  const deltaOf = (label) => (typeof delta === 'number' ? delta : delta[label] ?? delta.default ?? 2);
  const b = columns.map((_, j) => (coef ? coef[j] : assign[j] < 0 ? 0 : deltaOf(model.terms[assign[j]].label) / 2) / sigma);
  const pw = (S) => {
    const df2 = S.some(j => aliased.has(j)) ? 0 : dfOf(S);
    if (!(df2 >= 1) || S.some(j => aliased.has(j))) return { lambda: NaN, power: NaN, ddf: df2 };
    const bs = S.map(j => b[j]);
    // λ = bᵀ (V_SS)⁻¹ b via a small solve
    const A = S.map(i => S.map(j => V[i][j]));
    const x = solveSym(A, bs);
    const lambda = bs.reduce((s, v, i) => s + v * x[i], 0);
    const crit = fDist.isf(alpha, S.length, df2);
    return { lambda, ddf: df2, power: ncf.sf(crit, S.length, df2, lambda) };
  };
  const terms = model.terms.map((t, ti) => {
    const S = columns.map((_, j) => j).filter(j => assign[j] === ti);
    return { term: t.label, df: S.length, delta: deltaOf(t.label), ...(t.block ? { lambda: NaN, power: NaN, block: true } : pw(S)) };
  });
  // coefficients other than the intercept (whose "power" against zero means nothing here)
  const parameters = columns.map((name, j) => ({ j, name })).filter(c => assign[c.j] >= 0)
    .map(({ j, name }) => ({ name, term: model.terms[assign[j]].label, ...(model.terms[assign[j]].block ? { lambda: NaN, power: NaN } : pw([j])) }));
  return { n, rank, dfRes, alpha, sigma: sigma0, terms, parameters, ...(strata ? { strata, eta } : {}), ...(rho ? { rho, covariates, sigmaResidual: sigma } : {}) };
}

function solveSymMatrix(M) {
  const m = M.length;
  return M.map((_, j) => solveSym(M, M.map((__, i) => (i === j ? 1 : 0)))).map((col, j, all) => all.map(c => c[j]));
}

// small symmetric positive definite solve (Gaussian elimination with partial pivoting)
function solveSym(A, b) {
  const m = A.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < m; c++) {
    let p = c; for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < m; r++) { const k = M[r][c] / M[c][c]; for (let q = c; q <= m; q++) M[r][q] -= k * M[c][q]; }
  }
  const x = new Array(m).fill(0);
  for (let r = m - 1; r >= 0; r--) { let s = M[r][m]; for (let q = r + 1; q < m; q++) s -= M[r][q] * x[q]; x[r] = s / M[r][r]; }
  return x;
}

/**
 * Natural settings for coded rows (factorial.js convention: coded values for continuous factors,
 * ±1 for a two-level categorical factor, level index otherwise).
 */
export function codedToSettings(factors, X) {
  return X.map(r => Object.fromEntries(factors.map((f, j) => [f.id,
    f.type === 'categorical' ? (f.levels.length === 2 && (r[j] === -1 || r[j] === 1) ? f.levels[r[j] < 0 ? 0 : 1] : f.levels[r[j]]) : decode(f, r[j])])));
}

// model with a Block pseudo-factor first when there are several blocks (as fitModel does)
function withBlocks(model, factors, settings, block) {
  const labels = block ? [...new Set(block.map(String))].sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b)) : [];
  if (labels.length < 2) return { model, factors, settings };
  const id = factors.some(f => f.id === 'Block') ? '.block' : 'Block';
  return {
    model: { ...model, terms: [{ label: id, comps: [{ f: id }], degree: 1, block: true }, ...model.terms] },
    factors: [...factors, { id, name: 'Block', type: 'categorical', levels: labels, block: true }],
    settings: settings.map((s, i) => ({ ...s, [id]: String(block[i]) })),
  };
}

// named blocking variables (a Latin square's rows and columns, a crossover's subjects and periods,
// with carry-over; issue #80): the nuisance terms as the analysis fits them (fit.js withBlockTerm)
function withNuisance(study, parsed, runs) {
  const b = withBlockTerm({ ...study, plates: undefined }, parsed, runs);
  return { model: b.model, factors: b.factors, settings: b.rows.map(r => r.settings) };
}

/**
 * Power of a design given in coded units (X as factorial.js returns it, optional block per row)
 * for a model formula over the study's factors. opts as powerFromMatrix, plus model ('main'),
 * and blocking ([{ id, name, role, labels: per run }]) and carryover as comparative.js gives them.
 */
export function designPower(study, X, { model = 'main', block, blocking, carryover, ...opts } = {}) {
  const parsed = parseFormula(model, study.factors);
  const settings = codedToSettings(study.factors, X);
  const runs = settings.map((st, i) => ({ run: i + 1, kind: 'factorial', settings: st, ...(block ? { block: block[i] } : {}), ...(blocking ? { blocks: Object.fromEntries(blocking.map(b => [b.id, b.labels[i]])) } : {}) }));
  const m = blocking ? withNuisance({ ...study, design: { blocking: blocking.map(({ labels, ...b }) => b), carryover: !!carryover, runs } }, parsed, runs)
    : withBlocks(parsed, study.factors, settings, block);
  const mm = modelMatrix(m.model, m.factors, m.settings);
  return { model: parsed, ...(isGlm(opts) ? glmPowerFromMatrix(mm, opts) : powerFromMatrix(mm, opts)) };
}
// opts.wholePlot (label per run) and opts.eta (σ²_wp/σ², default 1) give split-plot power.

// counts and proportions: opts.distribution other than normal (see glmPowerFromMatrix below)
const isGlm = (opts) => opts.distribution && opts.distribution !== 'normal';

/**
 * Power of the study's design (confirmation runs excluded; blocks fitted as fixed effects). With
 * opts.distribution (a count or proportion response) the power of the Wald tests for a ratio
 * (glmPowerFromMatrix); otherwise for an effect Δ given σ.
 */
export function studyPower(study, { model = 'main', ...opts } = {}) {
  if (isGlm(opts)) return studyGlmPower(study, { model, ...opts });
  if (!study.design) throw new Error('the study has no design yet');
  const runs = study.design.runs.filter(r => r.kind !== 'confirm' && r.kind !== 'path');
  const parsed = parseFormula(model, study.factors);
  const m = study.design.blocking ? withNuisance(study, parsed, runs) : withBlocks(parsed, study.factors, runs.map(r => r.settings), runs.some(r => r.block !== undefined) ? runs.map(r => r.block ?? '') : null);
  const wp = runs.some(r => r.wholePlot !== undefined) ? { wholePlot: runs.map(r => String(r.wholePlot ?? `run ${r.run}`)) } : {};
  return { model: parsed, ...powerFromMatrix(modelMatrix(m.model, m.factors, m.settings), { ...wp, ...opts }) };
}

/**
 * Smallest effect Δ detectable with the given power, for each term of a power result (from
 * powerFromMatrix, designPower or studyPower), in the response's units (σ as in that result).
 * λ scales with Δ², so Δ = Δ_used · √(λ_needed / λ_used). Returns [{ term, delta, ratio }],
 * ratio = Δ/σ.
 */
export function detectableEffect(result, { power = 0.8 } = {}) {
  if (!(power > result.alpha && power < 1)) throw new Error(`target power must be between α (${result.alpha}) and 1`);
  return result.terms.filter(t => !t.block).map(t => {
    if (!Number.isFinite(t.lambda) || !(t.lambda > 0)) return { term: t.term, delta: NaN, ratio: NaN };
    const d2 = t.ddf ?? result.dfRes;
    const crit = fDist.isf(result.alpha, t.df, d2), f = (lam) => ncf.sf(crit, t.df, d2, lam);
    let lo = 0, hi = 1;
    while (f(hi) < power && hi < 1e8) { lo = hi; hi *= 2; }
    for (let k = 0; k < 200 && hi - lo > 1e-13 * hi; k++) { const mid = (lo + hi) / 2; if (f(mid) < power) lo = mid; else hi = mid; }
    const delta = t.delta * Math.sqrt(((lo + hi) / 2) / t.lambda);
    return { term: t.term, delta, ratio: delta / result.sigma };
  });
}

// ---------------------------------------------------------------- counts and proportions (issue #64)
//
// For a count or proportion response the information about the coefficients depends on the mean:
// XᵀWX with w = m μ′(η)² / V(μ) at the anticipated means (m: trials). Each term is assessed with
// the intercept at the baseline and that term alone at its anticipated effect (others zero), and
// its Wald test has non-centrality λ = bₛᵀ (V_SS)⁻¹ bₛ / φ, V = (XᵀWX)⁻¹:
//
//   power = P(χ²′(|S|, λ) > χ²_{1−α}(|S|))        (dispersion fixed: Poisson, binomial, negbin)
//   power = P(F′(|S|, N − rank, λ) > F_{1−α})      (dispersion φ estimated: quasi families)
//
// The effect is a ratio from a factor's low to its high setting: a rate ratio for counts (the mean
// count, high / low), an odds ratio for proportions; on the link scale the coefficient is
// b = (g(μ_high) − g(μ_low)) / 2 with μ_low and μ_high on either side of the baseline (b = ln r / 2
// for the canonical links). The baseline is the mean count per unit exposure (counts) or the
// proportion (binomial) at the centre of the design. simulatePower checks the approximation by
// simulating the experiment and the likelihood-ratio test the analysis will use.

const glmDistribution = (d) => (d === 'bernoulli' ? 'binomial' : d);

/** The link-scale coefficient for a ratio r (high / low) around a baseline mean. */
export function ratioCoefficient(distribution, link, baseline, r) {
  const d = glmDistribution(distribution), L = LINKS[link ?? canonicalLink(d)];
  if (GLM_DISTRIBUTIONS[d].counts) return (L.fun(baseline * Math.sqrt(r)) - L.fun(baseline / Math.sqrt(r))) / 2;
  const odds = baseline / (1 - baseline), p = (o) => o / (1 + o);
  return (L.fun(p(odds * Math.sqrt(r))) - L.fun(p(odds / Math.sqrt(r)))) / 2;
}

/**
 * Power for a count or proportion response, from a model matrix mm (formula.js).
 * opts: distribution ('poisson' …), link, baseline (mean count per unit exposure, or proportion),
 * ratio (number, or { termLabel: r, default }), trials (number or per run), exposure (number or per
 * run), theta (negbin), dispersion (quasi families, default 1), alpha (0.05).
 * Returns { n, rank, dfRes, alpha, distribution, link, baseline, terms: [{ term, df, ratio, lambda,
 * power }], parameters, lambdaAt(term, r) }.
 */
export function glmPowerFromMatrix(mm, { distribution, link, baseline, ratio = 2, trials = 1, exposure = 1, theta, dispersion = 1, alpha = 0.05 } = {}) {
  const d = glmDistribution(distribution);
  if (!GLM_DISTRIBUTIONS[d]) throw new Error(`unknown distribution "${distribution}"`);
  const lk = link ?? canonicalLink(d), counts = GLM_DISTRIBUTIONS[d].counts;
  if (!(baseline > 0) || (!counts && !(baseline < 1))) throw new Error(counts ? 'the baseline mean count must be positive' : 'the baseline proportion must lie between 0 and 1');
  if (d === 'negbin' && !(theta > 0)) throw new Error('the negative binomial needs θ (the variance is μ + μ²/θ): give the θ you expect');
  if (!(alpha > 0 && alpha < 1)) throw new Error('α must be between 0 and 1');
  const fam = family(d, lk, d === 'negbin' ? theta : undefined), L = fam.link;
  const { X, columns, assign, model } = mm, n = X.length;
  const per = (v) => X.map((_, i) => (Array.isArray(v) ? v[i % v.length] : v));   // a value, or values cycled over the runs
  const m = d.includes('binomial') ? per(trials) : X.map(() => 1), expo = counts ? per(exposure) : X.map(() => 1);
  const estimated = GLM_DISTRIBUTIONS[d].dispersion === 'estimated', phi = estimated ? dispersion : 1;
  const icpt = columns.findIndex((_, j) => assign[j] === -1);
  const b0 = L.fun(baseline);
  const ratioOf = (label) => (typeof ratio === 'number' ? ratio : ratio[label] ?? ratio.default ?? 2);
  const rank0 = qr(X).rank, dfRes = n - rank0;
  const crit = (df) => (estimated ? fDist.isf(alpha, df, dfRes) : CHI2.ppf(1 - alpha, df));
  const powerOf = (df, lambda) => (!Number.isFinite(lambda) ? NaN : estimated ? (dfRes >= 1 ? ncf.sf(crit(df), df, dfRes, lambda) : NaN) : ncChi2.sf(crit(df), df, lambda));
  // λ for the columns S with coefficients bS (the other non-intercept columns at 0)
  const lambdaFor = (S, bS) => {
    const beta = columns.map((_, j) => (j === icpt ? b0 : 0));
    S.forEach((j, k) => { beta[j] = bS[k]; });
    const eta = X.map((r, i) => r.reduce((s, v, j) => s + v * beta[j], 0) + (counts && L.name === 'log' ? Math.log(expo[i]) : 0));
    const mu = eta.map(L.inv);
    if (counts && L.name !== 'log') mu.forEach((v, i) => { mu[i] = v * expo[i]; });
    if (mu.some(v => !fam.validMu(v))) return NaN;          // the anticipated means leave the possible range
    const w = mu.map((v, i) => Math.sqrt(m[i] * L.deriv(eta[i]) ** 2 / fam.variance(v)));
    const f = qr(X.map((r, i) => r.map(v => v * w[i])), { tol: 1e-11 });
    if (S.some(j => f.aliased.includes(j))) return NaN;
    const V = f.unscaledCov(), A = S.map(i => S.map(j => V[i][j]));
    const x = solveSym(A, bS);
    return bS.reduce((s, v, i) => s + v * x[i], 0) / phi;
  };
  const colsOf = (ti) => columns.map((_, j) => j).filter(j => assign[j] === ti);
  const lambdaAt = (label, r) => {
    const ti = model.terms.findIndex(t => t.label === label), S = colsOf(ti);
    return lambdaFor(S, S.map(() => ratioCoefficient(d, lk, baseline, r)));
  };
  const terms = model.terms.map((t, ti) => {
    const S = colsOf(ti), r = ratioOf(t.label);
    if (t.block) return { term: t.label, df: S.length, ratio: r, lambda: NaN, power: NaN, block: true };
    const lambda = lambdaFor(S, S.map(() => ratioCoefficient(d, lk, baseline, r)));
    return { term: t.label, df: S.length, ratio: r, lambda, power: powerOf(S.length, lambda) };
  });
  const parameters = columns.map((name, j) => ({ j, name })).filter(c => assign[c.j] >= 0).map(({ j, name }) => {
    const t = model.terms[assign[j]], r = ratioOf(t.label), lambda = t.block ? NaN : lambdaFor([j], [ratioCoefficient(d, lk, baseline, r)]);
    return { name, term: t.label, lambda, power: powerOf(1, lambda) };
  });
  return { n, rank: rank0, dfRes, alpha, distribution, link: lk, baseline, ratio, ...(d === 'negbin' ? { theta } : {}), ...(estimated ? { dispersion: phi } : {}),
    terms, parameters, lambdaAt, powerOf };
}

/**
 * Smallest ratio detectable with the given power for each term of a glmPowerFromMatrix result
 * (λ is not proportional to the squared effect when the information depends on the mean, so the
 * ratio is found by bisection on its log). Returns [{ term, ratio }] (NaN when the design cannot
 * reach the power below a ratio of 1000).
 */
export function detectableRatio(result, { power = 0.8 } = {}) {
  return result.terms.filter(t => !t.block).map(t => {
    const pw = (r) => result.powerOf(t.df, result.lambdaAt(t.term, r));
    if (!(pw(1000) >= power)) return { term: t.term, ratio: NaN };
    let lo = 0, hi = Math.log(1000);
    for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2, p = pw(Math.exp(mid)); if (p >= power) hi = mid; else lo = mid; }
    return { term: t.term, ratio: Math.exp(hi) };
  });
}

// random draws for the simulation (glm.js)
const poissonDraw = (R, mu) => _draw.poisson(R, mu), gammaDraw = (R, a) => _draw.gamma(R, a);
const binomialDraw = (R, n, p) => { let k = 0; for (let i = 0; i < n; i++) if (R.random() < p) k++; return k; };

/**
 * Power by simulation: for each term, nsim experiments are simulated from the anticipated model
 * (that term at its effect, the baseline elsewhere), the full model is fitted, and the term's
 * likelihood-ratio test (F for quasi families) is counted at α. opts as glmPowerFromMatrix, plus
 * nsim (400) and seed. Returns [{ term, power, se, nsim }]. A quasi-Poisson response is simulated as
 * negative binomial (θ, default 5) and analysed as quasi-Poisson; a quasi-binomial as binomial.
 */
export function simulatePower(mm, opts = {}) {
  const { distribution, link, baseline, ratio = 2, trials = 1, exposure = 1, theta, alpha = 0.05, nsim = 400, seed = 1 } = opts;
  const d = glmDistribution(distribution), lk = link ?? canonicalLink(d), counts = GLM_DISTRIBUTIONS[d].counts;
  const R = rng(seed), L = LINKS[lk];
  const { X, columns, assign, model } = mm, n = X.length;
  const per = (v) => X.map((_, i) => (Array.isArray(v) ? v[i % v.length] : v));   // a value, or values cycled over the runs
  const m = d.includes('binomial') ? per(trials) : X.map(() => 1), expo = counts ? per(exposure) : X.map(() => 1);
  const icpt = columns.findIndex((_, j) => assign[j] === -1), b0 = L.fun(baseline);
  const ratioOf = (label) => (typeof ratio === 'number' ? ratio : ratio[label] ?? ratio.default ?? 2);
  const offset = counts && L.name === 'log' ? expo.map(Math.log) : undefined;
  const fitD = d === 'quasipoisson' ? 'quasipoisson' : d === 'quasibinomial' ? 'quasibinomial' : d;
  return model.terms.filter(t => !t.block).map(t => {
    const ti = model.terms.indexOf(t), S = columns.map((_, j) => j).filter(j => assign[j] === ti);
    const beta = columns.map((_, j) => (j === icpt ? b0 : S.includes(j) ? ratioCoefficient(d, lk, baseline, ratioOf(t.label)) : 0));
    const mu = X.map((r, i) => { const e = r.reduce((s, v, j) => s + v * beta[j], 0) + (offset ? offset[i] : 0); return L.inv(e) * (counts && L.name !== 'log' ? expo[i] : 1); });
    const keep = columns.map((_, j) => j).filter(j => !S.includes(j));
    const small = { ...mm, X: X.map(r => keep.map(j => r[j])), columns: keep.map(j => columns[j]), assign: keep.map(j => assign[j]) };
    let hits = 0, done = 0;
    for (let s = 0; s < nsim; s++) {
      const y = mu.map((v, i) => {
        if (!counts) return binomialDraw(R, m[i], v) / m[i];
        if (d === 'negbin' || d === 'quasipoisson') { const th = theta ?? 5; return poissonDraw(R, v * gammaDraw(R, th) / th); }
        return poissonDraw(R, v);
      });
      try {
        const o = { distribution: fitD, link: lk, weights: counts ? undefined : m, offset, ...(d === 'negbin' ? { theta } : {}) };
        const big = fitGLM(mm, y, o), sm = fitGLM(small, y, o);
        const c = glmCompare(big, sm);
        done++; if (c.p < alpha) hits++;
      } catch { /* a degenerate simulated data set: not counted */ }
    }
    const p = done ? hits / done : NaN;
    return { term: t.label, power: p, se: Math.sqrt(p * (1 - p) / Math.max(1, done)), nsim: done };
  });
}

/** Power of the study's design for a count or proportion response (glmPowerFromMatrix options). */
export function studyGlmPower(study, { model = 'main', ...opts } = {}) {
  if (!study.design) throw new Error('the study has no design yet');
  const runs = study.design.runs.filter(r => r.kind !== 'confirm' && r.kind !== 'path');
  const parsed = parseFormula(model, study.factors);
  const m = study.design.blocking ? withNuisance(study, parsed, runs) : withBlocks(parsed, study.factors, runs.map(r => r.settings), runs.some(r => r.block !== undefined) ? runs.map(r => r.block ?? '') : null);
  return { model: parsed, ...glmPowerFromMatrix(modelMatrix(m.model, m.factors, m.settings), opts) };
}
