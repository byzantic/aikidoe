// Regular two-level designs (spec §5, issue #5).
//
// A regular 2^(k−p) design with N = 2^q runs is described by one column mask per factor: a
// nonzero q-bit integer saying which base factors multiply to give that column (bit i = base
// factor i; this is the Yates column number). The first q factors are the base factors (masks
// 1, 2, 4, …); the others are generated, e.g. D = ABC has mask 0b0111 = 7. A generator may carry
// a sign (D = −ABC).
//
//   regularDesign(q, gens)      → { q, k, cols, signs, X }  (X: N × k, ±1, standard order)
//   wordLengthPattern(design)   → [A1, A2, …, Ak] (A_L = number of defining words of length L)
//   resolution(design)
//   definingRelation(design)    → words as factor-letter strings
//   aliasChains(design, order)  → effects up to `order` grouped by aliasing
//   aliasSummary(design)        → FrF2-style { main: ['A=BC', …], fi2: ['AB=CD', …] }
//   searchMinAberration(q, k)   → generators of a minimum-aberration design (search)
//   parseGenerators('D=ABC, E=-BCD' | ['ABC','BCD'], q)
//
// Standard order: run r (0-based) has base factor i at +1 when bit i of r is set, so A changes
// fastest. Factor letters follow FrF2: A … H, J … Z (no I, which is the identity in the
// defining relation).

export const LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'.split('');
const popcount = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };

/** Factor name for index i (A, B, …, H, J, …; then F26, F27, …). */
export const factorName = (i) => (i < LETTERS.length ? LETTERS[i] : `F${i + 1}`);

/** A product of base factors as letters → mask, e.g. 'ABD' → 0b1011. */
export function wordToMask(word, q) {
  let m = 0;
  for (const ch of word) {
    const i = LETTERS.indexOf(ch);
    if (i < 0 || i >= q) throw new Error(`generator "${word}": "${ch}" is not one of the ${q} base factors ${LETTERS.slice(0, q).join('')}`);
    if (m & (1 << i)) throw new Error(`generator "${word}": "${ch}" repeated`);
    m |= 1 << i;
  }
  return m;
}
export const maskToWord = (m) => { let s = ''; for (let i = 0; m >> i; i++) if (m >> i & 1) s += factorName(i); return s; };

/**
 * Parse generators for the added factors. Accepts 'D=ABC, E=-BCD', ['ABC', '-BCD'] or masks
 * [7, -14]. Returns [{ mask, sign }].
 */
export function parseGenerators(gens, q) {
  const list = typeof gens === 'string' ? gens.split(/[,;\s]+/).filter(Boolean) : gens;
  return list.map((g) => {
    if (typeof g === 'number') return { mask: Math.abs(g), sign: g < 0 ? -1 : 1 };
    let s = String(g).replace(/^[A-Z][0-9]*=/, '');
    let sign = 1;
    if (s.startsWith('-')) { sign = -1; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
    return { mask: wordToMask(s, q), sign };
  });
}

/** Build a regular design from q base factors and generators. */
export function regularDesign(q, gens = []) {
  const g = parseGenerators(gens, q);
  const N = 1 << q;
  const cols = [...Array(q).keys()].map(i => 1 << i).concat(g.map(x => x.mask));
  const signs = new Array(q).fill(1).concat(g.map(x => x.sign));
  for (const [j, x] of g.entries()) {
    if (popcount(x.mask) < 2) throw new Error(`generator ${j + 1} (${maskToWord(x.mask)}) must be an interaction of at least two base factors`);
  }
  const seen = new Set();
  for (const c of cols) { if (seen.has(c)) throw new Error(`two factors share the column ${maskToWord(c)}: their main effects would be completely aliased`); seen.add(c); }
  const X = [];
  for (let r = 0; r < N; r++) X.push(cols.map((m, j) => signs[j] * ((popcount(m) + popcount(r & m)) % 2 ? -1 : 1)));
  return { q, k: cols.length, runs: N, cols, signs, X };
}

/**
 * Defining words: for every nonempty subset S of the generated factors, the word is S together
 * with the base factors in the XOR of their masks. Returned as { factors: bitmask over all k
 * factors, sign }. 2^p − 1 words.
 */
export function definingWords(design) {
  const { q, k, cols, signs } = design, p = k - q, out = [];
  for (let s = 1; s < 1 << p; s++) {
    let m = 0, fac = 0, sign = 1;
    for (let j = 0; j < p; j++) if (s >> j & 1) { m ^= cols[q + j]; fac |= 1 << (q + j); sign *= signs[q + j]; }
    out.push({ factors: fac | m, sign });     // base factor i is bit i in both encodings
  }
  return out;
}

/** Word-length pattern [A1, …, Ak] (index L−1 holds A_L). */
export function wordLengthPattern(design) {
  const A = new Array(design.k).fill(0);
  for (const w of definingWords(design)) A[popcount(w.factors) - 1]++;
  return A;
}
export const resolution = (design) => { const A = wordLengthPattern(design); const i = A.findIndex(a => a > 0); return i < 0 ? Infinity : i + 1; };

const bits = (x) => { const out = []; for (let i = 0; x >> i; i++) if (x >> i & 1) out.push(i); return out; };
const lexBits = (a, b) => { const x = bits(a), y = bits(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
// effect names: letters run together (ABC), or the given factor names joined with ':' (T:t:amb)
const effectName = (fac, names) => {
  const parts = [];
  for (let i = 0; fac >> i; i++) if (fac >> i & 1) parts.push(names ? names[i] : factorName(i));
  return parts.join(names ? ':' : '');
};

/** Defining relation as strings, e.g. ['ABCE', '-BCDF', …], sorted by length then name. names: optional factor names. */
export const definingRelation = (design, names) => definingWords(design)
  .map(w => ({ s: (w.sign < 0 ? '-' : '') + effectName(w.factors, names), len: popcount(w.factors) }))
  .sort((a, b) => a.len - b.len || a.s.localeCompare(b.s)).map(w => w.s);

/**
 * Alias chains among all effects up to `order` (default 2): effects that share a column (up to
 * sign) are aliased. Returns chains (arrays of effect names, lowest order first) with ≥ 1 effect;
 * each chain also lists its column mask.
 */
export function aliasChains(design, order = 2, names) {
  const { k, cols } = design, byCol = new Map();
  const visit = (fac, col, start, depth) => {
    if (depth > 0) { if (!byCol.has(col)) byCol.set(col, []); byCol.get(col).push(fac); }
    if (depth === order) return;
    for (let i = start; i < k; i++) visit(fac | 1 << i, col ^ cols[i], i + 1, depth + 1);
  };
  visit(0, 0, 0, 0);
  const chains = [];
  for (const [col, facs] of byCol) {
    facs.sort((a, b) => popcount(a) - popcount(b) || lexBits(a, b));
    chains.push({ col, effects: facs.map(f => effectName(f, names)), orders: facs.map(popcount), first: bits(facs[0]) });
  }
  // lowest-order chains first, then by factor order of their first effect (A, B, … ; AB, AC, AD, BC, …)
  const lex = (x, y) => { for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i]; return x.length - y.length; };
  return chains.sort((a, b) => a.orders[0] - b.orders[0] || lex(a.first, b.first)).map(({ first, ...c }) => c);
}

/**
 * FrF2-style alias summary among main effects and two-factor interactions (signs ignored):
 * main: chains containing a main effect and at least one 2fi ("A=BC=DE");
 * fi2: chains of two or more 2fis with no main effect ("AB=CD").
 */
export function aliasSummary(design, names) {
  const main = [], fi2 = [];
  for (const c of aliasChains(design, 2, names)) {
    if (c.effects.length < 2) continue;
    if (c.orders[0] === 1) { if (c.orders[1] === 2) main.push(c.effects.join('=')); }
    else fi2.push(c.effects.join('='));
  }
  return { main, fi2 };
}

// ---------------------------------------------------------------- minimum aberration search

/** Compare word-length patterns lexicographically from A3 (A1, A2 are 0 for valid designs). */
export function compareWLP(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; }
  return 0;
}

// fast WLP for search: generator masks only
function wlpOf(q, gens) {
  const p = gens.length, A = new Array(q + p).fill(0);
  // Gray-code walk over subsets: each step toggles one generator
  let m = 0, size = 0, inSet = 0;
  for (let s = 1; s < 1 << p; s++) {
    const j = 31 - Math.clz32(s & -s);
    m ^= gens[j]; inSet ^= 1 << j; size += (inSet >> j & 1) ? 1 : -1;
    A[size + popcount(m) - 1]++;
  }
  return A;
}

function binom(n, r) { let x = 1; for (let i = 0; i < r; i++) x = x * (n - i) / (i + 1); return Math.round(x); }

/**
 * Search for a minimum-aberration 2^(k−p) design with N = 2^q runs. Exhaustive when the number
 * of generator choices is small; otherwise steepest-descent swaps from many seeded random starts.
 * Returns { gens: masks, wlp }. The catalogue (catalogue.js) is built with this and checked
 * against FrF2's minimum-aberration designs.
 */
export function searchMinAberration(q, k, { restarts = 400, seed = 1, exhaustiveLimit = 200000 } = {}) {
  const p = k - q;
  if (p < 0) throw new Error(`${k} factors need at least ${k} runs… (q = ${q} gives ${1 << q})`);
  if (p === 0) return { gens: [], wlp: new Array(k).fill(0) };
  const cands = [];
  for (let m = 1; m < 1 << q; m++) if (popcount(m) >= 2) cands.push(m);
  if (p > cands.length) throw new Error(`${k} factors cannot be placed in ${1 << q} runs`);
  let best = null, bestW = null;
  const consider = (g) => { const w = wlpOf(q, g); if (!best || compareWLP(w, bestW) < 0) { best = g.slice(); bestW = w; } };
  if (binom(cands.length, p) <= exhaustiveLimit) {
    const idx = [...Array(p).keys()];
    for (;;) {
      consider(idx.map(i => cands[i]));
      let i = p - 1;
      while (i >= 0 && idx[i] === cands.length - p + i) i--;
      if (i < 0) break;
      idx[i]++;
      for (let j = i + 1; j < p; j++) idx[j] = idx[j - 1] + 1;
    }
    return { gens: best, wlp: bestW };
  }
  const rnd = mulberry32(seed);
  for (let r = 0; r < restarts; r++) {
    // random start
    const pool = cands.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    let g = pool.slice(0, p), w = wlpOf(q, g);
    for (;;) {
      let bg = null, bw = w;
      const used = new Set(g);
      for (let j = 0; j < p; j++) for (const c of cands) {
        if (used.has(c)) continue;
        const h = g.slice(); h[j] = c;
        const hw = wlpOf(q, h);
        if (compareWLP(hw, bw) < 0) { bg = h; bw = hw; }
      }
      if (!bg) break;
      g = bg; w = bw;
    }
    if (!best || compareWLP(w, bestW) < 0) { best = g.slice().sort((a, b) => a - b); bestW = w; }
  }
  return { gens: best, wlp: bestW };
}

// small seeded PRNG for the search only (design randomisation uses rng.js)
function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
