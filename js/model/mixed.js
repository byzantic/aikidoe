// Linear mixed models with nested random intercepts, by REML (spec §7.1, §7.3; issue #15).
//
//   y = Xβ + Σ_k Z_k u_k + ε,   u_k ~ N(0, σ_k² I),   ε ~ N(0, σ² I)
//
// Z_k is the indicator matrix of the groups of component k (whole plot, run, wafer, lot …). With
// γ_k = σ_k²/σ² and H = I + Σ γ_k Z_k Z_kᵀ, σ² and β are profiled out and the REML criterion
//
//   f(γ) = (n − p) log(yᵀ P y) + log|H| + log|Xᵀ H⁻¹ X|,   P = H⁻¹ − H⁻¹X (XᵀH⁻¹X)⁻¹ XᵀH⁻¹
//
// is minimised over γ ≥ 0 by Newton's method with the exact Hessian (from P), damping and a
// backtracking line search, projected onto γ ≥ 0 so that a component can sit exactly on the
// boundary (estimate 0: reported as such, not as a failure); Nelder–Mead on √γ is the fallback.
// Fixed effects are then GLS estimates. Tests of fixed-effect terms use
//   - containment (stratum) df: a term is estimated in the finest stratum within whose groups
//     its columns are constant; that stratum's residual df is the denominator df;
//   - Kenward–Roger (1997): the small-sample adjusted covariance Φ_A and the scaled F with
//     approximate denominator df, as pbkrtest (Halekoh & Højsgaard 2014).
// Variance components get Satterthwaite (scaled χ²) intervals from the asymptotic covariance W
// of the REML estimates (the same W the KR adjustment uses).
//
// H is block diagonal over the groups of the coarsest component (all components nested), so the
// algebra is done block by block: cost Σ n_b³ per evaluation, e.g. 32 whole plots of 18
// wafer-sites in a few milliseconds. Only the residual-by-residual KR term is n × n.
import { chol, cholInverse, cholLogdet, cholSolve, qr } from '../linalg.js';
import { fDist, chi2, studentT } from '../dist.js';
import { parseFormula, modelMatrix } from './formula.js';
import { withBlockTerm, anova } from './fit.js';
import { fitOLS } from './ols.js';
import { noiseModelOf } from './noise.js';
import { observationsOf, withPositionTerms } from './sites.js';
import { withCovariates } from './covariates.js';

const sum = (a) => a.reduce((s, v) => s + v, 0);

/** Integer group index per observation and the number of groups. */
function indexGroups(labels) {
  const map = new Map(), idx = labels.map(l => { const k = String(l); if (!map.has(k)) map.set(k, map.size); return map.get(k); });
  return { idx, m: map.size, names: [...map.keys()] };
}

const groupSumVec = (v, g) => { const s = new Array(g.m).fill(0); v.forEach((x, i) => { s[g.idx[i]] += x; }); return s; };
const groupSumRows = (A, g) => { const p = A[0].length, S = Array.from({ length: g.m }, () => new Array(p).fill(0)); A.forEach((r, i) => { const t = S[g.idx[i]]; for (let a = 0; a < p; a++) t[a] += r[a]; }); return S; };
const frob2 = (S) => { let s = 0; for (const r of S) for (const v of r) s += v * v; return s; };
const matT = (A) => A[0].map((_, j) => A.map(r => r[j]));
const mm = (A, B) => { const n = A.length, k = B.length, m = B[0].length, C = Array.from({ length: n }, () => new Array(m).fill(0)); for (let i = 0; i < n; i++) for (let l = 0; l < k; l++) { const a = A[i][l]; if (a) for (let j = 0; j < m; j++) C[i][j] += a * B[l][j]; } return C; };
const tr = (A) => { let s = 0; for (let i = 0; i < A.length; i++) s += A[i][i]; return s; };
const add = (A, B, b = 1) => A.map((r, i) => r.map((v, j) => v + b * B[i][j]));
const scale = (A, s) => A.map(r => r.map(v => v * s));
function symInv(A) { return cholInverse(chol(A.map((r, i) => r.map((v, j) => (v + A[j][i]) / 2))).L); }

// ---------------------------------------------------------------- block-diagonal algebra
// With nested components, H (and Σ) are block diagonal over the groups of the coarsest
// component: everything is computed block by block, so the cost is Σ n_b³, not n³.

function makeBlocks(n, groups) {
  if (!groups.length) return [...Array(n).keys()].map(i => [i]);
  const coarse = groups.reduce((a, g) => (g.m < a.m ? g : a));
  // check that every other component is nested in the coarsest (else a single block)
  for (const g of groups) { const par = new Map(); for (let i = 0; i < n; i++) { const p = par.get(g.idx[i]); if (p === undefined) par.set(g.idx[i], coarse.idx[i]); else if (p !== coarse.idx[i]) return [[...Array(n).keys()]]; } }
  const b = Array.from({ length: coarse.m }, () => []);
  for (let i = 0; i < n; i++) b[coarse.idx[i]].push(i);
  return b;
}

// H⁻¹ per block: Hinv[b] (n_b × n_b), with log|H|. Within a block H_b = I + Z D Zᵀ with Z the
// group indicators of the components (q_b columns, D = diag(γ)), so by Woodbury
//   H_b⁻¹ = I − Z (D⁻¹ + ZᵀZ)⁻¹ Zᵀ,   log|H_b| = log|D⁻¹ + ZᵀZ| + Σ log γ
// — a q_b × q_b factorisation instead of n_b × n_b; each row of Z has one 1 per component, so
// (Z M⁻¹ Zᵀ)_ac = Σ_k Σ_l M⁻¹[g_k(a)][g_l(c)]. Components with γ = 0 are left out.
function blockInverse(blocks, groups, gamma) {
  if (!blocks._local || blocks._local.groups !== groups) {
    // per block and component: local group index of each row, and the number of local groups
    blocks._local = { groups, loc: blocks.map(I => groups.map(g => { const map = new Map(); const idx = I.map(i => { const v = g.idx[i]; if (!map.has(v)) map.set(v, map.size); return map.get(v); }); return { idx, m: map.size }; })) };
  }
  let ld = 0;
  const inv = blocks.map((I, bi) => {
    const nb = I.length, comps = [];
    let q = 0;
    blocks._local.loc[bi].forEach((c, k) => { if (gamma[k] > 0) { comps.push({ ...c, off: q, g: gamma[k] }); q += c.m; } });
    if (!q) return Array.from({ length: nb }, (_, a) => { const r = new Array(nb).fill(0); r[a] = 1; return r; });
    const M = new Float64Array(q * q);
    for (const c of comps) { for (let u = 0; u < c.m; u++) M[(c.off + u) * q + c.off + u] += 1 / c.g; ld += c.m * Math.log(c.g); }
    for (let a = 0; a < nb; a++) for (const c1 of comps) { const u = c1.off + c1.idx[a]; for (const c2 of comps) M[u * q + c2.off + c2.idx[a]] += 1; }
    const r = spdInverse(M, q); ld += r.ld;
    const Mi = r.inv;
    const out = Array.from({ length: nb }, () => new Array(nb));
    for (let a = 0; a < nb; a++) {
      const ua = comps.map(c => Mi[c.off + c.idx[a]]);
      for (let cc = a; cc < nb; cc++) {
        let v = a === cc ? 1 : 0;
        for (const row of ua) for (const c of comps) v -= row[c.off + c.idx[cc]];
        out[a][cc] = v; out[cc][a] = v;
      }
    }
    return out;
  });
  return { inv, ld };
}

// inverse and log-determinant of a symmetric positive definite matrix (flat, row-major):
// Cholesky, inverse of the factor, then L⁻ᵀ L⁻¹. Returns rows as arrays.
function spdInverse(A, n) {
  const L = new Float64Array(n * n);
  let ld = 0;
  for (let j = 0; j < n; j++) {
    let d = A[j * n + j];
    for (let k = 0; k < j; k++) d -= L[j * n + k] * L[j * n + k];
    if (!(d > 0)) throw new Error('chol: matrix is not positive definite');
    const ljj = Math.sqrt(d); L[j * n + j] = ljj; ld += 2 * Math.log(ljj);
    for (let i = j + 1; i < n; i++) { let s = A[i * n + j]; for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k]; L[i * n + j] = s / ljj; }
  }
  const M = new Float64Array(n * n);                     // M = L⁻¹ (lower)
  for (let j = 0; j < n; j++) {
    M[j * n + j] = 1 / L[j * n + j];
    for (let i = j + 1; i < n; i++) { let s = 0; for (let k = j; k < i; k++) s -= L[i * n + k] * M[k * n + j]; M[i * n + j] = s / L[i * n + i]; }
  }
  const inv = Array.from({ length: n }, () => new Array(n));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { let s = 0; for (let k = i; k < n; k++) s += M[k * n + i] * M[k * n + j]; inv[i][j] = s; inv[j][i] = s; }
  return { inv, ld };
}

// H⁻¹ M for an n × c matrix (or an n-vector)
function blockApply(blocks, inv, M) {
  const vec = !Array.isArray(M[0]);
  const out = vec ? new Array(M.length).fill(0) : M.map(r => new Array(r.length).fill(0));
  blocks.forEach((I, b) => {
    const Hb = inv[b];
    for (let a = 0; a < I.length; a++) {
      const o = vec ? null : out[I[a]];
      for (let c = 0; c < I.length; c++) {
        const h = Hb[a][c]; if (!h) continue;
        if (vec) out[I[a]] += h * M[I[c]]; else { const m = M[I[c]]; for (let j = 0; j < m.length; j++) o[j] += h * m[j]; }
      }
    }
  });
  return out;
}
// Z_kᵀ H⁻¹ Z_l (group sums of the block entries); residual "groups" are the observations
function blockGroupSums(blocks, inv, gk, gl) {
  const S = Array.from({ length: gk.m }, () => new Array(gl.m).fill(0));
  blocks.forEach((I, b) => { const Hb = inv[b]; for (let a = 0; a < I.length; a++) { const Sa = S[gk.idx[I[a]]]; for (let c = 0; c < I.length; c++) Sa[gl.idx[I[c]]] += Hb[a][c]; } });
  return S;
}

/** Pieces of the REML criterion at γ. */
function evaluate(X, y, groups, gamma, blocks, ml = false) {
  const n = y.length, p = X[0].length;
  const { inv, ld: ldH } = blockInverse(blocks, groups, gamma);
  const HiX = blockApply(blocks, inv, X), Hiy = blockApply(blocks, inv, y);
  const A = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, c) => { let s = 0; for (let i = 0; i < n; i++) s += X[i][a] * HiX[i][c]; return s; }));
  const LA = chol(A).L, ldA = cholLogdet(LA), Ainv = cholInverse(LA);
  const Xty = new Array(p).fill(0); for (let i = 0; i < n; i++) for (let a = 0; a < p; a++) Xty[a] += X[i][a] * Hiy[i];
  const beta = cholSolve(LA, Xty);
  const Py = Hiy.map((v, i) => { let s = 0; for (let a = 0; a < p; a++) s += HiX[i][a] * beta[a]; return v - s; });
  const q = y.reduce((s, v, i) => s + v * Py[i], 0);
  // REML: (n − p) log q + log|H| + log|A|;  ML: n log q + log|H|
  return { n, p, ldH, ldA, A, Ainv, beta, Py, q, inv, HiX, f: ml ? n * Math.log(q) + ldH : (n - p) * Math.log(q) + ldH + ldA };
}

// Z_kᵀ P Z_l = Z_kᵀH⁻¹Z_l − (Z_kᵀH⁻¹X) A⁻¹ (Z_lᵀH⁻¹X)ᵀ
function zPz(e, blocks, gk, gl, ZHX) {
  const S = blockGroupSums(blocks, e.inv, gk, gl);
  const Bk = mm(ZHX(gk), e.Ainv), Cl = ZHX(gl);
  for (let a = 0; a < S.length; a++) for (let c = 0; c < S[a].length; c++) { let t = 0; for (let j = 0; j < e.p; j++) t += Bk[a][j] * Cl[c][j]; S[a][c] -= t; }
  return S;
}

// gradient and Hessian of f in γ
function derivatives(e, groups, blocks, ml = false) {
  const K = groups.length, { Py, q, n, p } = e;
  const cache = new Map(), ZHX = (g) => { if (!cache.has(g)) cache.set(g, groupSumRows(e.HiX, g)); return cache.get(g); };
  const s = groups.map(g => groupSumVec(Py, g));           // Z_kᵀ P y
  const a = s.map(v => sum(v.map(x => x * x)));             // yᵀ P G_k P y
  const SS = groups.map((gk, k) => groups.map((gl, l) => (l >= k ? zPz(e, blocks, gk, gl, ZHX) : null)));
  // ML: the log-determinant terms use H⁻¹ instead of P, and n instead of n − p
  const SH = ml ? groups.map((gk, k) => groups.map((gl, l) => (l >= k ? blockGroupSums(blocks, e.inv, gk, gl) : null))) : SS;
  const m = ml ? n : n - p;
  const grad = groups.map((g, k) => -m * a[k] / q + tr(SH[k][k]));
  const hess = Array.from({ length: K }, () => new Array(K).fill(0));
  for (let k = 0; k < K; k++) for (let l = k; l < K; l++) {
    const S = SS[k][l];
    let b = 0; for (let x = 0; x < S.length; x++) for (let z = 0; z < S[x].length; z++) b += s[k][x] * S[x][z] * s[l][z];
    hess[k][l] = hess[l][k] = -frob2(SH[k][l]) + m * (2 * b / q - a[k] * a[l] / (q * q));
  }
  return { grad, hess };
}

function solveSmall(A, b) {
  const m = A.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < m; c++) {
    let pv = c; for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[pv][c])) pv = r;
    [M[c], M[pv]] = [M[pv], M[c]];
    if (Math.abs(M[c][c]) < 1e-300) return null;
    for (let r = c + 1; r < m; r++) { const f = M[r][c] / M[c][c]; for (let q = c; q <= m; q++) M[r][q] -= f * M[c][q]; }
  }
  const x = new Array(m).fill(0);
  for (let r = m - 1; r >= 0; r--) { let s = M[r][m]; for (let q = r + 1; q < m; q++) s -= M[r][q] * x[q]; x[r] = s / M[r][r]; }
  return x;
}

function newton(X, y, groups, start, blocks, ml = false) {
  const K = groups.length;
  let g = start.slice(), e = evaluate(X, y, groups, g, blocks, ml), it = 0, converged = false;
  for (; it < 200; it++) {
    const { grad, hess } = derivatives(e, groups, blocks, ml);
    // active set: components on the boundary with the criterion increasing into the interior
    const free = g.map((v, k) => !(v === 0 && grad[k] >= 0));
    const idx = [...Array(K).keys()].filter(k => free[k]);
    const pg = Math.max(0, ...idx.map(k => Math.abs(grad[k]) * Math.max(1, g[k])));
    if (pg < 1e-9) { converged = true; break; }
    // damped Newton on the free components
    let step = null;
    for (let mu = 0, t = 0; t < 30; t++, mu = mu ? mu * 10 : 1e-6 * Math.max(1, ...idx.map(k => Math.abs(hess[k][k])))) {
      const Hs = idx.map(a => idx.map(b => hess[a][b] + (a === b ? mu : 0)));
      const d = solveSmall(Hs, idx.map(k => -grad[k]));
      if (d && d.every(Number.isFinite) && d.reduce((s, v, i) => s + v * grad[idx[i]], 0) < 0) { step = d; break; }
    }
    if (!step) step = idx.map(k => -grad[k]);
    // backtracking, projected onto γ ≥ 0
    let lam = 1, moved = false;
    for (let t = 0; t < 60; t++, lam /= 2) {
      const trial = g.slice(); idx.forEach((k, i) => { trial[k] = Math.max(0, g[k] + lam * step[i]); });
      let et; try { et = evaluate(X, y, groups, trial, blocks, ml); } catch { continue; }
      if (et.f < e.f - 1e-14 * Math.abs(e.f)) { g = trial; e = et; moved = true; break; }
    }
    // no further decrease possible in floating point: converged if the gradient is negligible
    // relative to the criterion (|f| grows with n, and its rounding limits the attainable gradient)
    if (!moved) { converged = pg < 1e-7 * Math.max(1, Math.abs(e.f)); break; }
  }
  return { gamma: g, e, iterations: it, converged };
}

function nelderMead(fn, x0, { iter = 4000, tol = 1e-12 } = {}) {
  const n = x0.length;
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + (Math.abs(v) > 1e-3 ? 0.2 * v : 0.2) : v)))].map(x => ({ x, f: fn(x) }));
  for (let k = 0; k < iter; k++) {
    simplex.sort((a, b) => a.f - b.f);
    if (Math.abs(simplex[n].f - simplex[0].f) <= tol * (Math.abs(simplex[0].f) + tol)) break;
    const c = simplex.slice(0, n).reduce((acc, s) => acc.map((v, i) => v + s.x[i] / n), new Array(n).fill(0));
    const pt = (t) => c.map((v, i) => v + t * (simplex[n].x[i] - v));
    const r = { x: pt(-1) }; r.f = fn(r.x);
    if (r.f < simplex[0].f) { const ex = { x: pt(-2) }; ex.f = fn(ex.x); simplex[n] = ex.f < r.f ? ex : r; }
    else if (r.f < simplex[n - 1].f) simplex[n] = r;
    else { const ct = { x: pt(0.5) }; ct.f = fn(ct.x); if (ct.f < simplex[n].f) simplex[n] = ct; else simplex = simplex.map((s, i) => (i === 0 ? s : { x: s.x.map((v, j) => simplex[0].x[j] + 0.5 * (v - simplex[0].x[j])), f: NaN })).map(s => (Number.isNaN(s.f) ? { x: s.x, f: fn(s.x) } : s)); }
  }
  simplex.sort((a, b) => a.f - b.f);
  return simplex[0].x;
}

/**
 * Nesting order of the random components (coarse to fine) and whether they are nested:
 * component b is nested in a if every group of b lies within one group of a.
 */
function nestOrder(groups) {
  const order = groups.map((g, k) => k).sort((a, b) => groups[a].m - groups[b].m);
  let nested = true;
  for (let t = 1; t < order.length; t++) {
    const a = groups[order[t - 1]], b = groups[order[t]], parent = new Map();
    for (let i = 0; i < a.idx.length; i++) { const pb = parent.get(b.idx[i]); if (pb === undefined) parent.set(b.idx[i], a.idx[i]); else if (pb !== a.idx[i]) nested = false; }
  }
  return { order, nested };
}

const rankOf = (cols, n) => (cols.length ? qr(Array.from({ length: n }, (_, i) => cols.map(c => c[i]))).rank : 0);

/**
 * Containment (stratum) df for each column of X: strata coarse → fine are the nested random
 * components, then the residual. A column belongs to the finest stratum within whose groups it is
 * constant (the intercept to none). df(stratum k) = rank([C_k]) − rank([C_{k−1}, X_{≤k}]) with C_k
 * the group indicators of stratum k (C_0 = 1) and X_{≤k} the columns constant within its groups;
 * residual df = n − rank([C_K, X]).
 */
function containment(X, groups, order) {
  const n = X.length, p = X[0].length, cols = [...Array(p).keys()].map(j => X.map(r => r[j]));
  const ind = (g) => Array.from({ length: g.m }, (_, a) => g.idx.map(v => (v === a ? 1 : 0)));
  const constantWithin = (c, g) => { const v = new Map(); return c.every((x, i) => { const k = g.idx[i]; if (!v.has(k)) v.set(k, x); return Math.abs(v.get(k) - x) <= 1e-12 * (1 + Math.abs(x)); }); };
  const strata = order.map(k => groups[k]);
  const stratumOf = cols.map(c => { let s = strata.length; for (let t = strata.length - 1; t >= 0; t--) if (constantWithin(c, strata[t])) s = t; else break; return s; });
  // note: a column constant within the groups of stratum t is constant within every finer one
  const one = [new Array(n).fill(1)];
  const dfs = strata.map((g, t) => {
    const Ck = ind(g), Cprev = t === 0 ? one : ind(strata[t - 1]);
    const Xle = cols.filter((_, j) => stratumOf[j] <= t);
    return rankOf(Ck, n) - rankOf([...Cprev, ...Xle], n);
  });
  const last = strata.length ? ind(strata[strata.length - 1]) : one;
  const dfRes = n - rankOf([...last, ...cols], n);
  // the intercept and columns constant within the coarsest groups only are tested in that stratum
  return { stratumOf, dfs: [...dfs, dfRes] };
}

/**
 * Maximum-likelihood fit (for comparing models with different fixed effects, e.g. by AICc:
 * REML criteria are not comparable across fixed-effect structures). Returns { coef (kept columns),
 * gamma, sigma2, varcomp: [σ_k²…, σ²], deviance (−2 log L), k (parameters: p + K + 1), n, converged }.
 */
export function mlFit(X0, y, random) {
  const n = y.length;
  const f0 = qr(X0), keep = [...Array(X0[0].length).keys()].filter(j => !f0.aliased.includes(j));
  const X = X0.map(r => keep.map(j => r[j])), p = X[0].length;
  const groups = random.map(r => indexGroups(r.labels)), K = groups.length, blocks = makeBlocks(n, groups);
  let fit = K ? newton(X, y, groups, new Array(K).fill(1), blocks, true) : { gamma: [], e: evaluate(X, y, [], [], blocks, true), converged: true };
  if (K && !fit.converged) {
    const fn = (t) => { try { return evaluate(X, y, groups, t.map(v => v * v), blocks, true).f; } catch { return Infinity; } };
    const alt = newton(X, y, groups, nelderMead(fn, fit.gamma.map(Math.sqrt)).map(v => v * v), blocks, true);
    if (alt.e.f <= fit.e.f) fit = alt;
  }
  const { e, gamma } = fit, sigma2 = e.q / n;
  return { coef: e.beta, kept: keep, gamma, sigma2, varcomp: [...gamma.map(g => g * sigma2), sigma2], deviance: n * (1 + Math.log(2 * Math.PI * sigma2)) + e.ldH, k: p + K + 1, n, converged: fit.converged };
}

/**
 * REML fit. X: n × p model matrix (full rank after dropping aliased columns, which are reported),
 * y: responses, random: [{ name, labels: [group label per observation] }].
 * Returns { coef, vcov, varcomp, sigma2, gamma, REML, converged, boundary, columns kept, … , kr }.
 */
export function reml(X0, y, random, { columns, assign, terms, level = 0.95 } = {}) {
  const n = y.length;
  if (X0.length !== n) throw new Error(`${X0.length} rows for ${n} responses`);
  // estimable columns (as least squares would find them)
  const f0 = qr(X0), keep = [...Array(X0[0].length).keys()].filter(j => !f0.aliased.includes(j));
  const X = X0.map(r => keep.map(j => r[j]));
  const p = X[0].length;
  if (n - p < 1) throw new Error(`${n} observations for ${p} fixed-effect coefficients: no residual degrees of freedom`);
  const groups = random.map(r => indexGroups(r.labels));
  random.forEach((r, k) => { if (groups[k].m < 2) throw new Error(`random effect ${r.name} has only one group`); if (groups[k].m >= n) throw new Error(`random effect ${r.name} has a group per observation: it is the residual`); });
  const K = groups.length, blocks = makeBlocks(n, groups);
  let fit;
  if (K) {
    fit = newton(X, y, groups, new Array(K).fill(1), blocks);
    // fallback / check: Nelder–Mead on √γ from the Newton result, keep the better
    if (!fit.converged) {
      const fn = (t) => { try { return evaluate(X, y, groups, t.map(v => v * v), blocks).f; } catch { return Infinity; } };
      const x = nelderMead(fn, fit.gamma.map(Math.sqrt));
      const alt = newton(X, y, groups, x.map(v => v * v), blocks);
      if (alt.e.f <= fit.e.f) fit = alt;
    }
  } else fit = { gamma: [], e: evaluate(X, y, [], [], blocks), converged: true, iterations: 0 };
  const { e, gamma } = fit;
  const sigma2 = e.q / (n - p);
  const REML = (n - p) * (1 + Math.log(2 * Math.PI * sigma2)) + e.ldH + e.ldA;
  const Phi = scale(e.Ainv, sigma2);                         // (Xᵀ Σ⁻¹ X)⁻¹
  // ---------------------------------------------------------------- Kenward–Roger pieces
  // Σ = Σ_k σ_k² G_k + σ² I; derivatives with respect to (σ_1², …, σ_K², σ²).
  // Σ⁻¹ = H⁻¹/σ² (block diagonal); Z_iᵀΣ⁻¹Z_j by group sums of the blocks.
  const resid = { idx: [...Array(n).keys()], m: n };
  const G = [...groups, resid];
  const C = scale(e.HiX, 1 / sigma2);                         // Σ⁻¹ X
  const ZC = G.map(g => groupSumRows(C, g));                  // Z_iᵀ Σ⁻¹ X
  const Pm = ZC.map(M => mm(matT(M), M));                     // P_i = Xᵀ Σ⁻¹ G_i Σ⁻¹ X
  const R = G.length;
  const S = G.map((gi, i) => G.map((gj, j) => (j >= i ? scale(blockGroupSums(blocks, e.inv, gi, gj), 1 / sigma2) : null)));
  for (let i = 0; i < R; i++) for (let j = 0; j < i; j++) S[i][j] = matT(S[j][i]);
  const Q = G.map((_, i) => G.map((_, j) => mm(mm(matT(ZC[i]), S[i][j]), ZC[j])));
  const IE2 = Array.from({ length: R }, (_, i) => Array.from({ length: R }, (_, j) => frob2(S[i][j]) - 2 * tr(mm(Phi, Q[i][j])) + tr(mm(mm(Phi, Pm[i]), mm(Phi, Pm[j])))));
  const W = scale(symInv(IE2), 2);
  let U = Phi.map(r => r.map(() => 0));
  for (let i = 0; i < R; i++) for (let j = 0; j < R; j++) U = add(U, add(Q[i][j], mm(mm(Pm[i], Phi), Pm[j]), -1), W[i][j]);
  const PhiA = add(Phi, mm(mm(Phi, U), Phi), 2);
  // ---------------------------------------------------------------- variance components
  const z = level;
  const comp = (name, v, w) => {
    const df = v > 0 ? 2 * v * v / w : NaN;
    return { name, variance: v, sd: Math.sqrt(v), df, lower: df > 0 ? df * v / chi2.isf((1 - z) / 2, df) : 0, upper: df > 0 ? df * v / chi2.ppf((1 - z) / 2, df) : NaN, boundary: v === 0 };
  };
  const varcomp = [...random.map((r, k) => comp(r.name, gamma[k] * sigma2, W[k][k])), comp('Residual', sigma2, W[K][K])];
  // ---------------------------------------------------------------- strata
  const { order, nested } = nestOrder(groups);
  const cont = nested ? containment(X, groups, order) : null;
  const colTerm = assign ? keep.map(j => assign[j]) : keep.map(() => 0);
  const krTest = (Lrows) => kenwardRoger(Lrows, e.beta, Phi, PhiA, Pm, W);
  // coefficient table
  const coef = new Array(X0[0].length).fill(NaN), se = coef.slice(), seKR = coef.slice(), dfKR = coef.slice(), dfCont = coef.slice(), pKR = coef.slice();
  keep.forEach((j, a) => {
    coef[j] = e.beta[a]; se[j] = Math.sqrt(Phi[a][a]); seKR[j] = Math.sqrt(PhiA[a][a]);
    const L = [Array.from({ length: p }, (_, b) => (b === a ? 1 : 0))], t = krTest(L);
    dfKR[j] = t.ddf; pKR[j] = t.p;
    if (cont) dfCont[j] = cont.dfs[cont.stratumOf[a]];
  });
  // term tests
  const termTests = terms ? terms.map((t, ti) => {
    const cols = colTerm.map((c, a) => (c === ti ? a : -1)).filter(a => a >= 0);
    if (!cols.length || t.block === 'skip') return { term: t.label, df: 0 };
    const L = cols.map(a => Array.from({ length: p }, (_, b) => (b === a ? 1 : 0)));
    const kr = krTest(L);
    const stratum = cont ? Math.max(...cols.map(a => cont.stratumOf[a])) : null;
    const ddfC = cont ? cont.dfs[stratum] : NaN;
    return { term: t.label, df: cols.length, F: kr.Funscaled, ddfContainment: ddfC, pContainment: ddfC > 0 ? fDist.sf(kr.Funscaled, cols.length, ddfC) : NaN,
      FKR: kr.F, ddfKR: kr.ddf, pKR: kr.p, scaling: kr.scaling, stratum: cont ? (stratum < order.length ? random[order[stratum]].name : 'Residual') : null };
  }) : [];
  return {
    n, p, columns: columns ?? keep.map(j => `x${j}`), kept: keep, aliased: f0.aliased.map(j => (columns ? columns[j] : j)),
    coef, se, seKR, dfKR, dfContainment: dfCont, pKR, t: coef.map((b, j) => b / seKR[j]),
    beta: e.beta, vcov: Phi, vcovKR: PhiA, W, gamma, sigma2, varcomp, REML, converged: fit.converged, iterations: fit.iterations,
    boundary: random.filter((_, k) => gamma[k] === 0).map(r => r.name), nested, strata: cont ? [...order.map(k => random[k].name), 'Residual'].map((name, t) => ({ name, df: cont.dfs[t] })) : null,
    terms: termTests, Py: e.Py, _kr: { Phi, PhiA, Pm, W, beta: e.beta, keep },
  };
}

/**
 * Linear functions of a mixed model's fixed effects (adjusted means, contrasts; issue #82): for each
 * row l of L (over all the model's columns), the estimate lβ, its Kenward–Roger standard error
 * √(l Φ_A lᵀ) and Kenward–Roger df. A row with weight on an aliased column is not estimable (NaN).
 * With joint (default), also the joint F test of all rows (L of full rank): { rows: [{ est, se,
 * df }], F, df1, df2, p }.
 */
export function krLinear(m, L, { joint = true } = {}) {
  const { Phi, PhiA, Pm, W, beta, keep } = m._kr;
  const est = (l) => keep.reduce((a, j, i) => a + l[j] * beta[i], 0);
  const lost = (l) => l.some((v, j) => Math.abs(v) > 1e-12 && !keep.includes(j));
  const rows = L.map(l => {
    if (lost(l)) return { est: NaN, se: NaN, df: NaN };
    const x = keep.map(j => l[j]), k = kenwardRoger([x], beta, Phi, PhiA, Pm, W);
    const v = x.reduce((a, xi, i) => a + xi * PhiA[i].reduce((b, w, j) => b + w * x[j], 0), 0);
    return { est: est(l), se: Math.sqrt(v), df: k.ddf };
  });
  const ok = L.filter(l => !lost(l));
  const J = joint && ok.length ? kenwardRoger(ok.map(l => keep.map(j => l[j])), beta, Phi, PhiA, Pm, W) : null;
  return { rows, ...(J ? { F: J.F, df1: J.q, df2: J.ddf, p: J.p } : {}) };
}

/** Kenward–Roger F test of Lβ = 0 (rows of L over the kept columns). */
function kenwardRoger(L, beta, Phi, PhiA, Pm, W) {
  const q = L.length, R = Pm.length;
  const Lt = matT(L);
  const LPL = mm(mm(L, Phi), Lt), LPLA = mm(mm(L, PhiA), Lt);
  const Lb = L.map(r => r.reduce((s, v, a) => s + v * beta[a], 0));
  const quad = (M) => { const x = solveSmall(M, Lb); return Lb.reduce((s, v, i) => s + v * x[i], 0); };
  const Funscaled = quad(LPLA) / q;
  const Theta = mm(mm(Lt, symInv(LPL)), L);                  // Lᵀ (L Φ Lᵀ)⁻¹ L
  const TPhi = mm(Theta, Phi);
  const M = Pm.map(P => mm(mm(TPhi, P), Phi));                // Θ Φ P_i Φ
  let A1 = 0, A2 = 0;
  for (let i = 0; i < R; i++) for (let j = 0; j < R; j++) { A1 += W[i][j] * tr(M[i]) * tr(M[j]); A2 += W[i][j] * tr(mm(M[i], M[j])); }
  const B = (A1 + 6 * A2) / (2 * q);
  const g = ((q + 1) * A1 - (q + 4) * A2) / ((q + 2) * A2);
  const den = 3 * q + 2 * (1 - g);
  const c1 = g / den, c2 = (q - g) / den, c3 = (q + 2 - g) / den;
  const Estar = 1 / (1 - A2 / q);
  const Vstar = (2 / q) * (1 + c1 * B) / ((1 - c2 * B) ** 2 * (1 - c3 * B));
  const rho = Vstar / (2 * Estar * Estar);
  const ddf = 4 + (q + 2) / (q * rho - 1);
  const scaling = ddf / (Estar * (ddf - 2));
  const F = scaling * Funscaled;
  return { q, ddf, scaling, F, Funscaled, p: fDist.sf(F, q, ddf) };
}

// ---------------------------------------------------------------- studies

/**
 * One row per (non-missing) observation of a response, with the run's settings and the labels
 * that define the random effects: { run, wholePlot, block, kind, order, settings, y, wafer, lot }.
 * Confirmation runs are left out (as fitModel does).
 */
export function observationTable(study, response) {
  if (!study.responses.some(r => r.id === response)) throw new Error(`no response "${response}" in the study`);
  const runs = new Map((study.design?.runs ?? []).map(r => [r.run, r]));
  return observationsOf(study, response).filter(o => o.value !== null && runs.get(o.run)?.kind !== 'confirm').map(o => {
    const r = runs.get(o.run);
    return { run: o.run, order: r.order, kind: r.kind, settings: r.settings, y: o.value, obs: o,
      ...(o.wafer !== undefined && o.site !== undefined ? { site: `${o.run}|${o.wafer}|${o.site}` } : {}),
      ...(r.wholePlot !== undefined ? { wholePlot: String(r.wholePlot) } : {}), ...(r.block !== undefined ? { block: r.block } : {}), ...(r.blocks ? { blocks: r.blocks } : {}),
      ...(o.wafer !== undefined ? { wafer: `${o.run}|${o.wafer}` } : {}), ...(o.lot !== undefined ? { lot: String(o.lot) } : {}) };
  });
}

// a random effect by id: a built-in one, or a named blocking variable of the design (issue #80)
const randomOf = (id, blocking = []) => RANDOM[id] ?? (() => { const b = blocking.find(x => x.id === id); return b && { name: b.name ?? b.id, label: (r) => (r.blocks?.[id] === undefined ? undefined : String(r.blocks[id])) }; })();

const RANDOM = {
  wholePlot: { name: 'Whole plot', label: (r) => r.wholePlot },
  run: { name: 'Run', label: (r) => String(r.run) },
  wafer: { name: 'Wafer', label: (r) => r.wafer },
  site: { name: 'Site', label: (r) => r.site },
  lot: { name: 'Lot', label: (r) => r.lot },
  // blocks as a random effect (issue #80): an incomplete-block design recovers the treatment
  // information between blocks; asked for explicitly (random: ['block']), never 'auto'
  block: { name: 'Block', label: (r) => (r.block === undefined ? undefined : String(r.block)) },
};

/**
 * Random effects for a response's observations. 'auto': whole plots when the design has them
 * (and they hold more than one run), runs when runs have more than one observation, wafers when
 * runs have more than one wafer and wafers more than one observation (sites, repeats). A
 * component that would duplicate another (same grouping) or the residual is left out. Or a list
 * of 'wholePlot' | 'run' | 'wafer' | 'lot' (lot must be nested in the others to be a nested model).
 * Returns [{ id, name, labels }].
 */
export function randomEffects(rows, requested = 'auto', blocking = []) {
  const n = rows.length;
  const nGroups = (f) => new Set(rows.map(f)).size;
  const ids = requested === 'auto' ? ['wholePlot', 'run', 'wafer', 'site'].filter(id => rows.every(r => RANDOM[id].label(r) !== undefined)) : requested;
  for (const id of ids) {
    if (!randomOf(id, blocking)) throw new Error(`unknown random effect "${id}" (use wholePlot, run, wafer, site, lot, block${blocking.length ? `, ${blocking.map(b => b.id).join(', ')}` : ''})`);
    if (rows.some(r => randomOf(id, blocking).label(r) === undefined)) throw new Error(`random effect ${id}: some observations have no ${id}`);
  }
  const out = [], seen = [];
  const key = (f) => { const m = new Map(); return rows.map(r => { const k = f(r); if (!m.has(k)) m.set(k, m.size); return m.get(k); }).join(); };
  for (const id of ids) {
    const R = randomOf(id, blocking), f = R.label, m = nGroups(f);
    if (m < 2 || m >= n) { if (requested !== 'auto') throw new Error(`random effect ${id}: ${m < 2 ? 'only one group' : 'one observation per group (that is the residual)'}`); continue; }
    const k = key(f);
    if (seen.includes(k)) { if (requested !== 'auto') throw new Error(`random effect ${id} groups the observations exactly as an earlier one`); continue; }
    seen.push(k);
    out.push({ id, name: R.name, labels: rows.map(f) });
  }
  return out;
}

/**
 * Mixed-model (REML) fit of a formula to a study's observations. opts: random ('auto' or a list,
 * see randomEffects), blocks (fixed Block term when several blocks, as fitModel), level (0.95).
 * Returns the reml() result plus { kind: 'mixed', response, model, factors, rows, random, naive },
 * naive being least squares on the same observations as if they were all independent.
 */
// the pieces of a mixed model for a formula: rows, position terms, block term, random effects, X, y
function buildMixed(study, formula, opts) {
  const response = opts.response ?? (String(formula).includes('~') ? String(formula).slice(0, String(formula).indexOf('~')).trim() : null);
  if (!response) throw new Error('name the response: "y ~ …"');
  const noise = noiseModelOf(study, response);
  if (!noise.capabilities.mixed) throw new Error(`mixed models (REML) assume normal noise; ${response} is ${noise.label}`);
  const rows00 = observationTable(study, response);
  if (!rows00.length) throw new Error(`no results for ${response} yet`);
  // position terms (radius2, edge, slot …) become factors when the formula uses them
  const pos0 = withPositionTerms(study, formula, rows00);
  // covariates in the formula (issue #82): each reading takes its wafer's own value when there is one
  const cov = withCovariates(study, formula, pos0.rows, pos0.factors);
  const pos = { ...pos0, factors: cov.factors, rows: cov.rows };
  const parsed = parseFormula(formula, pos.factors);
  // random blocks replace the fixed block term
  const b = withBlockTerm({ ...study, factors: pos.factors }, parsed, pos.rows, opts);
  const random = randomEffects(b.rows, opts.random ?? 'auto', study.design?.blocking ?? []);
  const mmx = modelMatrix(b.model, b.factors, b.rows.map(r => r.settings));
  return { response, pos, b, random, mmx, y: b.rows.map(r => r.y), cov };
}

/** Maximum-likelihood fit of a formula to a study (for AICc comparisons): mlFit's result plus the model. */
export function fitMixedML(study, formula, opts = {}) {
  const { response, b, random, mmx, y } = buildMixed(study, formula, opts);
  return { ...mlFit(mmx.X, y, random.map(r => ({ name: r.name, labels: r.labels }))), response, model: b.model, random };
}

export function fitMixedModel(study, formula, opts = {}) {
  const { response, pos, b, random, mmx, y, cov } = buildMixed(study, formula, opts);
  const fit = reml(mmx.X, y, random.map(r => ({ name: r.name, labels: r.labels })), { columns: mmx.columns, assign: mmx.assign, terms: b.model.terms, level: opts.level ?? 0.95 });
  const naive = fitOLS(mmx, y);
  const naiveAnova = naive.dfRes > 0 ? anova(naive, 3) : [];
  fit.terms.forEach(t => { const a = naiveAnova.find(x => x.term === t.term); if (a) { t.naiveF = a.F; t.naiveDf = naive.dfRes; t.naiveP = a.p; } });
  // marginal fitted values Xβ̂ and residuals y − Xβ̂ (random effects not removed)
  const fitted = mmx.X.map(r => r.reduce((acc, v, j) => acc + (Number.isFinite(fit.coef[j]) ? v * fit.coef[j] : 0), 0));
  return { kind: 'mixed', ...fit, response, model: b.model, factors: b.factors, rows: b.rows, random, naive, ...(b.carryoverDropped ? { carryoverDropped: true } : {}), positionTerms: pos.used, fitted, residuals: y.map((v, i) => v - fitted[i]),
    ...(cov.used.length ? { covariates: cov.used, dropped: cov.dropped } : {}) };
}

// ---------------------------------------------------------------- predictions

/**
 * Predictions from a mixed-model fit (fitMixedModel) at settings (natural units).
 *   fit, se:   x β̂ and its Kenward–Roger standard error √(xᵀ Φ_A x); CI with the KR df for x.
 *   predSe:    for a new observation of the kind described by `weights`: √(se² + Σ c_k σ_k²), where
 *              c_k is the weight of component k ('wholePlot', 'run', 'wafer', 'site', 'lot', and
 *              'residual'); default 1 for every component (one new reading from a new furnace run,
 *              run, wafer …). For the mean of several readings, pass the fractions, e.g. a run of 2
 *              wafers × 9 sites: { wafer: 1/2, residual: 1/18 }. PI df by Satterthwaite:
 *              2V² / (gᵀ W g), g_k = xᵀΦ P_k Φx + c_k (W: asymptotic covariance of the components).
 * Position terms not given in the settings are averaged over the positions in the data (a run mean).
 * Returns [{ fit, se, df, lower, upper, predSe, predDf, predLower, predUpper }].
 */
export function predictMixed(m, settings, { level = 0.95, weights = {} } = {}) {
  const { Phi, PhiA, Pm, W, beta, keep } = m._kr;
  const pos = m.positionTerms ?? [];
  const posRows = pos.length ? [...new Map(m.rows.map(r => { const v = Object.fromEntries(pos.map(id => [id, r.settings[id]])); return [JSON.stringify(v), v]; })).values()] : [{}];
  const xOf = (st) => {
    const missing = pos.filter(id => st[id] === undefined);
    const rows = missing.length ? posRows.map(v => ({ ...st, ...Object.fromEntries(missing.map(id => [id, v[id]])) })) : [st];
    const X = modelMatrix(m.model, m.factors, rows).X;
    return keep.map(j => X.reduce((a, r) => a + r[j], 0) / X.length);
  };
  const c = [...m.random.map(r => weights[r.id] ?? 1), weights.residual ?? 1];
  const comps = m.varcomp.map(v => v.variance);
  return settings.map(st => {
    const x = xOf(st);
    const fit = x.reduce((a, v, i) => a + v * beta[i], 0);
    const quad = (M) => x.reduce((a, v, i) => a + v * M[i].reduce((b, w, j) => b + w * x[j], 0), 0);
    const se2 = quad(PhiA), kr = kenwardRoger([x], beta, Phi, PhiA, Pm, W);
    const t = studentT.ppf(1 - (1 - level) / 2, kr.ddf);
    const V = se2 + c.reduce((a, ck, k) => a + ck * comps[k], 0);
    const PhiX = Phi.map(r => r.reduce((a, w, j) => a + w * x[j], 0));               // Φ x
    const g = Pm.map((P, k) => PhiX.reduce((a, v, i) => a + v * P[i].reduce((b, w, j) => b + w * PhiX[j], 0), 0) + c[k]);
    const gWg = g.reduce((a, gi, i) => a + gi * g.reduce((b, gj, j) => b + W[i][j] * gj, 0), 0);
    const predDf = 2 * V * V / gWg, tp = studentT.ppf(1 - (1 - level) / 2, predDf);
    return { fit, se: Math.sqrt(se2), df: kr.ddf, lower: fit - t * Math.sqrt(se2), upper: fit + t * Math.sqrt(se2),
      predSe: Math.sqrt(V), predDf, predLower: fit - tp * Math.sqrt(V), predUpper: fit + tp * Math.sqrt(V) };
  });
}

/**
 * Readings per run in the data, per random level: the weights that turn a single-reading
 * prediction variance into one for the mean of a run measured like the others (and of `runs` such
 * runs; inOneWholePlot: they share one new whole plot, e.g. one furnace load).
 */
export function runMeanWeights(m, { runs = 1, inOneWholePlot = true } = {}) {
  const byRun = new Map();
  m.rows.forEach((r, i) => { if (!byRun.has(r.run)) byRun.set(r.run, []); byRun.get(r.run).push(i); });
  const avg = (f) => [...byRun.values()].reduce((a, idx) => a + f(idx), 0) / byRun.size;
  const w = {};
  for (const re of m.random) {
    // distinct groups of this component within a run (1 for whole plot and run)
    const per = avg(idx => new Set(idx.map(i => re.labels[i])).size);
    w[re.id] = (re.id === 'wholePlot' && inOneWholePlot ? 1 : 1 / runs) / per;
  }
  w.residual = 1 / (runs * avg(idx => idx.length));
  return w;
}

export { containment as _containment, nestOrder as _nestOrder, indexGroups as _indexGroups };
