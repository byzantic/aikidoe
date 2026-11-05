// Factorial, fractional factorial and Plackett–Burman design generators, and conversion of a
// generated design into study runs (spec §5, issue #5).
//
// Generators work in coded units and return a design object:
//   { kind, params, levels: [m per factor], X: N × k coded matrix, block?: [label per run],
//     runKind: ['factorial' | 'fraction' | 'centre' …] }
// Coding in X: two-level columns are ±1; an m-level column (m > 2) holds the level index
// 0 … m−1; centre points hold 0 in every continuous two-level column.
//
//   fullFactorial(levels, opts)              2^k or mixed-level; blocking, centre points, replicates
//   fractionalFactorial(k, opts)             2^(k−p): minimum aberration from the catalogue, or user generators
//   plackettBurman(k, opts)                  see pb.js
//   chooseBlockGenerators(design, b)         best 2^b blocking of a regular design
//   toStudyDesign(study, design, opts)       → study.design (natural units, randomised run order)
import * as T from './twolevel.js';
import { CATALOGUE } from './catalogue.js';
import { rng } from './rng.js';
import { decode } from '../study.js';

const popcount = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };

// ---------------------------------------------------------------- blocking

/**
 * Choose b block generators (column masks) for a regular two-level design so that no main
 * effect is confounded with blocks, then as few two-factor interactions as possible, then as
 * few three-factor interactions. Exhaustive over independent b-sets of columns when feasible.
 * Returns { gens: masks, confounded: { 1: [], 2: [...], 3: [...] } } (effects confounded with blocks).
 */
export function chooseBlockGenerators(design, b) {
  const { q, k, cols } = design;
  if (b < 1) return { gens: [], confounded: { 1: [], 2: [], 3: [] } };
  if (b >= q) throw new Error(`${1 << b} blocks of a ${1 << q}-run design would leave ≤ 1 run per block`);
  // effects up to order 3 by column
  const byCol = new Map();
  const visit = (fac, col, start, depth) => {
    if (depth > 0) { const e = byCol.get(col) || [0, 0, 0, 0]; e[depth]++; byCol.set(col, e); }
    if (depth === 3) return;
    for (let i = start; i < k; i++) visit(fac | 1 << i, col ^ cols[i], i + 1, depth + 1);
  };
  visit(0, 0, 0, 0);
  const score = (span) => { const s = [0, 0, 0]; for (const v of span) { const e = byCol.get(v); if (e) { s[0] += e[1]; s[1] += e[2]; s[2] += e[3]; } } return s; };
  const spanOf = (g) => { const out = []; for (let s = 1; s < 1 << g.length; s++) { let v = 0; for (let j = 0; j < g.length; j++) if (s >> j & 1) v ^= g[j]; out.push(v); } return out; };
  const all = [...Array((1 << q) - 1).keys()].map(i => i + 1);
  let best = null, bestS = null;
  const cmp = (a, c) => a[0] - c[0] || a[1] - c[1] || a[2] - c[2];
  // canonical search: g1 < g2 < … and each new generator outside the span so far
  const rec = (start, g, span) => {
    if (g.length === b) { const s = score(span); if (!best || cmp(s, bestS) < 0) { best = g.slice(); bestS = s; } return; }
    for (let i = start; i < all.length; i++) {
      const m = all[i];
      if (span.includes(m)) continue;
      const ns = span.concat(span.map(v => v ^ m), [m]);
      // prune: main effects confounded can only grow
      const s = score(ns);
      if (s[0] > 0) continue;
      if (best && cmp(s, bestS) >= 0) continue;
      g.push(m); rec(i + 1, g, ns); g.pop();
    }
  };
  rec(0, [], []);
  if (!best) throw new Error(`no way to put a ${1 << q}-run design with ${k} factors in ${1 << b} blocks without confounding a main effect`);
  return { gens: best, confounded: confoundedEffects(design, spanOf(best)) };
}

function confoundedEffects(design, span) {
  const { k, cols } = design, set = new Set(span), out = { 1: [], 2: [], 3: [] };
  const visit = (fac, col, start, depth) => {
    if (depth > 0 && set.has(col)) { let s = ''; for (let i = 0; fac >> i; i++) if (fac >> i & 1) s += T.factorName(i); out[depth].push(s); }
    if (depth === 3) return;
    for (let i = start; i < k; i++) visit(fac | 1 << i, col ^ cols[i], i + 1, depth + 1);
  };
  visit(0, 0, 0, 0);
  return out;
}

/** Block label (1 … 2^b) of each run of a regular design, from block generator masks. */
function blockLabels(design, gens) {
  return design.X.map((_, r) => { let lab = 0; gens.forEach((g, j) => { if (popcount(r & g) % 2) lab |= 1 << j; }); return lab + 1; });
}

// ---------------------------------------------------------------- full factorials

/**
 * Full factorial. levels: number of factors (all two-level) or an array of level counts.
 * opts: blocks (2^b, two-level only; or blockGenerators: ['ABC', …]), centre (centre points;
 * per block, and per combination of levels of factors that are not two-level continuous),
 * replicates (default 1; replicateBlocks: each replicate its own block), continuous (array of
 * booleans: which factors may take a centre value; default all two-level factors).
 */
export function fullFactorial(levels, opts = {}) {
  const lv = typeof levels === 'number' ? new Array(levels).fill(2) : levels.slice();
  if (!lv.length || lv.some(m => !Number.isInteger(m) || m < 2)) throw new Error('each factor needs an integer number of levels ≥ 2');
  const k = lv.length, twoLevel = lv.every(m => m === 2);
  let X, block, params = { levels: lv };
  if (twoLevel) {
    const d = T.regularDesign(k);
    X = d.X;
    if (opts.blocks > 1 || opts.blockGenerators) {
      const gens = opts.blockGenerators ? T.parseGenerators(opts.blockGenerators, k).map(g => g.mask) : chooseBlockGenerators(d, log2(opts.blocks, 'blocks')).gens;
      block = blockLabels(d, gens);
      params.blockGenerators = gens.map(T.maskToWord);
      params.confoundedWithBlocks = confoundedEffects(d, spanOf(gens));
    }
  } else {
    if (opts.blocks > 1 || opts.blockGenerators) throw new Error('blocking is only implemented for two-level factorials');
    X = [];
    const n = lv.reduce((a, b) => a * b, 1);
    for (let r = 0; r < n; r++) { let t = r; X.push(lv.map(m => { const v = t % m; t = Math.floor(t / m); return v; })); }
  }
  return finish({ kind: 'full-factorial', params, levels: lv, X, block, runKind: X.map(() => 'factorial') }, opts);
}

const spanOf = (g) => { const out = []; for (let s = 1; s < 1 << g.length; s++) { let v = 0; for (let j = 0; j < g.length; j++) if (s >> j & 1) v ^= g[j]; out.push(v); } return out; };
function log2(n, what) { const b = Math.log2(n); if (!Number.isInteger(b)) throw new Error(`${what} must be a power of 2, got ${n}`); return b; }

// ---------------------------------------------------------------- fractional factorials

/**
 * Regular 2^(k−p) fraction. opts: runs (power of 2) → minimum-aberration design from the
 * catalogue; or generators ('E=ABC, F=BCD' or ['ABC', 'BCD']) with runs = 2^(k − #generators).
 * Plus blocks / blockGenerators, centre, replicates as for fullFactorial.
 * params records generators, defining relation, word-length pattern, resolution and aliases.
 */
export function fractionalFactorial(k, opts = {}) {
  let q, gens;
  if (opts.generators) {
    const g = typeof opts.generators === 'string' ? opts.generators.split(/[,;\s]+/).filter(Boolean) : opts.generators;
    q = k - g.length;
    if (opts.runs && opts.runs !== 1 << q) throw new Error(`${g.length} generators for ${k} factors give ${1 << q} runs, not ${opts.runs}`);
    gens = g;
  } else {
    if (!opts.runs) throw new Error('give runs (a power of 2) or generators');
    q = log2(opts.runs, 'runs');
    if (k > opts.runs - 1) throw new Error(`${k} factors need more than ${opts.runs} runs`);
    if (k === q) return fullFactorial(k, opts);
    const entry = CATALOGUE[`${k}-${k - q}`];
    if (!entry) throw new Error(`no catalogued minimum-aberration design for ${k} factors in ${opts.runs} runs (catalogue: k ≤ 15, N ≤ 128)`);
    gens = entry.gens;
  }
  const d = T.regularDesign(q, gens);
  const params = {
    runs: d.runs, generators: d.cols.slice(q).map((m, j) => `${T.factorName(q + j)}=${d.signs[q + j] < 0 ? '-' : ''}${T.maskToWord(m)}`),
    definingRelation: T.definingRelation(d), wlp: T.wordLengthPattern(d), resolution: T.resolution(d), aliases: T.aliasSummary(d),
    source: opts.generators ? 'user generators' : 'minimum-aberration catalogue',
  };
  let block;
  if (opts.blocks > 1 || opts.blockGenerators) {
    const bg = opts.blockGenerators ? T.parseGenerators(opts.blockGenerators, q).map(g => g.mask) : chooseBlockGenerators(d, log2(opts.blocks, 'blocks')).gens;
    block = blockLabels(d, bg);
    params.blockGenerators = bg.map(T.maskToWord);
    params.confoundedWithBlocks = confoundedEffects(d, spanOf(bg));
    if (params.confoundedWithBlocks[1].length) throw new Error(`block generators ${params.blockGenerators} confound main effects ${params.confoundedWithBlocks[1]} with blocks`);
  }
  return finish({ kind: 'fractional-factorial', params, levels: new Array(k).fill(2), X: d.X, block, runKind: d.X.map(() => 'fraction'), regular: d }, opts);
}

// ---------------------------------------------------------------- centre points and replicates

function finish(design, opts) {
  let { X, block, runKind } = design;
  const k = design.levels.length;
  const centre = opts.centre ?? 0;
  if (centre > 0) {
    // factors that can take a centre value: continuous two-level factors
    const cont = opts.continuous ?? design.levels.map(m => m === 2);
    const fixed = [...Array(k).keys()].filter(j => !cont[j]);
    // one set of centre points per block and per combination of the other factors' levels
    const combos = uniqueRows(X.map(r => fixed.map(j => r[j])));
    const blocks = block ? [...new Set(block)] : [undefined];
    const add = [], addB = [];
    for (const b of blocks) for (const c of combos) for (let i = 0; i < centre; i++) {
      const row = new Array(k).fill(0);
      fixed.forEach((j, t) => { row[j] = c[t]; });
      add.push(row); addB.push(b);
    }
    X = X.concat(add);
    runKind = runKind.concat(add.map(() => 'centre'));
    if (block) block = block.concat(addB);
    design.params = { ...design.params, centrePoints: centre };
  }
  const reps = opts.replicates ?? 1;
  if (reps > 1) {
    const n = X.length;
    const nb = block ? Math.max(...block) : 1;
    X = Array.from({ length: reps }, () => X).flat().map(r => r.slice());
    runKind = Array.from({ length: reps }, () => runKind).flat();
    if (opts.replicateBlocks) block = [...Array(reps * n).keys()].map(i => (block ? block[i % n] : 1) + nb * Math.floor(i / n));
    else if (block) block = Array.from({ length: reps }, () => block).flat();
    design.params = { ...design.params, replicates: reps };
  }
  return { ...design, X, block, runKind };
}

function uniqueRows(rows) { const seen = new Map(); for (const r of rows) seen.set(JSON.stringify(r), r); return [...seen.values()]; }

// ---------------------------------------------------------------- to study runs

/**
 * Convert a generated design to study.design: natural settings via the study's factors (in
 * order), run ids 1 … N in standard order, and a seeded randomised execution order.
 * opts.seed (default study.seed); opts.randomise: 'complete' (default) | 'blocked' (default when
 * there are blocks: block order and run order within blocks randomised) | 'restricted' (default
 * for split-plot designs, which carry design.wholePlot: whole plots in random order — within
 * blocks if any — and runs in random order within each whole plot) | 'none'.
 */
export function toStudyDesign(study, design, opts = {}) {
  const factors = study.factors;
  if (factors.length !== design.levels.length) throw new Error(`the design has ${design.levels.length} factors, the study ${factors.length}`);
  if (design.continuousOnly) for (const f of factors) if (f.type === 'categorical') throw new Error(`a ${design.kind} design needs continuous factors; ${f.id} is categorical`);
  factors.forEach((f, j) => {
    const m = design.levels[j];
    if (f.type === 'categorical' && f.levels.length !== m) throw new Error(`factor ${f.id} has ${f.levels.length} levels but the design gives it ${m}`);
    if (f.type === 'continuous' && m > 2 && f.levels && f.levels.length !== m) throw new Error(`factor ${f.id} lists ${f.levels.length} levels but the design gives it ${m}`);
  });
  const setting = (f, j, v) => {
    const m = design.levels[j];
    // designs whose X holds coded values directly (definitive screening, optimal designs)
    if (design.coded) return f.type === 'categorical' ? f.levels[m === 2 && f.levels.length === 2 ? (v + 1) / 2 : v] : decode(f, v);
    if (f.type === 'categorical') return f.levels[m === 2 ? (v + 1) / 2 : v];
    if (m === 2) return decode(f, v);                               // ±1, or 0 for centre points
    if (f.levels) return f.levels[v];                               // listed numeric levels
    return decode(f, -1 + 2 * v / (m - 1));                         // evenly spaced in coded units
  };
  const runs = design.X.map((row, i) => {
    const r = { run: i + 1, kind: design.runKind[i], settings: Object.fromEntries(factors.map((f, j) => [f.id, setting(f, j, row[j])])) };
    if (design.block) r.block = design.block[i];
    if (design.wholePlot) r.wholePlot = design.wholePlot[i];
    return r;
  });
  const mode = opts.randomise ?? (design.wholePlot ? 'restricted' : design.block ? 'blocked' : 'complete');
  if (design.wholePlot && mode === 'complete') throw new Error('a split-plot design cannot be completely randomised: its whole plots would be broken up');
  const g = rng(opts.seed ?? study.seed);
  let order;
  if (mode === 'none') order = runs.map(r => r.run);
  else if (mode === 'complete') order = g.shuffle(runs.map(r => r.run));
  else if (mode === 'blocked') {
    if (!design.block) throw new Error('blocked randomisation needs blocks');
    const labels = g.shuffle([...new Set(design.block)].sort((a, b) => a - b));
    order = labels.flatMap(b => g.shuffle(runs.filter(r => r.block === b).map(r => r.run)));
  } else if (mode === 'restricted') {
    if (!design.wholePlot) throw new Error('restricted randomisation needs whole plots');
    const blocks = design.block ? g.shuffle([...new Set(design.block)].sort((a, b) => a - b)) : [undefined];
    order = blocks.flatMap(b => {
      const inB = runs.filter(r => b === undefined || r.block === b);
      const wps = g.shuffle([...new Set(inB.map(r => r.wholePlot))].sort((a, b2) => a - b2));
      return wps.flatMap(w => g.shuffle(inB.filter(r => r.wholePlot === w).map(r => r.run)));
    });
  } else throw new Error(`unknown randomisation "${mode}"`);
  order.forEach((run, i) => { runs[run - 1].order = i + 1; });
  return { kind: design.kind, params: { ...design.params, seed: opts.seed ?? study.seed }, randomisation: mode, runs };
}
