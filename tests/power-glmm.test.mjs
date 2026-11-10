// Power for counts and proportions in a split-plot (issue #64): the Wald approximation with the
// whole-plot σ (power-glmm.js), checked by its own algebra, against the GLM's power, and against
// lme4::glmer simulations of the analysis's likelihood-ratio tests (tests/ref/power_glmm_r.R);
// then aikidoe's own simulation, the study wrapper and the errors.
import { readFileSync } from 'node:fs';
import { section, check, near, throws, done } from './lib/check.mjs';
import { glmmPowerFromMatrix, simulateGlmmPower, studyGlmmPower, detectableGlmmRatio } from '../js/model/power-glmm.js';
import { glmPowerFromMatrix, ratioCoefficient } from '../js/model/power.js';
import { parseFormula, modelMatrix } from '../js/model/formula.js';
import { createStudy } from '../js/study.js';
import { splitPlotFull } from '../js/design/splitplot.js';
import { toStudyDesign } from '../js/design/factorial.js';
import { LINKS } from '../js/model/glm.js';

const F = JSON.parse(readFileSync(new URL('./fixtures/power-glmm-r.json', import.meta.url), 'utf8'));
const fs2 = ['T', 'B'].map(id => ({ id, type: 'continuous', low: -1, high: 1, transform: 'none' }));
// W whole plots of k runs: T alternates between whole plots, B within them (as the R generator)
const splitPlot = (W, k) => {
  const rows = [], g = [];
  for (let w = 0; w < W; w++) for (let i = 0; i < k; i++) { rows.push({ T: w % 2 ? 1 : -1, B: i % 2 ? 1 : -1 }); g.push(`wp${w + 1}`); }
  return { mm: modelMatrix(parseFormula('T + B', fs2), fs2, rows), g };
};
const optsOf = (c) => ({ distribution: c.input.distribution, baseline: c.input.baseline, ratio: c.input.ratio, sigma: c.input.sigma, trials: c.input.trials, alpha: c.input.alpha, ...(c.input.theta ? { theta: c.input.theta } : {}) });

section('the Wald approximation: its algebra');
{
  const { mm, g } = splitPlot(8, 4), o = { distribution: 'poisson', baseline: 20, ratio: { T: 1.8, B: 1.3 }, sigma: 0.3 };
  const p = glmmPowerFromMatrix(mm, g, o);
  // λ for T from the full covariance V = W⁻¹ + σ² m/(m − q) Z Zᵀ, inverted whole (not whole plot by whole plot)
  const b = ratioCoefficient('poisson', 'log', 20, 1.8), beta = [Math.log(20), b, 0];
  const X = mm.X, n = X.length, mu = X.map(r => Math.exp(r.reduce((s, v, j) => s + v * beta[j], 0)));
  const Vm = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 / mu[i] : 0) + (g[i] === g[j] ? 0.09 * 8 / 6 : 0)));
  const inv = (A) => { const m = A.length, M = A.map((r, i) => [...r, ...A.map((_, j) => (i === j ? 1 : 0))]);
    for (let c = 0; c < m; c++) { let q = c; for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[q][c])) q = r; [M[c], M[q]] = [M[q], M[c]];
      const d = M[c][c]; for (let k = 0; k < 2 * m; k++) M[c][k] /= d; for (let r = 0; r < m; r++) if (r !== c) { const f = M[r][c]; for (let k = 0; k < 2 * m; k++) M[r][k] -= f * M[c][k]; } }
    return M.map(r => r.slice(m)); };
  const Vi = inv(Vm), XtVX = [0, 1, 2].map(a => [0, 1, 2].map(c => X.reduce((s, ra, i) => s + ra[a] * X.reduce((t, rc, j) => t + Vi[i][j] * rc[c], 0), 0)));
  const cov = inv(XtVX), m = 8, q = 2;
  near('λ for the whole-plot factor: b²/Var(b̂) with V = W⁻¹ + σ² m/(m − q) ZZᵀ', p.terms[0].lambda, b * b / cov[1][1], { rel: 1e-9 });
  check('T changes only between whole plots: F on 8 − 2 = 6 df; B within them: χ²', p.terms[0].test === 'F' && p.terms[0].ddf === 6 && p.terms[1].test === 'chi2' && p.dfGroups === 6 && JSON.stringify(p.groupLevel) === '["(Intercept)","T"]');
  const g0 = glmPowerFromMatrix(mm, o), p0 = glmmPowerFromMatrix(mm, g, { ...o, sigma: 0 });
  near('σ = 0: the subplot term has the GLM\'s power; the whole-plot term the GLM\'s λ (on an F with m − q df)', [p0.terms[1].power, p0.terms[0].lambda], [g0.terms[1].power, g0.terms[0].lambda], { rel: 1e-9 });
  const pw = (s) => glmmPowerFromMatrix(mm, g, { ...o, sigma: s }).terms.map(t => t.power);
  const [a, c] = [pw(0.1), pw(0.6)];
  check(`more whole-plot variation: T's power falls (${a[0].toFixed(3)} → ${c[0].toFixed(3)}), B's hardly moves (${a[1].toFixed(3)} → ${c[1].toFixed(3)})`, c[0] < a[0] - 0.3 && Math.abs(c[1] - a[1]) < 0.05);
  const det = detectableGlmmRatio(p, { power: 0.8 });
  near('the detectable ratio has 80 % power', [p.powerOf(1, p.lambdaAt('T', det[0].ratio), 'T'), p.powerOf(1, p.lambdaAt('B', det[1].ratio), 'B')], [0.8, 0.8], { abs: 1e-6 });
}

section('against lme4::glmer simulations of the analysis');
// The approximation ignores that a log-normal whole-plot shift also changes the counts' variance and
// that σ is estimated; against 500 simulated experiments per term it is within a few points for
// terms that vary within whole plots, and conservative for whole-plot factors: 0.5–4.5 points low
// for Poisson and binomial, 7.6 for the negative binomial (θ = 4). So whole-plot terms may be up to
// 0.08 low, but no more than the usual tolerance high.
for (const c of F.cases) {
  const { mm, g } = splitPlot(c.input.wholePlots, c.input.perWholePlot), p = glmmPowerFromMatrix(mm, g, optsOf(c));
  c.output.terms.forEach((t, i) => {
    const a = p.terms.find(x => x.term === t).power, r = c.output.power[i], tol = Math.max(0.06, 3 * c.output.se[i]), wp = c.input.wholePlotTerms.includes(t);
    check(`${c.name}, ${t}${wp ? ' (whole plot)' : ''}: approximation ${a.toFixed(3)}, ${c.input.distribution === 'negbin' ? 'glmmTMB' : 'glmer'} simulation ${r.toFixed(3)} ± ${c.output.se[i].toFixed(3)}`, a - r <= tol && r - a <= (wp ? 0.08 : tol));
  });
  check(`${c.name}: the whole-plot terms and their df as the R generator`, JSON.stringify(p.terms.filter(t => t.wholePlot).map(t => t.term)) === JSON.stringify(c.input.wholePlotTerms) && p.dfGroups === c.input.dfGroups);
}
{
  // aikidoe's own simulation (fitGLMM, likelihood-ratio tests) against glmer's, on one case
  const c = F.cases[0], { mm, g } = splitPlot(c.input.wholePlots, c.input.perWholePlot);
  const s = simulateGlmmPower(mm, g, { ...optsOf(c), nsim: 150, seed: 5 });
  s.forEach((x, i) => {
    const z = (x.power - c.output.power[i]) / Math.hypot(x.se, c.output.se[i]);
    check(`${c.name}, ${x.term}: simulated with fitGLMM ${x.power.toFixed(3)} ± ${x.se.toFixed(3)}, with glmer ${c.output.power[i].toFixed(3)} (z = ${z.toFixed(2)})`, Math.abs(z) < 3 && x.nsim >= 145);
  });
}

{
  // the negative binomial: aikidoe's simulation (θ estimated in each fit) against glmmTMB's, for the
  // subplot factor (where the extra scatter within whole plots matters most); Laplace fits, for speed,
  // as glmmTMB's are
  const c = F.cases.find(x => x.input.distribution === 'negbin');
  check('the fixture has a negative binomial case', !!c);
  if (c) {
    const { mm, g } = splitPlot(c.input.wholePlots, c.input.perWholePlot);
    const s = simulateGlmmPower(mm, g, { ...optsOf(c), nsim: 60, seed: 3, nAGQ: 1 }), i = c.output.terms.indexOf('B'), x = s.find(t => t.term === 'B');
    const z = (x.power - c.output.power[i]) / Math.hypot(x.se, c.output.se[i]);
    check(`${c.name}, B: simulated with fitGLMM ${x.power.toFixed(3)} ± ${x.se.toFixed(3)}, with glmmTMB ${c.output.power[i].toFixed(3)} (z = ${z.toFixed(2)})`, Math.abs(z) < 3 && x.nsim >= 55);
  }
}

section('nested groupings: days ⊃ whole plots');
{
  // as tests/ref/power_glmm_nested_r.R: runs fastest, then whole plots, then days
  const layout = (days, wpd, k) => {
    const rows = [], day = [], wp = []; let i = 0;
    for (let dd = 1; dd <= days; dd++) for (let w = 1; w <= wpd; w++) for (let r = 1; r <= k; r++) { const W = (dd - 1) * wpd + w; rows.push({ D: dd % 2 ? -1 : 1, T: W % 2 ? -1 : 1, B: i++ % 2 ? 1 : -1 }); day.push(dd); wp.push(W); }
    const fs3 = ['D', 'T', 'B'].map(id => ({ id, type: 'continuous', low: -1, high: 1, transform: 'none' }));
    return { mm: modelMatrix(parseFormula('D + T + B', fs3), fs3, rows), levels: [{ name: 'day', labels: day }, { name: 'whole plot', labels: wp }] };
  };
  const { mm, levels } = layout(6, 4, 2), o = { distribution: 'poisson', baseline: 15, ratio: { D: 2.2, T: 1.6, B: 1.25 }, sigma: [0.35, 0.3] };
  const p = glmmPowerFromMatrix(mm, levels, o);
  check('strata: D between days (F on 6 − 2), T between whole plots within days (F on (24 − 6) − 1), B by χ²', p.terms[0].ddf === 4 && p.terms[0].level === 'day' && p.terms[1].ddf === 17 && p.terms[1].level === 'whole plot' && p.terms[2].test === 'chi2');
  // λ for T against the full V = W⁻¹ + σ_day² ZZᵀ + σ_wp² (18/17) ZZᵀ, inverted whole
  const b = ratioCoefficient('poisson', 'log', 15, 1.6), X = mm.X, n = X.length, mu = X.map(r => 15 * Math.exp(r[2] * b));
  const s2d = 0.35 ** 2, s2w = 0.3 ** 2 * 18 / 17, dl = levels[0].labels, wl = levels[1].labels;
  const Vm = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 / mu[i] : 0) + (dl[i] === dl[j] ? s2d : 0) + (wl[i] === wl[j] ? s2w : 0)));
  const inv = (A) => { const m = A.length, M = A.map((r, i) => [...r, ...A.map((_, j) => (i === j ? 1 : 0))]);
    for (let c = 0; c < m; c++) { let q = c; for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[q][c])) q = r; [M[c], M[q]] = [M[q], M[c]];
      const d = M[c][c]; for (let k = 0; k < 2 * m; k++) M[c][k] /= d; for (let r = 0; r < m; r++) if (r !== c) { const f = M[r][c]; for (let k = 0; k < 2 * m; k++) M[r][k] -= f * M[c][k]; } }
    return M.map(r => r.slice(m)); };
  const Vi = inv(Vm), XtVX = [0, 1, 2, 3].map(a => [0, 1, 2, 3].map(c => X.reduce((s, ra, i) => s + ra[a] * X.reduce((t, rc, j) => t + Vi[i][j] * rc[c], 0), 0)));
  near('λ for the whole-plot factor from the full V, its σ² widened by 18/17', p.terms[1].lambda, b * b / inv(XtVX)[2][2], { rel: 1e-9 });
  const det = detectableGlmmRatio(p, { power: 0.8 });
  near('the detectable ratios have 80 % power', det.map(x => p.powerOf(1, p.lambdaAt(x.term, x.ratio), x.term)), [0.8, 0.8, 0.8], { abs: 1e-6 });
  throws('crossed groupings are refused', () => glmmPowerFromMatrix(mm, [{ name: 'day', labels: dl }, { name: 'run', labels: mm.X.map(r => r[3]) }], { ...o }), /not nested/);
  throws('a σ for each grouping', () => glmmPowerFromMatrix(mm, levels, { ...o, sigma: 0.3 }), /1 σ's for 2 groupings/);
  const NF = JSON.parse(readFileSync(new URL('./fixtures/power-glmm-nested-r.json', import.meta.url), 'utf8'));
  for (const c of NF.cases) {
    const L = layout(c.input.days, c.input.wholePlotsPerDay, c.input.perWholePlot);
    const a = glmmPowerFromMatrix(L.mm, L.levels, { distribution: 'poisson', baseline: c.input.baseline, ratio: c.input.ratio, sigma: [c.input.sigma.day, c.input.sigma.wp], alpha: c.input.alpha });
    c.output.terms.forEach((t, i) => {
      const x = a.terms.find(y => y.term === t), r = c.output.power[i], tol = Math.max(0.06, 3 * c.output.se[i]);
      check(`${c.name}, ${t} (${x.level ?? 'runs'}): approximation ${x.power.toFixed(3)}, glmer simulation ${r.toFixed(3)} ± ${c.output.se[i].toFixed(3)}`, x.power - r <= tol && r - x.power <= (x.level ? 0.08 : tol));
    });
  }
  {
    const c = NF.cases[0], L = layout(c.input.days, c.input.wholePlotsPerDay, c.input.perWholePlot);
    const s = simulateGlmmPower(L.mm, L.levels, { distribution: 'poisson', baseline: c.input.baseline, ratio: c.input.ratio, sigma: [c.input.sigma.day, c.input.sigma.wp], nsim: 60, seed: 4 });
    const x = s.find(y => y.term === 'T'), i = c.output.terms.indexOf('T'), z = (x.power - c.output.power[i]) / Math.hypot(x.se, c.output.se[i]);
    check(`${c.name}, T: simulated with fitGLMM (nested, Laplace) ${x.power.toFixed(3)} ± ${x.se.toFixed(3)}, with glmer ${c.output.power[i].toFixed(3)} (z = ${z.toFixed(2)})`, Math.abs(z) < 3 && x.nsim >= 55);
  }
}

section('studies and errors');
{
  const s0 = createStudy({ name: 'sp', seed: 3, factors: [{ id: 'T', low: 30, high: 37, htc: true }, { id: 'B', low: 0, high: 1 }], responses: [{ id: 'n', distribution: 'poisson' }] });
  const st = createStudy({ ...s0, design: toStudyDesign(s0, splitPlotFull([2, 2], [true, false], { replicates: 5 }), { seed: 3 }) });
  const p = studyGlmmPower(st, { model: 'T + B', distribution: 'poisson', baseline: 20, ratio: 1.5, sigma: 0.3 });
  check('a study\'s split-plot: its 10 whole plots, T judged between them', p.groups === 10 && p.terms.find(t => t.term === 'T').wholePlot && p.terms.find(t => t.term === 'T').ddf === 8 && !p.terms.find(t => t.term === 'B').wholePlot);
  const { mm, g } = splitPlot(8, 4);
  throws('the negative binomial needs θ', () => glmmPowerFromMatrix(mm, g, { distribution: 'negbin', baseline: 5, sigma: 0.3 }), /needs θ/);
  throws('a quasi model is refused', () => glmmPowerFromMatrix(mm, g, { distribution: 'quasipoisson', baseline: 5, sigma: 0.3 }), /not quasipoisson/);
  const pn = (th) => glmmPowerFromMatrix(mm, g, { distribution: 'negbin', baseline: 20, theta: th, ratio: 1.5, sigma: 0.3 }).terms.map(t => t.power), pp = glmmPowerFromMatrix(mm, g, { distribution: 'poisson', baseline: 20, ratio: 1.5, sigma: 0.3 }).terms.map(t => t.power);
  const [n2, n1e6] = [pn(2), pn(1e6)];
  check(`the negative binomial: less power than the Poisson, mostly for the subplot factor (B ${pp[1].toFixed(3)} → ${n2[1].toFixed(3)} at θ = 2; T ${pp[0].toFixed(3)} → ${n2[0].toFixed(3)}); θ → ∞ is the Poisson`,
    n2[1] < pp[1] - 0.1 && pp[0] - n2[0] < pp[1] - n2[1] && Math.abs(n1e6[0] - pp[0]) < 1e-4 && Math.abs(n1e6[1] - pp[1]) < 1e-4);
  throws('σ is needed', () => glmmPowerFromMatrix(mm, g, { distribution: 'poisson', baseline: 5 }), /σ of the whole-plot shift/);
  throws('a design without whole plots', () => studyGlmmPower({ ...st, design: { ...st.design, runs: st.design.runs.map(({ wholePlot, ...r }) => r) } }, { distribution: 'poisson', baseline: 5, sigma: 0.3 }), /no whole plots/);
  const lk = LINKS.logit, pb = glmmPowerFromMatrix(mm, g, { distribution: 'binomial', baseline: 0.3, trials: 20, ratio: 2, sigma: 0.3 });
  check('proportions: the logit link, a power between α and 1', pb.link === 'logit' && pb.terms.every(t => t.power > 0.05 && t.power < 1) && Math.abs(lk.fun(0.3) - Math.log(0.3 / 0.7)) < 1e-12);
}

done();
