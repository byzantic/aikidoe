// Dose–response models (issue #65): log-logistic and Weibull curves fitted by nonlinear least
// squares, effective doses (EC50, ECx) with intervals, relative potency and parallelism, inverse
// prediction for standard curves, detection limits, and dose designs.
//
// Parameterisation as in R's drc (Ritz et al. 2015), with u = (x / e)^b:
//   LL.4   f = c + (d − c) / (1 + u)            LL.3: c = 0       LL.5: … / (1 + u)^f
//   W1.4   f = c + (d − c) exp(−u)              W2.4: f = c + (d − c) (1 − exp(−u))
// c and d are the response at one end and the other (for LL: d as x → 0 when b > 0, so b > 0 is a
// decreasing curve and b < 0 an increasing one), e the EC50 of LL.4 (the dose half way between
// c and d) and b the slope (minus the Hill coefficient). Doses of 0 are allowed.
//
//   fitDose({ x, y, curve? }, { model, separate, fixed, weights, varPower })  → fit
//   effectiveDose(fit, p, { curve, type: 'relative'|'absolute', interval: 'delta'|'log', level })
//   relativePotency(fit, { test, reference, p, interval, level })
//   compareFits(reduced, full)        F test of nested fits (e.g. parallel vs separate slopes)
//   parallelism(data, opts)           parallel and separate fits, F test, slope-ratio equivalence
//   inversePredict(fit, y0, { curve, m, level })     standard curve: dose for a response
//   detectionLimits(fit, { curve, k })               LOD (k = 3) and LOQ (k = 10)
//   predictDose(fit, xs, { curve, level })           fitted curve with a confidence band
import { levenbergMarquardt, rssHessian } from './nls.js';
import { inv } from '../linalg.js';
import { studentT, normal, fDist } from '../dist.js';

// ---------------------------------------------------------------- models

const LL = (fixedC) => ({
  value(x, P) {
    const u = x === 0 ? (P.b > 0 ? 0 : Infinity) : (x / P.e) ** P.b;
    const q = Number.isFinite(u) ? (1 + u) ** -(P.f ?? 1) : 0;
    return (fixedC ? 0 : P.c) + (P.d - (fixedC ? 0 : P.c)) * q;
  },
  grad(x, P) {
    const c = fixedC ? 0 : P.c, g = P.f ?? 1;
    const u = x === 0 ? (P.b > 0 ? 0 : Infinity) : (x / P.e) ** P.b;
    if (!Number.isFinite(u)) return { b: 0, c: 1, d: 0, e: 0, f: 0 };
    const q = (1 + u) ** -g, dq = -g * (1 + u) ** (-g - 1) * (P.d - c);
    const L = x > 0 ? Math.log(x / P.e) : 0;
    return { b: u > 0 ? dq * u * L : 0, c: 1 - q, d: q, e: u > 0 ? dq * (-P.b * u / P.e) : 0, f: u > 0 ? -(P.d - c) * q * Math.log1p(u) : 0 };
  },
});
const W = (type) => ({
  value(x, P) {
    const u = x === 0 ? (P.b > 0 ? 0 : Infinity) : (x / P.e) ** P.b;
    const g = type === 1 ? Math.exp(-u) : -Math.expm1(-u);
    return P.c + (P.d - P.c) * g;
  },
  grad(x, P) {
    const u = x === 0 ? (P.b > 0 ? 0 : Infinity) : (x / P.e) ** P.b;
    const eu = Math.exp(-u), g = type === 1 ? eu : -Math.expm1(-u);
    const du = (P.d - P.c) * (type === 1 ? -eu : eu);
    const L = x > 0 ? Math.log(x / P.e) : 0;
    const ok = Number.isFinite(u) && u > 0;
    return { b: ok ? du * u * L : 0, c: 1 - g, d: g, e: ok ? du * (-P.b * u / P.e) : 0 };
  },
});

/**
 * The models: parameter names, the curve, and the dose at which the response has moved p % of
 * the way from d (the x → 0 end when b > 0) towards c — drc's "relative" effective dose — and the
 * dose at an absolute response.
 */
export const MODELS = {
  'LL.4': { params: ['b', 'c', 'd', 'e'], ...LL(false), name: 'four-parameter log-logistic',
    ed: (P, p) => P.e * (p / (100 - p)) ** (1 / P.b),
    edAbs: (P, y) => P.e * ((P.d - P.c) / (y - P.c) - 1) ** (1 / P.b) },
  'LL.3': { params: ['b', 'd', 'e'], ...LL(true), name: 'three-parameter log-logistic (lower limit 0)',
    ed: (P, p) => P.e * (p / (100 - p)) ** (1 / P.b),
    edAbs: (P, y) => P.e * (P.d / y - 1) ** (1 / P.b) },
  'LL.5': { params: ['b', 'c', 'd', 'e', 'f'], ...LL(false), name: 'five-parameter log-logistic',
    ed: (P, p) => P.e * ((100 / (100 - p)) ** (1 / P.f) - 1) ** (1 / P.b),
    edAbs: (P, y) => P.e * (((P.d - P.c) / (y - P.c)) ** (1 / P.f) - 1) ** (1 / P.b) },
  'W1.4': { params: ['b', 'c', 'd', 'e'], ...W(1), name: 'four-parameter Weibull (type 1)',
    ed: (P, p) => P.e * (-Math.log((100 - p) / 100)) ** (1 / P.b),
    edAbs: (P, y) => P.e * (-Math.log((y - P.c) / (P.d - P.c))) ** (1 / P.b) },
  'W2.4': { params: ['b', 'c', 'd', 'e'], ...W(2), name: 'four-parameter Weibull (type 2)',
    ed: (P, p) => P.e * (-Math.log(p / 100)) ** (1 / P.b),
    edAbs: (P, y) => P.e * (-Math.log1p(-(y - P.c) / (P.d - P.c))) ** (1 / P.b) },
};

// ---------------------------------------------------------------- fitting

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

/** Starting values for one curve by linearising the model (drc-style self-start). */
function startValues(model, x, y) {
  const M = MODELS[model];
  const lo = Math.min(...y), hi = Math.max(...y), span = (hi - lo) || 1;
  const c = M.params.includes('c') ? lo - 0.01 * span : 0, d = hi + 0.01 * span;
  const pts = x.map((v, i) => [v, y[i]]).filter(([v]) => v > 0);
  const lin = (z) => {
    const X = pts.map(([v]) => Math.log(v)), mx = mean(X), mz = mean(z);
    const sxx = X.reduce((s, v) => s + (v - mx) ** 2, 0), sxz = X.reduce((s, v, i) => s + (v - mx) * (z[i] - mz), 0);
    const b = sxx > 0 ? sxz / sxx : 1;
    return { b: b || 1, e: Math.exp(mx - mz / (b || 1)) };
  };
  const clamp = (t) => Math.min(0.99, Math.max(0.01, t));
  let s;
  if (model.startsWith('LL')) s = lin(pts.map(([, v]) => { const t = clamp((v - c) / (d - c)); return Math.log((1 - t) / t); }));
  else if (model === 'W1.4') s = lin(pts.map(([, v]) => Math.log(-Math.log(clamp((v - c) / (d - c))))));
  else s = lin(pts.map(([, v]) => Math.log(-Math.log(1 - clamp((v - c) / (d - c))))));
  if (!Number.isFinite(s.e) || s.e <= 0) s.e = Math.exp(mean(pts.map(([v]) => Math.log(v))));
  return { b: s.b, c, d, e: s.e, f: 1 };
}

/**
 * Fit a dose–response model. data: { x, y, curve? } (curve labels; one curve if absent).
 * opts: model ('LL.4'), separate (parameters that differ between curves: default all;
 * 'parallel' = ['e']), fixed ({ c: 0, … } held at a value), weights (fixed, per observation),
 * varPower θ (variance ∝ mean^θ: weights 1/μ^θ, iterated), start ({ b, c, d, e, f }), vcov
 * ('hessian' as drc, default; 'gn' as nls).
 * Returns { model, curves, names, estimates: [{ name, param, curve, estimate, se, t, p }],
 * P (per-curve parameter objects), cov (natural scale), sigma, df, rss, n, fitted, residuals,
 * converged, iterations, logLik, weights }.
 */
export function fitDose(data, opts = {}) {
  const model = opts.model ?? 'LL.4', M = MODELS[model];
  if (!M) throw new Error(`model must be one of ${Object.keys(MODELS).join(', ')}`);
  const keep = data.x.map((v, i) => Number.isFinite(v) && v >= 0 && Number.isFinite(data.y[i]));
  const x = data.x.filter((_, i) => keep[i]), y = data.y.filter((_, i) => keep[i]);
  const cv = (data.curve ?? data.x.map(() => '1')).filter((_, i) => keep[i]).map(String);
  const curves = [...new Set(cv)];
  const fixed = opts.fixed ?? {};
  const free = M.params.filter(p => fixed[p] === undefined);
  const sep = curves.length < 2 ? [] : opts.separate === 'parallel' ? ['e'] : (opts.separate ?? free).filter(p => free.includes(p));
  // θ layout: for each free parameter, one entry (shared) or one per curve; e on the log scale
  const layout = [];
  for (const p of free) if (sep.includes(p)) curves.forEach((c, k) => layout.push({ p, k, curve: c })); else layout.push({ p, k: null });
  const ci = cv.map(c => curves.indexOf(c));
  const paramsOf = (theta, natural = false) => curves.map((_, k) => {
    const P = { ...fixed };
    layout.forEach((L, j) => { if (L.k === null || L.k === k) P[L.p] = L.p === 'e' && !natural ? Math.exp(theta[j]) : theta[j]; });
    return P;
  });
  const fFor = (natural) => (theta) => { const Ps = paramsOf(theta, natural); return x.map((v, i) => M.value(v, Ps[ci[i]])); };
  const jFor = (natural) => (theta) => {
    const Ps = paramsOf(theta, natural);
    return x.map((v, i) => {
      const g = M.grad(v, Ps[ci[i]]);
      return layout.map(L => ((L.k === null || L.k === ci[i]) ? (L.p === 'e' && !natural ? g.e * Ps[ci[i]].e : g[L.p]) : 0));
    });
  };
  // starting values: per curve, averaged for shared parameters
  const starts = curves.map((c) => ({ ...startValues(model, x.filter((_, i) => cv[i] === c), y.filter((_, i) => cv[i] === c)), ...(opts.start ?? {}) }));
  const theta0 = layout.map(L => { const v = L.k === null ? mean(starts.map(s => (L.p === 'e' ? Math.log(s.e) : s[L.p]))) : (L.p === 'e' ? Math.log(starts[L.k].e) : starts[L.k][L.p]); return v; });
  let w = opts.weights ? opts.weights.filter((_, i) => keep[i]) : null;
  const run = (th0, ww) => levenbergMarquardt({ f: fFor(false), jacobian: jFor(false), y, w: ww, theta0: th0 });
  const multistart = (ww) => {
    let best = run(theta0, ww);
    if (!best.converged || !Number.isFinite(best.rss)) {
      // other starts: slopes ±1, ±2 and EC50s across the doses
      const pos = x.filter(v => v > 0).sort((a, b) => a - b);
      for (const bs of [1, -1, 2, -2, 0.5, -0.5]) for (const qq of [0.25, 0.5, 0.75]) {
        const e0 = Math.log(pos[Math.floor(qq * (pos.length - 1))]);
        const th = theta0.map((v, j) => (layout[j].p === 'b' ? bs : layout[j].p === 'e' ? e0 : v));
        const r = run(th, ww);
        if (Number.isFinite(r.rss) && (!Number.isFinite(best.rss) || r.rss < best.rss - 1e-12)) best = r;
      }
    }
    return best;
  };
  let res = multistart(w), wIter = 0;
  if (opts.varPower) {
    // variance ∝ μ^θ: weights 1/|μ|^θ (mean 1), refitted until the weights settle
    for (; wIter < 50; wIter++) {
      const mu = fFor(false)(res.theta);
      const raw = mu.map(m => 1 / Math.max(Math.abs(m), 1e-12) ** opts.varPower), s = mean(raw);
      const nw = raw.map(v => v / s);
      const change = w ? Math.max(...nw.map((v, i) => Math.abs(v - w[i]) / v)) : Infinity;
      w = nw;
      res = run(res.theta, w);
      if (change < 1e-8) break;
    }
  }
  // natural-scale estimates, covariance from the Hessian of the RSS (as drc)
  const theta = res.theta.map((v, j) => (layout[j].p === 'e' ? Math.exp(v) : v));
  const n = x.length, p = layout.length, df = n - p;
  const fitted = fFor(true)(theta), residuals = y.map((v, i) => v - fitted[i]);
  const rss = residuals.reduce((s, r, i) => s + (w ? w[i] : 1) * r * r, 0);
  const sigma = df > 0 ? Math.sqrt(rss / df) : NaN;
  // covariance: σ² (H/2)⁻¹ with H the exact Hessian of the RSS (as drc), or σ² (JᵀWJ)⁻¹ (the
  // Gauss–Newton approximation, as R's nls) with vcov: 'gn'
  let cov = null;
  try {
    let A;
    if (opts.vcov === 'gn') {
      const J = jFor(true)(theta);
      A = layout.map((_, a) => layout.map((__, b) => J.reduce((s, r, i) => s + (w ? w[i] : 1) * r[a] * r[b], 0)));
    } else A = rssHessian({ f: fFor(true), jacobian: jFor(true), y, w }, theta).map(r => r.map(v => v / 2));
    cov = inv(A).map(r => r.map(v => v * sigma * sigma));
  } catch { cov = layout.map(() => layout.map(() => NaN)); }
  const names = layout.map(L => (L.k === null || curves.length < 2 ? (curves.length > 1 && L.k !== null ? `${L.p}:${L.curve}` : L.p) : `${L.p}:${L.curve}`));
  const se = cov.map((r, j) => Math.sqrt(r[j]));
  const estimates = layout.map((L, j) => {
    const t = theta[j] / se[j];
    return { name: names[j], param: L.p, curve: L.k === null ? null : L.curve, estimate: theta[j], se: se[j], t, p: df > 0 ? 2 * studentT.sf(Math.abs(t), df) : NaN };
  });
  const sumW = w ? w.reduce((s, v) => s + Math.log(v), 0) : 0;
  const logLik = -n / 2 * (Math.log(2 * Math.PI) + Math.log(rss / n) + 1) + sumW / 2;
  return { model, curves, layout, names, estimates, theta, P: paramsOf(theta, true), cov, sigma, df, rss, n, x, y, curve: cv, fitted, residuals,
    converged: res.converged, iterations: res.iterations + wIter, logLik, weights: w, varPower: opts.varPower ?? 0, fixed };
}

// ---------------------------------------------------------------- derived quantities

/** Gradient of a function of the parameters (natural scale) by central differences. */
function gradTheta(fit, g) {
  return fit.theta.map((v, j) => {
    const h = 1e-6 * Math.max(Math.abs(v), 1e-4);
    const up = fit.theta.slice(), dn = fit.theta.slice(); up[j] += h; dn[j] -= h;
    return (g(up) - g(dn)) / (2 * h);
  });
}
const quad = (g, C) => g.reduce((s, gi, i) => s + gi * g.reduce((t, gj, j) => t + C[i][j] * gj, 0), 0);
/** Parameters of curve k from a θ vector (natural scale). */
function paramsAt(fit, theta, k) {
  const P = { ...fit.fixed };
  fit.layout.forEach((L, j) => { if (L.k === null || L.k === k) P[L.p] = theta[j]; });
  return P;
}
const curveIndex = (fit, curve) => {
  if (curve === undefined || curve === null) { if (fit.curves.length > 1) throw new Error(`say which curve (${fit.curves.join(', ')})`); return 0; }
  const k = fit.curves.indexOf(String(curve));
  if (k < 0) throw new Error(`no curve "${curve}" (${fit.curves.join(', ')})`);
  return k;
};
const quantile = (fit, level) => (fit.df > 0 ? studentT.ppf(1 - (1 - level) / 2, fit.df) : normal.ppf(1 - (1 - level) / 2));

/** An estimate with its standard error and interval: delta (symmetric) or log (symmetric on the log scale). */
function interval(est, se, q, how) {
  if (how === 'log') return { estimate: est, se, lower: est * Math.exp(-q * se / est), upper: est * Math.exp(q * se / est) };
  return { estimate: est, se, lower: est - q * se, upper: est + q * se };
}

/**
 * The effective dose EDp of a curve: type 'relative' (p % of the way from d towards c, as drc's
 * default) or 'absolute' (the dose at response p). interval 'delta' (default) or 'log' (symmetric on the log dose; drc's fls for log-parameterised models).
 */
export function effectiveDose(fit, p, { curve, type = 'relative', interval: how = 'delta', level = 0.95 } = {}) {
  const k = curveIndex(fit, curve), M = MODELS[fit.model];
  const g = (th) => { const P = paramsAt(fit, th, k); return type === 'absolute' ? M.edAbs(P, p) : M.ed(P, p); };
  const est = g(fit.theta);
  if (!Number.isFinite(est)) throw new Error(type === 'absolute' ? `the curve never reaches ${p}` : `ED${p} is not defined for this curve`);
  const se = Math.sqrt(quad(gradTheta(fit, g), fit.cov));
  return { p, type, curve: fit.curves[k], ...interval(est, se, quantile(fit, level), how), interval: how, level };
}

/**
 * Relative potency of a test curve against a reference: ED_reference / ED_test at p (> 1: the
 * test is more potent), with a delta-method or log-scale interval.
 */
export function relativePotency(fit, { test, reference, p = 50, interval: how = 'delta', level = 0.95 } = {}) {
  const kt = curveIndex(fit, test), kr = curveIndex(fit, reference), M = MODELS[fit.model];
  const g = (th) => M.ed(paramsAt(fit, th, kr), p) / M.ed(paramsAt(fit, th, kt), p);
  const est = g(fit.theta), se = Math.sqrt(quad(gradTheta(fit, g), fit.cov));
  return { test: fit.curves[kt], reference: fit.curves[kr], p, ...interval(est, se, quantile(fit, level), how), interval: how, level };
}

/** F test of nested fits (reduced ⊂ full), as drc's anova. */
export function compareFits(reduced, full) {
  const df1 = reduced.df - full.df, df2 = full.df;
  const F = ((reduced.rss - full.rss) / df1) / (full.rss / df2);
  return { F, df1, df2, p: fDist.sf(F, df1, df2), rssReduced: reduced.rss, rssFull: full.rss };
}

/**
 * Are two or more curves parallel (same slope and asymptotes, shifted along the dose axis)? Fits
 * the parallel model (only e differs) and the separate model, and gives the F test and, for two
 * curves, the ratio of slopes with a 90 % interval — equivalence (USP ⟨1032⟩) when it lies within
 * [1/margin, margin].
 */
export function parallelism(data, { model = 'LL.4', margin = 1.25, weights, varPower, test, reference } = {}) {
  const par = fitDose(data, { model, separate: 'parallel', weights, varPower });
  const sep = fitDose(data, { model, weights, varPower });
  const F = compareFits(par, sep);
  let slope = null;
  if (sep.curves.length === 2) {
    const kt = curveIndex(sep, test ?? sep.curves[1]), kr = curveIndex(sep, reference ?? sep.curves[0]);
    const g = (th) => paramsAt(sep, th, kt).b / paramsAt(sep, th, kr).b;
    const est = g(sep.theta), se = Math.sqrt(quad(gradTheta(sep, g), sep.cov));
    const r = interval(est, se, quantile(sep, 0.9), 'log');
    slope = { ...r, level: 0.9, margin, equivalent: r.lower >= 1 / margin && r.upper <= margin };
  }
  return { parallel: par, separate: sep, F, slopeRatio: slope };
}

/**
 * Inverse prediction on a standard curve: the dose giving response y0 (the mean of m readings),
 * with an interval from the curve's uncertainty and the readings' noise (σ²/m) — delta method on
 * the log dose.
 */
export function inversePredict(fit, y0, { curve, m = 1, level = 0.95 } = {}) {
  const k = curveIndex(fit, curve), M = MODELS[fit.model];
  const at = (th, yy) => M.edAbs(paramsAt(fit, th, k), yy);
  const est = at(fit.theta, y0);
  if (!Number.isFinite(est) || est <= 0) return { y0, estimate: NaN, lower: NaN, upper: NaN, note: 'outside the range of the curve' };
  const lg = (th) => Math.log(at(th, y0));
  const gth = gradTheta(fit, lg);
  const hy = 1e-6 * Math.max(Math.abs(y0), 1e-6);
  const gy = (Math.log(at(fit.theta, y0 + hy)) - Math.log(at(fit.theta, y0 - hy))) / (2 * hy);
  const v = quad(gth, fit.cov) + gy * gy * fit.sigma * fit.sigma / m;
  const q = quantile(fit, level), s = Math.sqrt(v);
  return { y0, m, estimate: est, seLog: s, lower: est * Math.exp(-q * s), upper: est * Math.exp(q * s) };
}

/**
 * Detection and quantification limits of a standard curve: the doses where the response moves
 * k σ from the zero-dose asymptote (LOD k = 3, LOQ k = 10, σ the residual SD), towards the other
 * asymptote. Undefined (NaN) when the curve never gets that far.
 */
export function detectionLimits(fit, { curve, kLod = 3, kLoq = 10 } = {}) {
  const k = curveIndex(fit, curve), P = fit.P[k], M = MODELS[fit.model];
  const zero = M.value(0, P), far = M.value(1e300, P), dir = Math.sign(far - zero);
  const at = (kk) => { const y = zero + dir * kk * fit.sigma; return (dir > 0 ? y < far : y > far) ? M.edAbs(P, y) : NaN; };
  return { curve: fit.curves[k], blank: zero, sigma: fit.sigma, lod: at(kLod), loq: at(kLoq), kLod, kLoq };
}

/** The fitted curve at doses xs with a pointwise confidence band (delta method). */
export function predictDose(fit, xs, { curve, level = 0.95 } = {}) {
  const k = curveIndex(fit, curve), M = MODELS[fit.model], q = quantile(fit, level);
  return xs.map(x => {
    const g = (th) => M.value(x, paramsAt(fit, th, k));
    const est = g(fit.theta), se = Math.sqrt(Math.max(0, quad(gradTheta(fit, g), fit.cov)));
    return { x, fit: est, se, lower: est - q * se, upper: est + q * se };
  });
}

// ---------------------------------------------------------------- designs

/** A dilution series: n doses from top down by a dilution factor (and zeros). */
export function dilutionSeries({ top, dilution, doses, zeros = 0 }) {
  if (!(top > 0) || !(dilution > 1) || !(doses >= 2)) throw new Error('a dilution series needs top > 0, dilution > 1 and at least 2 doses');
  const out = Array.from({ length: doses }, (_, i) => +(top / dilution ** i).toPrecision(12)).reverse();
  return [...Array(zeros).fill(0), ...out];
}

/** Information matrix of a single-curve design (doses with counts) at parameter values P. */
function information(model, P, doses, counts, logE = true) {
  const M = MODELS[model], ps = M.params;
  const I = ps.map(() => ps.map(() => 0));
  doses.forEach((x, i) => {
    const g = M.grad(x, P), v = ps.map(p => (p === 'e' && logE ? g.e * P.e : g[p]));
    for (let a = 0; a < ps.length; a++) for (let b = 0; b < ps.length; b++) I[a][b] += counts[i] * v[a] * v[b];
  });
  return I;
}
const logdet = (A) => { try { const { L } = cholOf(A); return 2 * L.reduce((s, r, i) => s + Math.log(r[i]), 0); } catch { return -Infinity; } };
function cholOf(A) {
  const n = A.length, L = A.map(() => new Array(n).fill(0));
  for (let j = 0; j < n; j++) {
    let d = A[j][j]; for (let k = 0; k < j; k++) d -= L[j][k] ** 2;
    if (!(d > 1e-14 * Math.max(1, Math.abs(A[j][j])))) throw new Error('singular');
    L[j][j] = Math.sqrt(d);
    for (let i = j + 1; i < n; i++) { let s = A[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]; L[i][j] = s / L[j][j]; }
  }
  return { L };
}

/**
 * How well a design (doses, one per run) would estimate the curve at guessed parameters: the
 * standard error of log EC50 (e) and of each parameter, in units of σ, and log det of the
 * information. guesses may be a list (robust: averaged).
 */
export function doseDesignQuality(doses, { model = 'LL.4', guess, sigma = 1 }) {
  const gs = Array.isArray(guess) ? guess : [guess];
  const uniq = [...new Set(doses)], counts = uniq.map(u => doses.filter(d => d === u).length);
  const per = gs.map(P => {
    const I = information(model, P, uniq, counts);
    let C; try { C = inv(I); } catch { C = null; }
    const ie = MODELS[model].params.indexOf('e');
    return { logdet: logdet(I), seLogE: C && C[ie][ie] > 0 ? sigma * Math.sqrt(C[ie][ie]) : Infinity };
  });
  return { logdet: mean(per.map(x => x.logdet)), seLogE: Math.sqrt(mean(per.map(x => x.seLogE ** 2))), scenarios: per };
}

/**
 * Guesses for a robust design: the EC50 spread ×/÷ factor (5 points, log-even) and the slope
 * ×/÷ 1.5, around { b, c, d, e }.
 */
export function guessScenarios(guess, { factor = 1, slope = 1.5 } = {}) {
  if (!(factor > 1)) return [guess];
  const es = [-1, -0.5, 0, 0.5, 1].map(t => guess.e * factor ** t);
  const bs = slope > 1 ? [guess.b / slope, guess.b, guess.b * slope] : [guess.b];
  return es.flatMap(e => bs.map(b => ({ ...guess, e, b })));
}

/**
 * An optimal set of doses for runs runs at guessed parameters (a list = robust): exchange on a
 * log-spaced grid over [lo, hi] (and zero if allowed). criterion 'D' (all parameters) or 'EC50'
 * (the variance of log EC50). Returns { doses (sorted, one per run), criterion value, quality }.
 */
export function optimalDoses({ model = 'LL.4', guess, runs, range, criterion = 'D', zero = true, grid = 41, seed = 1 }) {
  const gs = Array.isArray(guess) ? guess : [guess];
  const [lo, hi] = range;
  if (!(lo > 0 && hi > lo)) throw new Error('range: 0 < low < high');
  const cand = [...(zero ? [0] : []), ...Array.from({ length: grid }, (_, i) => +(lo * (hi / lo) ** (i / (grid - 1))).toPrecision(6))];
  const score = (ds) => {
    const q = doseDesignQuality(ds, { model, guess: gs });
    return criterion === 'EC50' ? -q.seLogE : q.logdet;
  };
  // start: log-spaced over the range
  let ds = Array.from({ length: runs }, (_, i) => cand[Math.round((zero ? 1 : 0) + i * (cand.length - 1 - (zero ? 1 : 0)) / Math.max(1, runs - 1))]);
  let best = score(ds);
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    for (let i = 0; i < runs; i++) {
      let bi = ds[i];
      for (const c of cand) {
        if (c === ds[i]) continue;
        const t = ds.slice(); t[i] = c;
        const s = score(t);
        if (s > best + 1e-10) { best = s; bi = c; }
      }
      if (bi !== ds[i]) { ds[i] = bi; changed = true; }
    }
    if (!changed) break;
  }
  ds.sort((a, b) => a - b);
  return { doses: ds, criterion, value: best, quality: doseDesignQuality(ds, { model, guess: gs }) };
}

/**
 * Power to detect a relative potency ratio between two parallel curves, each run on the doses
 * given, at guessed parameters and σ: asymptotic (Wald test of log ratio = 0). Returns
 * { power, seLogRatio, detectable (ratio with 80 % power) }.
 */
export function potencyPower(doses, { model = 'LL.4', guess, sigma, ratio, alpha = 0.05 }) {
  const M = MODELS[model], ps = M.params;
  const uniq = [...new Set(doses)], counts = uniq.map(u => doses.filter(d => d === u).length);
  // joint information for (shared parameters, log e₁, log e₂): the reference at e, the test at e / ratio
  const shared = ps.filter(p => p !== 'e'), q = shared.length + 2;
  const I = Array.from({ length: q }, () => new Array(q).fill(0));
  [guess, { ...guess, e: guess.e / ratio }].forEach((P, k) => uniq.forEach((x, i) => {
    const g = M.grad(x, P), v = [...shared.map(p => g[p]), ...(k === 0 ? [g.e * P.e, 0] : [0, g.e * P.e])];
    for (let a = 0; a < q; a++) for (let b = 0; b < q; b++) I[a][b] += counts[i] * v[a] * v[b];
  }));
  const C = inv(I), a = q - 2, vlr = C[a][a] + C[a + 1][a + 1] - 2 * C[a][a + 1];
  const se = sigma * Math.sqrt(vlr), z = normal.ppf(1 - alpha / 2), d = Math.abs(Math.log(ratio));
  const power = normal.cdf(d / se - z) + normal.cdf(-d / se - z);
  return { power, seLogRatio: se, detectable: Math.exp((z + normal.ppf(0.8)) * se) };
}
