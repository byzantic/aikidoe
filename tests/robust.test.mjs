// Robust design (issue #19): propagation of error and dual-response optimisation. Worked
// example: the filtration-rate 2⁴ data of Montgomery, Design and Analysis of Experiments
// (example 6.2; data cross-checked against an independent copy), with temperature treated as a
// noise variable (σ_z = 1, coded). The mean and variance models follow from the data; the
// optimisation is checked analytically and by search, not against a published optimum.
import { section, check, near, throws, done } from './lib/check.mjs';
import { createStudy } from '../js/study.js';
import { fitModel } from '../js/model/ols.js';
import { propagationOfError, dualResponse, poeGrid } from '../js/model/robust.js';
import { EXAMPLES } from '../ui/examples.js';

const ex = EXAMPLES.find(e => e.id === 'filtration').build();
const fit = fitModel(ex, 'rate ~ A + C + D + A:C + A:D');
const pred = (s) => { const x = { A: s.A, C: s.C, D: s.D }; return fit.coef[0] + fit.coef[1] * x.A + fit.coef[2] * x.C + fit.coef[3] * x.D + fit.coef[4] * x.A * x.C + fit.coef[5] * x.A * x.D; };

section('response model from the example 6.2 data, temperature as noise');
{
  // the example's effects: A 21.625, C 9.875, D 14.625, AC −18.125, AD 16.625; coefficients are half
  near('ŷ = 70.06 + 10.81 z + 4.94 x_C + 7.31 x_D − 9.06 z x_C + 8.31 z x_D', fit.coef, [70.0625, 10.8125, 4.9375, 7.3125, -9.0625, 8.3125], { abs: 1e-10 });
  near('σ̂² = MS_E = 19.51 (10 df)', [fit.sigma ** 2, fit.dfRes], [19.5125, 10], { abs: 1e-10 });
}

section('propagation of error: mean and variance models');
{
  const s2 = fit.sigma ** 2;
  for (const [C, D] of [[0, 0], [1, -1], [-0.5, 0.7], [0.887, -0.334]]) {
    const p = propagationOfError(ex, pred, { B: 0, C, D }, { sigma: fit.sigma });
    near(`at C = ${C}, D = ${D}: E[y] = 70.06 + 4.94 C + 7.31 D (z at its mean)`, p.mean, 70.0625 + 4.9375 * C + 7.3125 * D, { abs: 1e-6 });
    near(`… Var[y] = σ_z² (10.81 − 9.06 C + 8.31 D)² + σ²`, p.var, (10.8125 - 9.0625 * C + 8.3125 * D) ** 2 + s2, { rel: 1e-6 });
  }
  // second order: f = x² with x ~ N(x0, σ²): E = x0² + σ², Var = 4 x0² σ² + 2 σ⁴ (exact for a quadratic)
  const q = createStudy({ aikidoe: 1, seed: 1, factors: [{ id: 'x', low: -2, high: 2, tolerance: 0.3 }] });
  const p2 = propagationOfError(q, (s) => s.x ** 2, { x: 1.2 });
  near('second order: quadratic surface, E and Var exact', [p2.mean, p2.var], [1.44 + 0.09, 4 * 1.44 * 0.09 + 2 * 0.09 ** 2], { rel: 1e-6 });
  near('first order only drops the curvature terms', propagationOfError(q, (s) => s.x ** 2, { x: 1.2 }, { order: 1 }).var, 4 * 1.44 * 0.09, { rel: 1e-6 });
  const g = poeGrid(ex, pred, { A: 0, B: 0 }, 'C', 'D', { n: 5, sigma: fit.sigma });
  check('POE surface over C and D', g.cells.length === 5 && Math.abs(g.cells[0][0].var - ((10.8125 + 9.0625 - 8.3125) ** 2 + s2)) < 1e-6);
}

section('dual response: Vining–Myers and Lin–Tu');
{
  const mu = (s) => propagationOfError(ex, pred, s, { sigma: fit.sigma }).mean, sd = (s) => propagationOfError(ex, pred, s, { sigma: fit.sigma }).sd;
  // μ = 72: the zero-slope line 10.81 − 9.06C + 8.31D = 0 crosses μ = 72 inside the cube, so σ = σ̂
  const v = dualResponse(ex, mu, sd, { goal: 'target', target: 72, fixed: { B: 0 } });
  const C = (10.8125 + 8.3125 * 1.9375 / 7.3125) / (9.0625 + 8.3125 * 4.9375 / 7.3125), D = (1.9375 - 4.9375 * C) / 7.3125;
  near('target 72: min σ on μ = 72 — where the temperature effect cancels (C ≈ 0.887, D ≈ −0.334)', [v.settings.C, v.settings.D], [C, D], { abs: 1e-4 });
  near('… σ = σ̂ = √19.51 (no transmitted variation), μ on target', [v.sd, v.mu], [Math.sqrt(19.5125), 72], { abs: 1e-6 });
  // μ = 76 lies beyond the zero-slope line in the cube: the minimum σ is on the boundary — check by brute force
  const w = dualResponse(ex, mu, sd, { goal: 'target', target: 76, fixed: { B: 0 } });
  let bf = Infinity;
  for (let i = 0; i <= 4000; i++) { const c = -1 + 2 * i / 4000, d = (76 - 70.0625 - 4.9375 * c) / 7.3125; if (Math.abs(d) <= 1) bf = Math.min(bf, sd({ B: 0, C: c, D: d })); }
  near('target 76: min σ on μ = 76 matches a fine search along the constraint', [w.sd, w.mu], [bf, 76], { rel: 1e-5 });
  check('… and it is larger: higher rate costs robustness', w.sd > v.sd + 0.5);
  const m = dualResponse(ex, mu, sd, { goal: 'mse', target: 76, fixed: { B: 0 } });
  let bm = Infinity; for (let i = 0; i <= 200; i++) for (let j = 0; j <= 200; j++) { const s = { B: 0, C: -1 + i / 100, D: -1 + j / 100 }; bm = Math.min(bm, (mu(s) - 76) ** 2 + sd(s) ** 2); }
  check('Lin–Tu MSE: at least as good as a 201² grid', m.objective <= bm + 1e-9, `${m.objective} vs ${bm}`);
  const mx = dualResponse(ex, mu, sd, { goal: 'maximize', maxSd: 6, fixed: { B: 0 } });
  check('maximise μ subject to σ ≤ 6', mx.feasible && mx.sd <= 6 + 1e-6 && mx.mu > 72);
  throws('target goal needs a target', () => dualResponse(ex, mu, sd, { goal: 'target' }), /needs a target/);
}

section('dual response from two fitted models (mean and log s)');
{
  // synthetic: μ = 10 + 2a + b, s = exp(0.2 + 0.8a − 0.5b) → minimise s with μ = 11
  const st = createStudy({ aikidoe: 1, seed: 1, factors: [{ id: 'a', low: -1, high: 1 }, { id: 'b', low: -1, high: 1 }] });
  const r = dualResponse(st, (s) => 10 + 2 * s.a + s.b, (s) => Math.exp(0.2 + 0.8 * s.a - 0.5 * s.b), { goal: 'target', target: 11 });
  // on μ = 11: b = 1 − 2a; log s = 0.2 + 0.8a − 0.5 + a = −0.3 + 1.8a → smallest a with |b| ≤ 1 → a = 0, b = 1
  near('analytic optimum on the constraint', [r.settings.a, r.settings.b, r.mu], [0, 1, 11], { abs: 1e-5 });
  check('study format: noise and tolerance validated', (() => { try { createStudy({ aikidoe: 1, seed: 1, factors: [{ id: 'a', low: 0, high: 1, noise: { sd: -1 } }] }); return false; } catch (e) { return /noise/.test(e.message); } })());
}
done();
