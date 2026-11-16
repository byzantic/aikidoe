// Time to an event, with right censoring (issue #83, phase 1): parametric accelerated-life models,
// as survival::survreg. The log of the time is linear in the factors, with a scale σ:
//
//   log T = Xβ + σ W,   W standard extreme-value (minimum)  — the Weibull distribution
//                       W standard normal                    — the log-normal distribution
//
// A right-censored observation (the unit had not failed when the run stopped) says only that its
// time exceeds the value: it contributes the survival function S(z) instead of the density.
//
//   fitSurvreg(mm, t, { distribution, status })   maximum likelihood by Newton–Raphson on (β, log σ)
//   survPredict(fit, X, { p, level })            the p quantile of the time (default the median) at
//                                                model-matrix rows, with its interval (delta method
//                                                on the log scale, as predict(type = "quantile"))
//   survTests(fit, type)                         likelihood-ratio tests of the terms (type 1:
//                                                sequential, as anova.survreg; 2 and 3)
//   survCompare(big, small)                      the likelihood-ratio test of nested fits
//   kaplanMeier(t, status)                       the product-limit estimate of S, for the
//                                                probability plot
//
// Effects are time ratios: exp(β) per coded unit, so exp(2β) from a factor's low to its high.
// The log-likelihood is on the time scale (with the Jacobian −Σ log t over failures), as survreg's.

import { qr, lu, inv } from '../linalg.js';
import { normal, chi2 } from '../dist.js';

const LOG2PI = Math.log(2 * Math.PI);

// the standard error distribution W of each model: log density and log survival with their first
// two derivatives in z, and its quantile function
export const SURV_DISTRIBUTIONS = Object.freeze({
  weibull: {
    label: 'Weibull',
    // f(z) = exp(z − e^z), S(z) = exp(−e^z)
    event: (z) => { const e = Math.exp(z); return [z - e, 1 - e, -e]; },
    censor: (z) => { const e = Math.exp(z); return [-e, -e, -e]; },
    quantile: (p) => Math.log(-Math.log1p(-p)),
    cdf: (z) => -Math.expm1(-Math.exp(z)),
  },
  lognormal: {
    label: 'log-normal',
    event: (z) => [-0.5 * z * z - 0.5 * LOG2PI, -z, -1],
    censor: (z) => {
      // log S = log(1 − Φ(z)); the hazard λ = φ / S: ℓ' = −λ, ℓ'' = −λ (λ − z)
      const S = normal.sf(z);
      const lam = S > 0 ? normal.pdf(z) / S : z + 1 / z;           // the tail: λ ≈ z for large z
      return [Math.log(S > 0 ? S : Number.MIN_VALUE), -lam, -lam * (lam - z)];
    },
    quantile: (p) => normal.ppf(p),
    cdf: (z) => normal.cdf(z),
  },
});

// log-likelihood (on log T; the time-scale value adds −Σ log t over failures), gradient and
// Hessian in θ = (β, τ = log σ)
function lik(Xk, y, status, beta, tau, D) {
  const n = y.length, p = beta.length, s = Math.exp(tau);
  let ll = 0;
  const g = new Array(p + 1).fill(0), H = Array.from({ length: p + 1 }, () => new Array(p + 1).fill(0));
  for (let i = 0; i < n; i++) {
    let eta = 0;
    for (let j = 0; j < p; j++) eta += Xk[i][j] * beta[j];
    const z = (y[i] - eta) / s, ev = status[i] === 1;
    const [l0, l1, l2] = ev ? D.event(z) : D.censor(z);
    ll += l0 - (ev ? tau : 0);
    // ∂z/∂β = −x/σ, ∂z/∂τ = −z
    const x = Xk[i];
    for (let j = 0; j < p; j++) g[j] += -l1 * x[j] / s;
    g[p] += -l1 * z - (ev ? 1 : 0);
    for (let j = 0; j < p; j++) {
      for (let k = 0; k <= j; k++) H[j][k] += l2 * x[j] * x[k] / (s * s);
      H[p][j] += (l2 * z + l1) * x[j] / s;
    }
    H[p][p] += l2 * z * z + l1 * z;
  }
  for (let j = 0; j <= p; j++) for (let k = 0; k < j; k++) H[k][j] = H[j][k];
  return { ll, g, H };
}

/**
 * Fit an accelerated-life model. mm: a model matrix (formula.js); t: times (> 0); opts:
 * distribution ('weibull' | 'lognormal'), status (1 = failed at t, 0 = censored at t; default all
 * failed), maxit, tol. Aliased columns (by the QR of X) have NaN coefficients.
 * Returns { model, columns, assign, n, events, rank, dfRes, distribution, coef, se, z, p, cov
 * (of β), scale, logScale, logScaleSe, covFull, loglik, k, aic, linear, residuals (standardised,
 * (log t − η)/σ), status, y (log t), converged, iter, warnings, … }.
 */
export function fitSurvreg(mm, t, { distribution = 'weibull', status, maxit = 100, tol = 1e-10 } = {}) {
  const D = SURV_DISTRIBUTIONS[distribution];
  if (!D) throw new Error(`unknown time-to-event distribution "${distribution}" (weibull or lognormal)`);
  const { X, columns, assign, model } = mm;
  const n = X.length, P = columns.length;
  if (t.length !== n) throw new Error(`${t.length} times for ${n} rows`);
  if (t.some(v => !(v > 0) || !Number.isFinite(v))) throw new Error('times must be positive numbers');
  status ??= t.map(() => 1);
  const events = status.filter(v => v === 1).length;
  if (!events) throw new Error('every observation is censored: there is no failure to fit');
  const y = t.map(Math.log);
  // the estimable columns
  const f = qr(X, { tol: 1e-9 }), keep = columns.map((_, j) => j).filter(j => !f.aliased.includes(j)), p = keep.length;
  const Xk = X.map(r => keep.map(j => r[j]));
  // start: least squares on log t (censored times as they are), σ from its residuals
  const ls = qr(Xk), b0 = ls.coef(y), r0 = y.map((v, i) => v - Xk[i].reduce((a, x, j) => a + x * b0[j], 0));
  let beta = b0.map(v => (Number.isFinite(v) ? v : 0));
  let tau = Math.log(Math.max(1e-3, Math.sqrt(r0.reduce((a, e) => a + e * e, 0) / Math.max(1, n - p))));
  if (distribution === 'weibull') { beta = beta.map((v, j) => (keep[j] === columns.indexOf('(Intercept)') ? v + 0.5772 * Math.exp(tau) : v)); }
  let cur = lik(Xk, y, status, beta, tau, D), iter = 0, converged = false;
  const warnings = [];
  for (iter = 1; iter <= maxit; iter++) {
    // Newton step: (−H) δ = g; halve while the likelihood falls
    let step;
    try { step = lu(cur.H.map(r => r.map(v => -v))).solve(cur.g); } catch { step = cur.g.map(v => v * 1e-3); }
    let lam = 1, next = null, nb, nt;
    for (let h = 0; h < 40; h++) {
      nb = beta.map((v, j) => v + lam * step[j]); nt = tau + lam * step[p];
      next = lik(Xk, y, status, nb, nt, D);
      if (Number.isFinite(next.ll) && next.ll >= cur.ll - 1e-12 * Math.abs(cur.ll)) break;
      lam /= 2;
    }
    const gain = next.ll - cur.ll;
    beta = nb; tau = nt; cur = next;
    if (Math.abs(gain) < tol * (Math.abs(cur.ll) + tol) && Math.max(...step.map(Math.abs)) * lam < 1e-7) { converged = true; break; }
  }
  if (!converged) warnings.push('the fit did not converge: some estimates may be running off (a factor setting with no failures?)');
  const V = inv(cur.H.map(r => r.map(v => -v)));
  const scale = Math.exp(tau);
  const coef = new Array(P).fill(NaN), se = new Array(P).fill(NaN);
  keep.forEach((j, a) => { coef[j] = beta[a]; se[j] = Math.sqrt(V[a][a]); });
  const cov = columns.map((_, i) => columns.map((_, j) => { const a = keep.indexOf(i), b = keep.indexOf(j); return a >= 0 && b >= 0 ? V[a][b] : NaN; }));
  const zstat = coef.map((b, j) => b / se[j]);
  const pv = zstat.map(z => (Number.isFinite(z) ? 2 * normal.sf(Math.abs(z)) : NaN));
  const linear = X.map(r => keep.reduce((a, j, k) => a + r[j] * beta[k], 0));
  const sumLogFail = y.reduce((a, v, i) => a + (status[i] === 1 ? v : 0), 0);
  const loglik = cur.ll - sumLogFail;
  const k = p + 1;
  return {
    model, columns, assign, n, events, censored: n - events, rank: p, dfRes: n - k, dfModel: p - (columns.includes('(Intercept)') ? 1 : 0),
    distribution, link: 'log', noise: distribution,
    coef, se, t: zstat, z: zstat, p: pv, statistic: 'z',
    cov, covFull: V, keep, scale, logScale: tau, logScaleSe: Math.sqrt(V[p][p]),
    aliased: f.aliased.map(j => columns[j]),
    loglik, k, aic: -2 * loglik + 2 * k,
    linear, fitted: linear.map(Math.exp), residuals: y.map((v, i) => (v - linear[i]) / scale), status: status.slice(), y, times: t.slice(),
    converged, iter, warnings, sigma: NaN, sigma2: NaN, r2: NaN, adjR2: NaN, X,
  };
}

/**
 * The p quantile of the time at model-matrix rows (default p = 0.5, the median), with a 1 − α
 * interval from the delta method on log T (as predict.survreg type "quantile" with se.fit):
 * [{ fit, se (of log), lower, upper, log, predLower, predUpper (the 2.5 and 97.5 % points of the
 * time's distribution at the estimates) }].
 */
export function survPredict(fit, X, { p = 0.5, level = 0.95 } = {}) {
  const D = SURV_DISTRIBUTIONS[fit.distribution], z = normal.isf((1 - level) / 2), wp = D.quantile(p);
  const K = fit.keep, V = fit.covFull, k = K.length;
  return X.map(row => {
    const x = K.map(j => row[j]);
    const eta = x.reduce((a, v, j) => a + v * fit.coef[K[j]], 0);
    const q = eta + fit.scale * wp;
    // gradient in (β, τ): (x, σ w_p)
    const g = [...x, fit.scale * wp];
    let v = 0;
    for (let a = 0; a <= k; a++) for (let b = 0; b <= k; b++) v += g[a] * V[a][b] * g[b];
    const se = Math.sqrt(Math.max(0, v));
    return { fit: Math.exp(q), log: q, se, seTime: se * Math.exp(q), lower: Math.exp(q - z * se), upper: Math.exp(q + z * se),
      predLower: Math.exp(eta + fit.scale * D.quantile(0.025)), predUpper: Math.exp(eta + fit.scale * D.quantile(0.975)) };
  });
}

// the fit with only some columns (for the tests): the same data
function refitCols(fit, cols) {
  const mm = { X: fit.X.map(r => cols.map(j => r[j])), columns: cols.map(j => fit.columns[j]), assign: cols.map(j => fit.assign[j]), model: fit.model };
  if (!cols.length) {
    // no columns at all: the scale alone (log T = σ W); fit with a zero column for the machinery
    return { loglik: fitSurvreg({ ...mm, X: fit.X.map(() => [0]), columns: ['0'], assign: [-1] }, fit.times, { distribution: fit.distribution, status: fit.status }).loglik, rank: 0 };
  }
  const r = fitSurvreg(mm, fit.times, { distribution: fit.distribution, status: fit.status });
  return { loglik: r.loglik, rank: r.rank };
}

const containedIn = (t, u) => t !== u && t.comps.every(c => u.comps.some(d => d.f === c.f && (d.pow ?? 1) === (c.pow ?? 1)));

/**
 * Likelihood-ratio tests of the model's terms: type 1 (sequential, as anova.survreg), 2 (each
 * term after the others not containing it) or 3 (each term last). Rows { term, df, chi2, p },
 * then { term: 'Residuals', df, loglik }.
 */
export function survTests(fit, type = 1) {
  if (![1, 2, 3].includes(type)) throw new Error('the type of test must be 1, 2 or 3');
  const { model, assign } = fit, rows = [], all = fit.columns.map((_, j) => j).filter(j => !Number.isNaN(fit.coef[j]));
  const colsOf = (ti) => all.filter(j => assign[j] === ti);
  const lr = (small, big) => { const df = big.rank - small.rank, x = 2 * (big.loglik - small.loglik); return { df, chi2: Math.max(0, x), p: df > 0 ? chi2.sf(Math.max(0, x), df) : NaN }; };
  if (type === 1) {
    let cols = all.filter(j => assign[j] === -1), prev = refitCols(fit, cols);
    model.terms.forEach((t, ti) => {
      const add = colsOf(ti);
      if (!add.length) return;
      cols = cols.concat(add);
      const cur = refitCols(fit, cols), r = lr(prev, cur);
      if (r.df > 0) rows.push({ term: t.label, ...r, loglik: cur.loglik });
      prev = cur;
    });
  } else {
    const full = { loglik: fit.loglik, rank: fit.rank };
    model.terms.forEach((t, ti) => {
      if (!colsOf(ti).length) return;
      const base = type === 2 ? all.filter(j => { const a = assign[j]; return a === -1 || (a !== ti && !containedIn(t, model.terms[a])); }) : all.filter(j => assign[j] !== ti);
      const r0 = refitCols(fit, base), r1 = type === 3 ? full : refitCols(fit, base.concat(colsOf(ti)));
      const r = lr(r0, r1);
      if (r.df > 0) rows.push({ term: t.label, ...r });
    });
  }
  rows.push({ term: 'Residuals', df: fit.dfRes, loglik: fit.loglik });
  return rows;
}

/** The likelihood-ratio test of dropping terms: small is big without them. */
export function survCompare(big, small) {
  const df = big.rank - small.rank;
  if (df === 0) return { df, chi2: NaN, F: NaN, p: 1 };
  const x = Math.max(0, 2 * (big.loglik - small.loglik));
  return { df, chi2: x, F: NaN, p: chi2.sf(x, df) };
}

/**
 * The Kaplan–Meier (product-limit) estimate of S at each distinct failure time: [{ time, atRisk,
 * failed, S }], for the probability plot. Censored times at a failure time count as at risk.
 */
export function kaplanMeier(t, status) {
  const idx = t.map((_, i) => i).sort((a, b) => t[a] - t[b] || status[b] - status[a]);
  let atRisk = t.length, S = 1;
  const out = [];
  for (let i = 0; i < idx.length;) {
    const time = t[idx[i]];
    let d = 0, c = 0;
    while (i < idx.length && t[idx[i]] === time) { if (status[idx[i]] === 1) d++; else c++; i++; }
    if (d > 0) { S *= 1 - d / atRisk; out.push({ time, atRisk, failed: d, S }); }
    atRisk -= d + c;
  }
  return out;
}

/** The Weibull shape β = 1/σ (for the Weibull model), and Wald intervals of the time ratios. */
export function timeRatios(fit, { level = 0.95 } = {}) {
  const z = normal.isf((1 - level) / 2);
  return fit.columns.map((c, j) => ({ term: c, assign: fit.assign[j], estimate: fit.coef[j], se: fit.se[j],
    ratio: Math.exp(fit.coef[j]), lower: Math.exp(fit.coef[j] - z * fit.se[j]), upper: Math.exp(fit.coef[j] + z * fit.se[j]) }))
    .filter(r => Number.isFinite(r.estimate));
}

// the rows of a fit grouped by their model-matrix row (the conditions tested), in first-seen order
function conditions(fit) {
  const by = new Map();
  fit.X.forEach((x, i) => { const k = x.join(','); if (!by.has(k)) by.set(k, []); by.get(k).push(i); });
  const shown = (fit.factors ?? []).filter(f => !f.block).map(f => f.id);
  return [...by.values()].map(idx => {
    const r = fit.rows?.[idx[0]], s = r?.settings ?? {};
    const runs = [...new Set(idx.map(i => fit.rows?.[i]?.run).filter(v => v !== undefined))];
    return { idx, runs, settings: Object.fromEntries((shown.length ? shown : Object.keys(s)).filter(k => k in s).map(k => [k, s[k]])), x: fit.X[idx[0]] };
  });
}

/**
 * Life at each condition tested: [{ runs, settings, units, failures, censored, quantiles: [{ p,
 * fit, lower, upper }] }], the model's p quantiles (default the B10 life and the median).
 */
export function lifeAtConditions(fit, { p = [0.1, 0.5], level = 0.95 } = {}) {
  return conditions(fit).map(c => {
    const failures = c.idx.filter(i => fit.status[i] === 1).length;
    return { runs: c.runs, settings: c.settings, units: c.idx.length, failures, censored: c.idx.length - failures,
      quantiles: p.map(q => ({ p: q, ...survPredict(fit, [c.x], { p: q, level })[0] })) };
  });
}

/**
 * The probability plot: for each condition tested, its failures at their plotting positions —
 * the Kaplan–Meier estimate of the fraction failed, midway through its step (so censored units
 * count, and the last failure is not at 100 %) — on the distribution's scale (Weibull:
 * log(−log(1 − F)); log-normal: Φ⁻¹(F)), against log time; and the fitted line, which is straight
 * on this scale: z = (log t − η)/σ. Returns { distribution, groups: [{ label, runs, points:
 * [{ t, F, z }], line: { eta, sigma } }], tMin, tMax }.
 */
export function probabilityPlot(fit) {
  const D = SURV_DISTRIBUTIONS[fit.distribution], qz = fit.distribution === 'weibull' ? (F) => Math.log(-Math.log1p(-F)) : (F) => normal.ppf(F);
  const groups = conditions(fit).map(c => {
    const t = c.idx.map(i => fit.times[i]), st = c.idx.map(i => fit.status[i]);
    let prev = 1;
    const points = kaplanMeier(t, st).map(k => { const F = 1 - (prev + k.S) / 2; prev = k.S; return { t: k.time, F, z: qz(F), failed: k.failed }; });
    const eta = c.x.reduce((a, v, j) => a + (Number.isFinite(fit.coef[j]) ? v * fit.coef[j] : 0), 0);
    const u = (k) => (fit.factors ?? []).find(f => f.id === k)?.units;
    return { label: Object.entries(c.settings).map(([k, v]) => `${k} = ${v}${u(k) ? ` ${u(k)}` : ''}`).join(', ') || 'all units', runs: c.runs, points, line: { eta, sigma: fit.scale }, units: c.idx.length };
  });
  return { distribution: fit.distribution, label: D.label, groups, tMin: Math.min(...fit.times), tMax: Math.max(...fit.times) };
}
