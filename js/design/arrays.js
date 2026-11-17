// Orthogonal arrays for factors with two, three, four or more levels (issue #85, phase 2).
//
// An orthogonal array OA(N, s1 s2 …) of strength 2 has N runs, and in any two of its columns every
// combination of levels appears equally often: main effects are estimated independently of each
// other. Choosing which columns to give the factors matters when there are spare columns: it
// decides how main effects are tangled with interactions, measured by the generalised word-length
// pattern (A3, A4, …; Xu & Wu 2001). The columns are chosen to minimise A3, then A4 (generalised
// minimum aberration, as DoE.base's "min34").
//
// The arrays are built here, not copied (Hedayat, Sloane & Stufken 1999; Wu & Hamada 2009, ch. 7–8):
//   regular arrays s^m over GF(s), s = 2, 3, 4, 5: every non-zero linear combination of m base
//     columns (first non-zero coefficient 1): (s^m − 1)/(s − 1) columns
//   from a difference matrix D(r, r, s): the rows (i, a), entries D[i][j] + a, give OA(r·s, r¹ s^r);
//     the r-level column is then replaced by a smaller array with r runs (expansive replacement)
//   expansive replacement of a 4-level column by three 2-level columns (a 4-level column is the
//     sum of two 2-level ones over GF(4)), or of an 8- or 12-level column by a small factorial
//
//   ARRAYS                         the catalogue: { id, runs, levels: { 2: n2, 3: n3, … }, name }
//   orthogonalArray(id)            the array: { id, name, runs, levels: [s per column], X (0 … s−1) }
//   gwlp(X, levels, maxLength)     the generalised word-length pattern [A1, …, A_max]
//   chooseArray(levels)            the smallest arrays with enough columns for factors of these
//                                  levels, and the best columns of each
//   arrayDesign(levels, opts)      a design: { kind: 'orthogonal-array', params, levels, X, runKind }

import { finish } from './factorial.js';
import { plackettBurman } from './pb.js';

// ---------------------------------------------------------------- fields
const gf = (s) => {
  if (s === 4) {
    // GF(4) = {0, 1, ω, ω²} as 0 1 2 3: addition is xor, multiplication by logs
    const log = [null, 0, 1, 2], exp = [1, 2, 3];
    return { add: (a, b) => a ^ b, mul: (a, b) => (a && b ? exp[(log[a] + log[b]) % 3] : 0) };
  }
  return { add: (a, b) => (a + b) % s, mul: (a, b) => (a * b) % s };
};

// all non-zero vectors of GF(s)^m with first non-zero entry 1: the columns of the saturated array
function points(s, m) {
  const out = [];
  for (let r = 1; r < s ** m; r++) {
    const v = []; let t = r;
    for (let j = 0; j < m; j++) { v.push(t % s); t = Math.floor(t / s); }
    if (v.find(x => x !== 0) === 1) out.push(v);
  }
  return out.sort((a, b) => a.filter(Boolean).length - b.filter(Boolean).length || a.join('').localeCompare(b.join('')));
}

/** The saturated regular array with s^m runs: columns as levels 0 … s−1. */
function regular(s, m) {
  const F = gf(s), P = points(s, m), N = s ** m;
  const X = [];
  for (let r = 0; r < N; r++) {
    const b = []; let t = r;
    for (let j = 0; j < m; j++) { b.push(t % s); t = Math.floor(t / s); }
    X.push(P.map(v => v.reduce((acc, e, i) => F.add(acc, F.mul(e, b[i])), 0)));
  }
  return { X, levels: P.map(() => s) };
}

// difference matrices found by a small search (each pair of columns' differences holds every
// element equally often); tests/arrays.test.mjs checks the property
const D6_3 = ['000000', '001122', '010212', '012021', '021201', '022110'];
const D12_3 = ['000000000000', '000011112222', '000102221112', '001220120121', '010221202011', '012012020211', '012120012102', '012202111020', '021020211210', '021102102201', '021211021002', '022111200120'];
const D8_4 = ['00000000', '00112233', '01230123', '01322310', '02023131', '02131302', '03213012', '03301221'];
export const DIFFERENCE_MATRICES = { D6_3: { s: 3, rows: D6_3 }, D12_3: { s: 3, rows: D12_3 }, D8_4: { s: 4, rows: D8_4 } };

/** OA(r·s, r¹ s^r) from a difference matrix D(r, r, s): the r-level column first. */
function fromDifference({ s, rows }) {
  const F = gf(s), r = rows.length, D = rows.map(t => [...t].map(Number)), X = [];
  for (let a = 0; a < s; a++) for (let i = 0; i < r; i++) X.push([i, ...D[i].map(d => F.add(d, a))]);
  return { X, levels: [r, ...D[0].map(() => s)] };
}

/** Replace column j (with n levels) by the columns of an array with n runs (expansive replacement). */
function replace(A, j, sub) {
  return { X: A.X.map(row => [...sub.X[row[j]], ...row.filter((_, c) => c !== j)]), levels: [...sub.levels, ...A.levels.filter((_, c) => c !== j)] };
}
// small full factorials as arrays (first factor slowest)
const full = (...lv) => {
  const X = [[]];
  for (const s of lv) { const nx = []; for (const r of X) for (let v = 0; v < s; v++) nx.push([...r, v]); X.splice(0, X.length, ...nx); }
  return { X, levels: lv };
};
const pbArray = (N) => { const d = plackettBurman(N - 1, { runs: N }); return { X: d.X.map(r => r.map(v => (v + 1) / 2)), levels: new Array(N - 1).fill(2) }; };

// a 4-level column of a regular GF(4) array is replaced by the three 2-level columns (b1, b2, b1+b2)
// of its two bits; replacing c of the five columns of L16(4^5) gives 2^(3c) 4^(5−c)
const fourToTwo = { X: [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]], levels: [2, 2, 2] };
function L16mixed(c) { let A = regular(4, 2); for (let t = 0; t < c; t++) A = replace(A, A.levels.length - 1, fourToTwo); return A; }

const count = (levels) => levels.reduce((o, s) => ({ ...o, [s]: (o[s] ?? 0) + 1 }), {});
const nameOf = (runs, levels) => `L${runs} (${Object.entries(count(levels)).sort((a, b) => a[0] - b[0]).map(([s, n]) => `${s}${n > 1 ? `^${n}` : ''}`).join(' ')})`;

const BUILD = {
  'L4': () => regular(2, 2), 'L8': () => regular(2, 3), 'L16': () => regular(2, 4), 'L32': () => regular(2, 5),
  'L12': () => pbArray(12), 'L20': () => pbArray(20), 'L24': () => pbArray(24),
  'L9': () => regular(3, 2), 'L27': () => regular(3, 3), 'L81': () => regular(3, 4),
  'L16.4.5': () => regular(4, 2), 'L16.2.3.4.4': () => L16mixed(1), 'L16.2.6.4.3': () => L16mixed(2), 'L16.2.9.4.2': () => L16mixed(3), 'L16.2.12.4.1': () => L16mixed(4),
  'L25': () => regular(5, 2),
  'L18.6.1.3.6': () => fromDifference(DIFFERENCE_MATRICES.D6_3),
  'L18': () => replace(fromDifference(DIFFERENCE_MATRICES.D6_3), 0, full(2, 3)),
  'L32.2.1.4.9': () => replace(fromDifference(DIFFERENCE_MATRICES.D8_4), 0, full(2, 4)),
  'L36': () => replace(fromDifference(DIFFERENCE_MATRICES.D12_3), 0, pbArray(12)),
  'L36.2.2.3.13': () => replace(fromDifference(DIFFERENCE_MATRICES.D12_3), 0, full(2, 2, 3)),
  'L36.3.13.4.1': () => replace(fromDifference(DIFFERENCE_MATRICES.D12_3), 0, full(4, 3)),
};
const CACHE = new Map();
/** The array: { id, name, runs, levels, X } with X holding levels 0 … s−1. */
export function orthogonalArray(id) {
  if (!BUILD[id]) throw new Error(`unknown array "${id}" (one of ${Object.keys(BUILD).join(', ')})`);
  if (!CACHE.has(id)) { const A = BUILD[id](); CACHE.set(id, Object.freeze({ id, name: nameOf(A.X.length, A.levels), runs: A.X.length, levels: A.levels, X: A.X })); }
  return CACHE.get(id);
}
/** The catalogue, smallest first: [{ id, name, runs, levels: { s: columns } }]. */
export const ARRAYS = Object.keys(BUILD).map(id => { const A = orthogonalArray(id); return { id, name: A.name, runs: A.runs, levels: count(A.levels) }; })
  .sort((a, b) => a.runs - b.runs || a.name.localeCompare(b.name));

// ---------------------------------------------------------------- the generalised word-length pattern
// orthonormal contrasts for an s-level column (Helmert, scaled so that Σ over the s levels of c² = s)
const CONTRASTS = new Map();
function contrasts(s) {
  if (!CONTRASTS.has(s)) {
    const C = [];
    for (let k = 1; k < s; k++) { const v = Array.from({ length: s }, (_, l) => (l < k ? 1 : l === k ? -k : 0)); const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0) / s); C.push(v.map(x => x / n)); }
    CONTRASTS.set(s, C);
  }
  return CONTRASTS.get(s);
}

/**
 * The generalised word-length pattern [A1, …, A_maxLength] of a design with columns of these
 * levels (X: levels 0 … s−1): A_j = Σ over sets of j columns, and over every choice of one
 * non-constant orthonormal contrast for each, of (mean over the runs of their product)²
 * (Xu & Wu 2001). For a regular s-level fraction, A_j = (s − 1) × the number of words of length j.
 */
export function gwlpDirect(X, levels, maxLength = 4) {
  const N = X.length, k = levels.length, out = new Array(Math.min(maxLength, k)).fill(0);
  // per column, the contrast values for every run: cols[j][c][i]
  const cols = levels.map((s, j) => contrasts(s).map(c => X.map(r => c[r[j]])));
  const prod = new Float64Array(N);
  const rec = (start, depth, acc) => {
    for (let j = start; j < k; j++) {
      for (const c of cols[j]) {
        const p = new Float64Array(N);
        let sum = 0;
        for (let i = 0; i < N; i++) { p[i] = acc[i] * c[i]; sum += p[i]; }
        out[depth] += (sum / N) ** 2;
        if (depth + 1 < out.length) rec(j + 1, depth + 1, p);
      }
    }
  };
  prod.fill(1);
  rec(0, 0, prod);
  return out.map(v => Math.round(v * 1e9) / 1e9);
}

const binom = (n, r) => (r < 0 || r > n ? 0 : choose(n, r));
// the Krawtchouk polynomial P_j(x; n, s) = Σ_t (−1)^t (s − 1)^(j − t) C(x, t) C(n − x, j − t)
const kraw = (j, x, n, s) => { let v = 0; for (let t = 0; t <= j; t++) v += (-1) ** t * (s - 1) ** (j - t) * binom(x, t) * binom(n - x, j - t); return v; };

/**
 * The generalised word-length pattern [A1, …, A_maxLength], by the MacWilliams identity from the
 * distribution of distances between runs (Xu & Wu 2001): with the columns grouped by their number
 * of levels, B(x) is the share of ordered pairs of runs differing in x_g columns of each group g,
 * and A_j = N⁻¹ Σ over (j_g) with Σ j_g = j of Σ_x B(x) Π_g P_{j_g}(x_g; n_g, s_g). Fast: O(N² k).
 * Equal to gwlpDirect (the contrasts), which the tests check, and to DoE.base's GWLP.
 */
export function gwlp(X, levels, maxLength = 4) {
  const N = X.length, k = levels.length, L = Math.min(maxLength, k);
  const types = [...new Set(levels)], gi = levels.map(s => types.indexOf(s)), n = types.map(s => levels.filter(t => t === s).length);
  const B = new Map();
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
    const d = new Array(types.length).fill(0);
    for (let j = 0; j < k; j++) if (X[a][j] !== X[b][j]) d[gi[j]]++;
    const key = d.join(',');
    B.set(key, (B.get(key) ?? 0) + 1);
  }
  const dist = [...B].map(([key, c]) => [key.split(',').map(Number), c / N]);
  // the compositions of j into the groups
  const comps = (j, g) => (g === types.length ? (j === 0 ? [[]] : []) : Array.from({ length: Math.min(j, n[g]) + 1 }, (_, t) => comps(j - t, g + 1).map(r => [t, ...r])).flat());
  const out = [];
  for (let j = 1; j <= L; j++) {
    let A = 0;
    for (const c of comps(j, 0)) for (const [x, w] of dist) A += w * c.reduce((p, jg, g) => p * kraw(jg, x[g], n[g], types[g]), 1);
    out.push(Math.round((A / N) * 1e9) / 1e9);
  }
  return out;
}

const lexLess = (a, b) => { for (let i = 0; i < a.length; i++) { if (Math.abs(a[i] - b[i]) > 1e-9) return a[i] < b[i]; } return false; };
const choose = (n, r) => { let c = 1; for (let i = 0; i < r; i++) c = c * (n - i) / (i + 1); return Math.round(c); };
function* combos(pool, r) {
  const idx = Array.from({ length: r }, (_, i) => i);
  if (r > pool.length) return;
  for (;;) {
    yield idx.map(i => pool[i]);
    let i = r - 1;
    while (i >= 0 && idx[i] === pool.length - r + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < r; j++) idx[j] = idx[j - 1] + 1;
  }
}

/**
 * The best columns of an array for factors with these levels (in order): generalised minimum
 * aberration on (A3, A4), by a complete search when at most `limit` choices (20 000), otherwise column by
 * column (each the best given those before). Returns { columns (one per factor, in its order),
 * gwlp: [A3, A4], exhaustive } or null when the array has too few columns of some level.
 */
const CHOICE = new Map();
export function chooseColumns(A, levels, { limit = 20000 } = {}) {
  const key = `${A.id}|${levels.join(',')}|${limit}`;
  if (!CHOICE.has(key)) CHOICE.set(key, searchColumns(A, levels, limit));
  const c = CHOICE.get(key);
  return c && { ...c, columns: c.columns.slice(), gwlp: c.gwlp.slice() };
}
function searchColumns(A, levels, limit) {
  const need = count(levels), byLevel = {};
  A.levels.forEach((s, j) => { (byLevel[s] ??= []).push(j); });
  for (const [s, n] of Object.entries(need)) if ((byLevel[s]?.length ?? 0) < n) return null;
  const types = Object.keys(need).map(Number).sort((a, b) => a - b);
  const score = (cols) => { const lv = cols.map(j => A.levels[j]); const g = gwlp(A.X.map(r => cols.map(j => r[j])), lv, 4); return [g[2] ?? 0, g[3] ?? 0]; };
  // assemble a full choice from one subset per level, then give the factors their columns in order
  const assign = (sets) => { const pools = Object.fromEntries(types.map((s, t) => [s, sets[t].slice()])); return levels.map(s => pools[s].shift()); };
  const total = types.reduce((p, s) => p * choose(byLevel[s].length, need[s]), 1);
  let best = null, bestSets = null;
  if (total <= limit) {
    const rec = (t, sets) => {
      if (t === types.length) { const sc = score(sets.flat()); if (!best || lexLess(sc, best)) { best = sc; bestSets = sets.map(x => x.slice()); } return; }
      for (const c of combos(byLevel[types[t]], need[types[t]])) rec(t + 1, [...sets, c]);
    };
    rec(0, []);
    return { columns: assign(bestSets), gwlp: best, exhaustive: true };
  }
  // column by column: the next factor's column, the best with those already chosen
  const chosen = [];
  for (const s of levels.slice().sort((a, b) => b - a)) {
    let bs = null, bj = -1;
    for (const j of byLevel[s]) { if (chosen.includes(j)) continue; const sc = chosen.length >= 2 ? score([...chosen, j]) : [0, 0]; if (!bs || lexLess(sc, bs)) { bs = sc; bj = j; } }
    chosen.push(bj);
  }
  const sets = types.map(s => chosen.filter(j => A.levels[j] === s));
  const cols = assign(sets);
  return { columns: cols, gwlp: score(cols), exhaustive: false };
}

/**
 * The arrays that fit factors with these levels, smallest first, with their best columns:
 * [{ id, name, runs, columns, gwlp, exhaustive }]. Only arrays with enough columns of each level
 * count (a factor is never put on a column with more or fewer levels than it has).
 */
export function fittingArrays(levels) {
  return ARRAYS.filter(a => Object.entries(count(levels)).every(([s, n]) => (a.levels[s] ?? 0) >= n));
}
export function chooseArray(levels, { maxRuns = Infinity, sizes = Infinity } = {}) {
  const fit = fittingArrays(levels).filter(a => a.runs <= maxRuns);
  const runs = [...new Set(fit.map(a => a.runs))].slice(0, sizes);
  // among arrays of one size, the one with the least aberration first
  return fit.filter(a => runs.includes(a.runs))
    .map(a => { const A = orthogonalArray(a.id), c = chooseColumns(A, levels); return c && { id: a.id, name: A.name, runs: A.runs, ...c }; })
    .filter(Boolean).sort((a, b) => a.runs - b.runs || (lexLess(a.gwlp, b.gwlp) ? -1 : lexLess(b.gwlp, a.gwlp) ? 1 : 0));
}

/**
 * An orthogonal-array design for factors with these levels. opts: array (an id; default the
 * smallest that fits), columns (column indices of the array, one per factor; default the best),
 * replicates. Returns { kind: 'orthogonal-array', params: { array, name, runs, columns, gwlp,
 * exhaustive, source }, levels, X (two-level columns ±1, others 0 … s−1), runKind }.
 */
export function arrayDesign(levels, opts = {}) {
  let A, pick;
  if (opts.array) {
    A = orthogonalArray(opts.array);
    if (opts.columns) {
      if (opts.columns.length !== levels.length) throw new Error(`give one column per factor (${levels.length}), not ${opts.columns.length}`);
      opts.columns.forEach((j, i) => { if (A.levels[j] !== levels[i]) throw new Error(`column ${j + 1} of ${A.name} has ${A.levels[j] ?? 'no'} levels; factor ${i + 1} has ${levels[i]}`); });
      if (new Set(opts.columns).size !== opts.columns.length) throw new Error('a column is given to two factors');
      const g = gwlp(A.X.map(r => opts.columns.map(j => r[j])), levels, 4);
      pick = { columns: opts.columns.slice(), gwlp: [g[2] ?? 0, g[3] ?? 0], exhaustive: true, source: 'columns given' };
    } else {
      pick = chooseColumns(A, levels);
      if (!pick) throw new Error(`${A.name} has too few columns for factors with ${Object.entries(count(levels)).map(([s, n]) => `${n} at ${s} levels`).join(', ')}`);
    }
  } else {
    const fits = chooseArray(levels, { sizes: 1 });
    if (!fits.length) throw new Error(`no orthogonal array in the catalogue has columns for ${Object.entries(count(levels)).map(([s, n]) => `${n} factor${n > 1 ? 's' : ''} at ${s} levels`).join(', ')}`);
    const f = fits[0];
    A = orthogonalArray(f.id); pick = f;
  }
  const source = pick.source ?? (pick.exhaustive ? 'columns of least aberration (complete search)' : 'columns of low aberration (column by column)');
  const X = A.X.map(r => pick.columns.map((j, i) => (levels[i] === 2 ? 2 * r[j] - 1 : r[j])));
  return finish({ kind: 'orthogonal-array', params: { array: A.id, name: A.name, runs: A.runs, columns: pick.columns, gwlp: pick.gwlp, exhaustive: pick.exhaustive, source },
    levels: levels.slice(), X, runKind: X.map(() => 'fraction') }, { replicates: opts.replicates });
}
