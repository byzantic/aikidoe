// Response-surface designs (spec §5, issue #9): central composite (CCD) and Box–Behnken
// designs, scaled prediction variance, and centre-point recommendations.
//
//   ccd(k, opts)                      central composite design in coded units
//   boxBehnken(k, opts)               Box–Behnken design, k = 3 … 7
//   cubeBlockAlpha, rotatableAlpha    the α rules (also used by ccd)
//   predictionVariance(X, opts)       x ↦ N · f(x)ᵀ (FᵀF)⁻¹ f(x) for a quadratic (or given) model
//   varianceProfile(X, opts)          min / mean / max scaled prediction variance on spheres
//   uniformPrecisionCentre(k, opts)   centre points giving the same variance at the centre and at ρ = 1
//
// Designs are returned in the same form as factorial.js (coded X, runKind, block), so
// toStudyDesign converts them to study runs. All factors must be continuous.
import * as T from './twolevel.js';
import { CATALOGUE } from './catalogue.js';
import { chooseBlockGenerators } from './factorial.js';
import { rng } from './rng.js';
import { cholInverse, chol, crossprod, qr } from '../linalg.js';

const popcount = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };

// ---------------------------------------------------------------- α rules

/** Rotatable α = n_F^(1/4), n_F the number of cube points (Box & Hunter 1957). */
export const rotatableAlpha = (nF) => nF ** 0.25;

/**
 * α for orthogonal blocking (Box & Hunter 1957; as R rsm computes it): the axial block's
 * second moment equals each cube block's, so blocks are orthogonal to the quadratic model:
 * α = √( (2k + n0a) · (nFb / (nFb + n0c)) / 2 ), with nFb cube points and n0c centre points in a
 * cube block, n0a centre points in the axial block.
 */
export const cubeBlockAlpha = (k, nFb, n0c, n0a) => Math.sqrt((2 * k + n0a) * (nFb / (nFb + n0c)) / 2);

// ---------------------------------------------------------------- CCD

/**
 * Central composite design for k continuous factors, in coded units.
 * opts:
 *   alpha: 'rotatable' (default unblocked) | 'orthogonal' (default when blocked: orthogonal
 *          blocking; unblocked: uncorrelated quadratic coefficients) | 'spherical' (√k) |
 *          'faces' (1) | a number
 *   inscribed: true → scale so the axial points are at ±1 and the cube at ±1/α
 *   cubeRuns: runs in the cube portion (default 2^k; e.g. 16 for k = 5 uses the resolution V
 *             half fraction from the catalogue) or cubeGenerators: ['ABCD', …]
 *   centre: number (unblocked; default: uniform precision for rotatable, else 4) or
 *           [perCubeBlock, axialBlock] (blocked; default [4, 4] as R rsm)
 *   blocks: false (default) | true (cube block + axial block) | B (cube split into B − 1 blocks,
 *           B − 1 a power of 2, plus the axial block)
 */
export function ccd(k, opts = {}) {
  if (!Number.isInteger(k) || k < 2) throw new Error('a CCD needs at least 2 factors');
  // cube portion
  let cube, gens = [];
  if (opts.cubeGenerators) { cube = T.regularDesign(k - opts.cubeGenerators.length, opts.cubeGenerators); gens = opts.cubeGenerators; }
  else {
    const nF = opts.cubeRuns ?? 2 ** k, q = Math.log2(nF);
    if (!Number.isInteger(q) || q > k) throw new Error(`cubeRuns must be a power of 2 up to 2^${k}`);
    if (q === k) cube = T.regularDesign(k);
    else {
      const e = CATALOGUE[`${k}-${k - q}`];
      if (!e) throw new Error(`no catalogued ${nF}-run fraction for ${k} factors`);
      cube = T.regularDesign(q, e.gens); gens = e.gens;
    }
  }
  if (gens.length && T.resolution(cube) < 5)
    throw new Error(`the cube portion has resolution ${['', 'I', 'II', 'III', 'IV'][T.resolution(cube)]}: a CCD needs resolution V or more so the two-factor interactions are estimable`);
  const nF = cube.X.length;
  const blocked = !!opts.blocks;
  const nCubeBlocks = blocked ? (opts.blocks === true ? 1 : opts.blocks - 1) : 1;
  if (blocked && !Number.isInteger(Math.log2(nCubeBlocks))) throw new Error('blocks: the cube is split into a power-of-2 number of blocks (blocks = 2, 3, 5, 9, …)');
  const alphaRule = opts.alpha ?? (blocked ? 'orthogonal' : 'rotatable');
  let n0c, n0a;
  if (blocked) [n0c, n0a] = Array.isArray(opts.centre) ? opts.centre : [opts.centre ?? 4, opts.centre ?? 4];
  else {
    if (Array.isArray(opts.centre)) throw new Error('centre: give one number for an unblocked CCD');
    n0c = opts.centre ?? (alphaRule === 'rotatable' ? uniformPrecisionCentre(k, { cubeRuns: nF, cubeGenerators: opts.cubeGenerators }) : 4);
    n0a = 0;
  }
  const nFb = nF / nCubeBlocks;
  let alpha;
  if (typeof alphaRule === 'number') alpha = alphaRule;
  else alpha = { rotatable: rotatableAlpha(nF), orthogonal: cubeBlockAlpha(k, nFb, blocked ? n0c : n0c, blocked ? n0a : 0),
    spherical: Math.sqrt(k), faces: 1 }[alphaRule];
  if (!(alpha > 0)) throw new Error(`alpha must be 'rotatable', 'orthogonal', 'spherical', 'faces' or a positive number`);
  if (alphaRule === 'orthogonal' && !blocked) {
    // unblocked: "orthogonal" means uncorrelated quadratic coefficients (Myers & Montgomery):
    // α⁴ = (√(n_F N) − n_F)² / 4 with N = n_F + 2k + n0
    const N = nF + 2 * k + n0c;
    alpha = ((Math.sqrt(nF * N) - nF) ** 2 / 4) ** 0.25;
  }
  // cube blocks
  let cubeBlock = cube.X.map(() => 1), blockGenerators;
  if (nCubeBlocks > 1) {
    const bg = chooseBlockGenerators(cube, Math.log2(nCubeBlocks)).gens;
    blockGenerators = bg.map(T.maskToWord);
    cubeBlock = cube.X.map((_, r) => { let lab = 0; bg.forEach((g, j) => { if (popcount(r & g) % 2) lab |= 1 << j; }); return lab + 1; });
  }
  const X = [], block = [], runKind = [];
  const push = (row, b, kind) => { X.push(row); block.push(b); runKind.push(kind); };
  for (let b = 1; b <= nCubeBlocks; b++) {
    cube.X.forEach((r, i) => { if (cubeBlock[i] === b) push(r.slice(), b, 'factorial'); });
    for (let i = 0; i < n0c; i++) push(new Array(k).fill(0), b, 'centre');
  }
  const ab = blocked ? nCubeBlocks + 1 : 1;
  for (let j = 0; j < k; j++) for (const s of [-1, 1]) { const row = new Array(k).fill(0); row[j] = s * alpha; push(row, ab, 'axial'); }
  for (let i = 0; i < n0a; i++) push(new Array(k).fill(0), ab, 'centre');
  if (opts.inscribed) { for (const r of X) for (let j = 0; j < k; j++) r[j] /= alpha; }
  const params = {
    alpha: opts.inscribed ? 1 : alpha, alphaRule, inscribed: !!opts.inscribed, cubeRuns: nF,
    cubeGenerators: gens.length ? cube.cols.slice(cube.q).map((m, j) => `${T.factorName(cube.q + j)}=${T.maskToWord(m)}`) : [],
    centrePoints: blocked ? { perCubeBlock: n0c, axialBlock: n0a } : n0c,
    ...(blocked ? { blocks: nCubeBlocks + 1, ...(blockGenerators ? { cubeBlockGenerators: blockGenerators } : {}) } : {}),
    ...(opts.inscribed ? { cubeAt: 1 / alpha } : {}),
  };
  return { kind: 'ccd', params, levels: new Array(k).fill(2), X, block: blocked ? block : undefined, runKind, continuousOnly: true };
}

// ---------------------------------------------------------------- Box–Behnken

// Box & Behnken (1960) incomplete-block structures (the same tables as R rsm::bbd)
const BBD = {
  3: [[1, 2], [1, 3], [2, 3]],
  4: [[1, 2], [3, 4], [1, 4], [2, 3], [1, 3], [2, 4]],
  5: [[1, 2], [1, 3], [3, 4], [4, 5], [2, 5], [1, 4], [1, 5], [2, 3], [2, 4], [3, 5]],
  6: [[1, 2, 4], [2, 3, 5], [3, 4, 6], [1, 4, 5], [2, 5, 6], [1, 3, 6]],
  7: [[4, 5, 6], [1, 6, 7], [2, 5, 7], [1, 2, 4], [3, 4, 7], [1, 3, 5], [2, 3, 6]],
};

/**
 * Box–Behnken design for k = 3 … 7 factors. opts.centre: centre points per block (default 3);
 * opts.blocks: true for the orthogonal blocking of k = 4 (3 blocks) or k = 5 (2 blocks).
 */
export function boxBehnken(k, { centre = 3, blocks = false } = {}) {
  const sets = BBD[k];
  if (!sets) throw new Error('Box–Behnken designs are available for 3 to 7 factors');
  const m = sets[0].length, corners = [];
  for (let r = 0; r < 1 << m; r++) corners.push([...Array(m).keys()].map(i => (r >> i & 1 ? 1 : -1)));
  const X = [], runKind = [];
  for (const s of sets) for (const c of corners) { const row = new Array(k).fill(0); s.forEach((f, i) => { row[f - 1] = c[i]; }); X.push(row); runKind.push('factorial'); }
  let block, nb = 1;
  if (blocks) {
    if (k === 4) nb = 3; else if (k === 5) nb = 2; else throw new Error('Box–Behnken blocking is available for k = 4 (3 blocks) and k = 5 (2 blocks)');
    const per = X.length / nb;
    block = X.map((_, i) => Math.floor(i / per) + 1);
  }
  for (let b = 1; b <= nb; b++) for (let i = 0; i < centre; i++) { X.push(new Array(k).fill(0)); runKind.push('centre'); if (block) block.push(b); }
  return { kind: 'box-behnken', params: { centrePoints: centre, ...(block ? { blocks: nb } : {}) }, levels: new Array(k).fill(2), X, block, runKind, continuousOnly: true };
}

// ---------------------------------------------------------------- prediction variance

/** Full quadratic model terms in coded x: 1, x_i, x_i x_j (i < j), x_i². */
export function quadraticTerms(k) {
  const f = [() => 1];
  for (let i = 0; i < k; i++) f.push(x => x[i]);
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) f.push(x => x[i] * x[j]);
  for (let i = 0; i < k; i++) f.push(x => x[i] * x[i]);
  return f;
}

/**
 * Scaled prediction variance v(x) = N · f(x)ᵀ (FᵀF)⁻¹ f(x) of a design (coded rows) under a
 * model (default: full quadratic; or an array of term functions x ↦ value). With blocks,
 * block effects are included in the model (they do not affect v for orthogonally blocked
 * designs). Throws if the model is not estimable.
 */
export function predictionVariance(X, { terms, block } = {}) {
  const k = X[0].length, f = terms ?? quadraticTerms(k);
  const blockIds = block ? [...new Set(block)].sort((a, b) => a - b) : [];
  // block effects: indicators for blocks 2…B, centred so they do not change the intercept
  const bcols = blockIds.slice(1).map(b => (i) => (block[i] === b ? 1 : 0) - block.filter(x => x === b).length / block.length);
  const F = X.map((x, i) => [...f.map(t => t(x)), ...bcols.map(c => c(i))]);
  // rank check by QR first: Cholesky of a numerically singular FᵀF does not always fail
  if (qr(F).rank < F[0].length) throw new Error('the model is not estimable from this design');
  const L = chol(crossprod(F)).L;
  const M = cholInverse(L), N = X.length, p = f.length;
  return (x) => {
    const v = f.map(t => t(x));
    let s = 0;
    for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) s += v[i] * M[i][j] * v[j];
    return N * s;
  };
}

/**
 * Scaled prediction variance on spheres of radius ρ: { radius, min, mean, max } for each ρ,
 * over `directions` directions (the axes, the cube diagonals, then seeded random unit vectors).
 * A rotatable design has min = max at every radius.
 */
export function varianceProfile(X, { radii, directions = 200, seed = 1, ...rest } = {}) {
  const k = X[0].length, v = predictionVariance(X, rest);
  const rmax = Math.max(...X.map(r => Math.hypot(...r)));
  const rs = radii ?? [...Array(21).keys()].map(i => (i * rmax) / 20);
  const dirs = [];
  for (let j = 0; j < k; j++) { const d = new Array(k).fill(0); d[j] = 1; dirs.push(d); }
  for (let m = 0; m < Math.min(1 << k, 64); m++) dirs.push([...Array(k).keys()].map(i => ((m >> i & 1) ? 1 : -1) / Math.sqrt(k)));
  const g = rng(seed);
  while (dirs.length < directions) {
    // normal deviates by Box–Muller → uniform direction
    const d = [...Array(k)].map(() => Math.sqrt(-2 * Math.log(1 - g.random())) * Math.cos(2 * Math.PI * g.random()));
    const n = Math.hypot(...d); dirs.push(d.map(x => x / n));
  }
  return rs.map(r => {
    const vals = dirs.map(d => v(d.map(x => x * r)));
    return { radius: r, min: Math.min(...vals), mean: vals.reduce((a, b) => a + b, 0) / vals.length, max: Math.max(...vals) };
  });
}

/**
 * Number of centre points for a rotatable CCD with (near) uniform precision (Box & Hunter
 * 1957): the n0 for which the prediction variance at the centre is closest to that at ρ = 1,
 * with ρ in Box and Hunter's standardised units (each factor's second moment Σx²/N = 1), i.e. at
 * coded radius √((n_F + 2α²)/N). Reproduces their table (k = 2, 3, 4 → 5, 6, 7; 2^(5−1) → 6; …).
 */
export function uniformPrecisionCentre(k, { cubeRuns, cubeGenerators, max = 30 } = {}) {
  let best = 1, bestD = Infinity;
  for (let n0 = 1; n0 <= max; n0++) {
    const d = ccd(k, { cubeRuns, cubeGenerators, alpha: 'rotatable', centre: n0 });
    const v = predictionVariance(d.X), N = d.X.length, a = d.params.alpha, nF = d.params.cubeRuns;
    const e1 = new Array(k).fill(0); e1[0] = Math.sqrt((nF + 2 * a * a) / N);
    const diff = Math.abs(v(new Array(k).fill(0)) - v(e1));
    if (diff < bestD) { bestD = diff; best = n0; }
  }
  return best;
}
