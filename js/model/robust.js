// Robust design: propagation of error and dual-response optimisation (spec §8; issue #19).
//
// Propagation of error (POE). With a fitted surface f(x) and random deviations of the factors —
// noise factors z ~ N(mean, sd²) (varied in the experiment, random in production) and control
// factors set with a tolerance (sd of the actual value about the setting) — the response at
// settings x has, to second order (exact when f is quadratic and the deviations normal),
//   E[y]   ≈ f(x̄) + ½ Σ_i H_ii σ_i²
//   Var[y] ≈ Σ_i g_i² σ_i² + ½ Σ_i Σ_j H_ij² σ_i² σ_j² + σ²
// with g, H the gradient and Hessian of f in natural units at x̄ (noise factors at their mean)
// and σ² the residual (run-to-run) variance. For a model linear in the noise factor this is the
// response-model approach (Myers & Montgomery; Montgomery, Design and Analysis of Experiments,
// ch. on robust parameter design): E[y] = f(x, z̄), Var[y] = σ_z² (∂f/∂z)² + σ².
//
// Dual response (Vining & Myers 1990): optimise a mean μ(x) and a standard deviation σ(x) — from
// POE, or from a second fitted model of log s (a per-wafer or replicate summary, #16):
//   'target':   minimise σ(x) subject to μ(x) = T (Vining–Myers), solved by a penalty sequence
//               on (μ − T)² then polished, in the cube (or sphere) of the control factors;
//   'mse':      minimise (μ − T)² + σ² (Lin & Tu 1995);
//   'maximize' / 'minimize': optimise μ subject to σ ≤ σ_max.
import { decode, code } from '../study.js';
import { rng } from '../design/rng.js';
import { toleranceSd } from '../sim/sample.js';

const H_REL = 1e-4;     // finite-difference step, relative to the factor's half-range

/**
 * POE at settings (natural units). predict(settings) → ŷ; study factors give tolerance / noise;
 * opts: sigma (residual sd, default 0), residualVar (a function of the mean giving the residual
 * variance, for counts and proportions, instead of sigma), extra ({ id: sd } overriding), order (1 or 2).
 * Returns { mean, sd, var, parts: [{ id, sd, contribution }], residual, gradient, hessianTerm }.
 */
export function propagationOfError(study, predict, settings, { sigma = 0, residualVar, extra = {}, order = 2 } = {}) {
  const fs = study.factors.filter(f => f.type !== 'categorical');
  const sds = fs.map(f => extra[f.id] ?? f.noise?.sd ?? (f.tolerance !== undefined ? toleranceSd(f.tolerance) : 0));
  const at = { ...settings };
  for (const f of fs) if (f.noise && settings[f.id] === undefined) at[f.id] = f.noise.mean ?? decode(f, 0);
  const idx = fs.map((_, i) => i).filter(i => sds[i] > 0);
  const step = fs.map(f => H_REL * Math.abs(f.high - f.low) / 2 || 1e-6);
  const fAt = (dx) => predict({ ...at, ...Object.fromEntries(dx.map(([i, d]) => [fs[i].id, at[fs[i].id] + d])) });
  const f0 = predict(at);
  const g = new Array(fs.length).fill(0), H = fs.map(() => new Array(fs.length).fill(0));
  for (const i of idx) {
    const hi = step[i], fp = fAt([[i, hi]]), fm = fAt([[i, -hi]]);
    g[i] = (fp - fm) / (2 * hi);
    H[i][i] = (fp - 2 * f0 + fm) / (hi * hi);
    if (order > 1) for (const j of idx) if (j > i) {
      const hj = step[j];
      H[i][j] = H[j][i] = (fAt([[i, hi], [j, hj]]) - fAt([[i, hi], [j, -hj]]) - fAt([[i, -hi], [j, hj]]) + fAt([[i, -hi], [j, -hj]])) / (4 * hi * hj);
    }
  }
  let v1 = 0, v2 = 0, bias = 0;
  const parts = idx.map(i => { const c = g[i] ** 2 * sds[i] ** 2; v1 += c; return { id: fs[i].id, sd: sds[i], slope: g[i], contribution: c }; });
  if (order > 1) for (const i of idx) { bias += 0.5 * H[i][i] * sds[i] ** 2; for (const j of idx) v2 += 0.5 * H[i][j] ** 2 * sds[i] ** 2 * sds[j] ** 2; }
  const res = residualVar ? residualVar(f0 + bias) : sigma * sigma;
  const v = v1 + v2 + res;
  return { mean: f0 + bias, nominal: f0, sd: Math.sqrt(v), var: v, transmitted: v1 + v2, residual: res, parts, curvature: v2, at };
}

/**
 * Dual-response optimisation. mu(settings) and sd(settings) are functions; study gives the
 * factors (noise factors stay at their mean and are not optimised). opts: goal ('target' |
 * 'mse' | 'maximize' | 'minimize'), target, maxSd, region ('cube' | 'sphere'), radius, fixed,
 * seed, starts. Returns { settings, mu, sd, objective, feasible }.
 */
export function dualResponse(study, mu, sd, { goal = 'target', target, maxSd = Infinity, region = 'cube', radius, fixed = {}, seed = 1, starts = 12 } = {}) {
  if ((goal === 'target' || goal === 'mse') && !Number.isFinite(target)) throw new Error(`goal "${goal}" needs a target value`);
  const ctl = study.factors.filter(f => f.type !== 'categorical' && !f.noise && fixed[f.id] === undefined);
  const k = ctl.length, R = radius ?? (region === 'sphere' ? Math.sqrt(k) : 1);
  if (!k) throw new Error('no control factors to optimise (all are noise, categorical or held)');
  const base = Object.fromEntries(study.factors.map(f => [f.id, fixed[f.id] ?? (f.noise ? f.noise.mean ?? decode(f, 0) : f.type === 'categorical' ? f.levels[0] : decode(f, 0))]));
  const project = (x) => { let y = x.map(v => Math.max(-R, Math.min(R, v))); if (region === 'sphere') { const n = Math.hypot(...y); if (n > R) y = y.map(v => v * R / n); } return y; };
  const settingsOf = (x) => ({ ...base, ...Object.fromEntries(ctl.map((f, j) => [f.id, decode(f, x[j])])) });
  const scaleMu = Math.max(1e-12, Math.abs(target ?? 1));
  const objective = (x, w) => {
    const s = settingsOf(x), m = mu(s), d = sd(s);
    switch (goal) {
      case 'target': return d + w * ((m - target) / scaleMu) ** 2;
      case 'mse': return (m - target) ** 2 + d * d;
      case 'maximize': return -m + w * Math.max(0, d - maxSd) ** 2;
      case 'minimize': return m + w * Math.max(0, d - maxSd) ** 2;
      default: throw new Error(`unknown goal "${goal}" (target, mse, maximize, minimize)`);
    }
  };
  const g = rng(seed);
  const cands = [Array(k).fill(0)];
  for (let i = 0; i < 400; i++) cands.push(project(Array.from({ length: k }, () => (2 * g.random() - 1) * R)));
  const w0 = goal === 'mse' ? 0 : 1;
  let best = null;
  for (const x0 of cands.map(x => ({ x, f: objective(x, w0 * 1e3) })).sort((a, b) => a.f - b.f).slice(0, starts).map(c => c.x)) {
    let x = x0;
    // penalty continuation for the equality / inequality, then polish at the largest weight
    for (const w of goal === 'mse' ? [0] : [1e1, 1e3, 1e5, 1e7, 1e9]) {
      x = project(nm((z) => objective(project(z), w), x, 0.2 * R));
      for (let pass = 0; pass < 2; pass++) for (let j = 0; j < k; j++) {
        let st = 0.02 * R;
        while (st > 1e-9) {
          const c = objective(x, w), up = project(x.map((v, t) => (t === j ? v + st : v))), dn = project(x.map((v, t) => (t === j ? v - st : v)));
          if (objective(up, w) < c) x = up; else if (objective(dn, w) < c) x = dn; else st /= 2;
        }
      }
    }
    const s = settingsOf(x), m = mu(s), d = sd(s);
    const feasible = goal === 'target' ? Math.abs(m - target) <= 1e-6 * Math.max(1, Math.abs(target)) : goal === 'mse' ? true : d <= maxSd * (1 + 1e-9);
    const obj = goal === 'target' ? d : goal === 'mse' ? (m - target) ** 2 + d * d : goal === 'maximize' ? -m : m;
    if (!best || (feasible && !best.feasible) || (feasible === best.feasible && obj < best.obj - 1e-12)) best = { settings: s, coded: Object.fromEntries(ctl.map((f, j) => [f.id, x[j]])), mu: m, sd: d, obj, feasible };
  }
  return { settings: best.settings, coded: best.coded, mu: best.mu, sd: best.sd, objective: best.obj, feasible: best.feasible };
}

function nm(fn, x0, step, iter = 800) {
  const n = x0.length;
  let S = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step : v)))].map(x => ({ x, f: fn(x) }));
  for (let it = 0; it < iter; it++) {
    S.sort((a, b) => a.f - b.f);
    if (Math.abs(S[n].f - S[0].f) <= 1e-14 * (1 + Math.abs(S[0].f)) && it > 30) break;
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

/** POE surface: σ_y over two continuous control factors, others at `at`. */
export function poeGrid(study, predict, at, fx, fy, { n = 31, sigma = 0, residualVar } = {}) {
  const X = study.factors.find(f => f.id === fx), Y = study.factors.find(f => f.id === fy);
  const xs = [...Array(n).keys()].map(i => decode(X, -1 + 2 * i / (n - 1))), ys = [...Array(n).keys()].map(i => decode(Y, -1 + 2 * i / (n - 1)));
  return { fx, fy, xs, ys, cells: ys.map(yv => xs.map(xv => propagationOfError(study, predict, { ...at, [fx]: xv, [fy]: yv }, { sigma, residualVar }))) };
}

export { code as _code };
