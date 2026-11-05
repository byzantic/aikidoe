// Dense linear algebra for small problems (spec §3): a few hundred rows, up to ~100 columns.
//
// Matrices are arrays of rows (number[][]); vectors are number[]. Inputs are never modified.
//
//   qr(A, opts)       Householder QR, optionally column-pivoted; least squares, rank, aliasing
//   chol(A, opts)     Cholesky A = L Lᵀ, with optional diagonal jitter
//   lu(A)             LU with partial pivoting; solve, inverse, determinant
//   eigSym(A)         symmetric eigendecomposition (cyclic Jacobi)
//   svd(A)            thin SVD (one-sided Jacobi)
//   pinv, matrixRank, cond, slogdet, solveLower, solveUpper, and small helpers
//
// Rank-deficient model matrices are normal in DOE (aliased terms in fractional designs), so
// qr() never fails on them: it reports the rank and which columns are aliased, and least
// squares gives NaN for those coefficients, as R's lm() gives NA.

const EPS = 2.220446049250313e-16;

// ---------------------------------------------------------------- helpers

export const zeros = (m, n) => Array.from({ length: m }, () => new Array(n).fill(0));
export const eye = (n) => { const I = zeros(n, n); for (let i = 0; i < n; i++) I[i][i] = 1; return I; };
export const copy = (A) => A.map(r => r.slice());
export const shape = (A) => [A.length, A.length ? A[0].length : 0];
export const transpose = (A) => { const [m, n] = shape(A); const T = zeros(n, m); for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) T[j][i] = A[i][j]; return T; };
export const dot = (x, y) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * y[i]; return s; };
export const matvec = (A, x) => A.map(r => dot(r, x));

export function norm2(x) {
  // scaled to avoid overflow/underflow, like BLAS dnrm2
  let scale = 0, ssq = 1;
  for (const v of x) {
    if (v === 0) continue;
    const a = Math.abs(v);
    if (scale < a) { ssq = 1 + ssq * (scale / a) ** 2; scale = a; } else ssq += (a / scale) ** 2;
  }
  return scale * Math.sqrt(ssq);
}

export function matmul(A, B) {
  const [m, k] = shape(A), [k2, n] = shape(B);
  if (k !== k2) throw new Error(`matmul: ${m}×${k} times ${k2}×${n}`);
  const C = zeros(m, n);
  for (let i = 0; i < m; i++) {
    const Ai = A[i], Ci = C[i];
    for (let l = 0; l < k; l++) { const a = Ai[l]; if (a === 0) continue; const Bl = B[l]; for (let j = 0; j < n; j++) Ci[j] += a * Bl[j]; }
  }
  return C;
}

/** AᵀA (the information matrix X'X), exploiting symmetry. */
export function crossprod(A) {
  const [m, n] = shape(A), C = zeros(n, n);
  for (let r = 0; r < m; r++) { const a = A[r]; for (let i = 0; i < n; i++) { const ai = a[i]; if (ai === 0) continue; for (let j = i; j < n; j++) C[i][j] += ai * a[j]; } }
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) C[i][j] = C[j][i];
  return C;
}

const isMat = (b) => Array.isArray(b[0]);
// apply a vector solver to each column of a matrix right-hand side
const byColumns = (B, f) => transpose(transpose(B).map(f));

// ---------------------------------------------------------------- triangular solves

/** Solve L x = b (or Lᵀ x = b with trans) for lower-triangular L; b a vector or matrix. */
export function solveLower(L, b, { trans = false, unit = false } = {}) {
  if (isMat(b)) return byColumns(b, c => solveLower(L, c, { trans, unit }));
  const n = b.length, x = b.slice();
  if (!trans) for (let i = 0; i < n; i++) { let s = x[i]; for (let j = 0; j < i; j++) s -= L[i][j] * x[j]; x[i] = unit ? s : s / L[i][i]; }
  else for (let i = n - 1; i >= 0; i--) { let s = x[i]; for (let j = i + 1; j < n; j++) s -= L[j][i] * x[j]; x[i] = unit ? s : s / L[i][i]; }
  return x;
}

/** Solve U x = b (or Uᵀ x = b with trans) for upper-triangular U (only the leading n×n is used). */
export function solveUpper(U, b, { trans = false } = {}) {
  if (isMat(b)) return byColumns(b, c => solveUpper(U, c, { trans }));
  const n = b.length, x = b.slice();
  if (!trans) for (let i = n - 1; i >= 0; i--) { let s = x[i]; for (let j = i + 1; j < n; j++) s -= U[i][j] * x[j]; x[i] = s / U[i][i]; }
  else for (let i = 0; i < n; i++) { let s = x[i]; for (let j = 0; j < i; j++) s -= U[j][i] * x[j]; x[i] = s / U[i][i]; }
  return x;
}

// ---------------------------------------------------------------- QR

/**
 * Householder QR of an m×n matrix, A P = Q R.
 *
 * opts.pivot:
 *   'limited' (default) — R/LINPACK dqrdc2 behaviour: columns keep their order, except that a
 *             column whose remaining norm is below tol × its original norm is moved to the end.
 *             The first independent columns are kept, so in a model the later (higher-order)
 *             term is the one reported as aliased. Matches R's qr() and lm().
 *   'full'    — largest remaining column norm first (LAPACK dgeqp3); rank-revealing.
 *   'none'    — no pivoting; rank is still estimated from |R_kk|.
 * opts.tol: rank tolerance (default 1e-7, as R). For 'limited' it is relative to each column's
 *   original norm; for 'full' and 'none', relative to |R_00|.
 *
 * Returned object: { m, n, rank, perm, aliased, R(), Q(), qty(y), qy(z), coef(y), fitted(y),
 *   residuals(y), unscaledCov(), logAbsDetR() }. perm[k] is the original index of pivoted column k.
 */
export function qr(A, { pivot = 'limited', tol = 1e-7 } = {}) {
  const [m, n] = shape(A);
  const a = copy(A), perm = [...Array(n).keys()];
  const k = Math.min(m, n);
  const tau = new Array(k).fill(0);
  const colnorm = (j, from) => { const v = new Array(m - from); for (let i = from; i < m; i++) v[i - from] = a[i][j]; return norm2(v); };
  const orig = perm.map(j => colnorm(j, 0));
  const swapCols = (p, q) => { for (let i = 0; i < m; i++) { const t = a[i][p]; a[i][p] = a[i][q]; a[i][q] = t; } [perm[p], perm[q]] = [perm[q], perm[p]]; [orig[p], orig[q]] = [orig[q], orig[p]]; };
  const moveToEnd = (p) => { for (let q = p; q < n - 1; q++) swapCols(q, q + 1); };

  let lim = n;            // 'limited': columns at index ≥ lim have been moved to the end as aliased
  for (let l = 0; l < k; l++) {
    if (pivot === 'full') {
      let best = l, bn = -1;
      for (let j = l; j < n; j++) { const c = colnorm(j, l); if (c > bn) { bn = c; best = j; } }
      if (best !== l) swapCols(l, best);
    } else if (pivot === 'limited') {
      // as dqrdc2: aliased columns are set aside at the end but still reduced, so A P = Q R holds
      while (l < lim && !(colnorm(l, l) >= orig[l] * tol && orig[l] > 0)) { moveToEnd(l); lim--; }
    }
    // Householder reflector for column l, rows l..m-1: H = I − τ v vᵀ, v[0] = 1
    // No reflection (H = I) when there is nothing below the diagonal: always on the last row
    // (as LINPACK dqrdc2, so R's sign of R_kk is reproduced), and for 'full'/'none' also when the
    // subdiagonal part is exactly zero (as LAPACK dlarfg).
    const x0 = a[l][l], nx = colnorm(l, l);
    let tailZero = true;
    for (let i = l + 1; i < m && tailZero; i++) if (a[i][l] !== 0) tailZero = false;
    if (nx === 0 || l === m - 1 || (pivot !== 'limited' && tailZero)) { tau[l] = 0; continue; }
    const alpha = x0 >= 0 ? -nx : nx, d = x0 - alpha;
    for (let i = l + 1; i < m; i++) a[i][l] /= d;
    tau[l] = (alpha - x0) / alpha;
    a[l][l] = alpha;
    for (let j = l + 1; j < n; j++) {
      let s = a[l][j];
      for (let i = l + 1; i < m; i++) s += a[i][l] * a[i][j];
      s *= tau[l];
      a[l][j] -= s;
      for (let i = l + 1; i < m; i++) a[i][j] -= s * a[i][l];
    }
  }

  let rank;
  if (pivot === 'limited') rank = Math.min(lim, k);
  else {
    const r0 = k ? Math.abs(a[0][0]) : 0;
    rank = 0;
    while (rank < k && r0 > 0 && Math.abs(a[rank][rank]) > tol * r0) rank++;
  }

  // apply Q or Qᵀ to a vector (length m)
  const applyH = (z, l) => {
    if (tau[l] === 0) return;
    let s = z[l];
    for (let i = l + 1; i < m; i++) s += a[i][l] * z[i];
    s *= tau[l];
    z[l] -= s;
    for (let i = l + 1; i < m; i++) z[i] -= s * a[i][l];
  };
  const qty = (y) => { const z = y.slice(); for (let l = 0; l < k; l++) applyH(z, l); return z; };
  const qy = (z0) => { const z = z0.slice(); while (z.length < m) z.push(0); for (let l = k - 1; l >= 0; l--) applyH(z, l); return z; };
  const Rmat = () => { const R = zeros(k, n); for (let i = 0; i < k; i++) for (let j = i; j < n; j++) R[i][j] = a[i][j]; return R; };
  const R11 = () => { const R = zeros(rank, rank); for (let i = 0; i < rank; i++) for (let j = i; j < rank; j++) R[i][j] = a[i][j]; return R; };

  const coef = (y) => {
    if (isMat(y)) return byColumns(y, coef);
    const z = qty(y).slice(0, rank);
    const b = solveUpper(R11(), z);
    const out = new Array(n).fill(NaN);
    for (let i = 0; i < rank; i++) out[perm[i]] = b[i];
    return out;
  };
  const fitted = (y) => { const z = qty(y); for (let i = rank; i < m; i++) z[i] = 0; return qy(z); };

  return {
    m, n, rank, perm: perm.slice(),
    aliased: perm.slice(rank).sort((p, q) => p - q),
    pivot, tol,
    /** R, min(m,n) × n, columns in pivoted order. */
    R: Rmat,
    /** Thin Q, m × min(m,n). */
    Q: () => transpose(Array.from({ length: k }, (_, j) => qy(Array.from({ length: m }, (_, i) => (i === j ? 1 : 0))))),
    qty, qy,
    /** Least-squares coefficients in original column order; NaN for aliased columns. */
    coef,
    fitted,
    residuals: (y) => { const f = fitted(y); return y.map((v, i) => v - f[i]); },
    /** (XᵀX)⁻¹ over the estimable columns, in original order; NaN rows/columns for aliased ones. */
    unscaledCov: () => {
      const Ri = solveUpper(R11(), eye(rank));               // R⁻¹
      const C = zeros(n, n).map(r => r.fill(NaN));
      for (let i = 0; i < rank; i++) for (let j = 0; j < rank; j++) {
        let s = 0; for (let l = Math.max(i, j); l < rank; l++) s += Ri[i][l] * Ri[j][l];
        C[perm[i]][perm[j]] = s;
      }
      return C;
    },
    /** log |det R11| (= ½ log det XᵀX for a full-rank X). */
    logAbsDetR: () => { let s = 0; for (let i = 0; i < rank; i++) s += Math.log(Math.abs(a[i][i])); return s; },
  };
}

// ---------------------------------------------------------------- Cholesky

/**
 * Cholesky factor of a symmetric positive-definite matrix: A = L Lᵀ, L lower triangular.
 * Only the lower triangle of A is read. Throws if A is not positive definite, unless
 * opts.jitter > 0: then δ = jitter·max(diag A) is added to the diagonal, ×10 per retry, up to
 * opts.maxTries times. Returns { L, added } where added is the total diagonal shift used.
 */
export function chol(A, { jitter = 0, maxTries = 8 } = {}) {
  const n = A.length;
  const attempt = (shift) => {
    const L = zeros(n, n);
    for (let j = 0; j < n; j++) {
      let d = A[j][j] + shift;
      for (let l = 0; l < j; l++) d -= L[j][l] * L[j][l];
      if (!(d > 0)) return { fail: j };
      const ljj = Math.sqrt(d);
      L[j][j] = ljj;
      for (let i = j + 1; i < n; i++) {
        let s = A[i][j];
        for (let l = 0; l < j; l++) s -= L[i][l] * L[j][l];
        L[i][j] = s / ljj;
      }
    }
    return { L };
  };
  let r = attempt(0);
  if (r.L) return { L: r.L, added: 0 };
  if (!(jitter > 0)) throw new Error(`chol: matrix is not positive definite (pivot ${r.fail})`);
  let delta = jitter * Math.max(...A.map((row, i) => Math.abs(row[i])), EPS);
  for (let t = 0; t < maxTries; t++, delta *= 10) {
    r = attempt(delta);
    if (r.L) return { L: r.L, added: delta };
  }
  throw new Error(`chol: not positive definite even with diagonal jitter ${delta / 10}`);
}

/** Solve A x = b given A's Cholesky factor L. */
export const cholSolve = (L, b) => solveLower(L, solveLower(L, b), { trans: true });
/** log det A from its Cholesky factor. */
export const cholLogdet = (L) => { let s = 0; for (let i = 0; i < L.length; i++) s += Math.log(L[i][i]); return 2 * s; };
/** A⁻¹ from its Cholesky factor. */
export const cholInverse = (L) => cholSolve(L, eye(L.length));

// ---------------------------------------------------------------- LU

/** LU with partial pivoting of a square matrix: P A = L U. */
export function lu(A) {
  const n = A.length, a = copy(A), piv = [...Array(n).keys()];
  let sign = 1, singular = false;
  for (let k = 0; k < n; k++) {
    let p = k, big = Math.abs(a[k][k]);
    for (let i = k + 1; i < n; i++) if (Math.abs(a[i][k]) > big) { big = Math.abs(a[i][k]); p = i; }
    if (p !== k) { [a[p], a[k]] = [a[k], a[p]]; [piv[p], piv[k]] = [piv[k], piv[p]]; sign = -sign; }
    if (a[k][k] === 0) { singular = true; continue; }
    for (let i = k + 1; i < n; i++) {
      const f = (a[i][k] /= a[k][k]);
      if (f !== 0) for (let j = k + 1; j < n; j++) a[i][j] -= f * a[k][j];
    }
  }
  const solve = (b) => {
    if (singular) throw new Error('lu: matrix is singular');
    if (isMat(b)) return byColumns(b, solve);
    return solveUpper(a, solveLower(a, piv.map(i => b[i]), { unit: true }));
  };
  return { LU: a, piv, sign, singular, solve };
}

/** Solve a square system A x = b (b vector or matrix). */
export const solve = (A, b) => lu(A).solve(b);
/** Inverse of a square matrix. */
export const inv = (A) => lu(A).solve(eye(A.length));

/** { sign, logabsdet } of a square matrix, as numpy.linalg.slogdet. sign 0 if singular. */
export function slogdet(A) {
  const { LU, sign, singular } = lu(A);
  if (singular) return { sign: 0, logabsdet: -Infinity };
  let s = sign, l = 0;
  for (let i = 0; i < LU.length; i++) { const d = LU[i][i]; if (d < 0) s = -s; l += Math.log(Math.abs(d)); }
  return { sign: s, logabsdet: l };
}

// ---------------------------------------------------------------- symmetric eigen

/**
 * Eigendecomposition of a symmetric matrix by cyclic Jacobi rotations: A = V diag(values) Vᵀ.
 * Values are in descending order; vectors are the columns of V, each with its largest-magnitude
 * component positive (a fixed sign convention, so results are reproducible). Only the lower
 * triangle of A is read.
 */
export function eigSym(A, { maxSweeps = 60 } = {}) {
  const n = A.length, a = zeros(n, n), V = eye(n);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) a[i][j] = a[j][i] = A[i][j];
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let rotated = false;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      const apq = a[p][q];
      if (apq === 0 || Math.abs(apq) <= EPS * Math.sqrt(Math.abs(a[p][p] * a[q][q])) || Math.abs(apq) < 1e-300) continue;
      rotated = true;
      const theta = (a[q][q] - a[p][p]) / (2 * apq);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {           // columns p, q
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {           // rows p, q
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
      }
      a[p][q] = a[q][p] = 0;
      for (let k = 0; k < n; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
      }
    }
    if (!rotated) break;
  }
  const order = [...Array(n).keys()].sort((i, j) => a[j][j] - a[i][i]);
  const values = order.map(i => a[i][i]);
  const vectors = zeros(n, n);
  order.forEach((src, dst) => {
    let big = 0; for (let k = 0; k < n; k++) if (Math.abs(V[k][src]) > Math.abs(V[big][src])) big = k;
    const sg = V[big][src] < 0 ? -1 : 1;
    for (let k = 0; k < n; k++) vectors[k][dst] = sg * V[k][src];
  });
  return { values, vectors };
}

// ---------------------------------------------------------------- SVD

/**
 * Thin SVD by one-sided Jacobi (Hestenes): A = U diag(s) Vᵀ, s descending, U m×k, V n×k,
 * k = min(m, n). Singular vectors use the same sign convention as eigSym (on V). Columns of U
 * for zero singular values are zero.
 */
export function svd(A, { maxSweeps = 60 } = {}) {
  const [m, n] = shape(A);
  if (m < n) { const r = svd(transpose(A), { maxSweeps }); return { U: r.V, s: r.s, V: r.U, _flipped: true }; }
  const U = copy(A), V = eye(n);
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let rotated = false;
    for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) {
      let al = 0, be = 0, ga = 0;
      for (let r = 0; r < m; r++) { const ui = U[r][i], uj = U[r][j]; al += ui * ui; be += uj * uj; ga += ui * uj; }
      if (ga === 0 || Math.abs(ga) <= EPS * Math.sqrt(al * be)) continue;
      rotated = true;
      const zeta = (be - al) / (2 * ga);
      const t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
      const c = 1 / Math.sqrt(1 + t * t), s = c * t;
      for (let r = 0; r < m; r++) { const ui = U[r][i], uj = U[r][j]; U[r][i] = c * ui - s * uj; U[r][j] = s * ui + c * uj; }
      for (let r = 0; r < n; r++) { const vi = V[r][i], vj = V[r][j]; V[r][i] = c * vi - s * vj; V[r][j] = s * vi + c * vj; }
    }
    if (!rotated) break;
  }
  const sv = [...Array(n).keys()].map(j => norm2(U.map(r => r[j])));
  const order = [...Array(n).keys()].sort((i, j) => sv[j] - sv[i]);
  const Uo = zeros(m, n), Vo = zeros(n, n);
  order.forEach((src, dst) => {
    let big = 0; for (let k = 0; k < n; k++) if (Math.abs(V[k][src]) > Math.abs(V[big][src])) big = k;
    const sg = V[big][src] < 0 ? -1 : 1, si = sv[src];
    for (let k = 0; k < n; k++) Vo[k][dst] = sg * V[k][src];
    for (let r = 0; r < m; r++) Uo[r][dst] = si > 0 ? sg * U[r][src] / si : 0;
  });
  return { U: Uo, s: order.map(i => sv[i]), V: Vo };
}

const defaultRtol = (A) => Math.max(...shape(A)) * EPS;

/** Numerical rank: singular values above rtol·s_max (numpy.linalg.matrix_rank convention). */
export function matrixRank(A, { rtol } = {}) {
  const { s } = svd(A); const t = (rtol ?? defaultRtol(A)) * (s[0] || 0);
  return s.filter(x => x > t).length;
}

/** Moore–Penrose pseudo-inverse via SVD (numpy.linalg.pinv convention for rtol). */
export function pinv(A, { rtol } = {}) {
  const { U, s, V } = svd(A), [m, n] = shape(A);
  const t = (rtol ?? defaultRtol(A)) * (s[0] || 0);
  const P = zeros(n, m);
  for (let k = 0; k < s.length; k++) {
    if (!(s[k] > t)) continue;
    const w = 1 / s[k];
    for (let i = 0; i < n; i++) { const vik = V[i][k] * w; if (vik === 0) continue; for (let j = 0; j < m; j++) P[i][j] += vik * U[j][k]; }
  }
  return P;
}

/** 2-norm condition number s_max / s_min (Infinity if singular). */
export function cond(A) { const { s } = svd(A); const lo = s[s.length - 1]; return lo > 0 ? s[0] / lo : Infinity; }
