// Ordinal scores (issue #83, phase 2): a cumulative link model, as ordinal::clm and MASS::polr.
// A score in K ordered categories (poor < fair < good …) falls in category j when a hidden
// continuous value lies between two cut points (thresholds):
//
//   P(Y ≤ j) = F(θ_j − η),   η = Xβ (no intercept: the thresholds take its place)
//
// with F the logistic (the proportional-odds model), normal (probit) or complementary log-log
// distribution. A positive β moves the scores up. exp(β) is the odds ratio for a higher score
// rather than a lower one, the same at every cut point: the proportional-odds assumption, tested
// by letting one term's effects differ between cut points (its "nominal" effects, as
// ordinal::nominal_test) and comparing the likelihoods.
//
//   fitOrdinal(mm, y, { K, link, nominal })   maximum likelihood by Newton's method
//   ordinalPredict(fit, X, { level })        category probabilities and the mean score, with
//                                            delta-method standard errors
//   ordinalTests(fit, type)                  likelihood-ratio tests of the terms (types 1–3)
//   proportionalOddsTest(fit)                each term's test of proportional odds, and all together
//   ordinalCompare(big, small)               the likelihood-ratio test of nested fits

import { qr, inv } from '../linalg.js';
import { normal, chi2 } from '../dist.js';

// F, its density f and f' for each link
export const ORDINAL_LINKS = Object.freeze({
  logit: {
    F: (x) => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x))),
    f: (x) => { const e = Math.exp(-Math.abs(x)); return e / ((1 + e) * (1 + e)); },
    df: (x) => { const e = Math.exp(-Math.abs(x)), f = e / ((1 + e) * (1 + e)), F = x >= 0 ? 1 / (1 + e) : e / (1 + e); return f * (1 - 2 * F); },
    Finv: (p) => Math.log(p / (1 - p)),
  },
  probit: { F: (x) => normal.cdf(x), f: (x) => normal.pdf(x), df: (x) => -x * normal.pdf(x), Finv: (p) => normal.ppf(p) },
  cloglog: {
    F: (x) => -Math.expm1(-Math.exp(x)),
    f: (x) => { const e = Math.exp(x); return e * Math.exp(-e); },
    df: (x) => { const e = Math.exp(x); return e * Math.exp(-e) * (1 - e); },
    Finv: (p) => Math.log(-Math.log1p(-p)),
  },
});

// the log-likelihood, gradient and Hessian. Parameters: θ (K−1), β (p), γ ((K−1) × q, by cut
// point then nominal column). Observation i's cut point j: a_ij = θ_j + z_i·γ_j − η_i.
function lik(par, Xk, Z, y, K, L, w) {
  const n = y.length, p = Xk[0]?.length ?? 0, q = Z ? Z[0].length : 0, m = K - 1, P = par.length;
  let ll = 0, ok = true;
  const g = new Array(P).fill(0), H = Array.from({ length: P }, () => new Array(P).fill(0));
  const cut = (i, j) => { let a = par[j]; for (let k = 0; k < p; k++) a -= Xk[i][k] * par[m + k]; for (let k = 0; k < q; k++) a += Z[i][k] * par[m + p + j * q + k]; return a; };
  // ∂a_ij/∂φ as (index, value) pairs
  const grad = (i, j) => { const d = [[j, 1]]; for (let k = 0; k < p; k++) d.push([m + k, -Xk[i][k]]); for (let k = 0; k < q; k++) d.push([m + p + j * q + k, Z[i][k]]); return d; };
  for (let i = 0; i < n; i++) {
    const yi = y[i], wi = w ? w[i] : 1;                       // categories 1 … K
    const hasU = yi < K, hasL = yi > 1;
    const u = hasU ? cut(i, yi - 1) : Infinity, l = hasL ? cut(i, yi - 2) : -Infinity;
    const pr = (hasU ? L.F(u) : 1) - (hasL ? L.F(l) : 0);
    if (!(pr > 0)) { ok = false; ll = -Infinity; break; }
    ll += wi * Math.log(pr);
    const du = hasU ? grad(i, yi - 1) : [], dl = hasL ? grad(i, yi - 2) : [];
    const fu = hasU ? L.f(u) : 0, fl = hasL ? L.f(l) : 0, dfu = hasU ? L.df(u) : 0, dfl = hasL ? L.df(l) : 0;
    // g_i = (f(u) du − f(l) dl) / p
    const gi = new Map();
    for (const [k, v] of du) gi.set(k, (gi.get(k) ?? 0) + fu * v / pr);
    for (const [k, v] of dl) gi.set(k, (gi.get(k) ?? 0) - fl * v / pr);
    for (const [k, v] of gi) g[k] += wi * v;
    // H_i = (f'(u) du du' − f'(l) dl dl') / p − g_i g_i'
    for (const [a, va] of du) for (const [b, vb] of du) H[a][b] += wi * dfu * va * vb / pr;
    for (const [a, va] of dl) for (const [b, vb] of dl) H[a][b] -= wi * dfl * va * vb / pr;
    for (const [a, va] of gi) for (const [b, vb] of gi) H[a][b] -= wi * va * vb;
  }
  return { ll, g, H, ok };
}

/**
 * Fit a cumulative link model. mm: a model matrix (formula.js; its intercept column, if any, is
 * absorbed by the thresholds); y: scores 1 … K. opts: K (the number of categories; default the
 * largest score), link ('logit' | 'probit' | 'cloglog'), nominal (column indices of mm whose
 * effects may differ between cut points — for the proportional-odds test), weights, maxit.
 * Returns { model, columns, assign, n, K, rank, link, coef, se, z, p, cov, thresholds: [{ name,
 * estimate, se }], loglik, k, aic, probs (fitted category probabilities per row), linear, counts,
 * converged, iter, warnings, … }; columns exclude the intercept.
 */
export function fitOrdinal(mm, y, { K, link = 'logit', nominal = [], weights, maxit = 100, tol = 1e-10 } = {}) {
  const L = ORDINAL_LINKS[link];
  if (!L) throw new Error(`unknown link "${link}" for ordinal scores (logit, probit or cloglog)`);
  const n = y.length;
  if (!n) throw new Error('no scores to fit');
  if (y.some(v => !Number.isInteger(v) || v < 1)) throw new Error('ordinal scores must be whole numbers 1 … K');
  K ??= Math.max(...y);
  if (y.some(v => v > K)) throw new Error(`a score above the ${K} categories`);
  if (K < 2) throw new Error('an ordinal score needs at least two categories');
  const counts = Array.from({ length: K }, (_, j) => y.filter(v => v === j + 1).length);
  const warnings = [];
  // categories never seen at either end leave a threshold at ±∞; in the middle, two thresholds equal
  const empty = counts.map((c, j) => (c ? null : j + 1)).filter(Boolean);
  if (empty.length) throw new Error(`no scores in categor${empty.length > 1 ? 'ies' : 'y'} ${empty.join(', ')}: merge ${empty.length > 1 ? 'them' : 'it'} with a neighbour, or leave ${empty.length > 1 ? 'them' : 'it'} out of the categories`);
  const { X, columns: cols0, assign: as0, model } = mm;
  // estimable columns other than the intercept, which the thresholds absorb
  const icp = cols0.indexOf('(Intercept)');
  const others = cols0.map((_, j) => j).filter(j => j !== icp);
  const f = qr(X.map(r => [1, ...others.map(j => r[j])]), { tol: 1e-9 });
  const keepIdx = others.filter((_, a) => !f.aliased.includes(a + 1));
  const columns = others.map(j => cols0[j]), assign = others.map(j => as0[j]);
  // nominal columns' effects are all in their per-cut-point γ (a common β would be redundant)
  const nomCols = nominal.filter(j => keepIdx.includes(j) || j === icp);
  const betaIdx = keepIdx.filter(j => !nomCols.includes(j));
  const keep = betaIdx.map(j => others.indexOf(j));                 // positions in columns
  const Xk = X.map(r => betaIdx.map(j => r[j]));
  const Z = nomCols.length ? X.map(r => nomCols.map(j => r[j])) : null;
  const p = betaIdx.length, q = nomCols.length, m = K - 1;
  // start: thresholds at the cumulative proportions, effects 0
  let cum = 0;
  const par = [];
  for (let j = 0; j < m; j++) { cum += counts[j]; par.push(L.Finv(Math.min(1 - 1e-6, Math.max(1e-6, cum / n)))); }
  par.push(...new Array(p + m * q).fill(0));
  let cur = lik(par, Xk, Z, y, K, L, weights), iter = 0, converged = false, theta = par.slice();
  // Newton's method, damped (Levenberg–Marquardt) whenever the full step does not raise the
  // likelihood (or leaves a category with no probability); a step is never taken unless the
  // likelihood rises, and convergence needs a small gradient
  let mu = 0;
  const gradSmall = (g) => Math.max(...g.map(Math.abs)) < 1e-8 * Math.max(1, Math.abs(cur.ll));
  for (iter = 1; iter <= maxit; iter++) {
    if (gradSmall(cur.g)) { converged = true; break; }
    let moved = false;
    for (let tries = 0; tries < 60 && !moved; tries++) {
      let step;
      try { step = inv(cur.H.map((r, i) => r.map((v, j) => -v + (i === j ? mu * (1 + Math.abs(cur.H[i][i])) : 0)))).map(r => r.reduce((a, v, k) => a + v * cur.g[k], 0)); } catch { step = null; }
      if (step && step.every(Number.isFinite)) {
        const cand = theta.map((v, k) => v + step[k]), next = lik(cand, Xk, Z, y, K, L, weights);
        if (next.ok && next.ll > cur.ll) {
          const gain = next.ll - cur.ll;
          theta = cand; cur = next; moved = true;
          mu = mu > 1e-10 ? mu / 10 : 0;
          if (gain < tol * (1 + Math.abs(cur.ll)) && gradSmall(cur.g)) converged = true;
          break;
        }
      }
      mu = mu > 0 ? mu * 10 : 1e-4;
    }
    if (converged || !moved) { if (!moved && gradSmall(cur.g)) converged = true; break; }
  }
  if (!converged) warnings.push('the fit did not converge: a factor setting may give only the top or only the bottom score, so its effect runs off to infinity');
  let V;
  try { V = inv(cur.H.map(r => r.map(v => -v))); } catch { V = cur.H.map(r => r.map(() => NaN)); warnings.push('the information matrix is singular: standard errors are not available'); }
  const se = (k) => Math.sqrt(V[k][k]);
  const coef = new Array(columns.length).fill(NaN), sec = new Array(columns.length).fill(NaN);
  keep.forEach((c, a) => { coef[c] = theta[m + a]; sec[c] = se(m + a); });
  const z = coef.map((b, j) => b / sec[j]);
  const pv = z.map(t => (Number.isFinite(t) ? 2 * normal.sf(Math.abs(t)) : NaN));
  const cov = columns.map((_, i) => columns.map((_, j) => { const a = keep.indexOf(i), b = keep.indexOf(j); return a >= 0 && b >= 0 ? V[m + a][m + b] : NaN; }));
  const thresholds = Array.from({ length: m }, (_, j) => ({ name: `${j + 1}|${j + 2}`, estimate: theta[j], se: se(j) }));
  const linear = Xk.map(r => r.reduce((a, v, k) => a + v * theta[m + k], 0));
  const k = p + m + m * q;
  const fit = {
    model, columns, assign, n, K, rank: p, dfRes: n - k, link, noise: 'ordinal', distribution: 'ordinal', statistic: 'z',
    coef, se: sec, t: z, z, p: pv, cov, covFull: V, keep, thresholds, theta,
    nominal: nomCols.map(j => cols0[j]), gamma: q ? Array.from({ length: m }, (_, j) => theta.slice(m + p + j * q, m + p + (j + 1) * q)) : [],
    aliased: others.filter(j => !keepIdx.includes(j)).map(j => cols0[j]),
    loglik: cur.ll, k, aic: -2 * cur.ll + 2 * k, linear, counts, y: y.slice(), weights,
    converged, iter, warnings, X, sigma: NaN, sigma2: NaN, r2: NaN, adjR2: NaN, mmColumns: cols0,
  };
  fit.probs = Xk.map((_, i) => categoryProbs(fit, X[i]).map(c => c.p));
  fit.fitted = fit.probs.map(pr => pr.reduce((a, v, j) => a + (j + 1) * v, 0));
  fit.residuals = y.map((v, i) => v - fit.fitted[i]);
  return fit;
}

// the cut points at a model-matrix row (with its nominal effects), and their gradients in φ
function cutsAt(fit, row) {
  const m = fit.K - 1, p = fit.keep.length, q = fit.nominal.length, th = fit.theta;
  const xk = fit.keep.map(c => row[fit.mmColumns.indexOf(fit.columns[c])]);
  const zk = fit.nominal.map(c => row[fit.mmColumns.indexOf(c)]);
  const eta = xk.reduce((a, v, k) => a + v * th[m + k], 0);
  return Array.from({ length: m }, (_, j) => {
    let a = th[j] - eta;
    for (let k = 0; k < q; k++) a += zk[k] * th[m + p + j * q + k];
    const d = new Array(th.length).fill(0);
    d[j] = 1; xk.forEach((v, k) => { d[m + k] = -v; }); zk.forEach((v, k) => { d[m + p + j * q + k] = v; });
    return { a, d };
  });
}

// category probabilities at a full model-matrix row, with the gradient of each in φ
function categoryProbs(fit, row) {
  const L = ORDINAL_LINKS[fit.link], cuts = cutsAt(fit, row), K = fit.K, P = fit.theta.length;
  const Fv = cuts.map(c => L.F(c.a)), fv = cuts.map(c => L.f(c.a));
  return Array.from({ length: K }, (_, j) => {
    const up = j < K - 1 ? Fv[j] : 1, lo = j > 0 ? Fv[j - 1] : 0;
    const g = new Array(P).fill(0);
    if (j < K - 1) cuts[j].d.forEach((v, k) => { g[k] += fv[j] * v; });
    if (j > 0) cuts[j - 1].d.forEach((v, k) => { g[k] -= fv[j - 1] * v; });
    return { p: up - lo, g };
  });
}

const quad = (g, V) => { let s = 0; for (let a = 0; a < g.length; a++) if (g[a]) for (let b = 0; b < g.length; b++) s += g[a] * V[a][b] * g[b]; return s; };

/**
 * At model-matrix rows: [{ fit (the mean score Σ j·p_j), se, lower, upper, probs: [{ category,
 * p, se, lower, upper }], mostLikely }]. Standard errors by the delta method (as emmeans' "prob"
 * and "mean.class" modes); a probability's interval is formed on the logit scale, so it stays
 * inside 0 … 1.
 */
export function ordinalPredict(fit, X, { level = 0.95 } = {}) {
  const zq = normal.isf((1 - level) / 2), V = fit.covFull;
  return X.map(row => {
    const cp = categoryProbs(fit, row);
    const probs = cp.map((c, j) => {
      const se = Math.sqrt(Math.max(0, quad(c.g, V)));
      const lg = Math.log(c.p / (1 - c.p)), sl = se / (c.p * (1 - c.p));
      return { category: j + 1, p: c.p, se, lower: 1 / (1 + Math.exp(-(lg - zq * sl))), upper: 1 / (1 + Math.exp(-(lg + zq * sl))) };
    });
    const g = cp[0].g.map((_, k) => cp.reduce((a, c, j) => a + (j + 1) * c.g[k], 0));
    const mean = cp.reduce((a, c, j) => a + (j + 1) * c.p, 0), se = Math.sqrt(Math.max(0, quad(g, V)));
    const mostLikely = 1 + probs.reduce((b, c, j) => (c.p > probs[b].p ? j : b), 0);
    return { fit: mean, se, lower: Math.max(1, mean - zq * se), upper: Math.min(fit.K, mean + zq * se), probs, mostLikely, predLower: 1, predUpper: fit.K };
  });
}

// the fit with only some columns of the model matrix (indices into fit.mmColumns), and nominal ones
function refit(fit, cols, nominal = []) {
  const mm = { X: fit.X.map(r => cols.map(j => r[j])), columns: cols.map(j => fit.mmColumns[j]), assign: cols.map(j => (j === fit.mmColumns.indexOf('(Intercept)') ? -1 : fit.assign[fit.columns.indexOf(fit.mmColumns[j])])), model: fit.model };
  const r = fitOrdinal(mm, fit.y, { K: fit.K, link: fit.link, weights: fit.weights, nominal: nominal.map(j => cols.indexOf(j)) });
  return { loglik: r.loglik, k: r.k, converged: r.converged };
}

const containedIn = (t, u) => t !== u && t.comps.every(c => u.comps.some(d => d.f === c.f && (d.pow ?? 1) === (c.pow ?? 1)));
const lrRow = (small, big) => { const df = big.k - small.k, x = Math.max(0, 2 * (big.loglik - small.loglik)); return { df, chi2: x, p: df > 0 ? chi2.sf(x, df) : NaN }; };

/**
 * Likelihood-ratio tests of the terms: type 1 (sequential, as anova of nested clm fits), 2 (each
 * term after those not containing it) or 3 (each term last, as drop1). Rows { term, df, chi2, p },
 * then { term: 'Residuals', df, loglik }.
 */
export function ordinalTests(fit, type = 1) {
  if (![1, 2, 3].includes(type)) throw new Error('the type of test must be 1, 2 or 3');
  const { model } = fit, mc = fit.mmColumns, rows = [];
  const est = fit.keep.map(c => mc.indexOf(fit.columns[c]));
  const icp = mc.indexOf('(Intercept)') >= 0 ? [mc.indexOf('(Intercept)')] : [];
  const colsOf = (ti) => est.filter(j => fit.assign[fit.columns.indexOf(mc[j])] === ti);
  if (type === 1) {
    let cols = icp.slice(), prev = refit(fit, cols);
    model.terms.forEach((t, ti) => {
      const add = colsOf(ti);
      if (!add.length) return;
      cols = cols.concat(add);
      const cur = refit(fit, cols), r = lrRow(prev, cur);
      if (r.df > 0) rows.push({ term: t.label, ...r });
      prev = cur;
    });
  } else {
    const full = { loglik: fit.loglik, k: fit.k };
    model.terms.forEach((t, ti) => {
      if (!colsOf(ti).length) return;
      const base = icp.concat(est.filter(j => { const a = fit.assign[fit.columns.indexOf(mc[j])]; return a !== ti && (type === 3 || !containedIn(t, model.terms[a])); }));
      const r0 = refit(fit, base), r1 = type === 3 ? full : refit(fit, base.concat(colsOf(ti)));
      const r = lrRow(r0, r1);
      if (r.df > 0) rows.push({ term: t.label, ...r });
    });
  }
  rows.push({ term: 'Residuals', df: fit.dfRes, loglik: fit.loglik });
  return rows;
}

/**
 * The test of proportional odds (as ordinal::nominal_test): for each term, the likelihood-ratio
 * test of letting its effects differ between the cut points; and all terms together. Rows
 * { term, df, chi2, p, converged }. A small p says the term moves some cut points more than
 * others: its odds ratio is not the same for every split of the scale.
 */
export function proportionalOddsTest(fit) {
  if (fit.K < 3) return [];
  const mc = fit.mmColumns, est = fit.keep.map(c => mc.indexOf(fit.columns[c]));
  const all = (mc.indexOf('(Intercept)') >= 0 ? [mc.indexOf('(Intercept)')] : []).concat(est);
  const base = { loglik: fit.loglik, k: fit.k }, rows = [];
  const one = (label, nom) => {
    // a fit that does not converge (its cut points cross somewhere in the data) cannot be tested, as clm leaves it blank
    try { const r = refit(fit, all, nom); rows.push(r.converged ? { term: label, ...lrRow(base, r), converged: true } : { term: label, df: (fit.K - 2) * nom.length, chi2: NaN, p: NaN, converged: false }); }
    catch { rows.push({ term: label, df: (fit.K - 2) * nom.length, chi2: NaN, p: NaN, converged: false }); }
  };
  fit.model.terms.forEach((t, ti) => { const c = est.filter(j => fit.assign[fit.columns.indexOf(mc[j])] === ti); if (c.length) one(t.label, c); });
  if (rows.length > 1) one('all terms', est);
  return rows;
}

/** The likelihood-ratio test of dropping terms: small is big without them. */
export function ordinalCompare(big, small) {
  const df = big.k - small.k;
  if (df === 0) return { df, chi2: NaN, F: NaN, p: 1 };
  const x = Math.max(0, 2 * (big.loglik - small.loglik));
  return { df, chi2: x, F: NaN, p: chi2.sf(x, df) };
}

/** Odds ratios with Wald intervals: exp(β) per coded unit, for a higher score rather than a lower. */
export function oddsRatios(fit, { level = 0.95 } = {}) {
  const zq = normal.isf((1 - level) / 2);
  return fit.columns.map((c, j) => ({ term: c, assign: fit.assign[j], estimate: fit.coef[j], se: fit.se[j], z: fit.z[j], p: fit.p[j],
    ratio: Math.exp(fit.coef[j]), lower: Math.exp(fit.coef[j] - zq * fit.se[j]), upper: Math.exp(fit.coef[j] + zq * fit.se[j]) })).filter(r => Number.isFinite(r.estimate));
}

/**
 * The scores at each condition tested beside the model's probabilities: [{ runs, settings, n,
 * observed: [counts per category], probs: [{ category, p, lower, upper }], mean, observedMean }].
 */
export function scoresAtConditions(fit, { level = 0.95 } = {}) {
  const by = new Map();
  fit.X.forEach((x, i) => { const k = x.join(','); if (!by.has(k)) by.set(k, []); by.get(k).push(i); });
  const shown = (fit.factors ?? []).filter(f => !f.block).map(f => f.id);
  return [...by.values()].map(idx => {
    const s = fit.rows?.[idx[0]]?.settings ?? {};
    const pr = ordinalPredict(fit, [fit.X[idx[0]]], { level })[0];
    const observed = Array.from({ length: fit.K }, (_, j) => idx.filter(i => fit.y[i] === j + 1).length);
    return { runs: [...new Set(idx.map(i => fit.rows?.[i]?.run).filter(v => v !== undefined))], settings: Object.fromEntries((shown.length ? shown : Object.keys(s)).filter(k => k in s).map(k => [k, s[k]])),
      n: idx.length, observed, probs: pr.probs, mean: pr.fit, observedMean: idx.reduce((a, i) => a + fit.y[i], 0) / idx.length };
  });
}
