// Desirability and multi-response optimisation (spec §8; issue #18).
//
// Derringer & Suich (1980) individual desirabilities, as the R package `desirability`:
//   maximise  d = 0 below L, ((y − L)/(H − L))^s between, 1 above H
//   minimise  d = 1 below L, ((y − H)/(L − H))^s between, 0 above H
//   target    d = ((y − L)/(T − L))^s₁ for L ≤ y ≤ T, ((y − H)/(T − H))^s₂ for T ≤ y ≤ H, 0 outside
//   range     d = 1 inside [L, H], 0 outside
// From a study response: maximise uses lower (L) and target, or upper, as H (fully satisfactory);
// minimise uses target, or lower, as L and upper as H; target uses lower, target, upper; range
// lower, upper. `weight` is the shape s ([s₁, s₂] for a target), `importance` r weights the overall
//   D = (Π d_i^{r_i})^{1 / Σ r_i}
// (all r = 1: the geometric mean, as dOverall).
//
// Optimisation maximises D over the factor region — the coded cube (or a sphere of radius α, as
// for central composite designs), within the study's constraints — with categorical factors
// enumerated: a seeded Latin-hypercube screen, then Nelder–Mead from the best starts (projected
// onto the region), then coordinate polishing. D is flat (0) far from the optimum, so the screen
// matters; a small multiple of each d's distance to its acceptable range breaks ties at D = 0.
import { optimiseMixture, referenceBlend, coxBlend, coxRange } from '../design/mixture.js';
import { rng } from '../design/rng.js';
import { code, decode, feasible } from '../study.js';
import { fitModel, predict } from './ols.js';
import { fitMixedModel, observationTable, randomEffects, predictMixed } from './mixed.js';
import { modelMatrix } from './formula.js';
import { defaultFormula } from './defaults.js';

/** Individual desirability. spec: { kind: 'max'|'min'|'target'|'box', low, high, target?, scale?, lowScale?, highScale? } */
export function dValue(spec, y) {
  if (!Number.isFinite(y)) return NaN;
  const { low: L, high: H } = spec;
  switch (spec.kind) {
    case 'max': return y <= L ? 0 : y >= H ? 1 : ((y - L) / (H - L)) ** (spec.scale ?? 1);
    case 'min': return y <= L ? 1 : y >= H ? 0 : ((y - H) / (L - H)) ** (spec.scale ?? 1);
    case 'target': {
      const T = spec.target;
      if (y < L || y > H) return 0;
      return y <= T ? ((y - L) / (T - L)) ** (spec.lowScale ?? 1) : ((y - H) / (T - H)) ** (spec.highScale ?? 1);
    }
    case 'box': return y >= L && y <= H ? 1 : 0;
    default: throw new Error(`unknown desirability kind "${spec.kind}"`);
  }
}

/** Overall desirability: weighted geometric mean (importance r_i). */
export function dOverall(ds, importance = null) {
  const r = importance ?? ds.map(() => 1), R = r.reduce((a, b) => a + b, 0);
  if (ds.some(d => d === 0)) return 0;
  return Math.exp(ds.reduce((a, d, i) => a + r[i] * Math.log(d), 0) / R);
}

/** Desirability spec of a study response (null when its goal is none or its limits are missing). */
export function responseDesirability(r) {
  const w = r.weight, imp = r.importance ?? 1;
  const sc = (i) => (Array.isArray(w) ? w[i] : w ?? 1);
  switch (r.goal) {
    case 'maximize': { const H = r.target ?? r.upper; return Number.isFinite(r.lower) && Number.isFinite(H) && H > r.lower ? { kind: 'max', low: r.lower, high: H, scale: sc(0), importance: imp } : null; }
    case 'minimize': { const L = r.target ?? r.lower; return Number.isFinite(r.upper) && Number.isFinite(L) && r.upper > L ? { kind: 'min', low: L, high: r.upper, scale: sc(0), importance: imp } : null; }
    case 'target': return Number.isFinite(r.lower) && Number.isFinite(r.upper) ? { kind: 'target', low: r.lower, target: r.target, high: r.upper, lowScale: sc(0), highScale: sc(1), importance: imp } : null;
    case 'range': return { kind: 'box', low: r.lower, high: r.upper, importance: imp };
    default: return null;
  }
}

// distance outside the acceptable range (0 when d > 0), to steer the search where D = 0
function shortfall(spec, y) {
  const span = Math.abs((spec.high ?? 1) - (spec.low ?? 0)) || 1;
  switch (spec.kind) {
    case 'max': return y <= spec.low ? (spec.low - y) / span + 1e-9 : 0;
    case 'min': return y >= spec.high ? (y - spec.high) / span + 1e-9 : 0;
    default: return y < spec.low ? (spec.low - y) / span + 1e-9 : y > spec.high ? (y - spec.high) / span + 1e-9 : 0;
  }
}

/**
 * Maximise the overall desirability.
 *   study: factors (and constraints); models: [{ id, spec (from responseDesirability), predict(settings) → number }];
 *   opts: region ('cube' | 'sphere'), radius (coded half-width of the cube, default 1; radius of the
 *   sphere, default √k), fixed ({ id: natural value } held),
 *   starts (20), screen (2000 points), seed.
 * Returns { settings, coded, D, d: [{ id, y, d }], feasible }.
 */
export function optimiseDesirability(study, models, { region = 'cube', radius, fixed = {}, starts = 20, screen = 2000, seed = 1 } = {}) {
  if (!models.length) throw new Error('no response has a desirability goal (set a goal with limits on the responses)');
  if (study.mixture) {
    // a mixture: search the blends (and process factors) in the constrained region
    const val = (s) => { const ys = models.map(m => m.predict(s)), ds = ys.map((y, i) => dValue(models[i].spec, y)); const D = dOverall(ds, models.map(m => m.spec.importance ?? 1)); return { D, ys, ds, v: D > 0 ? D : -ys.reduce((a, y, i) => a + shortfall(models[i].spec, y), 0) }; };
    const r = optimiseMixture(study, (s) => val(s).v, { seed, fixed, starts: Math.max(8, Math.round(starts / 2)) });
    const b = val(r.settings);
    return { settings: r.settings, coded: {}, D: b.D, feasible: true, d: models.map((m, i) => ({ id: m.id, y: b.ys[i], d: b.ds[i] })) };
  }
  const fs = study.factors, free = fs.filter(f => f.type !== 'categorical' && fixed[f.id] === undefined);
  const cats = fs.filter(f => f.type === 'categorical' && fixed[f.id] === undefined);
  // half-width of the cube, or radius of the sphere, in coded units
  const k = free.length, R = radius ?? (region === 'sphere' ? Math.sqrt(fs.filter(f => f.type !== 'categorical').length) : 1);
  const g = rng(seed);
  const project = (x) => {
    let y = x.map(v => Math.max(-R, Math.min(R, v)));
    if (region === 'sphere') { const n = Math.hypot(...y); if (n > R) y = y.map(v => v * R / n); }
    return y;
  };
  const settingsOf = (x, cat) => Object.fromEntries(fs.map(f => [f.id,
    fixed[f.id] !== undefined ? fixed[f.id] : f.type === 'categorical' ? cat[f.id] : decode(f, x[free.indexOf(f)])]));
  const hasCons = (study.constraints ?? []).length > 0;
  const score = (x, cat) => {
    const s = settingsOf(x, cat);
    const ys = models.map(m => m.predict(s));
    const ds = ys.map((y, i) => dValue(models[i].spec, y));
    const D = dOverall(ds, models.map(m => m.spec.importance ?? 1));
    let pen = 0;
    if (hasCons && !feasible(study, s)) pen = 1;
    // where D = 0, prefer points closer to acceptable
    const gap = D > 0 ? 0 : ys.reduce((a, y, i) => a + shortfall(models[i].spec, y), 0);
    return { val: D - gap - pen, D, ds, ys, s, feasible: !pen };
  };
  // categorical combinations
  let combos = [{}];
  for (const f of cats) combos = combos.flatMap(c => f.levels.map(l => ({ ...c, [f.id]: l })));
  if (combos.length > 64) throw new Error(`${combos.length} combinations of categorical levels: hold some fixed`);
  let best = null;
  for (const cat of combos) {
    // Latin-hypercube screen
    const n = Math.max(50, Math.round(screen / combos.length)), pts = [];
    const perms = free.map(() => g.shuffle([...Array(n).keys()]));
    for (let i = 0; i < n; i++) pts.push(project(free.map((_, j) => ((perms[j][i] + g.random()) / n * 2 - 1) * R)));
    pts.push(free.map(() => 0));
    const scored = pts.map(x => ({ x, ...score(x, cat) })).sort((a, b) => b.val - a.val);
    for (const st of scored.slice(0, Math.min(starts, scored.length))) {
      let x = k ? nelderMead((z) => -score(project(z), cat).val, st.x, 0.25 * R) : [];
      x = project(x);
      // coordinate polish
      for (let pass = 0; pass < 3 && k; pass++) for (let j = 0; j < k; j++) {
        let step = 0.05;
        while (step > 1e-7) {
          const cur = score(x, cat).val;
          const up = project(x.map((v, t) => (t === j ? v + step : v))), dn = project(x.map((v, t) => (t === j ? v - step : v)));
          const su = score(up, cat).val, sd = score(dn, cat).val;
          if (su > cur + 1e-15) x = up; else if (sd > cur + 1e-15) x = dn; else step /= 2;
        }
      }
      const r = score(x, cat);
      if (!best || r.val > best.val + 1e-12) best = { ...r, x, cat };
    }
  }
  return {
    settings: best.s, coded: Object.fromEntries(free.map((f, j) => [f.id, best.x[j]])), D: best.D, feasible: best.feasible,
    d: models.map((m, i) => ({ id: m.id, y: best.ys[i], d: best.ds[i] })),
  };
}

function nelderMead(fn, x0, step, { iter = 600, tol = 1e-12 } = {}) {
  const n = x0.length;
  let S = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step : v)))].map(x => ({ x, f: fn(x) }));
  for (let it = 0; it < iter; it++) {
    S.sort((a, b) => a.f - b.f);
    if (Math.abs(S[n].f - S[0].f) <= tol * (1 + Math.abs(S[0].f)) && it > 20) break;
    const c = S.slice(0, n).reduce((a, s) => a.map((v, i) => v + s.x[i] / n), new Array(n).fill(0));
    const at = (t) => c.map((v, i) => v + t * (S[n].x[i] - v));
    const r = { x: at(-1) }; r.f = fn(r.x);
    if (r.f < S[0].f) { const e = { x: at(-2) }; e.f = fn(e.x); S[n] = e.f < r.f ? e : r; }
    else if (r.f < S[n - 1].f) S[n] = r;
    else { const cc = { x: at(0.5) }; cc.f = fn(cc.x); if (cc.f < S[n].f) S[n] = cc; else S = S.map((s, i) => (i ? { x: s.x.map((v, j) => S[0].x[j] + 0.5 * (v - S[0].x[j])) } : s)).map(s => (s.f === undefined ? { ...s, f: fn(s.x) } : s)); }
  }
  S.sort((a, b) => a.f - b.f);
  return S[0].x;
}

/**
 * Prediction profiler: for each factor, the predicted responses (with confidence bands) along its
 * range with the other factors held at `at`. models: [{ id, predictBand(settings) → { fit, lower, upper } }].
 * Returns [{ factor, xs (natural), curves: [{ id, fit: [], lower: [], upper: [] }] }].
 */
export function profile(study, models, at, { points = 31 } = {}) {
  const mix = new Set(study.mixture?.components ?? []);
  return study.factors.map(f => {
    if (mix.has(f.id)) {
      // a mixture component: along its Cox direction (the others keep their proportions)
      const base = referenceBlend(study, at), [a, b] = coxRange(study, base, f.id);
      const xs = [...Array(points).keys()].map(i => a + (b - a) * i / (points - 1));
      return { factor: f.id, xs, cox: true, curves: models.map(m => {
        const bd = xs.map(x => m.predictBand(coxBlend(study, base, f.id, x)));
        return { id: m.id, fit: bd.map(v => v.fit), lower: bd.map(v => v.lower), upper: bd.map(v => v.upper) };
      }) };
    }
    const xs = f.type === 'categorical' ? f.levels.slice() : [...Array(points).keys()].map(i => decode(f, -1 + 2 * i / (points - 1)));
    return { factor: f.id, xs, curves: models.map(m => {
      const b = xs.map(x => m.predictBand({ ...at, [f.id]: x }));
      return { id: m.id, fit: b.map(v => v.fit), lower: b.map(v => v.lower), upper: b.map(v => v.upper) };
    }) };
  });
}

/** Grid of overall desirability (and each response's d) over two factors, others held at `at`. */
export function desirabilityGrid(study, models, at, fx, fy, { n = 41 } = {}) {
  const F = (id) => study.factors.find(f => f.id === id);
  const X = F(fx), Y = F(fy);
  if (!X || !Y || X.type === 'categorical' || Y.type === 'categorical') throw new Error('the overlay plot needs two continuous factors');
  if (study.mixture && (study.mixture.components.includes(fx) || study.mixture.components.includes(fy))) throw new Error('mixture components cannot be varied independently: use the ternary plot');
  const xs = [...Array(n).keys()].map(i => decode(X, -1 + 2 * i / (n - 1))), ys = [...Array(n).keys()].map(i => decode(Y, -1 + 2 * i / (n - 1)));
  const cells = ys.map(yv => xs.map(xv => {
    const s = { ...at, [fx]: xv, [fy]: yv };
    const vals = models.map(m => m.predict(s)), ds = vals.map((v, i) => dValue(models[i].spec, v));
    return { D: dOverall(ds, models.map(m => m.spec.importance ?? 1)), ds, vals, ok: ds.every(d => d > 0) && (!(study.constraints ?? []).length || feasible(study, s)) };
  }));
  return { fx, fy, xs, ys, cells };
}

/**
 * Fitted models of the responses that have a desirability goal: { formulas: { responseId: formula } }
 * (default: defaultFormula). Split-plot / nested readings use the mixed model (unless ols: true).
 * all: include responses without a goal (spec null). Each model: { id, spec, formula, fit, sigma (residual sd), predict(settings) → ŷ, predictBand(settings) → { fit, lower, upper } (95% CI) }.
 * Responses without results are skipped and listed in `missing`.
 */
export function fittedModels(study, { formulas = {}, ols = false, only = null, all = false } = {}) {
  const models = [], missing = [];
  for (const r of study.responses) {
    const spec = responseDesirability(r);
    if ((!spec && !all) || (only && !only.includes(r.id))) continue;
    const formula = formulas[r.id] ?? defaultFormula(study, r.id);
    let mixed = false;
    try { mixed = !ols && randomEffects(observationTable(study, r.id)).length > 0; } catch { /* no data */ }
    let fit;
    try { fit = mixed ? fitMixedModel(study, formula) : fitModel(study, formula); } catch (e) { missing.push({ id: r.id, reason: e.message }); continue; }
    if (mixed) {
      const cols = fit.kept;
      const xb = (st) => { const x = modelMatrix(fit.model, fit.factors, [st]).X[0]; return cols.reduce((a, j, i) => a + x[j] * fit.beta[i], 0); };
      const pos = fit.positionTerms ?? [];
      // position terms are averaged over the sites (predictMixed does it for the band)
      const predictOne = pos.length ? (st) => predictMixed(fit, [st])[0].fit : xb;
      models.push({ id: r.id, spec, formula, fit, sigma: Math.sqrt(fit.varcomp.reduce((a, v) => a + v.variance, 0)), predict: predictOne, predictBand: (st) => { const p = predictMixed(fit, [st])[0]; return { fit: p.fit, lower: p.lower, upper: p.upper }; } });
    } else {
      const coefIdx = fit.coef.map((c, j) => (Number.isFinite(c) ? j : -1)).filter(j => j >= 0);
      const xb = (st) => { const x = modelMatrix(fit.model, fit.factors, [st]).X[0]; return coefIdx.reduce((a, j) => a + x[j] * fit.coef[j], 0); };
      models.push({ id: r.id, spec, formula, fit, sigma: fit.sigma, predict: xb, predictBand: (st) => { const p = predict(fit, [st])[0]; return { fit: p.fit, lower: p.lower, upper: p.upper }; } });
    }
  }
  return { models, missing };
}
