// D-, I- and A-optimal designs by coordinate exchange (spec §5, issue #10).
//
// Coordinate exchange (Meyer & Nachtsheim 1995) changes one factor setting of one run at a time.
// For continuous factors each coordinate is optimised over its whole feasible interval — a grid
// then golden-section refinement — rather than over a few candidate levels, in the spirit of
// Hardin & Sloane's Gosset. Every trial change is evaluated in O(p²) by rank-one updates of
// (FᵀF)⁻¹; the inverse is refreshed from a Cholesky factor after each pass.
//
//   optimalDesign(study, opts)       → design object (coded X, as factorial.js) with diagnostics
//   compileModel(model, factors)     → { p, columns, f(row) } model vector in coded units
//   momentMatrix(compiled, factors, region)   I-criterion moments over the design region
//   designDiagnostics(compiled, F, …)          D/A/G efficiencies, I, FDS curve, correlations
//
// Rows are arrays in study factor order: coded values for continuous factors, level indices
// for categorical ones. The region is the coded cube [−1, 1]^k cut by the study's linear
// constraints (inequalities; equality / mixture constraints are not supported here).
import { parseFormula } from '../model/formula.js';
import { code, decode, effectCode, studyConstraints } from '../study.js';
import { chol, cholInverse, cholLogdet, crossprod } from '../linalg.js';
import { rng } from './rng.js';

// ---------------------------------------------------------------- model compilation

/**
 * Compile a parsed model for fast evaluation in coded units. Each column is described by its
 * dependence on each factor: a power of a continuous factor, or an effect-code column of a
 * categorical factor, so region moments can be computed factor by factor.
 */
export function compileModel(model, factors) {
  const idx = Object.fromEntries(factors.map((f, j) => [f.id, j]));
  const cols = [];                       // each: [{ j, pow } | { j, cat }]
  const names = [];
  if (model.intercept) { cols.push([]); names.push('(Intercept)'); }
  for (const t of model.terms) {
    let parts = [[]], labels = [''];
    for (const c of t.comps) {
      const opts = [];
      if (c.f !== undefined) {
        const j = idx[c.f], f = factors[j];
        if (f.type === 'categorical') f.levels.slice(1).forEach((l, q) => opts.push({ spec: [{ j, cat: q }], name: `${c.f}[${l}]` }));
        else opts.push({ spec: [{ j, pow: 1 }], name: c.f });
      } else opts.push({ spec: Object.entries(c.I).map(([id, pw]) => ({ j: idx[id], pow: pw })), name: `I(${Object.entries(c.I).map(([id, pw]) => (pw === 1 ? id : `${id}^${pw}`)).join('*')})` });
      const np = [], nl = [];
      for (const o of opts) for (let a = 0; a < parts.length; a++) { np.push(parts[a].concat(o.spec)); nl.push(labels[a] ? `${labels[a]}:${o.name}` : o.name); }
      parts = np; labels = nl;
    }
    // merge repeated factors within a column (e.g. A:I(A^2) → A³)
    for (let a = 0; a < parts.length; a++) {
      const m = new Map();
      for (const s of parts[a]) { const key = s.cat !== undefined ? `c${s.j}` : `p${s.j}`; if (s.pow) m.set(key, { j: s.j, pow: (m.get(key)?.pow ?? 0) + s.pow }); else m.set(key, s); }
      cols.push([...m.values()]); names.push(labels[a]);
    }
  }
  const ecode = factors.map(f => (f.type === 'categorical' ? f.levels.map((_, i) => effectCode(f, i)) : null));
  const p = cols.length;
  const f = (row) => {
    const out = new Float64Array(p);
    for (let c = 0; c < p; c++) {
      let v = 1;
      for (const s of cols[c]) v *= s.cat !== undefined ? ecode[s.j][row[s.j]][s.cat] : row[s.j] ** s.pow;
      out[c] = v;
    }
    return out;
  };
  return { p, cols, columns: names, f, factors };
}

// ---------------------------------------------------------------- region and constraints

/** Per-factor domain: { type: 'continuous' } on [−1, 1], or { type: 'discrete', values }. */
function domains(factors) {
  return factors.map(f => {
    if (f.type === 'categorical') return { type: 'discrete', values: f.levels.map((_, i) => i), categorical: true };
    if (f.levels) return { type: 'discrete', values: f.levels.map(v => code(f, v)) };
    return { type: 'continuous' };
  });
}

function makeFeasibility(study) {
  const cons = studyConstraints(study);
  if (cons.some(c => c.op === '=')) throw new Error('equality (mixture) constraints are not supported by the optimal-design search yet');
  const F = study.factors;
  const natural = (row) => Object.fromEntries(F.map((f, j) => [f.id, f.type === 'categorical' ? null : decode(f, row[j])]));
  const ok = (row) => cons.every(c => {
    const v = c.units === 'coded' ? Object.fromEntries(F.map((f, j) => [f.id, row[j]])) : natural(row);
    let s = 0, sc = Math.abs(c.rhs); for (const [k, a] of Object.entries(c.coef)) { s += a * v[k]; sc += Math.abs(a * v[k]); }
    const t = 1e-9 * Math.max(1, sc);
    return c.op === '<=' ? s <= c.rhs + t : s >= c.rhs - t;
  });
  // feasible coded interval for factor j with the rest of the row fixed (monotone in each coordinate)
  const interval = (row, j) => {
    let lo = -1, hi = 1;
    for (const c of cons) {
      const a = c.coef[F[j].id];
      if (!a) continue;
      const v = c.units === 'coded' ? Object.fromEntries(F.map((f, q) => [f.id, row[q]])) : natural(row);
      let rest = 0; for (const [k, b] of Object.entries(c.coef)) if (k !== F[j].id) rest += b * v[k];
      // a·x_j (op) rhs − rest  →  bound on x_j in the constraint's units
      const bound = (c.rhs - rest) / a, upper = (c.op === '<=') === (a > 0);
      let cb;
      if (c.units === 'coded') cb = bound;
      else if (F[j].transform === 'log' && !(bound > 0)) cb = upper ? -Infinity : Infinity;
      else cb = code(F[j], bound);
      if (upper) hi = Math.min(hi, cb); else lo = Math.max(lo, cb);
    }
    return [lo, hi];
  };
  return { ok, interval, any: cons.length > 0 };
}

/** Random feasible row (rejection sampling in the cube). */
function randomRow(dom, feas, g) {
  for (let t = 0; t < 20000; t++) {
    const row = dom.map(d => (d.type === 'discrete' ? d.values[g.int(d.values.length)] : 2 * g.random() - 1));
    if (feas.ok(row)) return row;
  }
  throw new Error('the constraints leave (almost) no feasible region inside the factor ranges');
}

/**
 * Moment matrix W = E[f(x) f(x)ᵀ] over the region, x uniform: exact (factor by factor) when
 * there are no constraints, otherwise a seeded Monte Carlo average over feasible points.
 */
export function momentMatrix(cm, study, { samples = 20000, seed = 12345 } = {}) {
  const dom = domains(study.factors), feas = makeFeasibility(study), p = cm.p;
  const W = Array.from({ length: p }, () => new Array(p).fill(0));
  if (!feas.any) {
    const ecode = study.factors.map(f => (f.type === 'categorical' ? f.levels.map((_, i) => effectCode(f, i)) : null));
    for (let a = 0; a < p; a++) for (let b = a; b < p; b++) {
      let v = 1;
      for (let j = 0; j < study.factors.length && v !== 0; j++) {
        const sa = cm.cols[a].filter(s => s.j === j), sb = cm.cols[b].filter(s => s.j === j);
        if (!sa.length && !sb.length) continue;
        const d = dom[j];
        if (d.categorical) {
          const ca = sa[0]?.cat, cb = sb[0]?.cat, L = d.values.length;
          let e = 0; for (let l = 0; l < L; l++) e += (ca === undefined ? 1 : ecode[j][l][ca]) * (cb === undefined ? 1 : ecode[j][l][cb]);
          v *= e / L;
        } else {
          const n = (sa[0]?.pow ?? 0) + (sb[0]?.pow ?? 0);
          v *= d.type === 'discrete' ? d.values.reduce((s, x) => s + x ** n, 0) / d.values.length : (n % 2 ? 0 : 1 / (n + 1));
        }
      }
      W[a][b] = W[b][a] = v;
    }
    return { W, exact: true };
  }
  const g = rng(seed);
  for (let s = 0; s < samples; s++) {
    const v = cm.f(randomRow(dom, feas, g));
    for (let a = 0; a < p; a++) for (let b = a; b < p; b++) W[a][b] += v[a] * v[b];
  }
  for (let a = 0; a < p; a++) for (let b = a; b < p; b++) { W[a][b] /= samples; W[b][a] = W[a][b]; }
  return { W, exact: false, samples };
}

// ---------------------------------------------------------------- linear algebra helpers

const mv = (M, x) => { const p = x.length, out = new Float64Array(p); for (let i = 0; i < p; i++) { let s = 0; const r = M[i]; for (let j = 0; j < p; j++) s += r[j] * x[j]; out[i] = s; } return out; };
const dotv = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
function infoInverse(F, ridge) {
  const A = crossprod(F.map(r => Array.from(r)));
  for (let i = 0; i < A.length; i++) A[i][i] += ridge;
  const { L } = chol(A, { jitter: 1e-12 });
  return { M: cholInverse(L), logdet: cholLogdet(L) };
}
// M ← (A + s·g gᵀ)⁻¹ given M = A⁻¹ (Sherman–Morrison), s = ±1. If W and B = M W M are given,
// B is updated in O(p²) as well: with c = s/d, B′ = B − c(v uᵀ + u vᵀ) + c² (uᵀWu) u uᵀ, v = M W u.
function rank1(M, g, s, W, B) {
  const u = mv(M, g), d = 1 + s * dotv(g, u), c = s / d, p = u.length;
  let v, w;
  if (B) { const Wu = mv(W, u); v = mv(M, Wu); w = dotv(u, Wu); }
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) M[i][j] -= c * u[i] * u[j];
  if (B) for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) B[i][j] += -c * (v[i] * u[j] + u[i] * v[j]) + c * c * w * u[i] * u[j];
}

// ---------------------------------------------------------------- criterion changes

/**
 * Criterion change when row f is replaced by g. prepare(f) does the work that depends only on
 * f (once per coordinate line search); the returned function then costs one (D) or two (I, A)
 * matrix-vector products per trial g.
 *   D: Fedorov's delta, det(A′)/det(A) = (1 + gᵀMg)(1 − fᵀMf) + (fᵀMg)²   (larger is better)
 *   I, A: trace(W A′⁻¹) by two Sherman–Morrison steps, with B = M W M      (smaller is better)
 */
function preparer(criterion, M, B, base) {
  if (criterion === 'D') return (f) => {
    const Mf = mv(M, f), ff = dotv(f, Mf);
    return (g) => { const fg = dotv(g, Mf), gg = dotv(g, mv(M, g)); return (1 + gg) * (1 - ff) + fg * fg; };
  };
  return (f) => {
    const Mf = mv(M, f), Bf = mv(B, f), ff = dotv(f, Mf), fBf = dotv(f, Bf);
    return (g) => {
      const Mg = mv(M, g), Bg = mv(B, g);
      const c1 = 1 + dotv(g, Mg), gMf = dotv(g, Mf), gBg = dotv(g, Bg), fBg = dotv(f, Bg);
      // A1 = A + g gᵀ: tr(W A1⁻¹) = base − gᵀBg / c1;  u = A1⁻¹ f = Mf − Mg·gMf / c1
      const t1 = base - gBg / c1, r = gMf / c1;
      const c2 = 1 - (ff - r * gMf);                        // 1 − fᵀu
      if (!(c2 > 1e-12)) return Infinity;                   // would make the design singular
      const uWu = fBf - 2 * r * fBg + r * r * gBg;          // uᵀ W u = fᵀBf − 2r fᵀBg + r² gᵀBg
      return t1 + uWu / c2;
    };
  };
}
const mm = (A, C) => { const p = A.length, out = Array.from({ length: p }, () => new Array(p).fill(0)); for (let i = 0; i < p; i++) for (let l = 0; l < p; l++) { const a = A[i][l]; if (a === 0) continue; for (let j = 0; j < p; j++) out[i][j] += a * C[l][j]; } return out; };

// ---------------------------------------------------------------- the search

/**
 * Optimal design for a study. opts:
 *   runs (required), model (formula right-hand side, default 'main'), criterion 'D' | 'I' | 'A'
 *   fixed: rows of natural settings that must be in the design (augmentation)
 *   candidates: rows of natural settings to choose from (row exchange instead of coordinate exchange)
 *   restarts (default 20), seed (default study.seed), grid (points per coordinate line search, default 9)
 */
export function optimalDesign(study, opts = {}) {
  const criterion = (opts.criterion ?? 'D').toUpperCase();
  if (!['D', 'I', 'A'].includes(criterion)) throw new Error(`criterion must be D, I or A`);
  const factors = study.factors, k = factors.length;
  const model = parseFormula(opts.model ?? 'main', factors);
  const cm = compileModel(model, factors), p = cm.p;
  const N = opts.runs;
  const fixed = (opts.fixed ?? []).map(s => factors.map(f => (f.type === 'categorical' ? f.levels.indexOf(s[f.id]) : code(f, s[f.id]))));
  if (!Number.isInteger(N) || N < p) throw new Error(`${N} runs cannot estimate ${p} model coefficients (need at least ${p})`);
  if (fixed.length > N) throw new Error('more fixed runs than runs');
  const dom = domains(factors), feas = makeFeasibility(study);
  const cands = opts.candidates ? opts.candidates.map(s => factors.map(f => (f.type === 'categorical' ? f.levels.indexOf(s[f.id]) : code(f, s[f.id])))).filter(r => feas.ok(r)) : null;
  if (cands && !cands.length) throw new Error('no candidate point satisfies the constraints');
  const W = criterion === 'I' ? momentMatrix(cm, study, opts.moments).W : criterion === 'A' ? Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => (i === j ? 1 : 0))) : null;
  const g = rng(opts.seed ?? study.seed);
  const restarts = opts.restarts ?? 20, grid = opts.grid ?? 9;
  const ridge = 1e-8 * N;
  const score = (F) => { // smaller is better for every criterion
    const { M, logdet } = infoInverse(F, 0);
    if (criterion === 'D') return -logdet;
    let t = 0; for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) t += W[a][b] * M[b][a];
    return t;
  };
  let best = null, bestScore = Infinity, passes = 0;
  for (let rs = 0; rs < restarts; rs++) {
    // random start: fixed rows, then random feasible rows (or candidates)
    const X = fixed.map(r => r.slice());
    while (X.length < N) X.push(cands ? cands[g.int(cands.length)].slice() : randomRow(dom, feas, g));
    const F = X.map(r => cm.f(r));
    let { M } = infoInverse(F, ridge);
    let tr = 0, B = null, prep;
    // full refresh (after each pass): B = M W M from scratch; quick refresh after a change, when
    // M and B have been updated by rank-one steps
    const refresh = () => { if (W) { tr = traceOf(W, M); B = mm(mm(M, W), M); } prep = preparer(criterion, M, B, tr); };
    const quick = () => { if (W) tr = traceOf(W, M); prep = preparer(criterion, M, B, tr); };
    refresh();
    // a restart ends when a whole pass improves the criterion by less than 1e-6 (relative)
    const crit = () => (criterion === 'D' ? -infoInverse(F, ridge).logdet : tr);
    let before = crit();
    for (let pass = 0; pass < 100; pass++) {
      let improved = false;
      for (let i = fixed.length; i < N; i++) {
        if (cands) {
          // row exchange over the candidate set
          let bi = -1, bv = criterion === 'D' ? 1 + 1e-10 : tr * (1 - 1e-10);
          const ev = prep(F[i]);
          for (let c = 0; c < cands.length; c++) {
            const v = ev(cm.f(cands[c]));
            if (criterion === 'D' ? v > bv : v < bv) { bv = v; bi = c; }
          }
          if (bi >= 0) { const gv = cm.f(cands[bi]); rank1(M, gv, 1, W, B); rank1(M, F[i], -1, W, B); X[i] = cands[bi].slice(); F[i] = gv; quick(); improved = true; }
          continue;
        }
        for (let j = 0; j < k; j++) {
          const ev = prep(F[i]);
          const evalAt = (v) => { const row = X[i].slice(); row[j] = v; const gv = cm.f(row); const e = ev(gv); return { gv, v, c: criterion === 'D' ? -e : e }; };
          const cur = criterion === 'D' ? -1 : tr;
          let bestT = null;
          const consider = (v) => { const e = evalAt(v); if (!bestT || e.c < bestT.c) bestT = e; return e.c; };
          if (dom[j].type === 'discrete') { for (const v of dom[j].values) { const row = X[i].slice(); row[j] = v; if (feas.ok(row)) consider(v); } }
          else {
            const [lo, hi] = feas.interval(X[i], j);
            if (!(hi >= lo)) continue;
            const pts = [...Array(grid).keys()].map(t => lo + (hi - lo) * t / (grid - 1));
            const vals = pts.map(consider);
            // golden-section refinement around the best grid point
            const m = vals.indexOf(Math.min(...vals));
            let a = pts[Math.max(0, m - 1)], b = pts[Math.min(grid - 1, m + 1)];
            const gr = (Math.sqrt(5) - 1) / 2;
            let c1 = b - gr * (b - a), c2 = a + gr * (b - a), f1 = consider(c1), f2 = consider(c2);
            for (let it = 0; it < 16 && b - a > 1e-5; it++) {
              if (f1 < f2) { b = c2; c2 = c1; f2 = f1; c1 = b - gr * (b - a); f1 = consider(c1); }
              else { a = c1; c1 = c2; f1 = f2; c2 = a + gr * (b - a); f2 = consider(c2); }
            }
          }
          if (bestT && bestT.c < cur - 1e-10 * Math.max(1, Math.abs(cur))) {
            rank1(M, bestT.gv, 1, W, B); rank1(M, F[i], -1, W, B);
            X[i][j] = bestT.v; F[i] = bestT.gv;
            quick();
            improved = true;
          }
        }
      }
      // refresh the inverse to stop rounding drift
      ({ M } = infoInverse(F, ridge)); refresh();
      const after = crit();
      passes++;
      if (!improved || before - after < 1e-6 * Math.max(1, Math.abs(after))) break;
      before = after;
    }
    let sc;
    try { sc = score(F); } catch { continue; }      // singular end point: discard this start
    if (sc < bestScore) { bestScore = sc; best = X.map(r => r.slice()); }
  }
  if (!best) throw new Error('no nonsingular design found: the model may not be estimable over this region with these runs');
  // tidy: snap continuous coordinates within 1e-6 of the bounds or zero
  for (const r of best) r.forEach((v, j) => { if (dom[j].type === 'continuous') { if (Math.abs(v - 1) < 1e-6) r[j] = 1; else if (Math.abs(v + 1) < 1e-6) r[j] = -1; else if (Math.abs(v) < 1e-6) r[j] = 0; } });
  const F = best.map(r => cm.f(r));
  const diag = designDiagnostics(cm, F, study, { W });
  return {
    kind: 'optimal', coded: true, levels: factors.map(f => (f.type === 'categorical' ? f.levels.length : 2)),
    X: best.map(r => r.map((v, j) => (dom[j].categorical ? (factors[j].levels.length === 2 ? 2 * v - 1 : v) : v))),
    runKind: best.map((_, i) => (i < fixed.length ? 'factorial' : 'optimal')),
    params: { criterion, model: opts.model ?? 'main', runs: N, fixedRuns: fixed.length, restarts, passes, ...(cands ? { candidates: cands.length } : {}),
      ...Object.fromEntries(Object.entries(diag).filter(([k2]) => ['dEfficiency', 'aEfficiency', 'gEfficiency', 'averageVariance', 'logDet'].includes(k2))) },
    diagnostics: diag, compiled: cm,
  };
}

const traceOf = (W, M) => { let t = 0; for (let a = 0; a < W.length; a++) for (let b = 0; b < W.length; b++) t += W[a][b] * M[b][a]; return t; };

// ---------------------------------------------------------------- diagnostics

/**
 * Efficiencies and related diagnostics of model matrix F (rows of compiled model vectors):
 *   dEfficiency = 100 |FᵀF|^(1/p) / N, aEfficiency = 100 p / (N tr (FᵀF)⁻¹),
 *   gEfficiency = 100 √(p / (N max_x d(x))) with d(x) = f(x)ᵀ (FᵀF)⁻¹ f(x) maximised over the
 *     cube's 3^k grid (k ≤ 8) or sampled points, plus the design points,
 *   averageVariance = tr(W (FᵀF)⁻¹) (I-criterion, σ = 1),
 *   fds: quantiles of d(x) over sampled points (fraction-of-design-space curve),
 *   correlations: |corr| between model columns (intercept excluded).
 */
export function designDiagnostics(cm, F, study, { W, samples = 4000, seed = 7 } = {}) {
  const N = F.length, p = cm.p;
  const { M, logdet } = infoInverse(F, 0);
  const dEfficiency = 100 * Math.exp(logdet / p) / N;
  let trM = 0; for (let i = 0; i < p; i++) trM += M[i][i];
  const aEfficiency = 100 * p / (N * trM);
  const Wm = W ?? momentMatrix(cm, study).W;
  const averageVariance = traceOf(Wm, M);
  const dom = domains(study.factors), feas = makeFeasibility(study), k = dom.length;
  const d = (row) => { const v = cm.f(row); return dotv(v, mv(M, v)); };
  // points for G: a 3-level grid (or sample) of the feasible region, plus random points
  const pts = [];
  const levelsOf = (dj) => (dj.type === 'discrete' ? dj.values : [-1, 0, 1]);
  const gridSize = dom.reduce((a, dj) => a * levelsOf(dj).length, 1);
  if (gridSize <= 6561) {
    const rec = (j, row) => { if (j === k) { if (feas.ok(row)) pts.push(row.slice()); return; } for (const v of levelsOf(dom[j])) { row[j] = v; rec(j + 1, row); } };
    rec(0, new Array(k));
  }
  const g = rng(seed), sample = [];
  for (let s = 0; s < samples; s++) sample.push(randomRow(dom, feas, g));
  const dvals = sample.map(d);
  const gmax = Math.max(...pts.map(d), ...dvals);
  const gEfficiency = 100 * Math.sqrt(p / (N * gmax));
  const sorted = dvals.slice().sort((a, b) => a - b);
  const fds = [...Array(21).keys()].map(i => ({ fraction: i / 20, variance: sorted[Math.min(sorted.length - 1, Math.round(i / 20 * (sorted.length - 1)))] }));
  // correlations between model columns
  const cols = cm.columns.map((_, c) => F.map(r => r[c]));
  const start = cm.columns[0] === '(Intercept)' ? 1 : 0;
  const corr = [];
  for (let a = start; a < p; a++) {
    const row = [];
    for (let b = start; b < p; b++) row.push(Math.abs(pearson(cols[a], cols[b])));
    corr.push(row);
  }
  return { dEfficiency, aEfficiency, gEfficiency, averageVariance, logDet: logdet, maxVariance: gmax, fds, correlations: { names: cm.columns.slice(start), r: corr } };
}

function pearson(x, y) {
  const n = x.length, mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : (sxx === 0 && syy === 0 ? 1 : 0);
}

/** Evaluate a set of natural-unit rows (e.g. another program's design) with the same criteria. */
export function evaluateDesign(study, rows, { model = 'main', criterion } = {}) {
  const factors = study.factors, cm = compileModel(parseFormula(model, factors), factors);
  const F = rows.map(s => cm.f(factors.map(f => (f.type === 'categorical' ? f.levels.indexOf(s[f.id]) : code(f, s[f.id])))));
  return designDiagnostics(cm, F, study, criterion === 'I' ? {} : {});
}
