// Designs for comparing a few treatments (issue #80, phase 2): one factor — the treatment, a
// medium or compound or supplier — with the runs grouped to remove nuisance variation.
//
//   completeBlocks(t, b)        randomised complete blocks: every treatment once in each of b
//                               blocks (days, batches) — the usual design for a comparison
//   latinSquare(t, opts)        two blocking variables (day × operator, row × column of a plate
//                               or a field): each treatment once in every row and every column
//   williams(t) / crossover(t, opts)
//                               subjects that receive every treatment in turn, one per period;
//                               Williams sequences balance first-order carry-over (each treatment
//                               follows every other equally often); AB/BA for two
//   bibd(t, k, opts)            balanced incomplete blocks: blocks that hold k < t treatments,
//                               every pair together in the same number of blocks
//   blockEfficiency(blocks, t)  how much of the information on treatment differences the blocks
//                               keep, relative to complete blocks of the same replication
//
// Each returns a design for toStudyDesign (factorial.js): { kind, levels: [t], X, runKind,
// params, and block (one grouping) or blocking (named: [{ id, name, role, labels: per run }]),
// orderGroup / fixedGroupOrder (the run order: groups in turn, runs in random order within each),
// carryover }. Treatment labels, rows, columns and subjects are randomised with the seed.

import { rng } from './rng.js';
import { eigSym } from '../linalg.js';

// a level index as X holds it: ±1 for two levels, else 0 … t − 1 (see toStudyDesign)
const code = (t) => (v) => (t === 2 ? 2 * v - 1 : v);

function check(t, what) {
  if (!Number.isInteger(t) || t < 2) throw new Error(`${what}: at least two treatments are needed`);
}

/** Randomised complete blocks: b blocks, each holding every one of t treatments once. */
export function completeBlocks(t, b = 4) {
  check(t, 'complete blocks');
  if (!Number.isInteger(b) || b < 2) throw new Error('blocks: a whole number ≥ 2');
  const c = code(t), X = [], block = [];
  for (let j = 0; j < b; j++) for (let i = 0; i < t; i++) { X.push([c(i)]); block.push(j + 1); }
  return { kind: 'complete-blocks', levels: [t], X, runKind: X.map(() => 'factorial'), block, params: { treatments: t, blocks: b } };
}

/**
 * A Latin square for t treatments: t rows × t columns, each treatment once in every row and once
 * in every column. opts: squares (1; more squares add rows, the columns stay the same), rows and
 * columns ({ id, name } of the two blocking variables; default row / column), seed.
 * Randomised by permuting the rows, the columns and the treatment labels of a cyclic square.
 */
export function latinSquare(t, { squares = 1, rows = { id: 'row', name: 'Row' }, columns = { id: 'column', name: 'Column' }, seed = 1 } = {}) {
  check(t, 'Latin square');
  if (!Number.isInteger(squares) || squares < 1) throw new Error('squares: a whole number ≥ 1');
  if (rows.id === columns.id) throw new Error('the rows and columns need different names');
  const g = rng(seed), c = code(t);
  const X = [], rowLab = [], colLab = [], group = [];
  const squaresOut = [];
  for (let s = 0; s < squares; s++) {
    const pr = g.shuffle([...Array(t).keys()]), pc = g.shuffle([...Array(t).keys()]), ps = g.shuffle([...Array(t).keys()]);
    const sq = Array.from({ length: t }, (_, i) => Array.from({ length: t }, (_, j) => ps[(pr[i] + pc[j]) % t]));
    squaresOut.push(sq);
    for (let i = 0; i < t; i++) for (let j = 0; j < t; j++) {
      X.push([c(sq[i][j])]); rowLab.push(s * t + i + 1); colLab.push(j + 1); group.push(s * t + i + 1);
    }
  }
  return {
    kind: 'latin-square', levels: [t], X, runKind: X.map(() => 'factorial'),
    blocking: [{ ...rows, role: 'row', labels: rowLab }, { ...columns, role: 'column', labels: colLab }],
    orderGroup: group, fixedGroupOrder: true,
    params: { treatments: t, squares, square: squaresOut[0].map(r => r.map(v => v + 1)) },
  };
}

/**
 * Williams sequences for t treatments (Williams 1949), as crossdes::williams: rows are sequences,
 * columns periods, entries 1 … t. Each treatment appears once in each period and is preceded by
 * every other treatment equally often (once for even t, with t sequences; twice for odd t, with
 * 2t). t = 2 gives AB/BA.
 */
export function williams(t) {
  check(t, 'crossover');
  if (t === 2) return [[1, 2], [2, 1]];
  const gen = [0, ...new Array(t - 1).fill(1)];
  for (let i = 3; i <= t; i++) gen[i - 1] = gen[i - 2] + (i % 2 === 0 ? -1 : 1) * (t + 1 - i);
  const rows = [gen];
  for (let i = 1; i < t; i++) rows.push(rows[i - 1].map(v => (v + 1) % t));
  const d = rows.map(r => r.map(v => (((v % t) + t) % t) + 1));
  return t % 2 ? [...d, ...d.map(r => r.slice().reverse())] : d;
}

/**
 * A crossover design: each subject receives all t treatments, one per period, in a Williams
 * sequence. opts: subjects (default the number of sequences; a multiple of it keeps the balance),
 * subject / period names, seed. Subjects are given sequences at random, and the treatment labels
 * are randomised. The analysis adds a carry-over term (design.carryover).
 */
export function crossover(t, { subjects, subject = { id: 'subject', name: 'Subject' }, period = { id: 'period', name: 'Period' }, seed = 1 } = {}) {
  const seqs = williams(t), S = seqs.length, n = subjects ?? S;
  if (!Number.isInteger(n) || n < 2) throw new Error('subjects: a whole number ≥ 2');
  const g = rng(seed), c = code(t);
  const labels = g.shuffle([...Array(t).keys()]);
  // subjects to sequences: each sequence equally often (as nearly as n allows), in random order
  const pool = [];
  while (pool.length < n) pool.push(...g.shuffle([...Array(S).keys()]));
  const given = g.shuffle(pool.slice(0, n));
  const X = [], subj = [], per = [];
  for (let s = 0; s < n; s++) for (let p = 0; p < t; p++) { X.push([c(labels[seqs[given[s]][p] - 1])]); subj.push(s + 1); per.push(p + 1); }
  const balanced = n % S === 0;
  return {
    kind: 'crossover', levels: [t], X, runKind: X.map(() => 'factorial'),
    blocking: [{ ...subject, role: 'subject', labels: subj }, { ...period, role: 'period', labels: per, levels: [...Array(t).keys()].map(p => p + 1) }],
    orderGroup: per, fixedGroupOrder: true, carryover: true,
    params: { treatments: t, subjects: n, periods: t, sequences: seqs.map(r => r.map(v => labels[v - 1] + 1)), balanced, design: t === 2 ? 'AB/BA' : 'Williams' },
  };
}

/**
 * The efficiency of a block design for treatment comparisons: blocks is a list of blocks, each a
 * list of treatment indices 0 … t − 1. The information matrix C = R − N K⁻¹ Nᵀ (R replications,
 * N the treatment × block incidence, K the block sizes); the canonical efficiency factors are the
 * non-zero eigenvalues of R^{−1/2} C R^{−1/2}, and the efficiency is their harmonic mean — the
 * average variance of a difference with complete blocks over that with these blocks. 1 for
 * complete blocks; λt / (rk) for a balanced incomplete block design.
 * Returns { efficiency, factors (the efficiency factors), connected, balanced, r (replications),
 * k (block sizes), concurrence: { min, max } (blocks shared by a pair) }.
 */
export function blockEfficiency(blocks, t) {
  const N = Array.from({ length: t }, () => new Array(blocks.length).fill(0));
  blocks.forEach((b, j) => b.forEach(i => { N[i][j]++; }));
  const r = N.map(row => row.reduce((a, x) => a + x, 0)), k = blocks.map(b => b.length);
  if (r.some(x => x === 0)) throw new Error('every treatment must appear in some block');
  const C = Array.from({ length: t }, (_, i) => Array.from({ length: t }, (_, l) => (i === l ? r[i] : 0) - N[i].reduce((a, x, j) => a + x * N[l][j] / k[j], 0)));
  const s = r.map(Math.sqrt);
  const W = C.map((row, i) => row.map((x, l) => x / (s[i] * s[l])));
  const ev = eigSym(W).values.slice().sort((a, b) => b - a);
  const factors = ev.slice(0, t - 1).map(x => Math.max(0, Math.min(1, x)));
  const connected = factors.every(x => x > 1e-9);
  const efficiency = connected ? (t - 1) / factors.reduce((a, x) => a + 1 / x, 0) : 0;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < t; i++) for (let l = i + 1; l < t; l++) { const c = N[i].reduce((a, x, j) => a + Math.min(x, N[l][j]), 0); min = Math.min(min, c); max = Math.max(max, c); }
  const binary = N.every(row => row.every(x => x <= 1));
  return { efficiency, factors, connected, balanced: binary && min === max && new Set(r).size === 1 && new Set(k).size === 1, r, k, concurrence: { min, max } };
}

const choose = (n, k) => { let c = 1; for (let i = 0; i < k; i++) c = c * (n - i) / (i + 1); return Math.round(c); };

function* subsets(t, k, start = 0, cur = []) {
  if (cur.length === k) { yield cur.slice(); return; }
  for (let i = start; i <= t - (k - cur.length); i++) { cur.push(i); yield* subsets(t, k, i + 1, cur); cur.pop(); }
}

/** The numbers of blocks b for which (t, k) can be balanced: r = bk/t and λ = r(k − 1)/(t − 1) whole, b ≥ t. */
export function bibdSizes(t, k, { max = choose(t, k) } = {}) {
  const out = [];
  for (let b = t; b <= max; b++) {
    if ((b * k) % t) continue;
    const r = b * k / t;
    if ((r * (k - 1)) % (t - 1)) continue;
    out.push({ b, r, lambda: r * (k - 1) / (t - 1) });
  }
  return out;
}

// search for b blocks of size k over t treatments, each treatment r times, with equal concurrences:
// swaps of treatments between blocks that lower Σ (λ_il − λ)², from seeded random starts
function searchBlocks(t, k, b, g, { restarts = 30, maxSweeps = 400 } = {}) {
  const r = b * k / t, lam = r * (k - 1) / (t - 1);
  let best = null;
  for (let s = 0; s < restarts; s++) {
    // a start: each treatment r times, dealt into blocks with no repeats (repaired by swaps)
    const cells = g.shuffle([...Array(t).keys()].flatMap(i => new Array(r).fill(i)));
    const B = Array.from({ length: b }, (_, j) => cells.slice(j * k, j * k + k));
    const lamM = Array.from({ length: t }, () => new Array(t).fill(0));
    const count = (blk, d) => { for (let x = 0; x < k; x++) for (let y = x + 1; y < k; y++) { const a = blk[x], c = blk[y]; lamM[a][c] += d; lamM[c][a] += d; } };
    B.forEach(blk => count(blk, 1));
    // the score: squared deviations from λ, with repeats in a block (λ_ii) heavily penalised
    const score = () => { let f = 0; for (let i = 0; i < t; i++) { f += 100 * lamM[i][i] ** 2; for (let l = i + 1; l < t; l++) f += (lamM[i][l] - lam) ** 2; } return f; };
    let cur = score();
    for (let sweep = 0; sweep < maxSweeps && cur > 0; sweep++) {
      let improved = false;
      for (let j1 = 0; j1 < b && cur > 0; j1++) for (let j2 = j1 + 1; j2 < b && cur > 0; j2++) for (let x = 0; x < k; x++) for (let y = 0; y < k; y++) {
        const a = B[j1][x], c = B[j2][y];
        if (a === c) continue;
        count(B[j1], -1); count(B[j2], -1);
        B[j1][x] = c; B[j2][y] = a;
        count(B[j1], 1); count(B[j2], 1);
        const nv = score();
        if (nv < cur) { cur = nv; improved = true; break; }
        count(B[j1], -1); count(B[j2], -1);
        B[j1][x] = a; B[j2][y] = c;
        count(B[j1], 1); count(B[j2], 1);
      }
      if (!improved) {
        // a random swap to leave a local minimum (only between blocks where it creates no repeat)
        for (let tries = 0; tries < 50; tries++) {
          const j1 = g.int(b), j2 = g.int(b), x = g.int(k), y = g.int(k), a = B[j1][x], c = B[j2][y];
          if (j1 === j2 || a === c || B[j1].includes(c) || B[j2].includes(a)) continue;
          count(B[j1], -1); count(B[j2], -1); B[j1][x] = c; B[j2][y] = a; count(B[j1], 1); count(B[j2], 1);
          cur = score();
          break;
        }
      }
    }
    const blocks = B.map(blk => blk.slice().sort((p, q) => p - q));
    if (blocks.every(blk => new Set(blk).size === k)) {
      const e = blockEfficiency(blocks, t);
      if (!best || e.efficiency > best.e.efficiency + 1e-12) best = { blocks, e };
      if (e.balanced) return best;
    }
  }
  return best;
}

/**
 * A balanced incomplete block design: t treatments in blocks of k < t, each treatment r times,
 * every pair of treatments together in λ blocks. opts: blocks (b; default the smallest b for which
 * a balanced design is found), seed. With b given and no balanced design found, the most
 * efficient design found is returned with balanced: false. Treatments are given to the symbols
 * at random, and the blocks and the runs within them are put in random order (toStudyDesign).
 */
export function bibd(t, k, { blocks, seed = 1, restarts } = {}) {
  check(t, 'incomplete blocks');
  if (!Number.isInteger(k) || k < 2 || k >= t) throw new Error(`block size: a whole number from 2 to ${t - 1} (a block of ${t} is a complete block)`);
  const g = rng(seed);
  const all = choose(t, k);
  let found = null;
  if (blocks !== undefined) {
    if (!Number.isInteger(blocks) || (blocks * k) % t) throw new Error(`${blocks} blocks of ${k}: each treatment must appear equally often, so blocks × ${k} must be a multiple of ${t}`);
    if (blocks === all) found = { blocks: [...subsets(t, k)] };
    else found = searchBlocks(t, k, blocks, g, { restarts });
  } else {
    for (const { b } of bibdSizes(t, k)) {
      if (b === all) { found = { blocks: [...subsets(t, k)] }; break; }
      const s = searchBlocks(t, k, b, g, { restarts });
      if (s?.e.balanced) { found = s; break; }
    }
    if (!found) found = { blocks: [...subsets(t, k)] };
  }
  if (!found) throw new Error(`no design found with ${blocks} blocks of ${k}`);
  const e = blockEfficiency(found.blocks, t);
  const labels = g.shuffle([...Array(t).keys()]), c = code(t);
  const X = [], block = [];
  found.blocks.forEach((blk, j) => blk.forEach(i => { X.push([c(labels[i])]); block.push(j + 1); }));
  const b = found.blocks.length, r = e.r[0];
  return {
    kind: 'bibd', levels: [t], X, runKind: X.map(() => 'factorial'), block,
    params: { treatments: t, blockSize: k, blocks: b, replicates: r, ...(e.balanced ? { lambda: r * (k - 1) / (t - 1) } : {}), balanced: e.balanced, efficiency: e.efficiency,
      layout: found.blocks.map(blk => blk.map(i => labels[i] + 1).sort((p, q) => p - q)) },
  };
}
