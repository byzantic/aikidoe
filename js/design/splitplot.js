// Split-plot designs (spec §5, §7; issue #14).
//
// A split-plot design has hard-to-change (htc, whole-plot) factors that are set once for a group
// of consecutive runs — a whole plot (a furnace run, a batch) — and easy-to-change (subplot)
// factors varied run to run inside it. Randomisation is restricted: whole plots in random order,
// runs in random order within each whole plot. Whole-plot effects are then estimated against the
// larger whole-plot variance, so the design and the analysis (REML, #15) must know the plots.
//
//   splitPlotFraction(htc, { runs, wholePlots, replicates, names })  regular 2^((k1+k2)−(p1+p2))
//       minimum aberration among designs whose whole-plot factors are constant within whole plots
//       (Huang, Chen & Voelkel 1998; Bingham & Sitter 1999)
//   splitPlotFull(levels, htc, { replicates, replicateBlocks })        full factorial in whole plots
//   optimalSplitPlot(study, { runs, wholePlots, model, eta, … })      D-optimal by coordinate
//       exchange on the GLS information for an assumed η = σ²_wp / σ² (Goos & Vandebroek 2003,
//       Jones & Goos 2007)
//   splitPlotLogDet(F, wholePlot, eta)                               log |Xᵀ V⁻¹ X| (σ² = 1)
//
// Designs are returned in the form of factorial.js ({ kind, params, levels, X, runKind, … })
// plus wholePlot: [label per run]; toStudyDesign randomises them as split-plots.
import { compileModel } from './optimal.js';
import { parseFormula } from '../model/formula.js';
import { rng } from './rng.js';
import { chol, cholLogdet, cholInverse } from '../linalg.js';
import { fullFactorial } from './factorial.js';

const popcount = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };
const log2i = (n, what) => { const b = Math.log2(n); if (!Number.isInteger(b) || b < 0) throw new Error(`${what} must be a power of 2, got ${n}`); return b; };
const binom = (n, r) => { let x = 1; for (let i = 0; i < r; i++) x = x * (n - i) / (i + 1); return Math.round(x); };

// ---------------------------------------------------------------- regular fractions

// Word-length pattern. With every base column a factor, words correspond to subsets S of the
// generated factors: the XOR of S gives the word S ∪ {base factors of its bits}. Base columns
// that carry no factor (an extra whole-plot column when there are fewer whole-plot factors than
// whole-plot base columns) count as pseudo-factors in the search, as FrF2 does — otherwise the
// search would happily alias effects with whole-plot contrasts. With realOnly, words touching
// them are skipped: the pattern among the real factors, for reporting.
function wlpMasks(k, basis, gens, realOnly = false) {
  const A = new Array(k + 31).fill(0), p = gens.length;
  let m = 0, inSet = 0, size = 0;
  for (let s = 1; s < 1 << p; s++) {
    const j = 31 - Math.clz32(s & -s);
    m ^= gens[j]; inSet ^= 1 << j; size += (inSet >> j & 1) ? 1 : -1;
    if (realOnly && (m & ~basis) !== 0) continue;
    A[size + popcount(m) - 1]++;
  }
  let n = A.length; while (n > k && !A[n - 1]) n--;
  return A.slice(0, Math.max(n, k));
}
const cmpWLP = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; };

/**
 * Regular two-level split-plot fraction. htc: boolean per factor (true = whole-plot factor);
 * runs = 2^q, wholePlots = 2^q1 (each of 2^(q−q1) runs). Whole-plot factors use only the q1
 * whole-plot base columns (so they are constant within whole plots); each subplot factor
 * involves at least one of the q − q1 subplot base columns. Among such designs the generators
 * minimise aberration (lexicographic word-length pattern), by exhaustive search when small,
 * otherwise by seeded swap descent from many starts. names: factor ids for the reported
 * generators and words. replicates: whole design repeated, new whole plots each time.
 */
export function splitPlotFraction(htc, { runs, wholePlots, replicates = 1, names, generators, exhaustiveLimit = 300000, restarts = 300, seed = 1 } = {}) {
  const k = htc.length, wpIdx = htc.map((h, j) => (h ? j : -1)).filter(j => j >= 0), spIdx = htc.map((h, j) => (h ? -1 : j)).filter(j => j >= 0);
  const k1 = wpIdx.length, k2 = spIdx.length;
  if (!k1) throw new Error('a split-plot design needs at least one hard-to-change factor');
  if (!k2) throw new Error('every factor is hard to change: each run is its own whole plot, so use an ordinary design');
  const q = log2i(runs, 'runs'), q1 = log2i(wholePlots, 'whole plots');
  if (q1 < 1 || q1 >= q) throw new Error(`${wholePlots} whole plots in ${runs} runs: need at least 2 whole plots and at least 2 runs in each`);
  if (k1 > (1 << q1) - 1) throw new Error(`${k1} whole-plot factors need more than ${wholePlots} whole plots`);
  if (k2 > (1 << q) - (1 << q1)) throw new Error(`${k2} subplot factors do not fit in ${runs} runs with ${wholePlots} whole plots`);
  const WP = (1 << q1) - 1;                                   // whole-plot bits
  const nb1 = Math.min(k1, q1), nb2 = Math.min(k2, q - q1);    // assigned basic columns
  const wpBasic = [...Array(nb1).keys()].map(b => 1 << b);
  const spBasic = [...Array(nb2).keys()].map(b => 1 << (q1 + b));
  const basis = [...wpBasic, ...spBasic].reduce((a, b) => a | b, 0);
  const p1 = k1 - nb1, p2 = k2 - nb2;
  let wpGens, spGens;
  if (generators) {
    // user generators as masks: { wp: [...], sp: [...] }
    ({ wp: wpGens = [], sp: spGens = [] } = generators);
    if (wpGens.length !== p1 || spGens.length !== p2) throw new Error(`need ${p1} whole-plot and ${p2} subplot generators`);
  } else {
    const wpC = [], spC = [];
    for (let m = 1; m < 1 << q; m++) {
      if (popcount(m) < 2) continue;
      if ((m & ~WP) === 0) wpC.push(m); else spC.push(m);
    }
    if (p1 > wpC.length || p2 > spC.length) throw new Error('these factors do not fit this split-plot structure');
    let best = null, bestW = null;
    const consider = (g1, g2) => {
      const g = [...g1, ...g2], w = wlpMasks(k, basis, g);
      if (!best || cmpWLP(w, bestW) < 0) { best = [g1.slice(), g2.slice()]; bestW = w; }
    };
    const combos = (arr, r, f) => {
      if (r === 0) { f([]); return; }
      const idx = [...Array(r).keys()];
      for (;;) {
        f(idx.map(i => arr[i]));
        let i = r - 1; while (i >= 0 && idx[i] === arr.length - r + i) i--;
        if (i < 0) break;
        idx[i]++; for (let j = i + 1; j < r; j++) idx[j] = idx[j - 1] + 1;
      }
    };
    if (binom(wpC.length, p1) * binom(spC.length, p2) <= exhaustiveLimit) combos(wpC, p1, g1 => combos(spC, p2, g2 => consider(g1, g2)));
    else {
      let a = seed >>> 0;
      const rnd = () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      const pick = (arr, r) => { const s = arr.slice(); for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } return s.slice(0, r); };
      for (let r = 0; r < restarts; r++) {
        let g1 = pick(wpC, p1), g2 = pick(spC, p2), w = wlpMasks(k, basis, [...g1, ...g2]);
        for (;;) {
          let move = null, mw = w;
          const used = new Set([...g1, ...g2]);
          const tryAt = (arr, cands, j, which) => { for (const c of cands) { if (used.has(c)) continue; const h = arr.slice(); h[j] = c; const hw = wlpMasks(k, basis, which ? [...g1, ...h] : [...h, ...g2]); if (cmpWLP(hw, mw) < 0) { move = [which, h]; mw = hw; } } };
          for (let j = 0; j < p1; j++) tryAt(g1, wpC, j, 0);
          for (let j = 0; j < p2; j++) tryAt(g2, spC, j, 1);
          if (!move) break;
          if (move[0]) g2 = move[1]; else g1 = move[1];
          w = mw;
        }
        if (!best || cmpWLP(w, bestW) < 0) { best = [g1.slice().sort((x, y) => x - y), g2.slice().sort((x, y) => x - y)]; bestW = w; }
      }
    }
    [wpGens, spGens] = best;
  }
  // factor masks in study order
  const masks = new Array(k);
  wpIdx.forEach((j, t) => { masks[j] = t < nb1 ? wpBasic[t] : wpGens[t - nb1]; });
  spIdx.forEach((j, t) => { masks[j] = t < nb2 ? spBasic[t] : spGens[t - nb2]; });
  const N = 1 << q;
  const base = [], wp = [];
  for (let i = 0; i < N; i++) {
    base.push(masks.map(m => (popcount(i & m) % 2 ? 1 : -1)));
    wp.push((i & WP) + 1);
  }
  const ids = names ?? [...Array(k).keys()].map(j => `F${j + 1}`);
  const nameOf = (m) => masks.map((x, j) => [x, j]).filter(([x]) => x === m).map(([, j]) => ids[j])[0];
  const basicName = (b) => nameOf(1 << b) ?? `w${b + 1}`;          // unassigned whole-plot columns
  const expr = (m) => { const parts = []; for (let b = 0; b < q; b++) if (m >> b & 1) parts.push(basicName(b)); return parts.join(':'); };
  const words = [];
  {
    const g = [...wpGens, ...spGens], gi = [...wpIdx.slice(nb1), ...spIdx.slice(nb2)];
    let m = 0, inSet = 0;
    for (let s = 1; s < 1 << g.length; s++) {
      const j = 31 - Math.clz32(s & -s); m ^= g[j]; inSet ^= 1 << j;
      if ((m & ~basis) !== 0) continue;
      const fs = []; g.forEach((_, t) => { if (inSet >> t & 1) fs.push(gi[t]); });
      for (let b = 0; b < q; b++) if (m >> b & 1) fs.push(masks.indexOf(1 << b));
      words.push(fs.sort((x, y) => x - y).map(j => ids[j]).join(':'));
    }
    words.sort((a, b) => a.split(':').length - b.split(':').length || a.localeCompare(b));
  }
  const wlp = wlpMasks(k, basis, [...wpGens, ...spGens], true).slice(0, k);
  const res = wlp.findIndex(a => a > 0);
  // effects up to order 2: alias chains and whether each is a whole-plot effect
  const effects = [];
  for (let a = 0; a < k; a++) effects.push({ name: ids[a], mask: masks[a] });
  for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) effects.push({ name: `${ids[a]}:${ids[b]}`, mask: masks[a] ^ masks[b] });
  const groups = new Map();
  for (const e of effects) { if (!groups.has(e.mask)) groups.set(e.mask, []); groups.get(e.mask).push(e.name); }
  // an effect whose column equals a product of unassigned whole-plot columns is confounded with
  // a contrast between whole plots
  for (const [m, g] of groups) if ((m & basis) === 0) g.push(`(whole-plot contrast ${expr(m)})`);
  const chains = [...groups.values()].filter(g => g.length > 1);
  const wholePlotEffects = effects.filter(e => (e.mask & ~WP) === 0).map(e => e.name);
  const params = {
    runs: N, wholePlots: 1 << q1, runsPerWholePlot: N >> q1, wholePlotFactors: wpIdx.map(j => ids[j]),
    generators: [...wpIdx.slice(nb1), ...spIdx.slice(nb2)].map(j => `${ids[j]}=${expr(masks[j])}`),
    definingRelation: words, wlp, resolution: res < 0 ? Infinity : res + 1, aliasChains: chains.map(c => c.join(' = ')), wholePlotEffects,
    // with k1 < q1 the extra whole-plot base columns carry no factor: they only separate whole plots
    ...(nb1 < q1 ? { unassignedWholePlotColumns: q1 - nb1, wlpWithPseudo: wlpMasks(k + q1 - nb1, basis, [...wpGens, ...spGens]).slice(0, k + q1 - nb1) } : {}),
  };
  return replicateWP({ kind: 'split-plot-fraction', params, levels: new Array(k).fill(2), X: base, runKind: base.map(() => 'fraction'), wholePlot: wp }, replicates);
}

function replicateWP(d, reps, replicateBlocks = false) {
  if (reps <= 1) return d;
  const n = d.X.length, W = Math.max(...d.wholePlot);
  return {
    ...d,
    X: Array.from({ length: reps }, () => d.X.map(r => r.slice())).flat(),
    runKind: Array.from({ length: reps }, () => d.runKind).flat(),
    wholePlot: [...Array(reps * n).keys()].map(i => d.wholePlot[i % n] + W * Math.floor(i / n)),
    ...(replicateBlocks ? { block: [...Array(reps * n).keys()].map(i => 1 + Math.floor(i / n)) } : d.block ? { block: Array.from({ length: reps }, () => d.block).flat() } : {}),
    params: { ...d.params, replicates: reps, wholePlots: W * reps },
  };
}

// ---------------------------------------------------------------- full factorial in whole plots

/**
 * Full factorial (two-level or mixed-level) with the htc factors' level combinations as whole
 * plots, each holding all combinations of the subplot factors. replicates: the whole design
 * repeated with new whole plots; replicateBlocks: each replicate is also a block (days, lots).
 */
export function splitPlotFull(levels, htc, { replicates = 1, replicateBlocks = false } = {}) {
  if (!htc.some(Boolean)) throw new Error('a split-plot design needs at least one hard-to-change factor');
  if (htc.every(Boolean)) throw new Error('every factor is hard to change: each run is its own whole plot, so use an ordinary design');
  const d = fullFactorial(levels, {});
  const keys = new Map();
  const wholePlot = d.X.map(r => { const key = r.filter((_, j) => htc[j]).join(','); if (!keys.has(key)) keys.set(key, keys.size + 1); return keys.get(key); });
  const n1 = keys.size;
  return replicateWP({ ...d, kind: 'split-plot-full', wholePlot, params: { ...d.params, wholePlots: n1, runsPerWholePlot: d.X.length / n1 } }, replicates, replicateBlocks);
}

// ---------------------------------------------------------------- optimal split-plot

/**
 * log |Xᵀ V⁻¹ X| with V = I + η Z Zᵀ (σ² = 1): Σ over whole plots w of Fᵂᵀ Fᵂ − c_w s_w s_wᵀ,
 * s_w = Fᵂᵀ 1, c_w = η / (1 + m_w η). F: model rows; wholePlot: label per row.
 */
export function splitPlotInfo(F, wholePlot, eta) {
  const p = F[0].length, M = Array.from({ length: p }, () => new Array(p).fill(0));
  const by = new Map(); F.forEach((r, i) => { const w = wholePlot[i]; if (!by.has(w)) by.set(w, []); by.get(w).push(r); });
  for (const rows of by.values()) {
    const c = eta / (1 + rows.length * eta), s = new Array(p).fill(0);
    for (const r of rows) for (let a = 0; a < p; a++) { s[a] += r[a]; for (let b = 0; b < p; b++) M[a][b] += r[a] * r[b]; }
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) M[a][b] -= c * s[a] * s[b];
  }
  return M;
}
export function splitPlotLogDet(F, wholePlot, eta) {
  try { return cholLogdet(chol(splitPlotInfo(F, wholePlot, eta)).L); } catch { return -Infinity; }
}

// det of a small matrix by elimination
function smallDet(A) {
  const n = A.length, M = A.map(r => r.slice()); let d = 1;
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (M[p][c] === 0) return 0;
    if (p !== c) { [M[p], M[c]] = [M[c], M[p]]; d = -d; }
    d *= M[c][c];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let q = c; q < n; q++) M[r][q] -= f * M[c][q]; }
  }
  return d;
}

/**
 * D-optimal split-plot design by coordinate exchange. opts: runs, wholePlots (equal sizes; runs
 * must be a multiple) or wholePlotSizes ([m1, m2, …]), model ('main'), eta (1), restarts (20),
 * seed, levels ({ factorId: [coded values] } to override the candidate levels: by default
 * −1, +1 for a continuous factor, and −1, 0, +1 when the model has its square).
 * Whole-plot (htc) factors change per whole plot, the others per run.
 */
export function optimalSplitPlot(study, opts = {}) {
  const factors = study.factors, k = factors.length;
  const htc = factors.map(f => !!f.htc);
  if (!htc.some(Boolean)) throw new Error('mark the hard-to-change factors first (a split-plot design needs at least one)');
  if (study.constraints?.length) throw new Error('constraints are not supported by the optimal split-plot search yet');
  const N = opts.runs;
  const sizes = opts.wholePlotSizes ?? (() => {
    const W = opts.wholePlots;
    if (!Number.isInteger(W) || W < 2) throw new Error('give the number of whole plots (at least 2)');
    if (!Number.isInteger(N) || N % W) throw new Error(`${N} runs do not divide into ${W} equal whole plots`);
    return new Array(W).fill(N / W);
  })();
  const total = sizes.reduce((a, b) => a + b, 0);
  if (N !== undefined && total !== N) throw new Error(`whole-plot sizes add up to ${total}, not ${N}`);
  const eta = opts.eta ?? 1;
  if (!(eta >= 0)) throw new Error('η must be ≥ 0');
  const modelText = opts.model ?? 'main';
  const model = parseFormula(modelText, factors);
  const cm = compileModel(model, factors), p = cm.p;
  if (total < p) throw new Error(`${total} runs cannot estimate ${p} model coefficients`);
  const squared = new Set(model.terms.flatMap(t => t.comps.flatMap(c => (c.I ? Object.entries(c.I).filter(([, pw]) => pw >= 2).map(([id]) => id) : []))));
  const values = factors.map(f => opts.levels?.[f.id] ?? (f.type === 'categorical' ? f.levels.map((_, i) => i) : squared.has(f.id) ? [-1, 0, 1] : [-1, 1]));
  // whole-plot fixed-effect df: the model must not need more whole-plot information than there are plots
  const W = sizes.length;
  const wpOf = []; sizes.forEach((m, w) => { for (let i = 0; i < m; i++) wpOf.push(w); });
  const g = rng(opts.seed ?? study.seed);
  const restarts = opts.restarts ?? 20;
  let best = null, bestLd = -Infinity;
  const randomDesign = () => {
    const wpRows = sizes.map(() => values.map((v, j) => (htc[j] ? v[g.int(v.length)] : null)));
    return wpOf.map(w => values.map((v, j) => (htc[j] ? wpRows[w][j] : v[g.int(v.length)])));
  };
  for (let rs = 0; rs < restarts; rs++) {
    let X = null, F, M, ld = -Infinity;
    for (let t = 0; t < 200 && !Number.isFinite(ld); t++) { X = randomDesign(); F = X.map(r => cm.f(r)); M = splitPlotInfo(F, wpOf, eta); ld = splitPlotLogDet(F, wpOf, eta); }
    if (!Number.isFinite(ld)) continue;
    let Minv = cholInverse(chol(M).L);
    const c = sizes.map(m => eta / (1 + m * eta));
    const sOf = (w) => { const s = new Array(p).fill(0); F.forEach((r, i) => { if (wpOf[i] === w) for (let a = 0; a < p; a++) s[a] += r[a]; }); return s; };
    for (let pass = 0; pass < 50; pass++) {
      let improved = false;
      const passStart = ld;
      // subplot coordinates: rank-4 update, det ratio by the matrix determinant lemma
      for (let i = 0; i < total; i++) for (let j = 0; j < k; j++) {
        if (htc[j]) continue;
        const w = wpOf[i], s = sOf(w), x = F[i];
        let bestV = null, bestR = 1 + 1e-9;
        for (const v of values[j]) {
          if (v === X[i][j]) continue;
          const row = X[i].slice(); row[j] = v; const xn = cm.f(row);
          const d = xn.map((t, a) => t - x[a]);
          // ΔM = xn xnᵀ − x xᵀ − c (s dᵀ + d sᵀ + d dᵀ) = U C Uᵀ with U = [xn, x, s, d]
          const U = [xn, x, s, d], C = [[1, 0, 0, 0], [0, -1, 0, 0], [0, 0, 0, -c[w]], [0, 0, -c[w], -c[w]]];
          const G = U.map(u => U.map(v2 => { let t = 0; for (let a = 0; a < p; a++) { let r = 0; for (let b = 0; b < p; b++) r += Minv[a][b] * v2[b]; t += u[a] * r; } return t; }));
          const K = C.map((row4, a) => row4.map((_, b) => (a === b ? 1 : 0) + C[a].reduce((acc, cv, e) => acc + cv * G[e][b], 0)));
          const ratio = smallDet(K);
          if (ratio > bestR) { bestR = ratio; bestV = { v, xn }; }
        }
        if (bestV) {
          // accept, guarding against an inaccurate inverse near singularity
          const oldV = X[i][j], oldF = F[i];
          X[i][j] = bestV.v; F[i] = bestV.xn;
          const M2 = splitPlotInfo(F, wpOf, eta);
          let L2 = null; try { L2 = chol(M2).L; } catch { /* singular */ }
          if (L2 && cholLogdet(L2) > ld + 1e-12 * Math.max(1, Math.abs(ld))) { M = M2; Minv = cholInverse(L2); ld = cholLogdet(L2); improved = true; }
          else { X[i][j] = oldV; F[i] = oldF; }
        }
      }
      // whole-plot coordinates: every run of the plot changes; full re-evaluation
      for (let w = 0; w < W; w++) for (let j = 0; j < k; j++) {
        if (!htc[j]) continue;
        const cur = splitPlotLogDet(F, wpOf, eta);
        let bestV = null, bestLdW = cur + 1e-9 * Math.max(1, Math.abs(cur));
        for (const v of values[j]) {
          const rows = []; X.forEach((r, i) => { if (wpOf[i] === w) rows.push(i); });
          if (v === X[rows[0]][j]) continue;
          const F2 = F.slice(); for (const i of rows) { const r = X[i].slice(); r[j] = v; F2[i] = cm.f(r); }
          const l2 = splitPlotLogDet(F2, wpOf, eta);
          if (l2 > bestLdW) { bestLdW = l2; bestV = { v, rows, F2 }; }
        }
        if (bestV) { for (const i of bestV.rows) X[i][j] = bestV.v; F = bestV.F2; M = splitPlotInfo(F, wpOf, eta); const L2 = chol(M).L; Minv = cholInverse(L2); ld = cholLogdet(L2); improved = true; }
      }
      const now = splitPlotLogDet(F, wpOf, eta);
      if (!improved || now - passStart < 1e-9 * Math.max(1, Math.abs(now))) { ld = now; break; }
      ld = now;
    }
    if (ld > bestLd) { bestLd = ld; best = X.map(r => r.slice()); }
  }
  if (!best) throw new Error('no nonsingular design found: the model may not be estimable with these whole plots and runs');
  const levels = factors.map(f => (f.type === 'categorical' ? f.levels.length : 2));
  return {
    kind: 'optimal-split-plot', coded: true, levels,
    X: best.map(r => r.map((v, j) => (factors[j].type === 'categorical' && factors[j].levels.length === 2 ? 2 * v - 1 : v))),
    runKind: best.map(() => 'optimal'), wholePlot: wpOf.map(w => w + 1),
    params: { criterion: 'D', model: modelText, runs: total, wholePlots: W, wholePlotSizes: sizes, eta, restarts, logDet: bestLd, dEfficiency: 100 * Math.exp(bestLd / p) / total, p },
  };
}
