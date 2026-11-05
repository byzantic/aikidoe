// Linear algebra (issue #2) against R's qr() and numpy/scipy (fixtures linalg-qr, linalg-np),
// plus identities that hold for any input.
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import * as la from '../js/linalg.js';

const TOL = { rel: 1e-10, abs: 1e-12 };
const nullToNaN = (x) => Array.isArray(x) ? x.map(nullToNaN) : (x === null ? NaN : x);
const maxAbs = (A) => Math.max(0, ...A.flat().map(Math.abs));
const sub = (A, B) => A.map((r, i) => r.map((v, j) => v - B[i][j]));
const relErr = (A, B) => maxAbs(sub(A, B)) / Math.max(maxAbs(B), 1e-300);
const permuteCols = (A, p) => A.map(r => p.map(j => r[j]));
const ill = (name) => name.includes('Hilbert');

// ------------------------------------------------------------ QR vs R
section('qr (limited pivoting) vs R qr()');
for (const c of loadFixture('linalg-qr').cases) {
  const { A, y } = c.input, o = c.output;
  const f = la.qr(A);
  check(`${c.name}: rank ${o.rank}`, f.rank === o.rank, `got ${f.rank}`);
  check(`${c.name}: pivot order`, JSON.stringify(f.perm) === JSON.stringify(o.perm), `got ${JSON.stringify(f.perm)}`);
  // backward error: A P = Q R to working precision, Q orthonormal
  const Q = f.Q(), R = f.R();
  check(`${c.name}: ‖AP − QR‖ / ‖A‖ < 1e-14`, relErr(la.matmul(Q, R), permuteCols(A, f.perm)) < 1e-14,
    relErr(la.matmul(Q, R), permuteCols(A, f.perm)).toExponential(2));
  check(`${c.name}: QᵀQ = I`, maxAbs(sub(la.crossprod(Q), la.eye(Q[0].length))) < 1e-14);
  if (ill(c.name)) continue;
  near(`${c.name}: R`, R, o.R, TOL);
  near(`${c.name}: coefficients (NaN when aliased)`, f.coef(y), nullToNaN(o.coef), TOL);
  near(`${c.name}: fitted`, f.fitted(y), o.fitted, TOL);
  near(`${c.name}: (XᵀX)⁻¹`, f.unscaledCov(), nullToNaN(o.covUnscaled), TOL);
}
{
  const f = la.qr(loadFixture('linalg-qr').cases.find(c => c.name.includes('CD aliased')).input.A);
  check('2^(4-1): the CD column (index 6) is the one reported aliased', JSON.stringify(f.aliased) === '[6]');
}

// ------------------------------------------------------------ numpy / scipy
const np = loadFixture('linalg-np').cases;

section('Cholesky vs numpy');
for (const c of np.filter(c => c.input.op === 'chol')) {
  const { A, b } = c.input, o = c.output;
  const { L, added } = la.chol(A);
  check(`${c.name}: no jitter needed`, added === 0);
  if (!ill(c.name)) near(`${c.name}: log det`, la.cholLogdet(L), o.logdet, TOL);
  if (o.L) near(`${c.name}: L`, L, o.L, TOL);
  if (o.x) near(`${c.name}: solve`, la.cholSolve(L, b), o.x, TOL);
}
{
  // Exact log det of Hilbert matrices: det H_n = c_n⁴ / c_2n, c_n = ∏_{i<n} i! (computed with
  // exact rationals). Achievable accuracy is ~cond(H)·ε: 3e-6 for n = 8, 4e-3 for n = 10.
  const hilbert = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => 1 / (i + j + 1)));
  near('chol Hilbert 8: log det vs exact', la.cholLogdet(la.chol(hilbert(8)).L), -74.97842732916048, { abs: 1e-7 });
  near('chol Hilbert 10: log det vs exact', la.cholLogdet(la.chol(hilbert(10)).L), -121.2649687493037, { abs: 1e-3 }); // numpy's Cholesky: 1.6e-4 off
}
throws('chol rejects an indefinite matrix', () => la.chol([[1, 2], [2, 1]]), /not positive definite/);
{
  const A = [[1, 1], [1, 1]];                                 // PSD, singular
  const { L, added } = la.chol(A, { jitter: 1e-10 });
  check('chol with jitter succeeds on a singular PSD matrix', added > 0 && added < 1e-6 && L[1][1] > 0, `added ${added}`);
}

section('LU vs numpy');
for (const c of np.filter(c => c.input.op === 'lu')) {
  const { A, b } = c.input, o = c.output;
  const d = la.slogdet(A);
  check(`${c.name}: det sign`, d.sign === o.sign, `got ${d.sign}`);
  if (o.singular) { check(`${c.name}: reported singular`, la.lu(A).singular); continue; }
  near(`${c.name}: log |det|`, d.logabsdet, o.logabsdet, TOL);
  near(`${c.name}: solve`, la.solve(A, b), o.x, TOL);
  near(`${c.name}: inverse`, la.inv(A), o.inv, TOL);
}

section('symmetric eigen vs numpy');
for (const c of np.filter(c => c.input.op === 'eig')) {
  const { A, vectorsUnique } = c.input, o = c.output;
  const { values, vectors } = la.eigSym(A);
  // eigenvalues are only determined to ~eps·‖A‖ absolutely
  near(`${c.name}: values`, values, o.values, { rel: 1e-10, abs: 1e-14 * maxAbs(A) * A.length });
  const VtV = la.crossprod(vectors);
  check(`${c.name}: VᵀV = I`, maxAbs(sub(VtV, la.eye(A.length))) < 1e-13);
  const recon = la.matmul(la.matmul(vectors, values.map((v, i) => values.map((_, j) => (i === j ? v : 0)))), la.transpose(vectors));
  check(`${c.name}: V Λ Vᵀ = A`, relErr(recon, A) < 1e-13, relErr(recon, A).toExponential(2));
  if (vectorsUnique && !ill(c.name)) near(`${c.name}: vectors`, vectors, o.vectors, TOL);
}

section('SVD, rank, pinv, cond vs numpy');
for (const c of np.filter(c => c.input.op === 'svd')) {
  const { A } = c.input, o = c.output;
  const { U, s, V } = la.svd(A);
  near(`${c.name}: singular values`, s, o.s, { rel: 1e-10, abs: 1e-14 * o.s[0] * Math.max(...la.shape(A)) });
  const recon = la.matmul(U.map(r => r.map((v, j) => v * s[j])), la.transpose(V));
  check(`${c.name}: U S Vᵀ = A`, relErr(recon, A) < 1e-13, relErr(recon, A).toExponential(2));
  check(`${c.name}: rank ${o.rank}`, la.matrixRank(A) === o.rank, `got ${la.matrixRank(A)}`);
  if (o.pinv) {
    // pinv is only determined to ~cond·ε (cond is s_max/s_min over the retained values)
    const P = la.pinv(A), sr = o.s.slice(0, o.rank), k = sr[0] / sr[sr.length - 1];
    near(`${c.name}: pinv`, P, o.pinv, { rel: 0, abs: Math.max(1e-12, 100 * k * 2.2e-16) * maxAbs(o.pinv) });
    const APA = la.matmul(la.matmul(A, P), A), PAP = la.matmul(la.matmul(P, A), P);
    check(`${c.name}: Penrose A P A = A, P A P = P`, relErr(APA, A) < 1e-12 && relErr(PAP, P) < 1e-12 * Math.max(1, k * 1e-4),
      `${relErr(APA, A).toExponential(2)}, ${relErr(PAP, P).toExponential(2)}`);
  }
  if (o.cond) near(`${c.name}: cond`, la.cond(A), o.cond, { rel: 1e-9 });
}

section('QR (full pivoting) vs scipy dgeqp3');
for (const c of np.filter(c => c.input.op === 'qrfull')) {
  const { A } = c.input, o = c.output;
  const f = la.qr(A, { pivot: 'full' });
  check(`${c.name}: pivot order`, JSON.stringify(f.perm.slice(0, f.rank)) === JSON.stringify(o.perm.slice(0, f.rank)), `got ${JSON.stringify(f.perm)}, want ${JSON.stringify(o.perm)}`);
  near(`${c.name}: |diag R| (leading rank)`, f.R().map((r, i) => Math.abs(r[i])).slice(0, f.rank), o.absDiagR.slice(0, f.rank), TOL);
  if (o.R) near(`${c.name}: R`, f.R(), o.R, TOL);
  check(`${c.name}: rank = numpy rank`, f.rank === la.matrixRank(A));
}

// ------------------------------------------------------------ identities and edge cases
section('triangular solves and helpers');
{
  const L = [[2, 0, 0], [1, 3, 0], [-1, 0.5, 4]], b = [1, 2, 3];
  const x = la.solveLower(L, b);
  near('L x = b', la.matvec(L, x), b, TOL);
  const xt = la.solveLower(L, b, { trans: true });
  near('Lᵀ x = b', la.matvec(la.transpose(L), xt), b, TOL);
  const U = la.transpose(L);
  near('U x = b', la.matvec(U, la.solveUpper(U, b)), b, TOL);
  near('Uᵀ x = b', la.matvec(L, la.solveUpper(U, b, { trans: true })), b, TOL);
  const B = [[1, 0], [0, 1], [2, -1]];
  near('matrix right-hand side', la.matmul(L, la.solveLower(L, B)), B, TOL);
  near('unit lower', la.solveLower([[5, 0], [2, 7]], [1, 3], { unit: true }), [1, 1], TOL);
}
near('norm2 avoids overflow', la.norm2([3e200, 4e200]), 5e200, TOL);
near('norm2 avoids underflow', la.norm2([3e-200, 4e-200]), 5e-200, TOL);
near('crossprod = AᵀA', la.crossprod([[1, 2], [3, 4], [5, 6]]), [[35, 44], [44, 56]], TOL);

section('qr edge cases');
{
  const f = la.qr([[0, 0], [0, 0]]);
  check('all-zero matrix: rank 0, all aliased', f.rank === 0 && f.aliased.length === 2 && f.coef([1, 2]).every(Number.isNaN));
  const g = la.qr([[1], [2], [2]]);
  near('single column least squares', g.coef([1, 2, 3]), [(1 + 4 + 6) / 9], TOL);
  near('single column residuals ⟂ column', [la.dot(g.residuals([1, 2, 3]), [1, 2, 2])], [0], { abs: 1e-14 });
  const h = la.qr([[1, 2, 3]]);
  check('one row, three columns: rank 1', h.rank === 1);
  const X = [[1, -1], [1, 1], [1, -1], [1, 1]], Y = [[1, 2], [3, 4], [5, 6], [7, 8]];
  near('matrix right-hand side in coef', la.qr(X).coef(Y), [[4, 5], [1, 1]], TOL);
  near('logAbsDetR = ½ log det XᵀX', la.qr(X).logAbsDetR(), 0.5 * Math.log(16), TOL);
}
done();
