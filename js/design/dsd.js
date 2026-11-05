// Definitive screening designs (spec §5, issue #10; Jones & Nachtsheim 2011, Xiao, Lin & Bai 2012).
//
// A DSD for k three-level factors is the fold-over of a conference matrix C of order m ≥ k,
// plus centre runs: rows C, −C, 0 (first k columns). Main effects are orthogonal to each other
// and to all two-factor interactions and quadratic terms; no two second-order terms are
// completely aliased. 2m + 1 runs.
//
//   conferenceMatrix(m)       C with Cᵀ C = (m − 1) I, zero diagonal, ±1 elsewhere
//   definitiveScreening(k, o) the design, in the form of factorial.js (coded X, runKind)
//
// Conference matrices: Paley's construction over GF(q) for q = m − 1 a prime power (symmetric
// for q ≡ 1 mod 4, skew for q ≡ 3 mod 4), and the doubling [[C, C+I], [C−I, −C]] of a skew
// matrix for m = 16. Order 22 does not exist (21 is not a sum of two squares), so k = 21, 22
// use order 24.

// ---------------------------------------------------------------- finite fields GF(p^n)

// irreducible polynomials (coefficients, constant term first, monic) for the non-prime fields used
const IRRED = { 9: [3, [1, 0, 1]], 25: [5, [2, 0, 1]], 27: [3, [1, 2, 0, 1]] };

function field(q) {
  const isPrime = (n) => { for (let d = 2; d * d <= n; d++) if (n % d === 0) return false; return n > 1; };
  if (isPrime(q)) return { q, add: (a, b) => (a + b) % q, sub: (a, b) => (a - b + q) % q, mul: (a, b) => a * b % q };
  const [p, poly] = IRRED[q] ?? (() => { throw new Error(`GF(${q}) not available`); })();
  const n = poly.length - 1;
  const digits = (a) => { const d = []; for (let i = 0; i < n; i++) { d.push(a % p); a = Math.floor(a / p); } return d; };
  const num = (d) => d.reduceRight((acc, v) => acc * p + v, 0);
  const add = (a, b) => num(digits(a).map((v, i) => (v + digits(b)[i]) % p));
  const sub = (a, b) => num(digits(a).map((v, i) => (v - digits(b)[i] + p) % p));
  const mul = (a, b) => {
    const x = digits(a), y = digits(b), r = new Array(2 * n - 1).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) r[i + j] = (r[i + j] + x[i] * y[j]) % p;
    for (let d = r.length - 1; d >= n; d--) {             // reduce modulo the monic polynomial
      const c = r[d]; if (!c) continue;
      for (let i = 0; i <= n; i++) r[d - n + i] = ((r[d - n + i] - c * poly[i]) % p + p) % p;
    }
    return num(r.slice(0, n));
  };
  return { q, add, sub, mul };
}

/** Quadratic character χ on GF(q): 0 for 0, 1 for nonzero squares, −1 otherwise. */
function character(F) {
  const sq = new Set();
  for (let a = 1; a < F.q; a++) sq.add(F.mul(a, a));
  return (a) => (a === 0 ? 0 : sq.has(a) ? 1 : -1);
}

function paley(q) {
  const F = field(q), chi = character(F), n = q + 1, skew = q % 4 === 3;
  const C = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let j = 1; j < n; j++) { C[0][j] = 1; C[j][0] = skew ? -1 : 1; }
  for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) C[i][j] = chi(F.sub(j - 1, i - 1));
  return C;
}

const ORDERS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 26, 28, 30, 32];

/** Conference matrix of order m (even, 2 … 32, not 22). */
export function conferenceMatrix(m) {
  if (m === 2) return [[0, 1], [1, 0]];
  if (m === 16) {
    const C = paley(7), I = C.map((r, i) => r.map((_, j) => (i === j ? 1 : 0)));
    const top = C.map((r, i) => [...r, ...r.map((v, j) => v + I[i][j])]);
    const bot = C.map((r, i) => [...r.map((v, j) => v - I[i][j]), ...r.map(v => -v)]);
    return [...top, ...bot];
  }
  if (!ORDERS.includes(m)) throw new Error(`no conference matrix of order ${m} here (available: ${ORDERS.join(', ')})`);
  return paley(m - 1);
}

/** Smallest available conference-matrix order for k columns. */
export const dsdOrder = (k) => ORDERS.find(m => m >= k && m >= 4) ?? null;

/**
 * Definitive screening design for k factors. opts:
 *   fake: extra columns in the conference matrix that are then dropped (Jones & Nachtsheim
 *         2013 recommend 2 for better estimation of second-order effects; default 0)
 *   centre: number of centre runs (default 1)
 *   categorical: indices of two-level categorical factors (the DSD-augment idea of Jones &
 *         Nachtsheim 2013): their 0 entries in C and −C become +1 and −1, keeping the fold-over,
 *         and there are two centre runs, one at each level. Every main effect stays orthogonal
 *         to every second-order term (so main effects are unbiased by active interactions and
 *         curvature); a categorical main effect is correlated 1/(m−1) with each continuous one.
 */
export function definitiveScreening(k, { fake = 0, centre = 1, categorical = [] } = {}) {
  if (!Number.isInteger(k) || k < 3) throw new Error('a definitive screening design needs at least 3 factors');
  const m = dsdOrder(k + fake);
  if (!m) throw new Error(`definitive screening designs here go up to ${ORDERS[ORDERS.length - 1]} columns (k + fake)`);
  const C = conferenceMatrix(m).map(r => r.slice(0, k));
  const cat = new Set(categorical);
  const X = [], runKind = [];
  C.forEach(r => { X.push(r.map((v, j) => (v === 0 && cat.has(j) ? 1 : v))); runKind.push('optimal'); });
  C.forEach(r => { X.push(r.map((v, j) => (v === 0 && cat.has(j) ? -1 : -v))); runKind.push('optimal'); });
  const nc = cat.size && centre < 2 ? 2 : centre;
  for (let i = 0; i < nc; i++) { X.push([...Array(k).keys()].map(j => (cat.has(j) ? (i % 2 ? -1 : 1) : 0))); runKind.push('centre'); }
  return { kind: 'definitive-screening', params: { order: m, fake: m - k, centrePoints: nc, ...(cat.size ? { categorical: [...cat] } : {}) },
    levels: [...Array(k).keys()].map(j => (cat.has(j) ? 2 : 3)), coded: true, X, runKind };
}
