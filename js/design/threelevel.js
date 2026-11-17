// Regular three-level fractional factorials, 3^(k−p) (issue #85, phase 1).
//
// The runs are the 3^m combinations of m base factors, each at 0, 1, 2. Each added factor is a
// linear combination of the base factors modulo 3: D = AB²C means x_D = x_A + 2·x_B + x_C (mod 3).
// Its defining word is that combination with D at exponent 2 (−1 mod 3): I = AB²CD². The defining
// relation is every non-zero combination of the p words over GF(3), a word and its square counted
// once (written with its first exponent 1), so (3^p − 1)/2 words.
//
// A three-level main effect has 2 df (linear and quadratic, or two contrasts), and a two-factor
// interaction A×B has 4, split into two components AB and AB² of 2 df each. A word of length 3,
// ABC say, aliases A with the component BC of B×C (and B with AC, C with AB). Resolution and the
// word-length pattern mean what they do for two-level fractions; minimum aberration minimises A3,
// then A4, … (Wu & Hamada 2009, ch. 6).
//
//   fraction3(k, { runs | generators })   the design: { kind, params, levels, X (0, 1, 2), runKind }
//   threeLevelWLP(gens, m)                the word-length pattern of generators over m base factors
//   minimumAberration3(k, m)              the generators of a minimum-aberration 3^(k−(k−m)) design

import { finish } from './factorial.js';

const NAMES = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';          // no I (the identity), as two-level fractions
export const factorName3 = (j) => NAMES[j] ?? `F${j + 1}`;
const SUP = { 1: '', 2: '²' };

// a vector over GF(3) normalised so its first non-zero entry is 1
const normalise = (v) => { const f = v.find(x => x !== 0); return f === 2 ? v.map(x => (2 * x) % 3) : v.slice(); };

/** Write a coefficient vector as a word: [1, 2, 1, 0] → "AB²C". */
export function word3(v) {
  return v.map((e, j) => (e ? factorName3(j) + SUP[e] : '')).join('');
}

/** Parse a word ("AB²C", "AB2C" or "AB^2C") over k factors into a coefficient vector. */
export function parseWord3(s, k) {
  const v = new Array(k).fill(0), t = String(s).trim().replace(/\^/g, '');
  const re = /([A-HJ-Z])([²2]?)/g;
  let m, used = 0;
  while ((m = re.exec(t))) {
    const j = NAMES.indexOf(m[1]);
    if (j < 0 || j >= k) throw new Error(`"${s}": factor ${m[1]} is not among the first ${k}`);
    if (v[j]) throw new Error(`"${s}": factor ${m[1]} appears twice`);
    v[j] = m[2] ? 2 : 1; used += m[0].length;
  }
  if (used !== t.length || !used) throw new Error(`"${s}" is not a word such as AB²C (or AB2C)`);
  return v;
}

/** All non-zero vectors of GF(3)^m with first non-zero entry 1, in a fixed order: (3^m − 1)/2 of them. */
function projectivePoints(m) {
  const out = [];
  for (let r = 1; r < 3 ** m; r++) {
    const v = []; let t = r;
    for (let j = 0; j < m; j++) { v.push(t % 3); t = Math.floor(t / 3); }
    if (v.find(x => x !== 0) === 1) out.push(v);
  }
  // base factors first, then by weight, then lexicographically: a stable, readable order
  return out.sort((a, b) => a.filter(Boolean).length - b.filter(Boolean).length || a.join('').localeCompare(b.join('')));
}

/**
 * The defining relation of a 3^(k−p) fraction: gens are the added factors' columns as vectors
 * over the m = k − p base factors. Returns the (3^p − 1)/2 words, each a vector over the k factors
 * with first non-zero exponent 1.
 */
export function definingWords3(gens, m) {
  const p = gens.length, k = m + p;
  // the p generating words: the column, and −1 (= 2) on its own factor
  const W = gens.map((g, j) => { const w = new Array(k).fill(0); g.forEach((e, i) => { w[i] = e; }); w[m + j] = 2; return w; });
  const out = [];
  for (let r = 1; r < 3 ** p; r++) {
    const c = []; let t = r;
    for (let j = 0; j < p; j++) { c.push(t % 3); t = Math.floor(t / 3); }
    if (c.find(x => x !== 0) !== 1) continue;                     // a combination and its square: once
    const w = new Array(k).fill(0);
    c.forEach((cj, j) => { if (cj) for (let i = 0; i < k; i++) w[i] = (w[i] + cj * W[j][i]) % 3; });
    out.push(normalise(w));
  }
  return out;
}

/** The word-length pattern [A1, A2, …, Ak] (A1, A2 are 0 for a proper fraction). */
export function threeLevelWLP(gens, m) {
  const k = m + gens.length, A = new Array(k).fill(0);
  for (const w of definingWords3(gens, m)) A[w.filter(Boolean).length - 1]++;
  return A;
}

const lexLess = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] < b[i]; } return false; };

// how many ways to choose r of n
const choose = (n, r) => { let c = 1; for (let i = 0; i < r; i++) c = c * (n - i) / (i + 1); return Math.round(c); };

/**
 * The added columns of a minimum-aberration 3^(k−p) design with m = k − p base factors: an
 * exhaustive search over the saturated array's other columns (choose p of (3^m − 1)/2 − m),
 * minimising A3, then A4, …; the first in a fixed order among equals. Beyond `limit` subsets, a
 * sequential search (each added column the best given those before; it found the same pattern
 * as the complete search for every 27-run design and 81-run designs of 6–9 factors), flagged
 * exhaustive: false.
 * Returns { gens, wlp, exhaustive }.
 */
const MA_CACHE = new Map();
export function minimumAberration3(k, m, { limit = 60000 } = {}) {
  const key = `${k}-${m}-${limit}`;
  if (!MA_CACHE.has(key)) MA_CACHE.set(key, searchMA(k, m, limit));
  const r = MA_CACHE.get(key);
  return { gens: r.gens.map(g => g.slice()), wlp: r.wlp.slice(), exhaustive: r.exhaustive };
}
function searchMA(k, m, limit) {
  const p = k - m;
  if (p < 0) throw new Error(`${k} factors cannot have ${m} base factors`);
  const cols = projectivePoints(m).filter(v => v.filter(Boolean).length >= 2);
  if (p > cols.length) throw new Error(`${k} three-level factors need more than ${3 ** m} runs (at most ${(3 ** m - 1) / 2} factors in ${3 ** m})`);
  if (p === 0) return { gens: [], wlp: new Array(k).fill(0), exhaustive: true };
  const better = (w, best) => !best || lexLess(w.slice(2), best.slice(2));
  if (choose(cols.length, p) <= limit) {
    let best = null, bestIdx = null;
    const idx = Array.from({ length: p }, (_, i) => i);
    for (;;) {
      const w = threeLevelWLP(idx.map(i => cols[i]), m);
      if (better(w, best)) { best = w; bestIdx = idx.slice(); }
      // the next combination
      let i = p - 1;
      while (i >= 0 && idx[i] === cols.length - p + i) i--;
      if (i < 0) break;
      idx[i]++;
      for (let j = i + 1; j < p; j++) idx[j] = idx[j - 1] + 1;
    }
    return { gens: bestIdx.map(i => cols[i]), wlp: best, exhaustive: true };
  }
  // sequential: add the column that keeps the pattern smallest
  const chosen = [];
  for (let s = 0; s < p; s++) {
    let best = null, bi = -1;
    cols.forEach((c, i) => {
      if (chosen.includes(i)) return;
      const w = threeLevelWLP([...chosen, i].map(t => cols[t]), m);
      if (better(w, best)) { best = w; bi = i; }
    });
    chosen.push(bi);
  }
  return { gens: chosen.map(i => cols[i]), wlp: threeLevelWLP(chosen.map(i => cols[i]), m), exhaustive: false };
}

/**
 * Main effects' aliases with two-factor interaction components, from the words of length 3: for
 * a word A^a B^b C^c, A is aliased with the component (B^b C^c) normalised, and likewise for B
 * and C. Returns { A: ['BC²', …], … } and the 2fi components aliased with each other (words of
 * length 4, each giving pairs) as a count.
 */
export function aliases3(words, k) {
  const main = Object.fromEntries(Array.from({ length: k }, (_, j) => [factorName3(j), []]));
  let pairs = 0;
  for (const w of words) {
    const nz = w.map((e, j) => (e ? j : -1)).filter(j => j >= 0);
    if (nz.length === 3) for (const j of nz) { const rest = w.map((e, i) => (i === j ? 0 : e)); main[factorName3(j)].push(word3(normalise(rest))); }
    if (nz.length === 4) pairs += 3;
  }
  return { main, twoFactorPairs: pairs };
}

/**
 * A regular 3^(k−p) fraction. opts: runs (9, 27, 81, 243 → minimum aberration from the
 * search) or generators ('D=ABC, E=AB²C' or ['ABC', 'AB2C'], over the first k − p factors);
 * replicates.
 * Returns { kind: 'fractional-factorial-3', params: { runs, generators, definingRelation, wlp,
 * resolution, aliases, source, exhaustive }, levels: [3, …], X (0, 1, 2), runKind }.
 */
export function fraction3(k, opts = {}) {
  let m, gens, exhaustive = true, source;
  if (opts.generators) {
    const g = typeof opts.generators === 'string' ? opts.generators.split(/[,;]+|\s+(?=[A-Z]\s*=)/).map(x => x.trim()).filter(Boolean) : opts.generators;
    m = k - g.length;
    if (m < 1) throw new Error(`${g.length} generators for ${k} factors leave no base factors`);
    if (opts.runs && opts.runs !== 3 ** m) throw new Error(`${g.length} generators for ${k} factors give ${3 ** m} runs, not ${opts.runs}`);
    gens = g.map((x, j) => {
      const [lhs, rhs] = x.includes('=') ? x.split('=').map(s => s.trim()) : [factorName3(m + j), x];
      if (lhs !== factorName3(m + j)) throw new Error(`generator ${j + 1} defines ${lhs}; it should define ${factorName3(m + j)} (the added factors come after the ${m} base factors, in order)`);
      const v = parseWord3(rhs, m);
      if (v.filter(Boolean).length < 2) throw new Error(`generator ${x}: an added factor must combine two or more base factors`);
      return normalise(v);
    });
    if (new Set(gens.map(g => g.join())).size < gens.length) throw new Error('two generators give the same column (or one the square of another)');
    source = 'user generators';
  } else {
    if (!opts.runs) throw new Error('give runs (9, 27, 81 or 243) or generators');
    m = Math.round(Math.log(opts.runs) / Math.log(3));
    if (3 ** m !== opts.runs || m < 2) throw new Error(`a three-level fraction has 9, 27, 81 or 243 runs (a power of 3), not ${opts.runs}`);
    if (k <= m) throw new Error(`${k} factors in ${opts.runs} runs: that is the full factorial (${3 ** k} runs) or more`);
    const r = minimumAberration3(k, m);
    gens = r.gens; exhaustive = r.exhaustive;
    source = exhaustive ? 'minimum aberration (complete search)' : 'low aberration (sequential search: not guaranteed minimum)';
  }
  const words = definingWords3(gens, m), wlp = threeLevelWLP(gens, m);
  const res = wlp.findIndex(a => a > 0) + 1 || Infinity;
  // the runs: the base factors in standard order (the first fastest), the added columns from them
  const X = [];
  for (let r = 0; r < 3 ** m; r++) {
    const b = []; let t = r;
    for (let j = 0; j < m; j++) { b.push(t % 3); t = Math.floor(t / 3); }
    X.push([...b, ...gens.map(g => g.reduce((s, e, i) => s + e * b[i], 0) % 3)]);
  }
  const params = {
    runs: 3 ** m, generators: gens.map((g, j) => `${factorName3(m + j)}=${word3(g)}`),
    definingRelation: words.map(word3).sort((a, b) => a.length - b.length || a.localeCompare(b)),
    wlp, resolution: res, aliases: aliases3(words, k), source, exhaustive,
  };
  return finish({ kind: 'fractional-factorial-3', params, levels: new Array(k).fill(3), X, runKind: X.map(() => 'fraction') }, { replicates: opts.replicates });
}
