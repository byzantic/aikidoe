// Moving to a better region (issue #81): when the first experiment shows the optimum lies outside
// the ranges studied, the path of steepest ascent (Box & Wilson 1951) says where to run next.
//
//   steepestPath(study, fit, opts)    the path from the centre: straight along the fitted gradient
//                                     for a first-order model; by ridge analysis (the best point on
//                                     each sphere about the centre) when the model has curvature
//   canonicalPath(study, fit, opts)   along a canonical axis of a second-order fit, through the
//                                     stationary point (rsm::canonical.path)
//   directionRegion(study, fit, opts) the confidence region for the direction (Box & Draper): how
//                                     many directions the data cannot rule out
//
// Coded units throughout (−1 … +1 over each factor's range; log factors on the log scale), the
// results also in natural units. Categorical factors are held at their best level; continuous
// factors not in the model at the centre. Ascent or descent from the response's goal (descent for
// minimise) unless given. A factor that reaches its operating limit (factor.limits) is held there
// and the others go on — in steps, each with its own increment; along given radii, in the direction
// of the remaining gradient (first order). A constraint, or a limit on a ridge path, ends the path.
// Checked against rsm::steepest and rsm::canonical.path.

import { decode, code, studyConstraints, feasible } from '../study.js';
import { eigSym, solve } from '../linalg.js';
import { fDist, betaInc } from '../dist.js';
import { predict } from './fit.js';

/**
 * The first- and second-order coefficients of a fit in its continuous factors (coded):
 * { ids, b, B, cats: [categorical ids in the model], intercept }; B is all zero for a first-order
 * model. Throws when a continuous factor interacts with a categorical one or has a higher term.
 */
export function surfaceCoefficients(study, fit) {
  const cols = fit.columns, coef = fit.coef;
  const isCont = (id) => study.factors.some(f => f.id === id && f.type !== 'categorical');
  const inModel = new Set(fit.model.terms.filter(t => !t.block && !t.position).flatMap(t => t.comps.map(c => c.f).filter(Boolean)));
  const ids = study.factors.filter(f => f.type !== 'categorical' && inModel.has(f.id) && !f.covariate).map(f => f.id);
  if (!ids.length) throw new Error('the model has no continuous factor: there is no direction to move in');
  const k = ids.length, b = new Array(k).fill(0), B = ids.map(() => new Array(k).fill(0));
  for (let j = 0; j < cols.length; j++) {
    const c = cols[j], v = coef[j];
    if (c === '(Intercept)') continue;
    // an aliased term in the path's factors: the surface is not determined (a 2² with centre points
    // cannot separate the two squares) — refuse rather than draw an arbitrary curvature
    if (!Number.isFinite(v)) { if (c.split(':').some(p => ids.some(id => p === id || p.includes(`(${id}`)))) throw new Error(`the design cannot estimate ${c} (aliased): fit a model it can estimate (e.g. main effects, or add axial points for the squares)`); continue; }
    const sq = c.match(/^I\(([A-Za-z_]\w*)\^2\)$/);
    if (sq && ids.includes(sq[1])) { const a = ids.indexOf(sq[1]); B[a][a] = v; continue; }
    const parts = c.split(':');
    const contParts = parts.filter(p => ids.includes(p));
    if (parts.length === 1 && contParts.length === 1) { b[ids.indexOf(c)] = v; continue; }
    if (parts.length === 2 && contParts.length === 2) { const a = ids.indexOf(parts[0]), e = ids.indexOf(parts[1]); B[a][e] += v / 2; B[e][a] += v / 2; continue; }
    if (parts.some(p => ids.some(id => p === id || p.includes(`(${id}`)))) throw new Error(`term ${c}: the path needs a model of main effects, two-factor interactions and squares in the continuous factors (no interaction with a categorical factor, no cubic)`);
  }
  const cats = study.factors.filter(f => f.type === 'categorical' && inModel.has(f.id)).map(f => f.id);
  for (const id of cats) if (fit.model.terms.some(t => t.comps.length > 1 && t.comps.some(c => c.f === id) && t.comps.some(c => isCont(c.f)))) throw new Error(`${id} interacts with a continuous factor: the path depends on its level — fit without the interaction, or analyse each level`);
  return { ids, b, B, cats };
}

const norm = (v) => Math.sqrt(v.reduce((a, x) => a + x * x, 0));

// the settings (natural) of a coded point in the path's factors, categorical factors at their
// chosen levels, other continuous factors at the centre
function settingsOf(study, ids, x, catLevels) {
  return Object.fromEntries(study.factors.map(f => {
    if (f.type === 'categorical') return [f.id, catLevels[f.id] ?? f.levels[0]];
    const i = ids.indexOf(f.id);
    return [f.id, decode(f, i >= 0 ? x[i] : 0)];
  }));
}

// the best level of each categorical factor in the model (at the centre of the others): the one
// with the highest (ascent) or lowest (descent) fitted mean, combinations searched together
function bestLevels(study, fit, ids, cats, sign) {
  if (!cats.length) return {};
  const fs = cats.map(id => study.factors.find(f => f.id === id));
  let combos = [{}];
  for (const f of fs) combos = combos.flatMap(c => f.levels.map(l => ({ ...c, [f.id]: l })));
  if (combos.length > 512) combos = combos.slice(0, 512);
  const zero = new Array(ids.length).fill(0);
  const vals = predict(fit, combos.map(c => settingsOf(study, ids, zero, c))).map(p => p.fit);
  let best = 0;
  vals.forEach((v, i) => { if (sign * v > sign * vals[best]) best = i; });
  return combos[best];
}

// operating limits in coded units, per path factor ([lo, hi], ±Infinity when none)
function codedLimits(study, ids) {
  return ids.map(id => {
    const f = study.factors.find(x => x.id === id), L = f.limits ?? {};
    const lo = L.lower !== undefined ? code(f, L.lower) : -Infinity, hi = L.upper !== undefined ? code(f, L.upper) : Infinity;
    return [Math.min(lo, hi), Math.max(lo, hi)];
  });
}

/**
 * The path of steepest ascent (or descent) from the centre of the design.
 * opts: descent (default: the response's goal is minimise), steps (number of steps after the
 * centre, default 5), step: the step in coded units of the factor with the largest effect (default
 * 1, Box & Wilson's convention) or stepFactor + stepNatural (a step of that many natural units in
 * that factor), distances (coded radii, as rsm::steepest's dist, instead of steps), level (0.95).
 * Returns { method: 'linear' | 'ridge', goal, factors: ids, direction (unit vector, linear),
 * increments (natural units per step, linear), held: { categorical levels }, points: [{ step,
 * distance, coded, settings, fit, se, lower, upper, outside, limited: [ids at their limit] }],
 * stopped (why the path ends early, or null) }.
 */
export function steepestPath(study, fit, { descent, steps = 5, step = 1, stepFactor, stepNatural, distances, level = 0.95 } = {}) {
  const resp = study.responses.find(r => r.id === fit.response) ?? study.responses[0];
  descent ??= resp?.goal === 'minimize';
  const sign = descent ? -1 : 1;
  const { ids, b, B, cats } = surfaceCoefficients(study, fit);
  const k = ids.length, curved = B.some(r => r.some(v => Math.abs(v) > 0));
  const held = bestLevels(study, fit, ids, cats, sign);
  const lim = codedLimits(study, ids), cons = study.constraints?.length ? studyConstraints(study) : [];
  const bn = norm(b);
  if (!curved && !(bn > 0)) throw new Error('every first-order coefficient is zero: there is no direction of steepest ascent');
  const pts = [];
  let stopped = null;
  const ok = (x) => !cons.length || feasible(study, settingsOf(study, ids, x, held));
  if (!curved) {
    // the straight path: x = t·(±b), the factor with the largest |b| moving `step` coded units a step
    const g = b.map(v => sign * v);
    let unit;
    if (stepFactor !== undefined) {
      const i = ids.indexOf(stepFactor);
      if (i < 0) throw new Error(`${stepFactor} is not a continuous factor of the model`);
      if (!(g[i] !== 0)) throw new Error(`${stepFactor} has no effect: it does not move along the path`);
      const f = study.factors.find(x => x.id === stepFactor);
      const dc = Math.abs(code(f, decode(f, 0) + Math.abs(stepNatural)) - 0);
      if (!(dc > 0)) throw new Error('give the step in natural units (a positive number)');
      unit = g.map(v => v * dc / Math.abs(g[i]));
    } else {
      const mx = Math.max(...g.map(Math.abs));
      unit = g.map(v => v * step / mx);
    }
    const ul = norm(unit);
    if (!distances) {
      // in steps (Box & Wilson): each factor moves its increment a step; one that reaches its
      // operating limit is held there while the others go on with theirs
      for (let i = 0; i <= steps; i++) {
        const x = unit.map((v, j) => Math.min(lim[j][1], Math.max(lim[j][0], i * v)));
        const limited = ids.filter((_, j) => x[j] !== i * unit[j]);
        if (limited.length === ids.length && i > 0 && pts.length && x.every((v, j) => v === pts.at(-1).coded[j])) { stopped = `step ${i}: every factor in the path is at its operating limit`; break; }
        if (!ok(x)) { stopped = `step ${i}: the path reaches a constraint`; break; }
        pts.push({ distance: norm(x), coded: x, limited });
      }
      return finish(study, fit, { method: 'linear', sign, ids, held, pts, stopped, level, direction: g.map(v => v / norm(g)),
        increments: Object.fromEntries(ids.map((id, i) => { const f = study.factors.find(x => x.id === id); return [id, decode(f, unit[i]) - decode(f, 0)]; })) });
    }
    const radii = distances;
    // walk: move along the projected direction; a factor reaching its limit is held there
    let x = new Array(k).fill(0), free = ids.map(() => true), r0 = 0;
    for (const r of radii) {
      let dr = r - r0;
      while (dr > 1e-12) {
        const dir = unit.map((v, i) => (free[i] ? v : 0)), dn = norm(dir);
        if (!(dn > 0)) { stopped = 'every factor in the path is at its operating limit'; break; }
        const u = dir.map(v => v / dn);
        // the furthest we can go before a free factor hits its limit
        let tmax = dr, hit = -1;
        u.forEach((v, i) => { if (!free[i] || v === 0) return; const bound = v > 0 ? lim[i][1] : lim[i][0], t = (bound - x[i]) / v; if (t < tmax - 1e-12) { tmax = Math.max(0, t); hit = i; } });
        x = x.map((v, i) => v + tmax * u[i]);
        dr -= tmax;
        if (hit >= 0) { free[hit] = false; x[hit] = u[hit] > 0 ? lim[hit][1] : lim[hit][0]; }
      }
      if (stopped) break;
      if (!ok(x)) { stopped = `step ${pts.length}: the path reaches a constraint`; break; }
      pts.push({ distance: r, coded: x.slice(), limited: ids.filter((_, i) => !free[i]) });
      r0 = r;
    }
    return finish(study, fit, { method: 'linear', sign, ids, held, pts, stopped, level, direction: g.map(v => v / norm(g)),
      increments: Object.fromEntries(ids.map((id, i) => { const f = study.factors.find(x => x.id === id); return [id, decode(f, unit[i]) - decode(f, 0)]; })) });
  }
  // ridge analysis: on each sphere of radius r, the stationary point of the fit under |x| = r,
  // x(μ) = −½ (B − μI)⁻¹ b, μ beyond the largest (ascent) or smallest (descent) eigenvalue
  const E = eigSym(B), lam = E.values;
  const lmax = Math.max(...lam), lmin = Math.min(...lam);
  const xOf = (mu) => solve(B.map((row, i) => row.map((v, j) => v - (i === j ? mu : 0))), b).map(v => -0.5 * v);
  const radius = (mu) => norm(xOf(mu));
  const radii = distances ?? Array.from({ length: steps + 1 }, (_, i) => i * step);
  for (const r of radii) {
    let x;
    if (Math.abs(r) < 0.01) x = new Array(k).fill(0);           // as rsm: the centre for radii below 0.01
    else {
      // radius(μ) falls from ∞ (at the eigenvalue) to 0 (μ → ±∞): bracket and bisect
      const edge = descent ? lmin : lmax, dir = descent ? -1 : 1;
      let near = edge + dir * 1e-9 * Math.max(1, Math.abs(edge)), far = edge + dir;
      while (radius(far) > r) far = edge + dir * 2 * Math.abs(far - edge);
      if (!(radius(near) > r)) { near = edge + dir * 1e-12; }
      for (let it = 0; it < 200; it++) { const m = (near + far) / 2; if (radius(m) > r) near = m; else far = m; if (Math.abs(far - near) < 1e-15 * Math.max(1, Math.abs(m))) break; }
      x = xOf((near + far) / 2);
    }
    if (x.some((v, i) => v < lim[i][0] - 1e-9 || v > lim[i][1] + 1e-9)) { stopped = `step ${pts.length}: the path reaches an operating limit`; break; }
    if (!ok(x)) { stopped = `step ${pts.length}: the path reaches a constraint`; break; }
    pts.push({ distance: r, coded: x, limited: [] });
  }
  return finish(study, fit, { method: 'ridge', sign, ids, held, pts, stopped, level });
}

/**
 * The path along a canonical axis of a second-order fit, through the stationary point (as
 * rsm::canonical.path): which (0-based, in decreasing order of eigenvalue; default the largest for
 * ascent, the smallest for descent), distances (coded, default −5 … 5 by 0.5).
 */
export function canonicalPath(study, fit, { descent, which, distances, level = 0.95 } = {}) {
  const resp = study.responses.find(r => r.id === fit.response) ?? study.responses[0];
  descent ??= resp?.goal === 'minimize';
  const { ids, b, B, cats } = surfaceCoefficients(study, fit);
  if (!B.some(r => r.some(v => Math.abs(v) > 0))) throw new Error('the canonical path needs a second-order model (squares or interactions)');
  const E = eigSym(B);
  const eig = E.values.map((l, m) => ({ value: l, vector: E.vectors.map(r => r[m]) })).sort((p, q) => q.value - p.value);
  if (eig.some(e => Math.abs(e.value) < 1e-10 * Math.max(...eig.map(x => Math.abs(x.value))))) throw new Error('B is singular: no unique stationary point');
  const xs = new Array(ids.length).fill(0);
  for (const e of eig) { const p = e.vector.reduce((s, v, i) => s + v * b[i], 0); for (let i = 0; i < ids.length; i++) xs[i] -= 0.5 * p / e.value * e.vector[i]; }
  const w = which ?? (descent ? eig.length - 1 : 0);
  const v = eig[w].vector;
  const ds = distances ?? Array.from({ length: 21 }, (_, i) => -5 + 0.5 * i);
  const held = bestLevels(study, fit, ids, cats, descent ? -1 : 1);
  const pts = ds.map(d => ({ distance: d, coded: xs.map((s, i) => s + d * v[i]), limited: [] }));
  return finish(study, fit, { method: 'canonical', sign: descent ? -1 : 1, ids, held, pts, stopped: null, level, stationary: xs, axis: { value: eig[w].value, vector: v } });
}

function finish(study, fit, { method, sign, ids, held, pts, stopped, level, ...extra }) {
  const settings = pts.map(p => settingsOf(study, ids, p.coded, held));
  const pr = predict(fit, settings, { level });
  const points = pts.map((p, i) => ({ step: i, distance: p.distance, coded: Object.fromEntries(ids.map((id, j) => [id, p.coded[j]])), settings: settings[i],
    fit: pr[i].fit, se: pr[i].se, lower: pr[i].lower, upper: pr[i].upper,
    outside: p.coded.some(v => Math.abs(v) > 1 + 1e-9), limited: p.limited }));
  return { method, goal: sign > 0 ? 'ascent' : 'descent', factors: ids, held, points, stopped, ...extra };
}

/**
 * The confidence region for the direction of steepest ascent of a first-order fit (Box & Draper
 * 1987, §6.4): the directions d (unit vectors) the data cannot rule out at level 1 − α are those
 * with Σbᵢ² − (Σbᵢdᵢ)² ≤ (k − 1) s_b² F(α; k − 1, ν), s_b² the variance of a coefficient (its mean
 * over the factors: equal in an orthogonal design). They form a cone about b of half-angle θ,
 * cos²θ = 1 − (k − 1) s_b² F / Σbᵢ²; the fraction of all directions inside it is
 * ½ I_{sin²θ}((k − 1)/2, ½). Returns { k, df, F, angle (degrees; 180 when every direction is
 * possible), fraction, determined (the cone excludes most directions: fraction < 0.05 is good) }.
 */
export function directionRegion(study, fit, { alpha = 0.05 } = {}) {
  const { ids, b, B } = surfaceCoefficients(study, fit);
  if (B.some(r => r.some(v => Math.abs(v) > 0))) throw new Error('the confidence region for the direction is for a first-order model');
  const k = ids.length, df = fit.dfRes;
  if (k < 2) return { k, df, F: NaN, angle: 0, fraction: 0, determined: true, note: 'one factor: the direction is up or down' };
  if (!(df > 0)) throw new Error('no residual degrees of freedom: the direction\'s uncertainty cannot be estimated');
  const se = ids.map(id => fit.se[fit.columns.indexOf(id)]);
  const sb2 = se.reduce((a, x) => a + x * x, 0) / k;
  const F = fDist.isf(alpha, k - 1, df), ss = b.reduce((a, x) => a + x * x, 0);
  const c2 = 1 - (k - 1) * sb2 * F / ss;
  if (!(c2 > 0)) return { k, df, F, sb2, angle: 180, fraction: 1, determined: false };
  const theta = Math.acos(Math.sqrt(c2)), s2 = 1 - c2;
  const fraction = 0.5 * betaInc(s2, (k - 1) / 2, 0.5).I;
  return { k, df, F, sb2, angle: theta * 180 / Math.PI, fraction, determined: fraction < 0.05 };
}
