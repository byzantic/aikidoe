// Probability distributions (spec §3, issue #3).
//
//   normal, studentT, chi2, fDist   pdf, cdf, sf (upper tail), ppf (quantile), isf (upper quantile)
//   nct, ncf                        non-central t and F: cdf, sf (for power, §6.4)
//   lgamma, lbeta, gammaP/gammaQ, betaInc   special functions
//
// Accuracy target: 1e-10 relative in both tails down to ~1e-300 for the central distributions.
// Upper tails are computed directly (sf), never as 1 − cdf, and isf(q) inverts sf directly, so
// small upper-tail probabilities keep full relative accuracy (measured against scipy: ≤ 1e-11
// relative throughout). Non-central t and F: ~1e-16 absolute, so relative accuracy degrades below
// ~1e-8 — only for the non-central t tail on the opposite side of zero to δ, where the series
// cancels. That is ample for power calculations.
//
// Methods: continued fractions (modified Lentz) and series for the incomplete gamma and beta
// functions; the x^a y^b / B(a,b) and x^a e^−x / Γ(a) prefactors use Stirling differences
// (as TOMS 708 does) so they stay accurate for large degrees of freedom; Poisson mixtures summed
// outward from the mode for the non-central distributions (Guenther 1978 for t).

const EPS = 2.220446049250313e-16;
const TINY = 1e-300;
const LN_SQRT_2PI = 0.9189385332046728;    // ½ ln 2π
const SQRT_2PI = 2.5066282746310002;

// ---------------------------------------------------------------- gamma and beta functions

/** Stirling-series remainder: lgamma(a) − [(a − ½) ln a − a + ½ ln 2π], for a ≥ 10. */
function stirlerr(a) {
  const r = 1 / a, r2 = r * r;
  return r * (1 / 12 - r2 * (1 / 360 - r2 * (1 / 1260 - r2 * (1 / 1680 - r2 / 1188))));
}

/** ln Γ(x) for x > 0. */
export function lgamma(x) {
  if (!(x > 0)) return x === 0 ? Infinity : NaN;
  if (x === 1 || x === 2) return 0;
  if (x >= 10) return (x - 0.5) * Math.log(x) - x + LN_SQRT_2PI + stirlerr(x);
  // shift up: Γ(x) = Γ(x + n) / (x (x+1) … (x+n−1))
  let p = 1, y = x;
  while (y < 10) { p *= y; y += 1; }
  return (y - 0.5) * Math.log(y) - y + LN_SQRT_2PI + stirlerr(y) - Math.log(p);
}

/** ln B(a, b). */
export const lbeta = (a, b) => {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (lo >= 10) return LN_SQRT_2PI + (lo - 0.5) * Math.log(lo) + (hi - 0.5) * Math.log(hi)
    - (lo + hi - 0.5) * Math.log(lo + hi) + stirlerr(lo) + stirlerr(hi) - stirlerr(lo + hi);
  if (hi >= 10) return lgamma(lo) - (hi - 0.5) * Math.log1p(lo / hi) - lo * Math.log(lo + hi) + lo
    + stirlerr(hi) - stirlerr(hi + lo);
  return lgamma(lo) + lgamma(hi) - lgamma(lo + hi);
};

/** ln(1 + d) − d, accurate for small d. */
function log1pmx(d) {
  if (Math.abs(d) > 0.25) return Math.log1p(d) - d;
  // −d²/2 + d³/3 − …
  let term = d, s = 0;
  for (let k = 2; k < 200; k++) {
    term *= -d;
    const t = term / k;
    s += t;
    if (Math.abs(t) < EPS * Math.abs(s)) break;
  }
  return s;
}

/** a·[ln r − (r − 1)] for a ratio r > 0, accurate both near r = 1 and far from it. */
function aLogRatioMinus(a, r) {
  // near 1, r − 1 is exact (Sterbenz) and log1pmx avoids cancellation; far from 1 the direct
  // form is accurate. (Forming r − 1 as (x − x0)/x0 instead loses ε/r when r is small.)
  return a * (Math.abs(r - 1) <= 0.5 ? log1pmx(r - 1) : Math.log(r) - (r - 1));
}

/** ln[ x^a e^−x / Γ(a) ]. */
function lgammaPrefix(a, x) {
  if (a >= 10) return aLogRatioMinus(a, x / a) + 0.5 * Math.log(a) - LN_SQRT_2PI - stirlerr(a);
  return a * Math.log(x) - x - lgamma(a);
}

/** ln[ x^a y^b / B(a, b) ], y = 1 − x passed separately for accuracy. */
function lbetaPrefix(a, b, x, y) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (lo >= 10) {
    // a ln(x/x0) + b ln(y/y0) with x0 = a/s, y0 = b/s; the linear parts a(x/x0 − 1) + b(y/y0 − 1)
    // sum to s(x + y − 1) = 0, so only the curvature terms remain
    const s = a + b;
    return aLogRatioMinus(a, x * s / a) + aLogRatioMinus(b, y * s / b)
      + 0.5 * Math.log(a * b / s) - LN_SQRT_2PI - stirlerr(a) - stirlerr(b) + stirlerr(s);
  }
  // one or both parameters small: lbeta already avoids the large-parameter cancellation
  return a * Math.log(x) + b * Math.log(y) - lbeta(a, b);
}

/** Regularised lower and upper incomplete gamma: { P, Q } with P + Q = 1, the smaller accurate. */
export function gammaInc(a, x) {
  if (!(a > 0) || !(x >= 0)) return { P: NaN, Q: NaN };
  if (x === 0) return { P: 0, Q: 1 };
  if (x === Infinity) return { P: 1, Q: 0 };
  const lpre = lgammaPrefix(a, x);
  if (x < a + 1) {
    // series: P = pre · Σ x^n / (a (a+1) … (a+n))
    let ap = a, del = 1 / a, sum = del;
    for (let n = 0; n < 100000; n++) {
      ap += 1; del *= x / ap; sum += del;
      if (Math.abs(del) < Math.abs(sum) * EPS * 0.5) break;
    }
    const P = Math.exp(lpre + Math.log(sum));
    return { P, Q: 1 - P };
  }
  // continued fraction for Q (Lentz)
  let b = x + 1 - a, c = 1 / TINY, d = 1 / b, h = d;
  for (let i = 1; i < 100000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  const Q = Math.exp(lpre + Math.log(h));
  return { P: 1 - Q, Q };
}
export const gammaP = (a, x) => gammaInc(a, x).P;
export const gammaQ = (a, x) => gammaInc(a, x).Q;

function betacf(a, b, x) {
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 100000; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/**
 * Regularised incomplete beta: { I, Ic } = { I_x(a,b), 1 − I_x(a,b) }. y = 1 − x may be given
 * separately (it often comes from a different, exact expression). The smaller of I, Ic is
 * computed directly, so both are accurate relative to their own size.
 */
export function betaInc(x, a, b, y = 1 - x) {
  if (!(a > 0) || !(b > 0) || !(x >= 0) || !(y >= 0)) return { I: NaN, Ic: NaN };
  if (x === 0) return { I: 0, Ic: 1 };
  if (y === 0) return { I: 1, Ic: 0 };
  if (x < (a + 1) / (a + b + 2)) {
    const I = Math.exp(lbetaPrefix(a, b, x, y)) * betacf(a, b, x) / a;
    return { I, Ic: 1 - I };
  }
  const Ic = Math.exp(lbetaPrefix(b, a, y, x)) * betacf(b, a, y) / b;
  return { I: 1 - Ic, Ic };
}

// ---------------------------------------------------------------- normal

/** exp(−z²/2) with z² split so the exponent is exact to rounding (keeps relative accuracy at large |z|). */
function expHalfSq(z) {
  const zh = Math.round(z * 16) / 16, zl = z - zh;
  return Math.exp(-0.5 * zh * zh) * Math.exp(-0.5 * zl * (2 * zh + zl));
}

/** Upper tail Q(z) = 1 − Φ(z) for z ≥ 0. */
function normalQ(z) {
  if (z === Infinity) return 0;
  const phi = expHalfSq(z) / SQRT_2PI;
  if (z < 2.5) {
    // Φ(z) − ½ = φ(z) Σ z^(2k+1) / (2k+1)!!  (all terms positive)
    let term = z, s = z;
    for (let k = 1; k < 200; k++) { term *= z * z / (2 * k + 1); s += term; if (term < EPS * s) break; }
    return 0.5 - phi * s;
  }
  // Mills ratio, Laplace continued fraction: R = 1/(z + 1/(z + 2/(z + 3/(z + …))))
  // modified Lentz for f = z + 1/(z + 2/(z + …)); R = 1/f
  let f = z, c = z, d = 0;
  for (let k = 1; k < 5000; k++) {
    d = z + k * d; if (Math.abs(d) < TINY) d = TINY;
    c = z + k / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = c * d;
    f *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return phi / f;
}

export const normal = {
  pdf: (x) => expHalfSq(x) / SQRT_2PI,
  cdf: (x) => Number.isNaN(x) ? NaN : x < 0 ? normalQ(-x) : 1 - normalQ(x),
  sf: (x) => Number.isNaN(x) ? NaN : x > 0 ? normalQ(x) : 1 - normalQ(-x),
  ppf: (p) => (p < 0.5 ? -normalIsfTail(p) : p === 0.5 ? 0 : normalIsfTail(1 - p)),
  isf: (q) => (q < 0.5 ? normalIsfTail(q) : q === 0.5 ? 0 : -normalIsfTail(1 - q)),
};

/** z > 0 with Q(z) = q, for 0 < q ≤ ½. */
function normalIsfTail(q) {
  if (!(q >= 0 && q <= 1)) return NaN;
  if (q === 0) return Infinity;
  if (q === 0.5) return 0;
  // Abramowitz & Stegun 26.2.23 start (|error| < 4.5e-4), then Halley on Q
  const t = Math.sqrt(-2 * Math.log(q));
  let z = t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
  for (let i = 0; i < 20; i++) {
    const dz = (normalQ(z) - q) / normal.pdf(z);
    const step = dz / (1 - z * dz / 2);
    z += step;
    if (Math.abs(step) <= 4 * EPS * Math.abs(z)) break;
  }
  return z;
}

// ---------------------------------------------------------------- quantile solver

/**
 * Solve T(x) = target on x > 0, where T is a tail probability (monotone in x) and dlogT is
 * d ln T / d ln x. Safeguarded Newton in u = ln x on g(u) = ln T(e^u) − ln target, with a
 * bracket grown outward from x0.
 */
function solveTail(T, dlogT, target, x0, increasing) {
  const lt = Math.log(target);
  const g = (u) => { const v = T(Math.exp(u)); return (v > 0 ? Math.log(v) : -Infinity) - lt; };
  let u = Math.log(x0 > 0 && Number.isFinite(x0) ? x0 : 1);
  // bracket [lo, hi] with g(lo) and g(hi) on opposite sides of 0
  let glo, ghi, lo, hi, gu = g(u);
  if (gu === 0) return Math.exp(u);
  const below = increasing ? gu < 0 : gu > 0;        // root is at larger u
  let step = 1;
  if (below) { lo = u; glo = gu; hi = u + step; ghi = g(hi); while ((increasing ? ghi < 0 : ghi > 0) && step < 2048) { lo = hi; glo = ghi; step *= 2; hi = lo + step; ghi = g(hi); } }
  else { hi = u; ghi = gu; lo = u - step; glo = g(lo); while ((increasing ? glo > 0 : glo < 0) && step < 2048) { hi = lo; ghi = glo; step *= 2; lo = hi - step; glo = g(lo); } }
  u = Number.isFinite(glo) && Number.isFinite(ghi) ? u : (lo + hi) / 2;
  if (u <= lo || u >= hi) u = (lo + hi) / 2;
  for (let i = 0; i < 300; i++) {
    const x = Math.exp(u), gv = g(u);
    if (gv === 0) return x;
    if (increasing ? gv < 0 : gv > 0) lo = u; else hi = u;
    const d = dlogT(x);
    let un = Number.isFinite(gv) && d !== 0 && Number.isFinite(d) ? u - gv / d : NaN;
    if (!(un > lo && un < hi)) un = (lo + hi) / 2;
    if (Math.abs(un - u) <= 2 * EPS * Math.max(1, Math.abs(u))) return Math.exp(un);
    u = un;
    if (hi - lo <= 2 * EPS * Math.max(1, Math.abs(u))) return Math.exp(u);
  }
  return Math.exp(u);
}

const checkP = (p) => p >= 0 && p <= 1;

// ---------------------------------------------------------------- Student t

function tTails(x, df) {
  // P(|T| > |x|) = I_{df/(df+x²)}(df/2, ½)
  const x2 = x * x;
  let a, b;          // a = df/(df+x²), b = x²/(df+x²), computed without cancellation
  if (x2 > df) { b = 1 / (1 + df / x2); a = (df / x2) / (1 + df / x2); }
  else { a = 1 / (1 + x2 / df); b = (x2 / df) / (1 + x2 / df); }
  const { I, Ic } = betaInc(a, df / 2, 0.5, b);
  return { two: I, inner: Ic };    // two-sided tail, and P(|T| < |x|)
}

export const studentT = {
  pdf: (x, df) => Math.exp(-lbeta(df / 2, 0.5) - 0.5 * Math.log(df) - (df + 1) / 2 * Math.log1p(x * x / df)),
  cdf: (x, df) => {
    if (Number.isNaN(x) || !(df > 0)) return NaN;
    if (x === 0) return 0.5;
    const { two, inner } = tTails(x, df);
    return x < 0 ? two / 2 : 0.5 + inner / 2;
  },
  sf: (x, df) => studentT.cdf(-x, df),
  isf: (q, df) => {
    if (!checkP(q) || !(df > 0)) return NaN;
    if (q === 0.5) return 0;
    if (q > 0.5) return -studentT.isf(1 - q, df);
    if (q === 0) return Infinity;
    const z = normalIsfTail(q), x0 = z + (z ** 3 + z) / (4 * df);
    return solveTail((x) => studentT.sf(x, df), (x) => -x * studentT.pdf(x, df) / studentT.sf(x, df), q, x0, false);
  },
  ppf: (p, df) => (p < 0.5 ? -studentT.isf(p, df) : studentT.isf(1 - p, df)),
};

// ---------------------------------------------------------------- chi-square

export const chi2 = {
  pdf: (x, df) => x < 0 ? 0 : x === 0 ? (df < 2 ? Infinity : df === 2 ? 0.5 : 0)
    : Math.exp(lgammaPrefix(df / 2, x / 2)) / x,
  cdf: (x, df) => x <= 0 ? 0 : gammaInc(df / 2, x / 2).P,
  sf: (x, df) => x <= 0 ? 1 : gammaInc(df / 2, x / 2).Q,
  ppf: (p, df) => {
    if (!checkP(p) || !(df > 0)) return NaN;
    if (p === 0) return 0;
    if (p === 1) return Infinity;
    if (p > 0.5) return chi2.isf(1 - p, df);
    return solveTail((x) => chi2.cdf(x, df), (x) => x * chi2.pdf(x, df) / chi2.cdf(x, df), p, wilsonHilferty(1 - p, df), true);
  },
  isf: (q, df) => {
    if (!checkP(q) || !(df > 0)) return NaN;
    if (q === 0) return Infinity;
    if (q === 1) return 0;
    if (q > 0.5) return chi2.ppf(1 - q, df);
    return solveTail((x) => chi2.sf(x, df), (x) => -x * chi2.pdf(x, df) / chi2.sf(x, df), q, wilsonHilferty(q, df), false);
  },
};

function wilsonHilferty(q, df) {
  const z = normal.isf(q), c = 2 / (9 * df);
  const x = df * (1 - c + z * Math.sqrt(c)) ** 3;
  return x > 0 ? x : df * 1e-3;
}

// ---------------------------------------------------------------- F

function fBeta(x, d1, d2) {
  // F ≤ x  ⇔  Beta(d1/2, d2/2) ≤ d1 x / (d1 x + d2)
  const s = d1 * x + d2;
  return betaInc(d1 * x / s, d1 / 2, d2 / 2, d2 / s);
}

export const fDist = {
  pdf: (x, d1, d2) => {
    if (x < 0) return 0;
    if (x === 0) return d1 < 2 ? Infinity : d1 === 2 ? 1 : 0;
    const s = d1 * x + d2;
    return Math.exp(lbetaPrefix(d1 / 2, d2 / 2, d1 * x / s, d2 / s)) / x;
  },
  cdf: (x, d1, d2) => x <= 0 ? 0 : x === Infinity ? 1 : fBeta(x, d1, d2).I,
  sf: (x, d1, d2) => x <= 0 ? 1 : x === Infinity ? 0 : fBeta(x, d1, d2).Ic,
  ppf: (p, d1, d2) => {
    if (!checkP(p) || !(d1 > 0) || !(d2 > 0)) return NaN;
    if (p === 0) return 0;
    if (p === 1) return Infinity;
    if (p > 0.5) return fDist.isf(1 - p, d1, d2);
    return solveTail((x) => fDist.cdf(x, d1, d2), (x) => x * fDist.pdf(x, d1, d2) / fDist.cdf(x, d1, d2), p, 1, true);
  },
  isf: (q, d1, d2) => {
    if (!checkP(q) || !(d1 > 0) || !(d2 > 0)) return NaN;
    if (q === 0) return Infinity;
    if (q === 1) return 0;
    if (q > 0.5) return fDist.ppf(1 - q, d1, d2);
    return solveTail((x) => fDist.sf(x, d1, d2), (x) => -x * fDist.pdf(x, d1, d2) / fDist.sf(x, d1, d2), q, 1, false);
  },
};

// ---------------------------------------------------------------- non-central

/** Sum f(j) · w_j over Poisson(μ) weights w_j, outward from the mode, until the remaining weight is negligible. */
function poissonMix(mu, f, logw = (j) => -mu + j * Math.log(mu) - lgamma(j + 1)) {
  if (mu === 0) return f(0, 1);
  const j0 = Math.floor(mu);
  let sum = 0;
  for (let j = j0; j < j0 + 100000; j++) {            // upward
    const w = Math.exp(logw(j));
    sum += f(j, w);
    // remaining weight ≤ w · Σ (μ/(j+1))^k
    const r = mu / (j + 1);
    if (j > j0 && w * r / (1 - r) <= 1e-17 * Math.abs(sum) || w === 0 && j > mu) break;
  }
  for (let j = j0 - 1; j >= 0; j--) {                  // downward
    const w = Math.exp(logw(j));
    sum += f(j, w);
    if (w * j / mu <= 1e-17 * Math.abs(sum) * (1 - j / mu) || w === 0) break;
  }
  return sum;
}

/** Non-central t: cdf and sf (Guenther 1978 series). */
export const nct = {
  cdf: (x, df, nc) => (x < 0 ? nctUpper(-x, df, -nc) : nctLower(x, df, nc)),
  sf: (x, df, nc) => (x < 0 ? nctLower(-x, df, -nc) : nctUpper(x, df, nc)),
};

// For t ≥ 0, with λ = δ²/2, p_j = Poisson(j; λ), q_j = δ e^−λ λ^j / (√2 Γ(j + 3/2)):
//   P(T ≤ t) = Φ(−δ) + ½ Σ [p_j I_x(j+½, ν/2) + q_j I_x(j+1, ν/2)],   x = t²/(t²+ν)
//   P(T > t) =         ½ Σ [p_j I_y(ν/2, j+½) + q_j I_y(ν/2, j+1)],   y = ν/(t²+ν)
function nctTerms(t, df, nc, upper) {
  const lam = nc * nc / 2, t2 = t * t;
  const x = t2 / (t2 + df), y = df / (t2 + df);
  const lq = (j) => Math.log(Math.abs(nc)) - lam + (j === 0 ? 0 : j * Math.log(lam)) - 0.5 * Math.LN2 - lgamma(j + 1.5);
  const sgn = nc < 0 ? -1 : 1;
  const P = poissonMix(lam, (j, w) => {
    const b = betaInc(x, j + 0.5, df / 2, y);
    return w * (upper ? b.Ic : b.I);
  });
  const Q = nc === 0 ? 0 : poissonMix(lam, (j, w) => {
    const b = betaInc(x, j + 1, df / 2, y);
    return w * (upper ? b.Ic : b.I);
  }, lq);
  return (P + sgn * Q) / 2;
}
function nctLower(t, df, nc) { return normal.cdf(-nc) + nctTerms(t, df, nc, false); }
function nctUpper(t, df, nc) { return nctTerms(t, df, nc, true); }

/** Non-central F (non-centrality λ, Poisson mean λ/2): cdf and sf. */
export const ncf = {
  cdf: (x, d1, d2, nc) => x <= 0 ? 0 : ncfSum(x, d1, d2, nc, false),
  sf: (x, d1, d2, nc) => x <= 0 ? 1 : ncfSum(x, d1, d2, nc, true),
};
function ncfSum(x, d1, d2, nc, upper) {
  const s = d1 * x + d2, bx = d1 * x / s, by = d2 / s;
  return poissonMix(nc / 2, (j, w) => {
    const b = betaInc(bx, d1 / 2 + j, d2 / 2, by);
    return w * (upper ? b.Ic : b.I);
  });
}
