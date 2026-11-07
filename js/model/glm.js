// Generalised linear models (issue #64, phase 1): counts and proportions.
//
//   fitGLM(mm, y, o)       fit by iteratively reweighted least squares, as R's glm.fit
//   glmTests(fit, type)    deviance tests of the terms: type 1 sequential (R anova.glm), 2 or 3
//                          likelihood ratio (car::Anova test = "LR"; F with an estimated dispersion)
//   glmCompare(big, small) likelihood-ratio (or F) test of nested fits
//   glmPredict(fit, X, o)  predictions with intervals on the link scale, transformed back
//   glmConfint(fit, o)     profile-likelihood (or Wald) intervals for the coefficients
//
// Families (o.distribution): poisson, quasipoisson, negbin (θ by maximum likelihood, as
// MASS::glm.nb), binomial, quasibinomial. For the binomial, y is the proportion of successes and
// o.weights the trials. Links: log, identity, sqrt (counts); logit, probit, cloglog (proportions).
// o.offset is added to the linear predictor (log exposure). o.firth: Firth's penalised likelihood
// (binomial logit, poisson log), whose estimates exist under separation (brglm2, type "AS_mean").
//
// Numerics follow glm.fit: starting values, the convergence test |D − D_old| / (|D| + 0.1) < 1e-8,
// step halving, the QR tolerance 1e-11, and the covariance from the last weighted QR.
import { qr, eigSym } from '../linalg.js';
import { normal as N, chi2, fDist, studentT, lgamma, lbeta, gammaInc, betaInc } from '../dist.js';
import { rng } from '../design/rng.js';
import { containedIn } from './formula.js';

const EPS = 2.220446049250313e-16;
const sum = (a) => a.reduce((s, v) => s + v, 0);
const ylogy = (y, m) => (y > 0 ? y * Math.log(y / m) : 0);
const lchoose = (n, k) => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);

// ---------------------------------------------------------------- links (as R's make.link and binomial())

const THRESH = 30, MTHRESH = -30, INVEPS = 1 / EPS, PTHRESH = -N.ppf(EPS);
export const LINKS = {
  identity: { name: 'identity', fun: (m) => m, inv: (e) => e, deriv: () => 1, valid: () => true },
  log: { name: 'log', fun: Math.log, inv: (e) => Math.max(Math.exp(e), EPS), deriv: (e) => Math.max(Math.exp(e), EPS), valid: () => true },
  sqrt: { name: 'sqrt', fun: Math.sqrt, inv: (e) => e * e, deriv: (e) => 2 * e, valid: (e) => e > 0 },
  logit: {
    name: 'logit', fun: (m) => Math.log(m / (1 - m)),
    inv: (e) => { const t = e < MTHRESH ? EPS : e > THRESH ? INVEPS : Math.exp(e); return t / (1 + t); },
    deriv: (e) => { const o = 1 + Math.exp(e); return e > THRESH || e < MTHRESH ? EPS : Math.exp(e) / (o * o); }, valid: () => true,
  },
  probit: {
    name: 'probit', fun: (m) => N.ppf(m),
    inv: (e) => N.cdf(Math.min(Math.max(e, -PTHRESH), PTHRESH)), deriv: (e) => Math.max(N.pdf(e), EPS), valid: () => true,
  },
  cloglog: {
    name: 'cloglog', fun: (m) => Math.log(-Math.log(1 - m)),
    inv: (e) => Math.max(Math.min(-Math.expm1(-Math.exp(e)), 1 - EPS), EPS),
    deriv: (e) => { e = Math.min(e, 700); return Math.max(Math.exp(e) * Math.exp(-Math.exp(e)), EPS); }, valid: () => true,
  },
};

// ---------------------------------------------------------------- families

const COUNT_LINKS = ['log', 'identity', 'sqrt'], PROP_LINKS = ['logit', 'probit', 'cloglog'];
export const DISTRIBUTIONS = {
  poisson: { counts: true, links: COUNT_LINKS, dispersion: 'fixed', label: 'Poisson' },
  quasipoisson: { counts: true, links: COUNT_LINKS, dispersion: 'estimated', label: 'quasi-Poisson' },
  negbin: { counts: true, links: COUNT_LINKS, dispersion: 'fixed', label: 'negative binomial' },
  binomial: { counts: false, links: PROP_LINKS, dispersion: 'fixed', label: 'binomial' },
  quasibinomial: { counts: false, links: PROP_LINKS, dispersion: 'estimated', label: 'quasi-binomial' },
};
export const canonicalLink = (d) => (DISTRIBUTIONS[d].counts ? 'log' : 'logit');

/** A family: variance, deviance residuals, starting values and validity, as R's family objects. */
export function family(distribution, link = canonicalLink(distribution), theta) {
  const D = DISTRIBUTIONS[distribution];
  if (!D) throw new Error(`unknown distribution "${distribution}"`);
  if (!D.links.includes(link)) throw new Error(`the ${D.label} distribution takes the ${D.links.join(', ')} link, not "${link}"`);
  const L = LINKS[link];
  if (distribution === 'poisson' || distribution === 'quasipoisson')
    return { distribution, D, link: L, variance: (m) => m, devRes: (y, m, w) => 2 * w * (ylogy(y, m) - (y - m)), mustart: (y) => y + 0.1, validMu: (m) => Number.isFinite(m) && m > 0 };
  if (distribution === 'negbin') {
    if (!(theta > 0)) throw new Error('the negative binomial needs θ > 0');
    return {
      distribution, D, link: L, theta, variance: (m) => m + m * m / theta,
      devRes: (y, m, w) => 2 * w * (y * Math.log(Math.max(1, y) / m) - (y + theta) * Math.log((y + theta) / (m + theta))),
      mustart: (y) => y + (y === 0 ? 1 / 6 : 0), validMu: (m) => Number.isFinite(m) && m > 0,
    };
  }
  return {
    distribution, D, link: L, variance: (m) => m * (1 - m),
    devRes: (y, m, w) => 2 * w * (ylogy(y, m) + ylogy(1 - y, 1 - m)),
    mustart: (y, w) => (w * y + 0.5) / (w + 1), validMu: (m) => Number.isFinite(m) && m > 0 && m < 1,
  };
}

/** Log-likelihood of observations under a fixed-dispersion family (NaN for quasi families). */
function loglikOf(fam, y, mu, w) {
  if (fam.D.dispersion === 'estimated') return NaN;
  let s = 0;
  for (let i = 0; i < y.length; i++) {
    if (fam.distribution === 'poisson') s += w[i] * (y[i] > 0 ? y[i] * Math.log(mu[i]) : 0) - w[i] * mu[i] - w[i] * lgamma(y[i] + 1);
    else if (fam.distribution === 'negbin') {
      const th = fam.theta;
      s += w[i] * (lgamma(th + y[i]) - lgamma(th) - lgamma(y[i] + 1) + th * Math.log(th) + y[i] * Math.log(mu[i] + (y[i] === 0 ? 1 : 0)) - (th + y[i]) * Math.log(th + mu[i]));
    } else {
      const m = w[i], k = Math.round(m * y[i]);
      if (m > 0) s += lchoose(m, k) + (k > 0 ? k * Math.log(mu[i]) : 0) + (m - k > 0 ? (m - k) * Math.log(1 - mu[i]) : 0);
    }
  }
  return s;
}

// ---------------------------------------------------------------- IRLS (glm.fit)

const linear = (X, b, offset) => X.map((r, i) => { let s = offset[i]; for (let j = 0; j < r.length; j++) if (!Number.isNaN(b[j])) s += r[j] * b[j]; return s; });

/**
 * One GLM fit by IRLS. Returns { coef, eta, mu, dev, w (working weights √), f (QR of the last
 * weighted solve), iter, converged, boundary }.
 */
export function irls(X, y, fam, { weights, offset, start, etastart, maxit = 25, epsilon = 1e-8, pseudo } = {}) {
  const n = y.length, p = X[0]?.length ?? 0;
  const w0 = weights ?? y.map(() => 1), off = offset ?? y.map(() => 0);
  const L = fam.link;
  const devOf = (mu) => { let s = 0; for (let i = 0; i < n; i++) s += fam.devRes(y[i], mu[i], w0[i]); return s; };
  if (!p) {
    const eta = off.slice(), mu = eta.map(L.inv);
    return { coef: [], eta, mu, dev: devOf(mu), w: [], f: null, iter: 0, converged: true, boundary: false };
  }
  let eta = start ? linear(X, start, off) : etastart ? etastart.slice() : y.map((v, i) => L.fun(fam.mustart(v, w0[i])));
  let mu = eta.map(L.inv);
  let devold = devOf(mu), coef = start ? start.slice() : null, coefold = start ? start.slice() : null;
  let converged = false, boundary = false, iter = 0, f = null, wts = null;
  for (iter = 1; iter <= maxit; iter++) {
    // pseudo: Firth's adjusted data for this iteration (successes and trials, or counts)
    const yy = pseudo ? pseudo.y(eta, mu) : y, ww = pseudo ? pseudo.w(eta, mu) : w0;
    const me = eta.map(L.deriv);
    const z = eta.map((e, i) => e - off[i] + (yy[i] - mu[i]) / me[i]);
    wts = mu.map((m, i) => Math.sqrt(ww[i] * me[i] * me[i] / fam.variance(m)));
    f = qr(X.map((r, i) => r.map(v => v * wts[i])), { tol: Math.min(1e-7, epsilon / 1000) });
    let b = f.coef(z.map((v, i) => v * wts[i]));
    eta = linear(X, b, off); mu = eta.map(L.inv);
    let dev = devOf(mu);
    // step halving when the deviance is not finite or μ / η leave their range
    const bad = () => !Number.isFinite(dev) || !mu.every(fam.validMu) || !eta.every(L.valid);
    if (bad()) {
      if (!coefold) throw new Error('no valid set of coefficients: please supply starting values');
      for (let k = 0; bad() && k < maxit; k++) {
        b = b.map((v, j) => (v + coefold[j]) / 2);
        eta = linear(X, b, off); mu = eta.map(L.inv); dev = devOf(mu);
      }
      boundary = true;
      if (bad()) throw new Error('the fit failed: the deviance stayed infinite after step halving');
    }
    coef = b;
    if (Math.abs(dev - devold) / (Math.abs(dev) + 0.1) < epsilon) { converged = true; devold = dev; break; }
    devold = dev; coefold = coef;
  }
  return { coef, eta, mu, dev: devold, w: wts, f, iter: Math.min(iter, maxit), converged, boundary };
}

// ---------------------------------------------------------------- negative binomial θ (MASS)

function digamma(x) {
  let r = 0;
  while (x < 6) { r -= 1 / x; x += 1; }
  const f = 1 / (x * x);
  return r + Math.log(x) - 0.5 / x - f * (1 / 12 - f * (1 / 120 - f * (1 / 252 - f * (1 / 240 - f / 132))));
}
function trigamma(x) {
  let r = 0;
  while (x < 6) { r += 1 / (x * x); x += 1; }
  const f = 1 / (x * x);
  return r + 1 / x + f / 2 + (1 / x) * f * (1 / 6 - f * (1 / 30 - f * (1 / 42 - f / 30)));
}

/** θ by maximum likelihood given μ (MASS::theta.ml). Returns { theta, se }. */
export function thetaML(y, mu, w = y.map(() => 1), { limit = 25, eps = EPS ** 0.25 } = {}) {
  const n = sum(w);
  const score = (th) => sum(y.map((v, i) => w[i] * (digamma(th + v) - digamma(th) + Math.log(th) + 1 - Math.log(th + mu[i]) - (v + th) / (mu[i] + th))));
  const info = (th) => sum(y.map((v, i) => w[i] * (-trigamma(th + v) + trigamma(th) - 1 / th + 2 / (mu[i] + th) - (v + th) / (mu[i] + th) ** 2)));
  let t0 = n / sum(y.map((v, i) => w[i] * (v / mu[i] - 1) ** 2)), del = 1, it = 0, i0 = NaN;
  while (++it < limit && Math.abs(del) > eps) { t0 = Math.abs(t0); i0 = info(t0); del = score(t0) / i0; t0 += del; }
  const warn = [];
  if (t0 < 0) { t0 = 0; warn.push('θ estimate truncated at 0'); }
  if (it === limit) warn.push('θ: iteration limit reached');
  return { theta: t0, se: Math.sqrt(1 / i0), warnings: warn };
}

const nbLoglik = (th, mu, y, w) => sum(y.map((v, i) => w[i] * (lgamma(th + v) - lgamma(th) - lgamma(v + 1) + th * Math.log(th) + v * Math.log(mu[i] + (v === 0 ? 1 : 0)) - (th + v) * Math.log(th + mu[i]))));

// ---------------------------------------------------------------- the fit

/**
 * Fit a GLM to a model matrix mm (formula.js). y: counts, or proportions for the binomial.
 * o: distribution, link, weights (binomial trials; prior weights otherwise), offset, firth,
 * theta (negbin: fixed θ instead of estimating it).
 */
export function fitGLM(mm, y, o = {}) {
  const { X, columns, assign, model } = mm;
  const n = X.length, p = columns.length;
  if (y.length !== n) throw new Error(`${y.length} responses for ${n} rows`);
  const distribution = o.distribution ?? 'poisson', link = o.link ?? canonicalLink(distribution);
  const weights = o.weights ?? y.map(() => 1), offset = o.offset ?? y.map(() => 0);
  if (y.some(v => !Number.isFinite(v))) throw new Error('responses must be finite numbers (remove missing values first)');
  const counts = DISTRIBUTIONS[distribution]?.counts;
  if (counts && y.some(v => v < 0)) throw new Error('counts must be ≥ 0');
  if (counts === false && y.some(v => v < 0 || v > 1)) throw new Error('proportions must lie between 0 and 1 (successes ≤ trials)');
  if (weights.some(v => !(v >= 0))) throw new Error('weights (trials) must be ≥ 0');
  const warnings = [];
  let fam, r, theta, thetaSE;
  if (o.firth) {
    if (!((distribution === 'binomial' && link === 'logit') || (distribution === 'poisson' && link === 'log'))) throw new Error('Firth’s penalised likelihood is available for binomial (logit) and Poisson (log) models');
    fam = family(distribution, link);
    r = firth(X, y, fam, weights, offset);
  } else if (distribution === 'negbin' && o.theta === undefined) {
    // MASS::glm.nb: a Poisson fit, then θ and the coefficients in turn
    const pois = irls(X, y, family('poisson', link), { weights, offset });
    let mu = pois.mu, fit = pois;
    let t = thetaML(y, mu, weights); theta = t.theta;
    const d1 = Math.sqrt(2 * Math.max(1, n - (pois.f?.rank ?? 0)));
    let del = 1, d2 = 1, Lm = nbLoglik(theta, mu, y, weights), Lm0 = Lm + 2 * d1, it = 0;
    while (++it <= 25 && Math.abs(Lm0 - Lm) / d1 + Math.abs(del) / d2 > 1e-8) {
      fit = irls(X, y, family('negbin', link, theta), { weights, offset, etastart: mu.map(family('negbin', link, theta).link.fun) });
      const t0 = theta;
      t = thetaML(y, fit.mu, weights); theta = t.theta;
      mu = fit.mu; del = t0 - theta; Lm0 = Lm; Lm = nbLoglik(theta, mu, y, weights);
    }
    if (theta > 1e3) warnings.push(`θ is very large (${theta.toPrecision(3)}): the counts show no variation beyond the Poisson that the negative binomial can find, so the Poisson model (or the quasi-Poisson, if Pearson χ²/df is well above 1) is the simpler choice`);
    else {
      if (it > 25) warnings.push('alternation limit reached (θ and the coefficients)');
      warnings.push(...t.warnings);
    }
    thetaSE = t.se;
    fam = family('negbin', link, theta);
    r = fit;
  } else {
    if (distribution === 'negbin') theta = o.theta;
    fam = family(distribution, link, theta);
    r = irls(X, y, fam, { weights, offset });
  }
  if (!r.converged) warnings.push(`the fit did not converge in ${r.iter} iterations`);
  if (r.boundary) warnings.push('the fit reached the boundary of the parameter space');
  const { mu, eta, f } = r, rank = f ? f.rank : 0, dfRes = n - rank;
  const L = fam.link;
  const coef = r.coef.map((b, j) => (f && f.aliased.includes(j) ? NaN : b));
  // dispersion: 1, or Pearson χ² / residual df (summary.glm) for the quasi families
  const wt = r.w.map(v => v * v);
  const working = y.map((v, i) => (v - mu[i]) / L.deriv(eta[i]));
  const pearsonChi2 = sum(y.map((v, i) => weights[i] * (v - mu[i]) ** 2 / fam.variance(mu[i])));
  const estimated = fam.D.dispersion === 'estimated';
  const dispersion = estimated ? (dfRes > 0 ? sum(working.map((e, i) => wt[i] * e * e)) / dfRes : NaN) : 1;
  const covU = f ? f.unscaledCov() : [];
  const se = coef.map((b, j) => (Number.isNaN(b) ? NaN : Math.sqrt(covU[j][j] * dispersion)));
  const stat = coef.map((b, j) => b / se[j]);
  const pv = stat.map(z => (!Number.isFinite(z) ? NaN : estimated ? (dfRes > 0 ? 2 * studentT.sf(Math.abs(z), dfRes) : NaN) : 2 * N.sf(Math.abs(z))));
  // deviance, null deviance (the intercept-only model, refitted when there is an offset)
  const dev = sum(y.map((v, i) => fam.devRes(v, mu[i], weights[i])));
  const intercept = model.intercept || model.implied;
  let nullDev;
  if (intercept && offset.some(v => v !== 0)) nullDev = irls(X.map(() => [1]), y, fam, { weights, offset }).dev;
  else {
    const wm = intercept ? sum(y.map((v, i) => weights[i] * v)) / sum(weights) : NaN;
    nullDev = sum(y.map((v, i) => fam.devRes(v, intercept ? wm : L.inv(offset[i]), weights[i])));
  }
  const dfNull = n - (intercept ? 1 : 0);
  // residuals and influence: Pearson and deviance residuals as R's residuals.glm; standardised
  // deviance residuals r_D / √(φ(1 − h)) (R's rstandard.glm, type "deviance"); studentised
  // residuals sign(r_D) √(r_D² + h r_P² / (1 − h)) / s, with s = 1 for families of fixed
  // dispersion and the leave-one-out Pearson dispersion for quasi families (R ≥ 4.6 does not
  // leave one out when the dispersion is fixed; earlier versions did for the negative binomial);
  // Cook's distance (r_P / (1 − h))² h / (φ p)
  const pearson = y.map((v, i) => (v - mu[i]) * Math.sqrt(weights[i]) / Math.sqrt(fam.variance(mu[i])));
  const devRes = y.map((v, i) => Math.sign(v - mu[i]) * Math.sqrt(Math.max(0, fam.devRes(v, mu[i], weights[i]))));
  const Q = f ? f.Q() : [];
  const h = y.map((_, i) => { let s = 0; for (let j = 0; j < rank; j++) s += Q[i][j] * Q[i][j]; return s; });
  const tidy = (v, i) => (Math.abs(1 - h[i]) < 1e-10 ? NaN : v);
  const rstandard = devRes.map((d, i) => tidy(d / Math.sqrt(dispersion * (1 - h[i])), i));
  const fixedFamily = distribution === 'poisson' || distribution === 'binomial';
  const ssP = sum(pearson.map(e => e * e));
  const rstudent = devRes.map((d, i) => {
    const r0 = Math.sign(d) * Math.sqrt(d * d + h[i] * pearson[i] ** 2 / (1 - h[i]));
    const s = estimated ? Math.sqrt((ssP - pearson[i] ** 2 / (1 - h[i])) / (dfRes - 1)) : 1;
    return tidy(r0 / s, i);
  });
  const cooks = pearson.map((e, i) => tidy((e / (1 - h[i])) ** 2 * h[i] / (dispersion * rank), i));
  // likelihood and AIC (k counts θ for the negative binomial; undefined for quasi families)
  const loglik = o.firth ? NaN : loglikOf(fam, y, mu, weights);
  const k = rank + (distribution === 'negbin' && o.theta === undefined ? 1 : 0);
  // checks: overdispersion (Poisson and binomial with trials > 1), separation (fitted 0 or 1)
  let overdispersion = null;
  if (fixedFamily && dfRes > 0 && !(distribution === 'binomial' && weights.every(v => v <= 1))) {
    const ratio = pearsonChi2 / dfRes, pval = chi2.sf(pearsonChi2, dfRes);
    overdispersion = { pearson: pearsonChi2, df: dfRes, ratio, p: pval, detected: ratio > 1.5 && pval < 0.05 };
    if (overdispersion.detected) warnings.push(`overdispersion: Pearson χ²/df = ${ratio.toFixed(2)} (p = ${pval < 1e-4 ? pval.toExponential(1) : pval.toFixed(4)}); ${distribution === 'poisson' ? 'a quasi-Poisson or negative binomial model' : 'a quasi-binomial model'} gives honest standard errors`);
  }
  let separation = null;
  if (!o.firth && fam.D.counts === false) {
    // fitted proportions driven to 0 or 1 where the outcomes are all failures or all successes: the
    // estimates are running off to infinity (R warns at 10ε; IRLS often stops earlier, so 1e-8)
    const edge = mu.map((m, i) => weights[i] > 0 && ((m < 1e-8 && y[i] === 0) || (m > 1 - 1e-8 && y[i] === 1)));
    if (edge.some(Boolean) || !r.converged) {
      separation = { rows: edge.map((e, i) => (e ? i : -1)).filter(i => i >= 0), terms: columns.filter((c, j) => c !== '(Intercept)' && Math.abs(coef[j]) > 5 && se[j] > 2 * Math.abs(coef[j])) };
      warnings.push('fitted proportions of 0 or 1: the outcomes are (quasi-)separated by the factors, so some estimates are infinite and their standard errors meaningless — use Firth’s penalised likelihood');
    }
  }
  if (fam.D.counts && distribution !== 'negbin' && mu.some(m => m < 10 * EPS)) warnings.push('fitted counts numerically 0');
  return {
    model, columns, assign, n, rank, dfRes, dfModel: rank - (intercept ? 1 : 0), dfNull,
    distribution, link, theta, thetaSE, firth: !!o.firth,
    coef, se, t: stat, p: pv, statistic: estimated ? 't' : 'z',
    cov: covU.map(row => row.map(v => v * dispersion)), covUnscaled: covU, dispersion, dispersionEstimated: estimated,
    aliased: f ? f.aliased.map(j => columns[j]) : [],
    fitted: mu, linear: eta, residuals: y.map((v, i) => v - mu[i]), pearson, devianceResiduals: devRes, working,
    leverage: h, rstandard, rstudent, cooks,
    deviance: dev, nullDeviance: nullDev, devExplained: 1 - dev / nullDev,
    loglik, k, aic: Number.isFinite(loglik) ? -2 * loglik + 2 * k : NaN,
    pearsonChi2, overdispersion, separation, converged: r.converged, iter: r.iter, warnings,
    sigma: NaN, sigma2: NaN, r2: NaN, adjR2: NaN,
    _qr: f, _w: wt, X, y, weights, offset,
  };
}

/** Firth's penalised likelihood: IRLS on adjusted data (successes + h/2, trials + h), to convergence. */
function firth(X, y, fam, weights, offset) {
  const n = y.length, p = X[0].length;
  const hat = (eta, mu) => {
    const L = fam.link, w = mu.map((m, i) => Math.sqrt(weights[i] * L.deriv(eta[i]) ** 2 / fam.variance(m)));
    const f = qr(X.map((r, i) => r.map(v => v * w[i])), { tol: 1e-11 }), Q = f.Q();
    return Q.map(row => { let s = 0; for (let j = 0; j < f.rank; j++) s += row[j] * row[j]; return s; });
  };
  const binom = fam.distribution === 'binomial';
  let b = new Array(p).fill(0), last = null, it = 0;
  let eta = y.map((v, i) => fam.link.fun(fam.mustart(v, weights[i])));
  let mu = eta.map(fam.link.inv);
  for (it = 1; it <= 200; it++) {
    const h = hat(eta, mu);
    const pseudo = binom
      ? { y: () => y.map((v, i) => (weights[i] * v + h[i] / 2) / (weights[i] + h[i])), w: () => weights.map((v, i) => v + h[i]) }
      : { y: () => y.map((v, i) => v + h[i] / 2), w: () => weights };
    // one Newton step on the adjusted data, from the current estimate
    const step = irls(X, y, fam, { weights, offset, maxit: 1, pseudo, ...(last ? { start: b } : { etastart: eta }) });
    const delta = Math.max(...step.coef.map((v, j) => Math.abs(v - b[j])));
    b = step.coef; eta = step.eta; mu = step.mu; last = step;
    if (delta < 1e-10 * Math.max(1, Math.max(...b.map(Math.abs)))) break;
  }
  // the covariance (XᵀWX)⁻¹ at the estimate, as brglm2 and logistf report it
  const L = fam.link, w = mu.map((m, i) => Math.sqrt(weights[i] * L.deriv(eta[i]) ** 2 / fam.variance(m)));
  const f = qr(X.map((r, i) => r.map(v => v * w[i])), { tol: 1e-11 });
  const dev = sum(y.map((v, i) => fam.devRes(v, mu[i], weights[i])));
  return { coef: b, eta, mu, dev, w, f, iter: it, converged: it <= 200, boundary: false };
}

// ---------------------------------------------------------------- tests

/** Refit with a subset of the columns (θ, family and offset as in the fit). */
function refit(fit, cols) {
  const fam = family(fit.distribution, fit.link, fit.theta);
  if (!cols.length) {
    const r = irls([], fit.y, fam, { weights: fit.weights, offset: fit.offset });
    return { dev: r.dev, rank: 0 };
  }
  const r = irls(fit.X.map(row => cols.map(j => row[j])), fit.y, fam, { weights: fit.weights, offset: fit.offset });
  return { dev: r.dev, rank: r.f.rank };
}

// a deviance difference as a test: χ² (fixed dispersion) or F (estimated)
function devTest(fit, d, df) {
  if (!(df > 0)) return { df, deviance: d, chi2: NaN, F: NaN, p: NaN };
  if (fit.dispersionEstimated) { const F = d / df / fit.dispersion; return { df, deviance: d, F, p: fit.dfRes > 0 ? fDist.sf(Math.max(F, 0), df, fit.dfRes) : NaN }; }
  const c = d / fit.dispersion;
  return { df, deviance: d, chi2: c, p: chi2.sf(Math.max(c, 0), df) };
}

// Wald test of a set of columns: βₛᵀ V_SS⁻¹ βₛ (for Firth fits, whose likelihood is penalised)
function waldTest(fit, S) {
  const b = S.map(j => fit.coef[j]);
  if (!S.length || b.some(v => Number.isNaN(v))) return { df: 0, chi2: NaN, p: NaN };
  const A = S.map(i => S.map(j => fit.cov[i][j]));
  const x = solveSmall(A, b), w = b.reduce((s, v, i) => s + v * x[i], 0);
  return { df: S.length, chi2: w, p: chi2.sf(w, S.length), wald: true };
}
function solveSmall(A, b) {
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
 * The tests of a GLM's terms ("analysis of deviance"). type 1: sequential, adding the terms in
 * order (R anova.glm, test "Chisq", or "F" for quasi families). type 2: each term against the
 * model without it and the terms containing it; type 3: against the model without it (car::Anova
 * test "LR"). Rows { term, df, deviance, chi2 | F, p } and then { term: 'Residuals', df, deviance }.
 * Firth fits get Wald tests (type 2 and 3 alike).
 */
export function glmTests(fit, type = 1) {
  if (![1, 2, 3].includes(type)) throw new Error('the type of test must be 1, 2 or 3');
  const { model, assign } = fit, rows = [];
  const all = fit.columns.map((_, j) => j);
  const colsOf = (ti) => all.filter(j => assign[j] === ti);
  if (fit.firth) {
    model.terms.forEach((t, ti) => { const S = colsOf(ti).filter(j => !Number.isNaN(fit.coef[j])); if (S.length) rows.push({ term: t.label, ...waldTest(fit, S) }); });
  } else if (type === 1) {
    let cols = all.filter(j => assign[j] === -1), prev = refit(fit, cols);
    model.terms.forEach((t, ti) => {
      cols = cols.concat(colsOf(ti));
      const cur = refit(fit, cols), df = cur.rank - prev.rank;
      if (df > 0) rows.push({ term: t.label, ...devTest(fit, prev.dev - cur.dev, df), resDf: fit.n - cur.rank, resDeviance: cur.dev });
      prev = cur;
    });
  } else {
    model.terms.forEach((t, ti) => {
      const base = type === 2
        ? all.filter(j => { const a = assign[j]; return a === -1 || (a !== ti && !containedIn(t, model.terms[a])); })
        : all.filter(j => assign[j] !== ti);
      const r0 = refit(fit, base), r1 = type === 3 ? { dev: fit.deviance, rank: fit.rank } : refit(fit, base.concat(colsOf(ti)));
      const df = r1.rank - r0.rank;
      if (df > 0) rows.push({ term: t.label, ...devTest(fit, r0.dev - r1.dev, df) });
    });
  }
  rows.push({ term: 'Residuals', df: fit.dfRes, deviance: fit.deviance });
  return rows;
}

/** Test of nested fits (small without some of big's terms): likelihood ratio, F, or Wald (Firth). */
export function glmCompare(big, small) {
  if (big.firth) {
    const S = big.columns.map((c, j) => (small.columns.includes(c) ? -1 : j)).filter(j => j >= 0 && !Number.isNaN(big.coef[j]));
    const w = waldTest(big, S);
    return { df: w.df, chi2: w.chi2, F: NaN, p: S.length ? w.p : 1 };
  }
  const df = big.rank - small.rank;
  if (df === 0) return { df, chi2: NaN, F: NaN, p: 1 };
  const t = devTest(big, small.deviance - big.deviance, df);
  return { df, chi2: t.chi2 ?? NaN, F: t.F ?? NaN, p: t.p };
}

// ---------------------------------------------------------------- predictions and intervals

/**
 * Predictions at model-matrix rows X (offset 0: per unit exposure): the mean on the response scale
 * (a rate or a proportion), its delta-method standard error, a confidence interval transformed from
 * the link scale (z, or t with an estimated dispersion), and a prediction interval for a new run
 * (predictiveInterval: the count, or proportion of successes, a new run with the given exposure
 * and trials would give, per unit exposure or as a proportion, allowing for the uncertainty in
 * the fit). opts: level, exposure (1), trials (the fit's typical trials), n (runs averaged, 1).
 */
export function glmPredict(fit, X, { level = 0.95, exposure = 1, trials, n = 1 } = {}) {
  const L = LINKS[fit.link];
  const c = fit.dispersionEstimated ? (fit.dfRes > 0 ? studentT.ppf(1 - (1 - level) / 2, fit.dfRes) : NaN) : N.ppf(1 - (1 - level) / 2);
  return X.map(x => {
    let e = 0, v = 0;
    for (let i = 0; i < x.length; i++) {
      if (Number.isNaN(fit.coef[i])) continue;
      e += x[i] * fit.coef[i];
      for (let j = 0; j < x.length; j++) if (!Number.isNaN(fit.coef[j])) v += x[i] * fit.cov[i][j] * x[j];
    }
    const s = Math.sqrt(v), m = L.inv(e);
    const pi = predictiveInterval(fit, e, s, { level, exposure, trials, n });
    return { fit: m, se: s * Math.abs(L.deriv(e)), lower: L.inv(e - c * s), upper: L.inv(e + c * s), predLower: pi.lower, predUpper: pi.upper, link: e, seLink: s };
  });
}

// Gauss–Hermite nodes and weights for E[g(Z)], Z ~ N(0, 1) (Golub–Welsch on the probabilists' Jacobi matrix)
const gaussHermite = (K) => {
  const J = Array.from({ length: K }, (_, i) => Array.from({ length: K }, (__, j) => (Math.abs(i - j) === 1 ? Math.sqrt(Math.max(i, j)) : 0)));
  const { values, vectors } = eigSym(J);
  const w = values.map((_, k) => vectors[0][k] ** 2), t = w.reduce((a, b) => a + b, 0);
  return values.map((z, k) => ({ z, w: w[k] / t }));
};
const GH = gaussHermite(24), GH8 = gaussHermite(8);

/** Typical trials of a binomial fit (the median of its runs'), for predictions. */
const typicalTrials = (fit) => { const t = fit.weights.slice().sort((a, b) => a - b); return t[Math.floor(t.length / 2)] ?? 1; };

/**
 * The distribution of a new result: the total T of n runs at exposure e (counts) or with m trials
 * each (proportions), at the linear predictor η ~ N(eta, s²) (the fit's uncertainty, integrated by
 * Gauss–Hermite). Poisson: T ~ Poisson(n e μ); negative binomial: NB(n e μ, n θ); quasi-Poisson:
 * the negative binomial with variance φ × mean; binomial: Bin(n m, p); quasi-binomial: the
 * beta-binomial with variance φ × binomial. Returns { lower, upper } of T / (n e) or T / (n m) at the
 * given level (the shortest equal-tailed interval of a discrete distribution, so coverage ≥ level).
 */
export function predictiveInterval(fit, eta, s, { level = 0.95, exposure = 1, trials, n = 1 } = {}) {
  const L = LINKS[fit.link], counts = DISTRIBUTIONS[fit.distribution].counts;
  const m = counts ? 1 : Math.max(1, Math.round(trials ?? typicalTrials(fit)));
  const N = counts ? n * exposure : n * m;               // the scale of the total
  const phi = fit.dispersionEstimated ? Math.max(1, fit.dispersion) : 1;
  // the negative binomial's θ is uncertain too: log θ ~ N(log θ̂, (se/θ̂)²), integrated alongside
  const thetas = fit.distribution === 'negbin' && fit.thetaSE > 0 && Number.isFinite(fit.thetaSE)
    ? GH8.map(({ z, w }) => ({ w, th: fit.theta * Math.exp(Math.min(3, fit.thetaSE / fit.theta) * z) })) : [{ w: 1, th: fit.theta }];
  const nodes = (Number.isFinite(s) && s > 0 ? GH : [{ z: 0, w: 1 }]).flatMap(({ z, w }) => thetas.map(t => ({ w: w * t.w, mu: L.inv(eta + s * z), th: t.th })));
  // cdf of T at t for one node
  const cdf = (t, mu, theta) => {
    if (t < 0) return 0;
    if (counts) {
      const M = N * mu;
      const th = fit.distribution === 'negbin' ? n * theta : phi > 1 + 1e-9 ? M / (phi - 1) : Infinity;
      if (th === Infinity) return gammaInc(t + 1, M).Q;                      // Poisson
      return betaInc(th / (th + M), th, t + 1).I;                             // negative binomial
    }
    if (t >= N) return 1;
    const rho = phi > 1 + 1e-9 && N > 1 ? Math.min(0.999, (phi - 1) / (N - 1)) : 0;
    if (!rho) return betaInc(1 - mu, N - t, t + 1, mu).I;                   // binomial
    const a = mu * (1 - rho) / rho, b = (1 - mu) * (1 - rho) / rho;           // beta-binomial
    let c = 0;
    for (let k = 0; k <= t; k++) c += Math.exp(lchoose(N, k) + lbeta(k + a, N - k + b) - lbeta(a, b));
    return Math.min(1, c);
  };
  const F = (t) => nodes.reduce((acc, nd) => acc + nd.w * cdf(t, nd.mu, nd.th), 0);
  const quant = (p) => {
    // smallest t with F(t) ≥ p: bracket upwards, then bisect
    let lo = -1, hi = 1;
    while (F(hi) < p) { lo = hi; hi *= 2; if (hi > 1e12) return Infinity; }
    while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (F(mid) >= p) hi = mid; else lo = mid; }
    return hi;
  };
  const a = (1 - level) / 2;
  return { lower: quant(a) / N * (counts ? 1 : 1), upper: quant(1 - a) / N };
}

/** Variance of one new result (per unit exposure, or as a proportion of m trials) at mean μ. */
export function glmVariance(fit, mu, { exposure = 1, trials } = {}) {
  const counts = DISTRIBUTIONS[fit.distribution].counts, phi = fit.dispersionEstimated ? fit.dispersion : 1;
  if (counts) { const M = exposure * mu, v = fit.distribution === 'negbin' ? M + M * M / fit.theta : phi * M; return v / (exposure * exposure); }
  const m = trials ?? typicalTrials(fit);
  return phi * mu * (1 - mu) / m;
}

/**
 * Simulated envelope for a half-normal plot of |standardised deviance residuals| (Atkinson 1985):
 * nsim data sets simulated from the fit (θ and dispersion fixed), each refitted with the same model,
 * their sorted |residuals| giving pointwise 2.5 %, 50 % and 97.5 % bands. A residual outside the
 * band is unusual for the model. Returns [{ q, observed, row, lower, median, upper }] in order.
 */
export function glmEnvelope(fit, { nsim = 99, seed = 1 } = {}) {
  const R = rng(seed), n = fit.y.length, counts = DISTRIBUTIONS[fit.distribution].counts;
  const phi = fit.dispersionEstimated ? Math.max(1, fit.dispersion) : 1;
  const mm = { X: fit.X, columns: fit.columns, assign: fit.assign, model: fit.model };
  const opts = { distribution: fit.distribution, link: fit.link, weights: fit.weights, offset: fit.offset, ...(fit.distribution === 'negbin' ? { theta: fit.theta } : {}), firth: fit.firth };
  const abs = (f) => f.rstandard.map(Math.abs).map(v => (Number.isFinite(v) ? v : 0)).sort((a, b) => a - b);
  const sims = [];
  for (let k = 0; k < nsim; k++) {
    const y = fit.fitted.map((mu, i) => {
      if (counts) {
        const th = fit.distribution === 'negbin' ? fit.theta : phi > 1 + 1e-9 ? mu / (phi - 1) : Infinity;
        return poissonDraw(R, th === Infinity ? mu : mu * gammaDraw(R, th) / th);
      }
      const m = Math.round(fit.weights[i]); let x = 0, p = mu;
      if (phi > 1 + 1e-9 && m > 1) { const rho = Math.min(0.999, (phi - 1) / (m - 1)), a = mu * (1 - rho) / rho, b = (1 - mu) * (1 - rho) / rho, g1 = gammaDraw(R, a), g2 = gammaDraw(R, b); p = g1 / (g1 + g2); }
      for (let j = 0; j < m; j++) if (R.random() < p) x++;
      return m > 0 ? x / m : 0;
    });
    try { sims.push(abs(fitGLM(mm, y, opts))); } catch { /* a degenerate simulated data set */ }
  }
  const obs = fit.rstandard.map((v, i) => ({ v: Math.abs(v), i })).filter(o => Number.isFinite(o.v)).sort((a, b) => a.v - b.v);
  const pct = (a, p) => { const b = a.slice().sort((x, y) => x - y), h = (b.length - 1) * p, lo = Math.floor(h); return b[lo] + (b[Math.min(b.length - 1, lo + 1)] - b[lo]) * (h - lo); };
  const m0 = obs.length;
  return obs.map((o, k) => {
    const col = sims.map(sv => sv[sv.length - m0 + k]).filter(Number.isFinite);
    return { q: N.ppf(0.5 + 0.5 * (k + 0.5) / m0), observed: o.v, row: o.i, lower: pct(col, 0.025), median: pct(col, 0.5), upper: pct(col, 0.975) };
  });
}

function poissonDraw(R, mu) {
  if (mu > 500) { let t = 0; const k = Math.ceil(mu / 500); for (let i = 0; i < k; i++) t += poissonDraw(R, mu / k); return t; }
  const Lm = Math.exp(-mu); let k = 0, p = R.random();
  while (p > Lm) { k++; p *= R.random(); }
  return k;
}
function gammaDraw(R, a) {
  if (a < 1) return gammaDraw(R, a + 1) * R.random() ** (1 / a);
  const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { const u1 = R.random() || 1e-300, u2 = R.random(); x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = R.random();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
export const _draw = { poisson: poissonDraw, gamma: gammaDraw };

/**
 * Confidence intervals for the coefficients: method 'profile' (default; the deviance profile,
 * as MASS / R ≥ 4.4 confint.glm, but solved exactly rather than interpolated) or 'wald'. With a
 * log or logit link the exponentiated intervals are rate or odds ratios (ratio: true).
 * Returns [{ name, estimate, lower, upper, ratio?: { estimate, lower, upper } }] for the estimable
 * coefficients (only those named in names, when given).
 */
export function glmConfint(fit, { level = 0.95, method = fit.firth ? 'wald' : 'profile', names } = {}) {
  const z = N.ppf(1 - (1 - level) / 2);
  const fam = family(fit.distribution, fit.link, fit.theta);
  const ratio = fit.link === 'log' || fit.link === 'logit';
  return fit.columns.map((name, j) => ({ name, j })).filter(c => !Number.isNaN(fit.coef[c.j]) && (!names || names.includes(c.name))).map(({ name, j }) => {
    const b = fit.coef[j], s = fit.se[j];
    let lower = b - z * s, upper = b + z * s;
    if (method === 'profile') {
      const others = fit.columns.map((_, k) => k).filter(k => k !== j && !Number.isNaN(fit.coef[k]));
      const Xo = fit.X.map(r => others.map(k => r[k]));
      // signed root of the deviance increase with β_j fixed at v, scaled by the dispersion
      const root = (v) => {
        const off = fit.offset.map((o, i) => o + fit.X[i][j] * v);
        const start = others.map(k => fit.coef[k]);
        const r = others.length ? irls(Xo, fit.y, fam, { weights: fit.weights, offset: off, start }) : irls([], fit.y, fam, { weights: fit.weights, offset: off });
        return Math.sign(v - b) * Math.sqrt(Math.max(0, r.dev - fit.deviance) / fit.dispersion);
      };
      const solve = (dir) => {
        // bracket from the Wald limit outwards, then bisect
        let a = b, c = b + dir * z * s, fc = root(c) - dir * z;
        for (let k = 0; k < 40 && dir * fc < 0; k++) { a = c; c = b + dir * z * s * 2 ** (k + 1); fc = root(c) - dir * z; }
        if (dir * fc < 0) return dir * Infinity;
        for (let k = 0; k < 100 && Math.abs(c - a) > 1e-10 * Math.max(1, Math.abs(c)); k++) {
          const m = (a + c) / 2, fm = root(m) - dir * z;
          if (dir * fm < 0) a = m; else c = m;
        }
        return (a + c) / 2;
      };
      try { lower = solve(-1); upper = solve(1); } catch { /* keep the Wald limits */ }
    }
    return { name, estimate: b, lower, upper, method, ...(ratio ? { ratio: { estimate: Math.exp(b), lower: Math.exp(lower), upper: Math.exp(upper) } } : {}) };
  });
}

/**
 * Information weight per run at anticipated means (for power, noise.js): w = m μ′(η)² / V(μ).
 */
export function glmWeights(distribution, link, mean, { trials, theta } = {}) {
  const fam = family(distribution, link, theta ?? 1e6);
  return mean.map((m, i) => { const e = fam.link.fun(m); return (trials?.[i] ?? 1) * fam.link.deriv(e) ** 2 / fam.variance(m); });
}
