// Sampling for computer experiments (spec §10, issue #20): maximin Latin hypercubes, and
// distributions for factor tolerances (normal, uniform, truncated normal).
import { rng } from '../design/rng.js';
import { normal } from '../dist.js';

/**
 * Maximin Latin hypercube in coded units [−1, 1]^k: n points, one per row of n equal strata in
 * every column. Starting from random LHSs, column swaps that increase the smallest pairwise
 * distance (then the number of pairs at it) are accepted (Morris & Mitchell's criterion,
 * greedy). centred: points at stratum centres (else uniform within the stratum).
 * Returns { X, minDist }.
 */
export function maximinLHS(n, k, { seed = 1, starts = 5, iterations = 2000, centred = true } = {}) {
  if (!(n >= 2) || !(k >= 1)) throw new Error('a Latin hypercube needs n ≥ 2 points and k ≥ 1 factors');
  const g = rng(seed);
  // squared distances kept in a matrix; a swap in one column changes only two of its rows
  const dist = (P) => { const D = Array.from({ length: n }, () => new Float64Array(n)); for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { let d = 0; for (let c = 0; c < k; c++) d += (P[i][c] - P[j][c]) ** 2; D[i][j] = D[j][i] = d; } return D; };
  const crit = (D) => {
    let mn = Infinity, cnt = 0;
    for (let i = 0; i < n; i++) { const r = D[i]; for (let j = i + 1; j < n; j++) { const d = r[j]; if (d < mn - 1e-9) { mn = d; cnt = 1; } else if (d <= mn + 1e-9) cnt++; } }
    return { mn, cnt };
  };
  const better = (a, b) => a.mn > b.mn + 1e-9 || (Math.abs(a.mn - b.mn) <= 1e-9 && a.cnt < b.cnt);
  const swap = (P, D, col, a, b) => {
    [P[a][col], P[b][col]] = [P[b][col], P[a][col]];
    for (const r of [a, b]) for (let j = 0; j < n; j++) if (j !== r) { let d = 0; for (let c = 0; c < k; c++) d += (P[r][c] - P[j][c]) ** 2; D[r][j] = D[j][r] = d; }
  };
  let best = null;
  for (let s = 0; s < starts; s++) {
    const perm = Array.from({ length: k }, () => g.shuffle([...Array(n).keys()]));
    const P = Array.from({ length: n }, (_, i) => perm.map(p => p[i]));          // stratum indices
    const D = dist(P);
    let c = crit(D);
    for (let it = 0; it < iterations; it++) {
      const col = g.int(k), a = g.int(n); let b = g.int(n - 1); if (b >= a) b++;
      swap(P, D, col, a, b);
      const cq = crit(D);
      if (better(cq, c) || (Math.abs(cq.mn - c.mn) <= 1e-9 && cq.cnt === c.cnt)) c = cq;
      else swap(P, D, col, a, b);                                                 // undo
    }
    if (!best || better(c, best.c)) best = { P: P.map(r => r.slice()), c };
  }
  const X = best.P.map(r => r.map(s => -1 + 2 * (s + (centred ? 0.5 : g.random())) / n));
  return { X, minDist: Math.sqrt(crit(dist(X)).mn) };
}

/**
 * A sampler for a factor's actual value about a nominal setting. tol: a number (standard
 * deviation, normal) or { sd, dist: 'normal' | 'uniform' | 'truncated', at } (uniform with that
 * standard deviation, i.e. ±√3·sd; truncated normal cut at ±at·sd, default 2).
 * Returns (u01 generator) → deviation.
 */
export function deviationSampler(tol) {
  const t = typeof tol === 'number' ? { sd: tol, dist: 'normal' } : tol;
  const sd = t.sd;
  if (!(sd >= 0)) throw new Error('a tolerance needs a standard deviation ≥ 0');
  switch (t.dist ?? 'normal') {
    case 'normal': return (u) => sd * normal.ppf(u());
    case 'uniform': return (u) => sd * Math.sqrt(3) * (2 * u() - 1);
    case 'truncated': {
      const a = t.at ?? 2, pa = normal.cdf(-a);
      return (u) => sd * normal.ppf(pa + (1 - 2 * pa) * u());
    }
    default: throw new Error(`unknown tolerance distribution "${t.dist}" (normal, uniform, truncated)`);
  }
}
/** Standard deviation actually implied by a tolerance spec (the truncated normal is narrower than sd). */
export function toleranceSd(tol) {
  const t = typeof tol === 'number' ? { sd: tol, dist: 'normal' } : tol;
  if ((t.dist ?? 'normal') !== 'truncated') return t.sd;
  const a = t.at ?? 2, z = 2 * normal.cdf(a) - 1;
  return t.sd * Math.sqrt(1 - 2 * a * normal.pdf(a) / z);
}
