// The fitted response over the factor space (issue #88, phase 2): a slice of a fitted model over
// two factors, and for a quadratic its stationary point and canonical axes.
//
//   predictorOf(fit)                 settings (natural units) ↦ the fitted mean, for any fit the
//                                    Analyse step makes: least squares and GLMs (fit.js predict, on
//                                    the response scale), REML mixed models (predictMixed) and GLMMs
//                                    (predictCountMixed: a typical whole plot or block)
//   responseSlice(study, fit, o)     the fitted mean over a grid of two continuous factors, the
//                                    others held at o.at (coded, by factor id; default the centre,
//                                    categorical the first level)
//   stationaryPoint(study, fit)      for a model with quadratic terms in continuous factors: the
//                                    stationary point x_s = −½ B⁻¹ b (coded), the fitted mean there,
//                                    and the canonical analysis — eigenvalues and eigenvectors of B
//                                    (all negative: a maximum; positive: a minimum; mixed: a saddle)
//   canonicalAxesOn(sp, a, b)        the canonical axes worth drawing on a slice over a and b
//   runsOnSlice(study, fit, o)       the fitted runs projected on the slice: coded x, y, their
//                                    distance from it in the other factors, response and residual
import { code, decode } from '../study.js';
import { eigSym } from '../linalg.js';
import { predict } from './fit.js';
import { predictMixed } from './mixed.js';
import { predictCountMixed } from './glmm.js';

/** settings (natural) → fitted means, for a fit of any kind. */
export function predictorOf(fit) {
  if (fit.kind === 'glmm') return (rows) => predictCountMixed(fit, rows).map(p => p.fit);
  if (fit._kr) return (rows) => predictMixed(fit, rows).map(p => p.fit);
  return (rows) => predict(fit, rows).map(p => p.fit);
}

const idxOf = (study, v) => (typeof v === 'number' ? v : study.factors.findIndex(f => f.id === v));

/** Coded point → natural settings (categorical: the level at that index). */
const natural = (study, p) => Object.fromEntries(study.factors.map((f, j) => [f.id, f.type === 'categorical' ? f.levels[p[j]] : decode(f, p[j])]));

/** The coded range covered by the runs for factor j: −1 … +1, widened to the runs (axial points). */
function rangeOf(study, fit, j) {
  const f = study.factors[j];
  const vals = (fit.rows ?? []).map(r => code(f, r.settings?.[f.id])).filter(Number.isFinite);
  const m = Math.max(1, ...vals.map(Math.abs));
  return [-m, m];
}

/**
 * The fitted mean over two continuous factors x, y (ids or indices), the others at opts.at
 * (coded, by id). opts.n: grid points per side (41). Returns { x, y, ix, iy, xs, ys (coded), z
 * (rows over ys), min, max, at (coded point) }.
 */
export function responseSlice(study, fit, { x, y, at = {}, n = 41 } = {}) {
  const ix = idxOf(study, x), iy = idxOf(study, y);
  for (const j of [ix, iy]) if (j < 0 || study.factors[j].type === 'categorical') throw new Error('choose two continuous factors');
  if (ix === iy) throw new Error('choose two different factors');
  const base = study.factors.map(f => at[f.id] ?? 0);
  const [x0, x1] = rangeOf(study, fit, ix), [y0, y1] = rangeOf(study, fit, iy);
  const xs = [...Array(n).keys()].map(i => x0 + (x1 - x0) * i / (n - 1)), ys = [...Array(n).keys()].map(i => y0 + (y1 - y0) * i / (n - 1));
  const pts = [];
  for (const yv of ys) for (const xv of xs) { const p = base.slice(); p[ix] = xv; p[iy] = yv; pts.push(natural(study, p)); }
  const v = predictorOf(fit)(pts);
  const z = ys.map((_, r) => xs.map((__, q) => v[r * n + q]));
  const fin = v.filter(Number.isFinite);
  return { x: study.factors[ix].id, y: study.factors[iy].id, ix, iy, xs, ys, z, min: Math.min(...fin), max: Math.max(...fin), at: base };
}

/**
 * Stationary point and canonical analysis of a fitted second-order model in its continuous factors
 * (coded units). Only when the model has quadratic terms, and every term involving those factors is
 * a main effect, a square or a two-factor interaction among them (a categorical factor or a block
 * may shift the surface but not interact). Returns null otherwise, or when B is singular.
 * { factors: [ids], x: coded point, settings: natural, value (fitted mean there; other factors at
 * their centre / first level), eigen: [{ value, vector }] (largest first), kind: 'maximum' |
 * 'minimum' | 'saddle', inside: within the coded range of the runs }.
 */
export function stationaryPoint(study, fit) {
  const cols = fit.columns, coef = fit.coef;
  const cont = study.factors.filter(f => f.type !== 'categorical').map(f => f.id);
  const sq = (id) => cols.indexOf(`I(${id}^2)`);
  const ids = cont.filter(id => sq(id) >= 0);
  if (!ids.length) return null;
  const inv = new Set(ids), k = ids.length;
  const b = new Array(k).fill(0), B = ids.map(() => new Array(k).fill(0));
  for (let j = 0; j < cols.length; j++) {
    const c = cols[j], v = coef[j];
    if (!Number.isFinite(v) || c === '(Intercept)') continue;
    const sqm = c.match(/^I\(([A-Za-z_][A-Za-z0-9_]*)\^2\)$/);
    if (sqm && inv.has(sqm[1])) { const a = ids.indexOf(sqm[1]); B[a][a] = v; continue; }
    const parts = c.split(':');
    if (parts.length === 1 && inv.has(c)) { b[ids.indexOf(c)] = v; continue; }
    if (parts.length === 2 && inv.has(parts[0]) && inv.has(parts[1])) { const a = ids.indexOf(parts[0]), e = ids.indexOf(parts[1]); B[a][e] = v / 2; B[e][a] = v / 2; continue; }
    // any other term touching the quadratic factors (a cubic, an interaction with a categorical factor): no simple canonical form
    if (parts.some(p => ids.some(id => p === id || p.includes(`(${id}`) || p.startsWith(`${id}[`)))) return null;
  }
  const E = eigSym(B);
  if (E.values.some(l => Math.abs(l) < 1e-10 * Math.max(...E.values.map(Math.abs), 1e-300))) return null;
  // x_s = −½ B⁻¹ b, through the eigen decomposition (B may be indefinite)
  const xs = new Array(k).fill(0);
  E.values.forEach((l, m) => { const vec = E.vectors.map(r => r[m]), proj = vec.reduce((s, vv, i) => s + vv * b[i], 0); for (let i = 0; i < k; i++) xs[i] -= 0.5 * proj / l * vec[i]; });
  const point = study.factors.map(f => (inv.has(f.id) ? xs[ids.indexOf(f.id)] : 0));
  const settings = natural(study, point);
  const value = predictorOf(fit)([settings])[0];
  const eigen = E.values.map((l, m) => ({ value: l, vector: E.vectors.map(r => r[m]) })).sort((a, c) => c.value - a.value);
  const kind = eigen.every(e => e.value < 0) ? 'maximum' : eigen.every(e => e.value > 0) ? 'minimum' : 'saddle';
  const inside = ids.every((id, i) => { const j = study.factors.findIndex(f => f.id === id), [lo, hi] = rangeOf(study, fit, j); return xs[i] >= lo - 1e-9 && xs[i] <= hi + 1e-9; });
  return { factors: ids, x: Object.fromEntries(ids.map((id, i) => [id, xs[i]])), settings, value, eigen, kind, inside };
}

/**
 * The fitted runs on a slice: [{ run, x, y (coded), distance (coded, in the other factors; a
 * categorical factor at another level counts 1), y: observed (run mean), fitted, residual }].
 */
export function runsOnSlice(study, fit, { x, y, at = {} } = {}) {
  const ix = idxOf(study, x), iy = idxOf(study, y), F = study.factors;
  const rows = fit.rows ?? [];
  const obs = fit.y ?? rows.map(r => r.y);
  const fitted = fit.fitted ?? [];
  return rows.map((r, i) => {
    const c = F.map(f => (f.type === 'categorical' ? f.levels.indexOf(r.settings[f.id]) : code(f, r.settings[f.id])));
    const dist = Math.sqrt(F.reduce((s, f, j) => (j === ix || j === iy ? s : s + (f.type === 'categorical' ? (c[j] === (at[f.id] ?? 0) ? 0 : 1) : (c[j] - (at[f.id] ?? 0)) ** 2)), 0));
    return { run: r.run, x: c[ix], y: c[iy], distance: dist, observed: obs[i], fitted: fitted[i], residual: Number.isFinite(obs[i]) && Number.isFinite(fitted[i]) ? obs[i] - fitted[i] : NaN };
  });
}

/**
 * The canonical axes to draw on a slice over factors a and b (ids): each axis's direction projected
 * onto the slice, the two lying most within it (projected length over 0.3), through the stationary
 * point. [{ x, y, dx, dy, value }] — empty when a or b is not among the stationary point's factors.
 */
export function canonicalAxesOn(sp, a, b) {
  if (!sp || !sp.factors.includes(a) || !sp.factors.includes(b)) return [];
  const ia = sp.factors.indexOf(a), ib = sp.factors.indexOf(b);
  return sp.eigen.map(e => ({ x: sp.x[a], y: sp.x[b], dx: e.vector[ia], dy: e.vector[ib], value: e.value, len: Math.hypot(e.vector[ia], e.vector[ib]) }))
    .filter(t => t.len > 0.3).sort((u, v) => v.len - u.len).slice(0, 2);
}
