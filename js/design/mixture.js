// Mixture designs and analysis (issue #62): formulations whose components add up to a total —
// a culture medium, a ceramic glaze, an alloy, a polymer blend.
//
//   simplexLattice(q, m), simplexCentroid(q)        points in pseudo-components (each row adds up to 1)
//   extremeVertices(study, { faces })               vertices of the constrained region (bounds and
//                                                   linear constraints on the components) and the
//                                                   centroids of its edges / faces and of the whole
//   mixtureCandidates(study, opts)                  vertices, centroids and axial check points
//   isSimplexRegion(study)                          is the region a simplex in pseudo-components?
//   optimalMixture(study, { model, runs, criterion, candidates, process })   point exchange (D / I)
//   mixtureDesign(study, opts)                      a design for the study: lattice, centroid,
//                                                   vertices or optimal; crossed with process factors
//   mixtureAnova(fit)                               linear blending (q − 1 df), then each further term
//   coxTrace(study, f, { at })                      the response along each component's Cox direction
//   ternaryGrid(study, f, { components, at, n })    a response over a three-component triangle
//   randomBlend(study, g), optimiseMixture(study, score, opts)   search over the feasible region
import { rng } from './rng.js';
import { studyConstraints, satisfies, feasible, decode } from '../study.js';
import { parseFormula, modelMatrix } from '../model/formula.js';
import { solve, inv } from '../linalg.js';
import { fDist } from '../dist.js';

// ---------------------------------------------------------------- the region

/** The mixture of a study: { ids, comps (factors), total, L (Σ lows), scale, process (other factors) }. */
export function mixtureOf(study) {
  const m = study.mixture;
  if (!m) throw new Error('the study has no mixture (mixture: { components, total })');
  const comps = m.components.map(id => study.factors.find(f => f.id === id));
  const L = comps.reduce((a, f) => a + f.low, 0);
  return { ids: m.components, comps, total: m.total, L, scale: m.total - L, process: study.factors.filter(f => !m.components.includes(f.id)) };
}
/** Pseudo-components ↔ actual proportions. */
export const toActual = (M, z) => M.comps.map((f, i) => f.low + M.scale * z[i]);
export const toPseudo = (M, x) => M.comps.map((f, i) => (x[i] - f.low) / M.scale);

/** Is the region the whole L-pseudo-component simplex (no upper bound or extra constraint cuts it)? */
export function isSimplexRegion(study) {
  const M = mixtureOf(study);
  return M.comps.every(f => f.high >= f.low + M.scale * (1 - 1e-12)) && !componentConstraints(study).length;
}
/** The study's linear constraints that involve only mixture components (natural units). */
function componentConstraints(study) {
  const ids = new Set(study.mixture.components);
  return studyConstraints(study).filter(c => c.units === 'natural' && Object.keys(c.coef).every(k => ids.has(k)));
}

/** The {q, m} simplex lattice: all proportions in steps of 1/m. */
export function simplexLattice(q, m) {
  const out = [];
  const rec = (pre, left) => { if (pre.length === q - 1) { out.push([...pre, left].map(v => v / m)); return; } for (let k = left; k >= 0; k--) rec([...pre, k], left - k); };
  rec([], m);
  return out;
}
/** The simplex centroid design: the centroid of every non-empty subset of components (2^q − 1 points). */
export function simplexCentroid(q) {
  const out = [];
  for (let s = 1; s < 2 ** q; s++) { const on = [...Array(q).keys()].filter(i => s & (1 << i)); out.push([...Array(q).keys()].map(i => (on.includes(i) ? 1 / on.length : 0))); }
  return out.sort((a, b) => a.filter(v => v > 0).length - b.filter(v => v > 0).length);
}

/**
 * Extreme vertices of the constrained region (actual units): every point where q − 1 independent
 * constraints (bounds, and linear constraints on the components) are active together with the
 * total, and which satisfies all of them. faces (default 1): also the centroids of the faces of
 * dimension 1 … faces (edges, 2-faces, …), and the overall centroid.
 * Returns { vertices: [{ x, active }], centroids: [{ x, dim }], overall }.
 */
export function extremeVertices(study, { faces = 1 } = {}) {
  const M = mixtureOf(study), q = M.ids.length;
  // constraints as a·x (op) b; bounds first
  const cons = [];
  M.comps.forEach((f, i) => { const a = Array(q).fill(0); a[i] = 1; cons.push({ a, b: f.low, op: '>=', key: `${f.id}>=` }); cons.push({ a: a.slice(), b: f.high, op: '<=', key: `${f.id}<=` }); });
  for (const c of componentConstraints(study)) cons.push({ a: M.ids.map(id => c.coef[id] ?? 0), b: c.rhs, op: c.op, key: c.expr });
  const ok = (x) => cons.every(c => { const s = c.a.reduce((t, v, i) => t + v * x[i], 0), tol = 1e-9 * M.total; return c.op === '<=' ? s <= c.b + tol : c.op === '>=' ? s >= c.b - tol : Math.abs(s - c.b) <= tol; });
  const activeOf = (x) => cons.map((c, k) => (Math.abs(c.a.reduce((t, v, i) => t + v * x[i], 0) - c.b) <= 1e-9 * M.total ? k : -1)).filter(k => k >= 0);
  const verts = [];
  const choose = (start, picked) => {
    if (picked.length === q - 1) {
      const A = [Array(q).fill(1), ...picked.map(k => cons[k].a)], b = [M.total, ...picked.map(k => cons[k].b)];
      let x; try { x = solve(A, b); } catch { return; }
      if (!x.every(Number.isFinite) || !ok(x)) return;
      x = x.map(v => (Math.abs(v) < 1e-12 * M.total ? 0 : +v.toPrecision(13)));
      if (!verts.some(v => v.x.every((u, i) => Math.abs(u - x[i]) <= 1e-9 * M.total))) verts.push({ x, active: activeOf(x) });
      return;
    }
    for (let k = start; k < cons.length; k++) choose(k + 1, [...picked, k]);
  };
  choose(0, []);
  if (!verts.length) throw new Error('the mixture constraints leave no feasible blend');
  // faces of dimension d: the vertices sharing q − 1 − d active constraints (at least d + 1 of them)
  const centroids = [], seen = new Set();
  for (let d = 1; d <= Math.min(faces, q - 2); d++) {
    const need = q - 1 - d;
    for (const v of verts) {
      const subsets = []; const rec = (s, pick) => { if (pick.length === need) { subsets.push(pick); return; } for (let i = s; i < v.active.length; i++) rec(i + 1, [...pick, v.active[i]]); };
      rec(0, []);
      for (const A of subsets) {
        const key = `${d}:${A.join(',')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const on = verts.filter(w => A.every(k => w.active.includes(k)));
        if (on.length < d + 1) continue;
        const x = M.ids.map((_, i) => on.reduce((t, w) => t + w.x[i], 0) / on.length);
        if (!centroids.some(c => c.x.every((u, i) => Math.abs(u - x[i]) <= 1e-9 * M.total))) centroids.push({ x, dim: d });
      }
    }
  }
  const overall = M.ids.map((_, i) => verts.reduce((t, w) => t + w.x[i], 0) / verts.length);
  return { vertices: verts, centroids, overall };
}

/**
 * Candidate blends for an optimal design (actual units): the vertices, the centroids of edges and
 * (q ≥ 4) 2-faces, the overall centroid, and axial check points half way from the centroid to each
 * vertex.
 */
export function mixtureCandidates(study, { faces } = {}) {
  const M = mixtureOf(study), q = M.ids.length;
  const ev = extremeVertices(study, { faces: faces ?? (q >= 4 ? 2 : 1) });
  const pts = [...ev.vertices.map(v => v.x), ...ev.centroids.map(c => c.x), ev.overall, ...ev.vertices.map(v => v.x.map((u, i) => (u + ev.overall[i]) / 2))];
  const out = [];
  for (const x of pts) if (!out.some(y => y.every((u, i) => Math.abs(u - x[i]) <= 1e-9 * M.total))) out.push(x);
  return out;
}

// ---------------------------------------------------------------- optimal designs

const logdet = (A) => {
  const n = A.length, L = A.map(() => new Array(n).fill(0));
  let s = 0;
  for (let j = 0; j < n; j++) {
    let d = A[j][j]; for (let k = 0; k < j; k++) d -= L[j][k] ** 2;
    if (!(d > 1e-10 * Math.max(1, Math.abs(A[j][j])))) return -Infinity;
    L[j][j] = Math.sqrt(d); s += Math.log(L[j][j]);
    for (let i = j + 1; i < n; i++) { let t = A[i][j]; for (let k = 0; k < j; k++) t -= L[i][k] * L[j][k]; L[i][j] = t / L[j][j]; }
  }
  return 2 * s;
};
const info = (rows) => { const p = rows[0].length, I = Array.from({ length: p }, () => new Array(p).fill(0)); for (const r of rows) for (let a = 0; a < p; a++) for (let b = 0; b <= a; b++) I[a][b] += r[a] * r[b]; for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) I[b][a] = I[a][b]; return I; };

/** Settings for a candidate: a blend (actual units) crossed with process settings. */
function candidateSettings(study, blends, process) {
  const M = mixtureOf(study);
  const procLevels = process === false || !M.process.length ? [{}] : M.process.reduce((acc, f) => acc.flatMap(a => (f.type === 'categorical' ? f.levels : (process?.levels ?? [-1, 1]).map(c => decode(f, c))).map(v => ({ ...a, [f.id]: v }))), [{}]);
  return blends.flatMap(x => procLevels.map(pv => ({ ...Object.fromEntries(M.ids.map((id, i) => [id, x[i]])), ...pv })));
}

/**
 * A D- or I-optimal design of runs runs from candidate blends (default mixtureCandidates) for a
 * model (default mixquadratic), by Fedorov point exchange from several random starts. Process
 * factors are crossed into the candidates at their low and high settings (process.levels to change).
 * Returns { settings: [runs], logdet, averageVariance, model, candidates }.
 */
export function optimalMixture(study, { model = 'mixquadratic', runs, criterion = 'D', candidates, process, restarts = 10, seed } = {}) {
  const cands = candidateSettings(study, candidates ?? mixtureCandidates(study), process);
  const parsed = parseFormula(model, study.factors);
  const X = modelMatrix(parsed, study.factors, cands).X, p = X[0].length;
  if (!(runs >= p)) throw new Error(`the model has ${p} coefficients: at least ${p} runs`);
  const g = rng((seed ?? study.seed) >>> 0);
  const Iavg = criterion === 'I' ? info(X).map(r => r.map(v => v / X.length)) : null;
  const score = (idx) => {
    const I = info(idx.map(i => X[i]));
    const ld = logdet(I);
    if (criterion !== 'I') return ld;
    if (!Number.isFinite(ld)) return -Infinity;
    const C = inv(I); let tr = 0;
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) tr += C[a][b] * Iavg[b][a];
    return -tr;
  };
  let best = null, bestS = -Infinity;
  for (let s = 0; s < restarts; s++) {
    let idx = Array.from({ length: runs }, () => g.int(X.length)), cur = score(idx);
    for (let tries = 0; !Number.isFinite(cur) && tries < 50; tries++) { idx = Array.from({ length: runs }, () => g.int(X.length)); cur = score(idx); }
    for (let pass = 0; pass < 30; pass++) {
      let improved = false;
      for (let i = 0; i < runs; i++) {
        let bi = idx[i];
        for (let c = 0; c < X.length; c++) {
          if (c === idx[i]) continue;
          const t = idx.slice(); t[i] = c;
          const v = score(t);
          if (v > cur + 1e-10) { cur = v; bi = c; improved = true; }
        }
        idx[i] = bi;
      }
      if (!improved) break;
    }
    if (cur > bestS) { bestS = cur; best = idx.slice(); }
  }
  if (!Number.isFinite(bestS)) throw new Error(`no ${runs}-run design from these candidates can estimate ${model}`);
  const I = info(best.map(i => X[i])), C = inv(I);
  const av = X.reduce((t, r) => t + r.reduce((u, v, a) => u + v * r.reduce((w, z, b) => w + C[a][b] * z, 0), 0), 0) / X.length;
  return { settings: best.sort((a, b) => a - b).map(i => cands[i]), logdet: logdet(I), averageVariance: av, model, candidates: cands.length };
}

/**
 * A mixture design for the study. kind: 'lattice' (degree m), 'centroid', 'vertices' (extreme
 * vertices and centroids) or 'optimal' (runs, model, criterion). Options: axial (add axial check
 * points, lattice and centroid), centre (overall-centroid replicates), replicates, process ('crossed':
 * each blend at every corner of the process factors; default when there are process factors),
 * seed. Lattice and centroid designs need a simplex region (in pseudo-components); otherwise use
 * vertices or optimal. Returns the study's design object (kind 'mixture'), runs in random order.
 */
export function mixtureDesign(study, { kind = 'lattice', degree = 2, axial = false, centre = 0, replicates = 1, runs, model, criterion, seed } = {}) {
  const M = mixtureOf(study), q = M.ids.length;
  let settings, params = { type: kind };
  if (kind === 'lattice' || kind === 'centroid') {
    if (!isSimplexRegion(study)) throw new Error('the region is not a simplex (upper bounds or constraints cut it): use extreme vertices or an optimal design');
    let Z = kind === 'lattice' ? simplexLattice(q, degree) : simplexCentroid(q);
    if (axial) Z = [...Z, ...Array.from({ length: q }, (_, i) => M.ids.map((_, j) => (j === i ? (q + 1) / (2 * q) : 1 / (2 * q))))];
    if (centre) Z = [...Z, ...Array.from({ length: centre }, () => M.ids.map(() => 1 / q))];
    settings = candidateSettings(study, Z.map(z => toActual(M, z)), study.mixture && M.process.length ? undefined : false);
    params = { ...params, ...(kind === 'lattice' ? { degree } : {}), axial: !!axial, centre };
  } else if (kind === 'vertices') {
    const ev = extremeVertices(study, { faces: q >= 4 ? 2 : 1 });
    let pts = [...ev.vertices.map(v => v.x), ...ev.centroids.map(c => c.x), ...Array.from({ length: Math.max(1, centre) }, () => ev.overall)];
    if (axial) pts = [...pts, ...ev.vertices.map(v => v.x.map((u, i) => (u + ev.overall[i]) / 2))];
    settings = candidateSettings(study, pts, undefined);
    params = { ...params, vertices: ev.vertices.length, centroids: ev.centroids.length, axial: !!axial };
  } else if (kind === 'optimal') {
    const o = optimalMixture(study, { model: model ?? 'mixquadratic', runs, criterion: criterion ?? 'D', seed });
    settings = o.settings; params = { ...params, model: o.model, criterion: criterion ?? 'D', logdet: o.logdet, averageVariance: o.averageVariance };
  } else throw new Error(`mixture design kind: lattice, centroid, vertices or optimal (not "${kind}")`);
  const all = Array.from({ length: replicates }, () => settings).flat();
  const g = rng((seed ?? study.seed) >>> 0);
  const order = g.shuffle(all.map((_, i) => i));
  const tidy = (v) => (typeof v === 'number' ? +v.toPrecision(12) : v);
  return { kind: 'mixture', params: { ...params, replicates, seed: seed ?? study.seed }, randomisation: 'complete',
    runs: all.map((s, i) => ({ run: i + 1, order: order.indexOf(i) + 1, kind: 'other', settings: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, tidy(v)])) })) };
}

// ---------------------------------------------------------------- analysis

/**
 * ANOVA of a mixture model fit (an implied-intercept fit from fitModel): the linear blending terms
 * together (q − 1 df, tested against the mean), then each further term in order (sequential SS).
 */
export function mixtureAnova(fit) {
  const eff = fit._effects, pivot = fit._qr.perm ?? fit.columns.map((_, j) => j);
  const ssOf = new Map();
  for (let k = 0; k < fit.rank; k++) { const t = fit.assign[pivot[k]]; ssOf.set(t, (ssOf.get(t) ?? 0) + eff[k] ** 2); }
  const n = fit.n, ybar = fit.y.reduce((a, v) => a + v, 0) / n;
  const terms = fit.model.terms;
  const linIdx = terms.map((t, i) => (t.degree === 1 && t.comps[0].f && fit.factors.find(f => f.id === t.comps[0].f)?.mix ? i : -1)).filter(i => i >= 0);
  const rows = [];
  const dfOf = (i) => fit.assign.filter((a, j) => a === i && !fit.aliased.includes(fit.columns[j])).length;
  const linSS = linIdx.reduce((a, i) => a + (ssOf.get(i) ?? 0), 0) - n * ybar * ybar;
  const linDf = linIdx.reduce((a, i) => a + dfOf(i), 0) - 1;
  rows.push({ term: 'Linear blending', df: linDf, ss: linSS });
  terms.forEach((t, i) => { if (!linIdx.includes(i) && !t.block) rows.push({ term: t.label, df: dfOf(i), ss: ssOf.get(i) ?? 0 }); });
  const s2 = fit.sigma2, out = rows.filter(r => r.df > 0).map(r => ({ ...r, ms: r.ss / r.df, F: r.ss / r.df / s2, p: fit.dfRes > 0 ? fDist.sf(r.ss / r.df / s2, r.df, fit.dfRes) : NaN }));
  out.push({ term: 'Residuals', df: fit.dfRes, ss: fit.rss, ms: s2 });
  return out;
}

/**
 * Response traces along the Cox directions: component i moved from its smallest to its largest
 * feasible value, the others keeping their proportions to each other as at the reference blend
 * (default the centroid of the region). f(settings) → value. Returns [{ id, points: [{ x, dx, y }] }]
 * with dx the deviation from the reference.
 */
export function coxTrace(study, f, { at, points = 41 } = {}) {
  const M = mixtureOf(study), base = referenceBlend(study, at);
  return M.ids.map((id) => {
    const [a, b] = coxRange(study, base, id);
    const pts = Array.from({ length: points }, (_, t) => a + (b - a) * t / (points - 1)).map(xi => ({ x: xi, dx: xi - base[id], y: f(coxBlend(study, base, id, xi)) }));
    return { id, reference: base[id], points: pts };
  });
}

/** Settings of a reference blend: at, filled in with the region's centroid and the process factors' centres. */
export function referenceBlend(study, at = {}) {
  const M = mixtureOf(study), ov = extremeVertices(study).overall;
  return { ...Object.fromEntries(M.ids.map((id, i) => [id, ov[i]])), ...Object.fromEntries(M.process.map(p => [p.id, p.type === 'categorical' ? p.levels[0] : decode(p, 0)])), ...at };
}
/** Component id set to xi, the other components keeping their proportions to each other (Cox direction). */
export function coxBlend(study, base, id, xi) {
  const M = mixtureOf(study), rest = M.total - base[id], others = M.ids.filter(k => k !== id);
  const out = { ...base, [id]: xi };
  for (const k of others) out[k] = rest > 0 ? base[k] * (M.total - xi) / rest : (M.total - xi) / others.length;
  return out;
}
/** The feasible range of component id along its Cox direction through base: [low, high]. */
export function coxRange(study, base, id) {
  const M = mixtureOf(study), f = M.comps[M.ids.indexOf(id)];
  const okAt = (xi) => { const b = coxBlend(study, base, id, xi); return M.comps.every(c => b[c.id] >= c.low - 1e-12 && b[c.id] <= c.high + 1e-12) && feasible(study, b); };
  const edge = (to) => { if (okAt(to)) return to; let lo = base[id], hi = to; for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (okAt(mid)) lo = mid; else hi = mid; } return lo; };
  return [edge(Math.max(f.low, 0)), edge(Math.min(f.high, M.total))];
}

/**
 * The response over a triangle of three components (the others, and process factors, as in at;
 * the three share what is left of the total), on a grid of n steps per side: [{ z: [z1, z2, z3]
 * (shares of the triangle), settings, y, feasible }].
 */
export function ternaryGrid(study, f, { components, at = {}, n = 20, pseudo = false } = {}) {
  const M = mixtureOf(study), [a, b, c] = components ?? M.ids.slice(0, 3);
  const others = M.ids.filter(id => ![a, b, c].includes(id));
  const ref = referenceBlend(study, at);
  const left = M.total - others.reduce((t, id) => t + ref[id], 0);
  // pseudo: the triangle of what is left above the three lower bounds (corner = that component at
  // its lower bound + span, the others at theirs), so a constrained region fills more of it
  const lo = pseudo ? [a, b, c].map(id => M.comps[M.ids.indexOf(id)].low) : [0, 0, 0];
  const span = left - lo[0] - lo[1] - lo[2];
  const out = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
    const z = [i / n, j / n, (n - i - j) / n];
    const st = { ...ref, [a]: lo[0] + z[0] * span, [b]: lo[1] + z[1] * span, [c]: lo[2] + z[2] * span };
    const ok = M.comps.every(fc => st[fc.id] >= fc.low - 1e-12 && st[fc.id] <= fc.high + 1e-12) && feasible(study, st);
    out.push({ z, settings: st, feasible: ok, y: ok ? f(st) : NaN });
  }
  return { components: [a, b, c], left, low: lo, span, points: out };
}

// ---------------------------------------------------------------- searching the region

/** A random feasible blend: a random convex combination of the region's vertices. */
export function randomBlend(study, g, verts = extremeVertices(study).vertices) {
  const w = verts.map(() => -Math.log(1 - g.random())), s = w.reduce((a, v) => a + v, 0);
  const M = mixtureOf(study);
  return Object.fromEntries(M.ids.map((id, i) => [id, verts.reduce((t, v, k) => t + v.x[i] * w[k] / s, 0)]));
}

/**
 * Maximise score(settings) over the mixture region (and the process factors' ranges, coded −1 … 1;
 * categorical process factors over their levels): random feasible starts, then pairwise transfers
 * between components and coordinate moves of the process factors, the step halving.
 * fixed: settings held. Returns { settings, value }.
 */
export function optimiseMixture(study, score, { starts = 20, seed = 1, fixed = {} } = {}) {
  const M = mixtureOf(study), g = rng(seed >>> 0), verts = extremeVertices(study).vertices;
  const cont = M.process.filter(f => f.type !== 'categorical' && fixed[f.id] === undefined);
  const cats = M.process.filter(f => f.type === 'categorical' && fixed[f.id] === undefined);
  let combos = [{}];
  for (const f of cats) combos = combos.flatMap(c => f.levels.map(l => ({ ...c, [f.id]: l })));
  const ok = (s) => M.comps.every(f => s[f.id] >= f.low - 1e-12 && s[f.id] <= f.high + 1e-12) && feasible(study, s);
  let best = null;
  for (const cat of combos) for (let st = 0; st < starts; st++) {
    let s = { ...fixed, ...cat, ...randomBlend(study, g, verts), ...Object.fromEntries(cont.map(f => [f.id, decode(f, st === 0 ? 0 : 2 * g.random() - 1)])) };
    if (st === 0) { const ov = extremeVertices(study).overall; M.ids.forEach((id, i) => { s[id] = ov[i]; }); }
    let v = score(s);
    for (let step = 0.1; step > 1e-7; step /= 2) {
      let moved = true;
      while (moved) {
        moved = false;
        for (let i = 0; i < M.ids.length; i++) for (let j = 0; j < M.ids.length; j++) {
          if (i === j) continue;
          const t = { ...s, [M.ids[i]]: s[M.ids[i]] + step * M.scale, [M.ids[j]]: s[M.ids[j]] - step * M.scale };
          if (!ok(t)) continue;
          const w = score(t);
          if (w > v + 1e-13) { s = t; v = w; moved = true; }
        }
        for (const f of cont) for (const d of [1, -1]) {
          const c = Math.max(-1, Math.min(1, (2 * s[f.id] - f.low - f.high) / (f.high - f.low) + d * 2 * step));
          const t = { ...s, [f.id]: decode(f, c) };
          const w = score(t);
          if (w > v + 1e-13) { s = t; v = w; moved = true; }
        }
      }
    }
    if (!best || v > best.value) best = { settings: s, value: v };
  }
  return best;
}
