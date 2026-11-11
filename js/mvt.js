// Multivariate normal and t probabilities of a box symmetric about 0, for simultaneous inference
// (Dunnett's comparisons with a control, and any set of contrasts; issue #80).
//
//   pmvtBox(c, R, df)         P(|T_i| ≤ c_i for every i), T multivariate t with correlation R and
//                             df degrees of freedom (Infinity: normal); c a number or one per row
//   qmvtBox(p, R, df)         the c with P(|T_i| ≤ c for every i) = p: the critical value of
//                             simultaneous two-sided intervals at level p
//   adjustedP(t, R, df)       single-step adjusted p values: P(max |T_i| ≥ |t_j|) for each j
//
// Product form (Dunnett's case): when the correlations are ρ_ij = λ_i λ_j — comparisons of
// several treatments with one control from independent means, or from a balanced model — the
// probability is a one-dimensional integral over a common normal factor (two with t):
//   P = ∫ φ(z) Π_i [Φ((c s + λ_i z)/√(1 − λ_i²)) − Φ((−c s + λ_i z)/√(1 − λ_i²))] dz,
// by Gauss–Hermite quadrature (80 nodes), exact to about 1e-12. Otherwise:
//
// Method: Genz (1992) separation of variables — the normal probability as an integral over the
// unit cube after a Cholesky factorisation, a correlation of rank r < m handled by its zero
// pivots — with a rank-1 lattice (Kronecker sequence, √primes) of 1024 points shifted 10 times,
// antithetic and periodised (baker's transform). The same points every time, so the result is a
// smooth, reproducible function of c (a quantile can be found by root finding). For t, s =
// √(χ²_df / df) is one more lattice coordinate. Accuracy about 1e-4 (an error estimate from the
// shifts is returned as err): this path is for user contrasts; Dunnett's comparisons take the
// exact product form, where s is integrated by 64-point Gauss–Legendre over its central range.

import { normal, chi2 } from './dist.js';

/** λ with R_ij = λ_i λ_j (i ≠ j), or null when R is not of that form (or some |λ| ≥ 1). */
export function productForm(R) {
  const m = R.length;
  if (m < 2) return m === 1 ? [0] : null;
  if (m === 2) { const r = R[0][1]; const l = Math.sqrt(Math.abs(r)); return [l, Math.sign(r) * l]; }
  const lam = R.map((row, i) => {
    // λ_i² = R_ij R_ik / R_jk for some j, k ≠ i with R_jk away from 0
    let best = null;
    for (let j = 0; j < m; j++) for (let k = j + 1; k < m; k++) {
      if (j === i || k === i || Math.abs(R[j][k]) < 1e-8) continue;
      const v = R[i][j] * R[i][k] / R[j][k];
      if (best === null || Math.abs(R[j][k]) > best.w) best = { v, w: Math.abs(R[j][k]), j };
    }
    if (!best || best.v < 0) return NaN;
    const l = Math.sqrt(best.v);
    return R[i][best.j] < 0 ? -l : l;
  });
  // fix signs from the first row, then check every pair
  if (lam.some(l => !Number.isFinite(l) || Math.abs(l) >= 1 - 1e-12)) return null;
  for (let i = 1; i < m; i++) if (Math.sign(R[0][i]) !== Math.sign(lam[0] * lam[i]) && Math.abs(R[0][i]) > 1e-12) lam[i] = -lam[i];
  for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) if (Math.abs(R[i][j] - lam[i] * lam[j]) > 1e-9) return null;
  return lam;
}

// Gauss–Hermite (probabilists') nodes and weights: ∫ φ(z) f(z) dz ≈ Σ w f(x)
const GH = (() => {
  const n = 80, x = [], w = [];
  // Golub–Welsch would need an eigen solver; Newton on the Hermite polynomial with good starts
  let z = 0;
  for (let i = 0; i < n; i++) {
    if (i === 0) z = Math.sqrt(2 * n + 1) - 1.85575 * (2 * n + 1) ** (-1 / 6);
    else if (i === 1) z -= 1.14 * n ** 0.426 / z;
    else if (i === 2) z = 1.86 * z - 0.86 * x[0];
    else if (i === 3) z = 1.91 * z - 0.91 * x[1];
    else z = 2 * z - x[i - 2];
    let pp = 0;
    for (let it = 0; it < 100; it++) {
      let p1 = Math.PI ** -0.25, p2 = 0;
      for (let j = 1; j <= n; j++) { const p3 = p2; p2 = p1; p1 = z * Math.sqrt(2 / j) * p2 - Math.sqrt((j - 1) / j) * p3; }
      pp = Math.sqrt(2 * n) * p2;
      const z1 = z; z = z1 - p1 / pp;
      if (Math.abs(z - z1) < 1e-14) break;
    }
    x.push(z); w.push(2 / (pp * pp));
  }
  // physicists' (weight e^{−x²}) to probabilists' (φ): z = √2 x, weight / √π
  const xs = [], ws = [];
  for (let i = 0; i < n; i++) { xs.push(Math.SQRT2 * x[i]); ws.push(w[i] / Math.sqrt(Math.PI)); }
  return { x: xs, w: ws };
})();

/** P(−b_i ≤ Z_i ≤ b_i) for Z normal with product-form correlation λ. */
function pmvnProduct(b, lam) {
  let p = 0;
  const sd = lam.map(l => Math.sqrt(1 - l * l));
  for (let q = 0; q < GH.x.length; q++) {
    const z = GH.x[q];
    let f = 1;
    for (let i = 0; i < b.length && f > 0; i++) f *= normal.cdf((b[i] + lam[i] * z) / sd[i]) - normal.cdf((-b[i] + lam[i] * z) / sd[i]);
    p += GH.w[q] * f;
  }
  return p;
}

const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113];
const NPTS = 1024, SHIFTS = 10;

/** Cholesky of a positive semi-definite correlation matrix; rows of a zero pivot are dependent. */
function cholPSD(R) {
  const m = R.length, L = R.map(() => new Array(m).fill(0));
  for (let j = 0; j < m; j++) {
    let d = R[j][j];
    for (let k = 0; k < j; k++) d -= L[j][k] ** 2;
    if (d < 1e-10) { L[j][j] = 0; for (let i = j + 1; i < m; i++) { let s = R[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]; L[i][j] = 0; void s; } continue; }
    const ljj = Math.sqrt(d); L[j][j] = ljj;
    for (let i = j + 1; i < m; i++) { let s = R[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]; L[i][j] = s / ljj; }
  }
  return L;
}

// a small deterministic generator for the lattice shifts
function shifts(dim) {
  let a = 0x9e3779b9 >>> 0;
  const next = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return Array.from({ length: SHIFTS }, () => Array.from({ length: dim }, next));
}

/**
 * P(−b·s ≤ Z ≤ b·s) for Z normal with correlation (Cholesky factor L), b a vector; scaleOf(w): s
 * from an extra lattice coordinate w (the t case; omitted: s = 1). { p, err }.
 */
function pmvnBox(b0, L, sh, scaleOf) {
  const m = b0.length, extra = scaleOf ? 1 : 0;
  if (m === 1 && !extra) return { p: 2 * normal.cdf(b0[0]) - 1, err: 0 };
  // a singular correlation: a row with a zero pivot is a combination of earlier variables; its
  // bounds are folded into those of the last variable it involves (Genz & Bretz)
  const pivot = L.map((r, i) => r[i] > 0);
  const deps = L.map(() => []);
  for (let i = 0; i < m; i++) {
    if (pivot[i]) continue;
    let last = -1;
    for (let k = 0; k < i; k++) if (Math.abs(L[i][k]) > 1e-12) last = k;
    if (last >= 0) deps[last].push(i);
  }
  const gen = PRIMES.slice(0, m - 1 + extra).map(Math.sqrt);
  const b = b0.slice();
  const est = [];
  const y = new Array(m).fill(0);
  for (const shift of sh) {
    let sum = 0;
    for (let n = 1; n <= NPTS; n++) {
      for (const anti of [false, true]) {
        let f = 1;
        if (extra) {
          let w = (n * gen[m - 1] + shift[m - 1]) % 1;
          w = Math.abs(2 * w - 1); if (anti) w = 1 - w;
          const sc = scaleOf(w);
          for (let i = 0; i < m; i++) b[i] = b0[i] * sc;
        }
        for (let i = 0; i < m && f > 0; i++) {
          if (!pivot[i]) { y[i] = 0; continue; }
          let s = 0;
          for (let k = 0; k < i; k++) s += L[i][k] * y[k];
          // y_i's interval: its own row, and the rows that end with it
          let lo = (-b[i] - s) / L[i][i], hi = (b[i] - s) / L[i][i];
          for (const r of deps[i]) {
            let t = 0;
            for (let k = 0; k < i; k++) t += L[r][k] * y[k];
            const c = L[r][i];
            let l2 = (-b[r] - t) / c, h2 = (b[r] - t) / c;
            if (c < 0) [l2, h2] = [h2, l2];
            if (l2 > lo) lo = l2;
            if (h2 < hi) hi = h2;
          }
          if (!(hi > lo)) { f = 0; break; }
          const d = normal.cdf(lo), e = normal.cdf(hi);
          f *= e - d;
          if (f === 0) break;
          if (i === m - 1) continue;                       // nothing after it needs y
          let w = (n * gen[Math.min(i, gen.length - 1)] + shift[Math.min(i, shift.length - 1)]) % 1;
          w = Math.abs(2 * w - 1);
          if (anti) w = 1 - w;
          y[i] = normal.ppf(Math.min(1 - 1e-16, Math.max(1e-16, d + w * (e - d))));
        }
        sum += f;
      }
    }
    est.push(sum / (2 * NPTS));
  }
  const p = est.reduce((a, x) => a + x, 0) / est.length;
  const v = est.reduce((a, x) => a + (x - p) ** 2, 0) / (est.length * (est.length - 1));
  return { p, err: 3 * Math.sqrt(v) };
}

// Gauss–Legendre nodes and weights on [0, 1]
const GL = (() => {
  const n = 64, x = [], w = [];
  for (let i = 1; i <= n; i++) {
    let z = Math.cos(Math.PI * (i - 0.25) / (n + 0.5)), pp = 0;
    for (let it = 0; it < 100; it++) {
      let p1 = 1, p2 = 0;
      for (let j = 1; j <= n; j++) { const p3 = p2; p2 = p1; p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j; }
      pp = n * (z * p1 - p2) / (z * z - 1);
      const z1 = z; z = z1 - p1 / pp;
      if (Math.abs(z - z1) < 1e-15) break;
    }
    x.push((1 - z) / 2); w.push(1 / ((1 - z * z) * pp * pp));
  }
  return { x, w };
})();
// s = √(χ²_df / df): 64 Gauss–Legendre nodes over s itself, between its 1e-15 and 1 − 1e-15
// quantiles, weighted by its density 2 df s f_χ²(df s²) — the integrand is smooth there
const sCache = new Map();
const sNodes = (df) => {
  if (!sCache.has(df)) {
    const lo = Math.sqrt(chi2.ppf(1e-15, df) / df), hi = Math.sqrt(chi2.ppf(1 - 1e-15, df) / df);
    const s = GL.x.map(u => lo + u * (hi - lo));
    const w = s.map((x, i) => GL.w[i] * (hi - lo) * 2 * df * x * chi2.pdf(df * x * x, df));
    sCache.set(df, { s, w });
  }
  return sCache.get(df);
};

// s = √(χ²_df / df) at a probability w, for the lattice: a table of 4097 quantiles, linear between
const tabCache = new Map();
const sTable = (df) => {
  if (!tabCache.has(df)) {
    const n = 4096, t = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) { const u = Math.min(1 - 1e-12, Math.max(1e-12, i / n)); t[i] = Math.sqrt(chi2.ppf(u, df) / df); }
    tabCache.set(df, (w) => { const x = w * n, i = Math.min(n - 1, Math.floor(x)); return t[i] + (x - i) * (t[i + 1] - t[i]); });
  }
  return tabCache.get(df);
};

/** P(|T_i| ≤ c_i ∀ i): { p, err, method: 'product' | 'lattice' }. */
export function pmvtBox(c, R, df = Infinity) {
  const m = R.length, cv = Array.isArray(c) ? c : new Array(m).fill(c);
  if (cv.some(x => !(x > 0))) return { p: 0, err: 0 };
  const lam = productForm(R);
  if (lam) {
    if (!Number.isFinite(df)) return { p: pmvnProduct(cv, lam), err: 0, method: 'product' };
    const S = sNodes(df);
    let p = 0;
    S.s.forEach((sv, i) => { p += S.w[i] * pmvnProduct(cv.map(x => x * sv), lam); });
    return { p: Math.min(1, Math.max(0, p)), err: 0, method: 'product' };
  }
  const L = cholPSD(R), sh = shifts(m);
  if (!Number.isFinite(df)) return { ...pmvnBox(cv, L, sh), method: 'lattice' };
  const r = pmvnBox(cv, L, sh, sTable(df));
  return { p: Math.min(1, Math.max(0, r.p)), err: r.err, method: 'lattice' };
}

/** The c with P(|T_i| ≤ c ∀ i) = p. */
export function qmvtBox(p, R, df = Infinity) {
  const f = (c) => pmvtBox(c, R, df).p - p;
  let lo = 0, hi = 2;
  while (f(hi) < 0) { lo = hi; hi *= 2; if (hi > 1e3) return NaN; }
  let flo = f(lo), fhi = f(hi);
  for (let it = 0; it < 60 && hi - lo > 1e-9 * hi; it++) {
    let x = hi - fhi * (hi - lo) / (fhi - flo);
    if (!(x > lo && x < hi) || it % 3 === 2) x = (lo + hi) / 2;
    const fx = f(x);
    if (fx === 0) return x;
    if (fx < 0) { lo = x; flo = fx; } else { hi = x; fhi = fx; }
  }
  return (lo + hi) / 2;
}

/** Single-step adjusted p values for statistics t (correlation R, df). */
export const adjustedP = (t, R, df = Infinity) => t.map(x => Math.min(1, Math.max(0, 1 - pmvtBox(Math.abs(x), R, df).p)));
