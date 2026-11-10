// Where the runs sit in the factor space (issue #88): the runs in coded units, the scaled
// prediction variance of a design for a model over two factors, and the variance dispersion graph.
//
//   codedRuns(study, o)             the design's runs in coded units: { factors, runs: [{ run, x,
//                                   kind, block, wholePlot, count }] } — continuous factors coded
//                                   −1 … +1, categorical as level indices; count: runs at the same
//                                   point (replicates)
//   spvFunction(study, X, model)    x ↦ N · f(x)ᵀ (FᵀF)⁻¹ f(x), the scaled prediction variance of
//                                   the design X (coded rows) for a model (formula over the factor
//                                   ids, compiled as optimal.js does)
//   spvSlice(study, X, model, o)    that variance over a grid of two continuous factors, the others
//                                   held at o.at (coded; default the centre, or the first level)
//   vdg(study, X, model, o)         min, mean and max of it on spheres of radius ρ about the
//                                   centre (continuous factors only), as varianceProfile in rsm.js
//                                   for any model: the variance dispersion graph
//   feasibleSlice(study, o)         over the same grid, whether the study's linear constraints hold
//                                   (the other factors at o.at)
import { code, decode, parseConstraint, satisfies } from '../study.js';
import { compileModel } from './optimal.js';
import { parseFormula } from '../model/formula.js';
import { chol, cholInverse, crossprod, qr } from '../linalg.js';
import { rng } from './rng.js';

/** A run's settings → its coded row (continuous coded −1 … +1, categorical as level index). */
export const codedRow = (study, settings) => study.factors.map(f => (f.type === 'categorical' ? f.levels.indexOf(settings[f.id]) : code(f, settings[f.id])));

/**
 * The study's runs in coded units. opts.confirm (default true): include confirmation runs.
 * Runs at the same coded point share a count (replicates and repeated centre points).
 */
export function codedRuns(study, { confirm = true } = {}) {
  const runs = (study.design?.runs ?? []).filter(r => confirm || r.kind !== 'confirm').map(r => ({
    run: r.run, x: codedRow(study, r.settings), kind: r.kind ?? 'run',
    ...(r.block !== undefined ? { block: r.block } : {}), ...(r.wholePlot !== undefined ? { wholePlot: r.wholePlot } : {}),
  }));
  const key = (x) => x.map(v => (Number.isFinite(v) ? v.toFixed(9) : String(v))).join(',');
  const n = new Map();
  for (const r of runs) n.set(key(r.x), (n.get(key(r.x)) ?? 0) + 1);
  for (const r of runs) r.count = n.get(key(r.x));
  return { factors: study.factors.map(f => ({ id: f.id, name: f.name ?? f.id, type: f.type, ...(f.type === 'categorical' ? { levels: f.levels } : {}) })), runs };
}

/**
 * The scaled prediction variance of a design for a model: { v(x), p, N }. X: coded rows (as
 * codedRuns). Throws when the model is not estimable from the design.
 */
export function spvFunction(study, X, model = 'quadratic') {
  const cm = compileModel(typeof model === 'string' ? parseFormula(model, study.factors) : model, study.factors);
  const F = X.map(r => Array.from(cm.f(r)));
  if (F.length < cm.p || qr(F).rank < cm.p) throw new Error(`the model (${cm.p} terms) is not estimable from these ${F.length} runs`);
  const M = cholInverse(chol(crossprod(F)).L), N = X.length, p = cm.p;
  const v = (x) => {
    const f = cm.f(x);
    let s = 0;
    for (let i = 0; i < p; i++) { let t = 0; for (let j = 0; j < p; j++) t += M[i][j] * f[j]; s += f[i] * t; }
    return N * s;
  };
  return { v, p, N, columns: cm.columns };
}

/** The coded point the other factors are held at: o.at (coded values by factor id), else the centre (categorical: first level). */
const heldAt = (study, at = {}) => study.factors.map(f => (at[f.id] !== undefined ? at[f.id] : f.type === 'categorical' ? 0 : 0));

/** The coded range a grid should cover for factor j: −1 … +1, widened to the runs (axial points). */
function rangeOf(X, j) {
  const m = Math.max(1, ...X.map(r => Math.abs(r[j])).filter(Number.isFinite));
  return [-m, m];
}

/**
 * The scaled prediction variance over a grid of two continuous factors (indices or ids x, y), the
 * others held at opts.at (coded, by factor id). opts.n: grid points per side (default 41).
 * Returns { x, y, xs, ys, z: rows over ys of values over xs, min, max, at (the coded point) }.
 */
export function spvSlice(study, X, model, { x, y, at, n = 41 } = {}) {
  const ix = typeof x === 'number' ? x : study.factors.findIndex(f => f.id === x), iy = typeof y === 'number' ? y : study.factors.findIndex(f => f.id === y);
  for (const j of [ix, iy]) if (j < 0 || study.factors[j].type === 'categorical') throw new Error('choose two continuous factors');
  if (ix === iy) throw new Error('choose two different factors');
  const { v } = spvFunction(study, X, model), base = heldAt(study, at);
  const [x0, x1] = rangeOf(X, ix), [y0, y1] = rangeOf(X, iy);
  const xs = [...Array(n).keys()].map(i => x0 + (x1 - x0) * i / (n - 1)), ys = [...Array(n).keys()].map(i => y0 + (y1 - y0) * i / (n - 1));
  let min = Infinity, max = -Infinity;
  const z = ys.map(yv => xs.map(xv => { const p = base.slice(); p[ix] = xv; p[iy] = yv; const s = v(p); if (s < min) min = s; if (s > max) max = s; return s; }));
  return { x: study.factors[ix].id, y: study.factors[iy].id, ix, iy, xs, ys, z, min, max, at: base };
}

/**
 * The variance dispersion graph: { radius, min, mean, max } of the scaled prediction variance on
 * spheres about the centre, for a design of continuous factors. opts: radii (default 21 from 0 to
 * the farthest run), directions (200: the axes, the cube diagonals, then seeded random unit
 * vectors), seed.
 */
export function vdg(study, X, model = 'quadratic', { radii, directions = 200, seed = 1 } = {}) {
  if (study.factors.some(f => f.type === 'categorical')) throw new Error('the variance dispersion graph is for continuous factors');
  const k = study.factors.length, { v } = spvFunction(study, X, model);
  const rmax = Math.max(...X.map(r => Math.hypot(...r)));
  const rs = radii ?? [...Array(21).keys()].map(i => (i * rmax) / 20);
  // directions: a count, or the unit vectors themselves
  const dirs = Array.isArray(directions) ? directions.map(d => d.slice()) : [];
  if (!Array.isArray(directions)) {
    for (let j = 0; j < k; j++) { const d = new Array(k).fill(0); d[j] = 1; dirs.push(d); }
    for (let m = 0; m < Math.min(1 << k, 64); m++) dirs.push([...Array(k).keys()].map(i => ((m >> i & 1) ? 1 : -1) / Math.sqrt(k)));
  }
  const g = rng(seed);
  while (!Array.isArray(directions) && dirs.length < directions) {
    const d = [...Array(k)].map(() => Math.sqrt(-2 * Math.log(1 - g.random())) * Math.cos(2 * Math.PI * g.random()));
    const nn = Math.hypot(...d); dirs.push(d.map(t => t / nn));
  }
  return { directions: dirs, curves: rs.map(r => {
    const vals = dirs.map(d => v(d.map(t => t * r)));
    return { radius: r, min: Math.min(...vals), mean: vals.reduce((a, b) => a + b, 0) / vals.length, max: Math.max(...vals) };
  }) };
}

/**
 * Whether the study's linear constraints hold over a grid of two continuous factors (the others
 * at opts.at, coded): { xs, ys, ok: rows of booleans } — null when the study has no constraints.
 */
export function feasibleSlice(study, { x, y, at, n = 41, xs, ys } = {}) {
  if (!study.constraints?.length) return null;
  const ix = typeof x === 'number' ? x : study.factors.findIndex(f => f.id === x), iy = typeof y === 'number' ? y : study.factors.findIndex(f => f.id === y);
  const cons = study.constraints.map(c => parseConstraint(c.expr, study.factors.map(f => f.id)));
  const base = heldAt(study, at);
  xs ??= [...Array(n).keys()].map(i => -1 + 2 * i / (n - 1)); ys ??= [...Array(n).keys()].map(i => -1 + 2 * i / (n - 1));
  const ok = ys.map(yv => xs.map(xv => {
    const p = base.slice(); p[ix] = xv; p[iy] = yv;
    const s = Object.fromEntries(study.factors.map((f, j) => [f.id, f.type === 'categorical' ? f.levels[p[j]] : decode(f, p[j])]));
    return cons.every(c => satisfies(c, s));
  }));
  return { xs, ys, ok };
}
