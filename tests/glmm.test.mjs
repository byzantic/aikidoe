// Generalised linear mixed models with one random intercept (issue #64, phase 5): checked against
// lme4::glmer (tests/ref/glmm_r.R) for Poisson counts with an exposure, binomial proportions with
// the logit and probit links, pass/fail results and a fit on the boundary (σ = 0), by adaptive
// Gauss–Hermite quadrature (nAGQ = 25) and the Laplace approximation (nAGQ = 1); then the
// boundary, the likelihood-ratio tests, study fits with random whole plots and blocks, and by
// simulation the coverage of the intervals for a whole-plot factor and of the prediction interval
// for a new run in a new whole plot; and model reduction (issue #78) against backward elimination
// of glmer fits (tests/ref/reduce_glmm_r.R).
import { readFileSync } from 'node:fs';
import { section, check, near, throws, done } from './lib/check.mjs';
import { fitGLMM, glmmTests, glmmCompare, glmmPredict, glmmLoglikAt, glmmConfint, fitCountMixedModel, predictCountMixed, randomGroupOf } from '../js/model/glmm.js';
import { fitGLM } from '../js/model/glm.js';
import { fitModel } from '../js/model/fit.js';
import { parseFormula, modelMatrix } from '../js/model/formula.js';
import { createStudy } from '../js/study.js';
import { splitPlotFull } from '../js/design/splitplot.js';
import { toStudyDesign, fullFactorial } from '../js/design/factorial.js';
import { runVirtual, hashUniform, countQuantile } from '../js/learn/process.js';
import { normal } from '../js/dist.js';
import { reduceGLMM } from '../js/model/reduce.js';

const F = JSON.parse(readFileSync(new URL('./fixtures/glmm-r.json', import.meta.url), 'utf8'));
const fs3 = ['A', 'B', 'C'].map(id => ({ id, type: 'continuous', low: -1, high: 1, transform: 'none' }));
const mmOf = (formula, d) => modelMatrix(parseFormula(formula, fs3), fs3, d.A.map((_, i) => ({ A: d.A[i], B: d.B[i], C: d.C[i] })));
const caseData = (c) => {
  const d = c.input.data, prop = c.input.distribution !== 'poisson';
  return { d, y: prop ? d.y.map((v, i) => v / (d.trials ? d.trials[i] : 1)) : d.y, g: d[c.input.group],
    o: { distribution: c.input.distribution, link: c.input.link, nAGQ: c.input.nAGQ, ...(d.trials ? { weights: d.trials } : {}), ...(d.exposure ? { offset: d.exposure.map(Math.log) } : {}) } };
};

section('against lme4::glmer: adaptive quadrature (nAGQ = 25) and Laplace (nAGQ = 1)');
// AGQ agrees to the optimiser's precision. For nAGQ = 1, lme4's own objective differs from the
// Laplace approximation computed here by up to 1e-4 in the log-likelihood (its penalised iteratively
// reweighted least squares conventions); the estimates then agree to about 1e-3. Laplace standard
// errors are not recorded: lme4's own moved by up to 0.3 % between versions 1.1-35 and 2.1.
for (const c of F.cases) {
  const { d, y, g, o } = caseData(c), R = c.output, agq = c.input.nAGQ > 1;
  const T = agq ? { coef: 2e-5, se: 2e-4, sigma: 2e-5, ll: 1e-6, obj: 1e-8, lr: 2e-4, modes: 2e-5 } : { coef: 1e-3, se: 5e-3, sigma: 1e-3, ll: 2e-4, obj: 2e-4, lr: 2e-3, modes: 2e-3 };
  const fit = fitGLMM(mmOf(c.input.formula, d), y, g, o);
  const small = fitGLMM(mmOf(`${c.input.formula} - ${c.input.drop}`, d), y, g, o);
  near(`${c.name}: coefficients`, fit.coef, R.coef, { abs: T.coef });
  if (R.se) near(`${c.name}: standard errors (Wald, as lme4)`, fit.seWald, R.se, { rel: T.se });
  near(`${c.name}: σ of the random intercept`, fit.sigma, R.sigma, { abs: T.sigma });
  near(`${c.name}: log-likelihood`, fit.loglik, R.loglik, { abs: T.ll });
  near(`${c.name}: the objective at glmer's estimates`, glmmLoglikAt(mmOf(c.input.formula, d), y, g, o, R.coef, R.sigma), R.loglik, { abs: T.obj });
  near(`${c.name}: conditional modes of the ${c.input.group === 'wholePlot' ? 'whole plots' : 'blocks'}`, R.groups.map(k => fit.modes[k]), R.modes, { abs: T.modes });
  const lr = glmmCompare(fit, small);
  near(`${c.name}: likelihood-ratio test of ${c.input.drop}`, [lr.chi2, lr.df], [R.lr.chisq, R.lr.df], { abs: T.lr });
  check(`${c.name}: converged`, fit.converged && fit.boundary === (R.sigma === 0));
}

section('the boundary: no variation between groups');
{
  const c = F.cases.find(x => x.name === 'poisson-boundary-agq25'), { d, y, g, o } = caseData(c);
  const fit = fitGLMM(mmOf(c.input.formula, d), y, g, o), glm = fitGLM(mmOf(c.input.formula, d), y, { distribution: 'poisson' });
  check('σ = 0, flagged; the estimates, standard errors and log-likelihood are the GLM\'s', fit.boundary && fit.sigma === 0 && Math.max(...fit.coef.map((b, j) => Math.abs(b - glm.coef[j]))) < 1e-10
    && Math.max(...fit.se.map((s, j) => Math.abs(s - glm.se[j]))) < 1e-10 && Math.abs(fit.loglik - glm.loglik) < 1e-8);
  check('the test of σ = 0: χ² 0, p 1', fit.sigmaTest.chi2 === 0 && fit.sigmaTest.p === 1);
  const c2 = F.cases.find(x => x.name === 'poisson-blocks-agq25'), q = caseData(c2), f2 = fitGLMM(mmOf(c2.input.formula, q.d), q.y, q.g, q.o);
  const glm2 = fitGLM(mmOf(c2.input.formula, q.d), q.y, { distribution: 'poisson', offset: q.o.offset });
  near('the test of σ = 0 is the likelihood ratio against the GLM, halved (½χ²₀ + ½χ²₁)', [f2.sigmaTest.chi2, f2.sigmaTest.p], [2 * (f2.loglik - glm2.loglik), normal.sf(Math.sqrt(2 * (f2.loglik - glm2.loglik)))], { rel: 1e-6 });
  const lap = fitGLMM(mmOf(c2.input.formula, q.d), q.y, q.g, { ...q.o, nAGQ: 1 });
  near('counts of 10–200: Laplace and quadrature agree closely', [lap.sigma, lap.loglik], [f2.sigma, f2.loglik], { abs: 5e-3 });
  // relabelling the groups changes nothing
  const perm = q.g.map(v => `day-${(v * 7) % 13}`);
  const f3 = fitGLMM(mmOf(c2.input.formula, q.d), q.y, perm, q.o);
  near('group labels are only labels', [f3.loglik, f3.sigma, ...f3.coef], [f2.loglik, f2.sigma, ...f2.coef], { abs: 1e-8 });
}

section('tests of the terms');
{
  const c = F.cases.find(x => x.name === 'poisson-blocks-agq25'), { d, y, g, o } = caseData(c);
  const fit = fitGLMM(mmOf('count ~ A*B + C', d), y, g, o);
  const t2 = glmmTests(fit, 2), t3 = glmmTests(fit, 3), t1 = glmmTests(fit, 1);
  const drop = (f) => glmmCompare(fit, fitGLMM(mmOf(f, d), y, g, o));
  near('type III: each term against the model without it', t3.map(r => r.chi2), ['count ~ B + C + A:B', 'count ~ A + C + A:B', 'count ~ A*B', 'count ~ A + B + C'].map(f => drop(f).chi2), { rel: 1e-6 });
  const noA = glmmCompare(fitGLMM(mmOf('count ~ A + B + C', d), y, g, o), fitGLMM(mmOf('count ~ B + C', d), y, g, o));
  near('type II: A against the model without A and A:B', t2.find(r => r.term === 'A').chi2, noA.chi2, { rel: 1e-6 });
  near('type I: sequential, the last term as type III', t1.at(-1).chi2, t3.find(r => r.term === t1.at(-1).term).chi2, { rel: 1e-6 });
  check('rows: term, df, χ², p', t2.every(r => r.df === 1 && r.chi2 >= 0 && r.p > 0 && r.p <= 1) && t2.map(r => r.term).join() === 'A,B,C,A:B');
  const ci = glmmConfint(fit), j = fit.columns.indexOf('A');
  near('Wald intervals, with rate ratios', [ci[j].lower, ci[j].ratio.estimate], [fit.coef[j] - 1.959963984540054 * fit.se[j], Math.exp(fit.coef[j])], { rel: 1e-9 });
  // here each block is half a replicate with C fixed: C (and the intercept) vary only between blocks
  const jc = fit.columns.indexOf('C');
  check('C is constant within each block: a group-level coefficient, with a t interval on 12 − 2 = 10 df', fit.groupLevel.includes('C') && fit.df[jc] === 10 && ci[jc].method === 'wald-t');
  throws('a negative binomial is refused (the random effect takes the variation between groups)', () => fitGLMM(mmOf('count ~ A', d), y, g, { distribution: 'negbin' }), /Poisson counts, binomial proportions and pass\/fail/);
  throws('one group is refused', () => fitGLMM(mmOf('count ~ A', d), y, g.map(() => 1), o), /at least two/);
}

// ---------------------------------------------------------------- studies

const splitPlotCounts = ({ seed = 1, wp = 0.5, plots = 12, base = 30, T = 0.2, B = -0.25 } = {}) => {
  const s0 = createStudy({ name: 's', seed: 3, factors: [{ id: 'T', low: 20, high: 30, htc: true }, { id: 'B', low: 0, high: 1 }], responses: [{ id: 'n', distribution: 'poisson' }] });
  const st = createStudy({ ...s0, design: toStudyDesign(s0, splitPlotFull([2, 2], [true, false], { replicates: plots / 2 }), { seed: 3 }) });
  const proc = { seed, factors: s0.factors, responses: [{ id: 'n', distribution: 'poisson', truth: { intercept: Math.log(base), terms: { T, B } } }], nuisance: { wholePlot: wp } };
  return createStudy(runVirtual(proc, st));
};

section('studies: random whole plots and random blocks');
{
  const st = splitPlotCounts();
  check('auto: the whole plots of a split-plot', JSON.stringify(randomGroupOf(st)) === JSON.stringify({ id: 'wholePlot', name: 'whole plot', m: 12 }));
  const f = fitCountMixedModel(st, 'n ~ T + B');
  const glm = fitModel(st, 'n ~ T + B');
  check('a split-plot with counts: the GLMM; the hard-to-change T\'s standard error is several times the GLM\'s, B\'s about the same',
    f.kind === 'glmm' && f.random.id === 'wholePlot' && f.se[1] > 3 * glm.se[1] && Math.abs(f.se[2] / glm.se[2] - 1) < 0.25, `${f.se[1]} vs ${glm.se[1]}`);
  const p = predictCountMixed(f, [{ T: 30, B: 1 }], {})[0];
  check('predictions: a typical whole plot, averaged over whole plots (larger: exp(σ²/2) on the log scale), a new run in a new whole plot',
    Math.abs(p.marginal / p.fit - Math.exp(f.sigma ** 2 / 2)) < 1e-6 && p.predLower < p.lower && p.predUpper > p.upper);
  // random blocks: a blocked factorial, the Block term dropped from the fixed part
  const b0 = createStudy({ name: 'b', seed: 2, factors: [{ id: 'A', low: -1, high: 1 }, { id: 'B', low: -1, high: 1 }], responses: [{ id: 'k', distribution: 'binomial', trials: 30 }] });
  const bd = createStudy({ ...b0, design: toStudyDesign(b0, fullFactorial([2, 2], { replicates: 8 }), { seed: 2 }) });
  const blocked = createStudy({ ...bd, design: { ...bd.design, runs: bd.design.runs.map((r, i) => ({ ...r, block: 1 + (i % 8) })) } });
  const done = createStudy(runVirtual({ seed: 4, factors: b0.factors, responses: [{ id: 'k', distribution: 'binomial', truth: { intercept: 0.2, terms: { A: 0.5 } } }], nuisance: { block: 0.6 } }, blocked));
  check('auto does not make blocks random (they stay a fixed term)', randomGroupOf(done) === null && fitModel(done, 'k ~ A + B').columns.some(c => c.startsWith('Block')));
  const fb = fitCountMixedModel(done, 'k ~ A + B', { random: 'block' });
  check('random: block — a random intercept per block, no Block term among the fixed effects', fb.random.id === 'block' && fb.random.m === 8 && !fb.columns.some(c => c.startsWith('Block')) && fb.sigma > 0.2);
  throws('random whole plots in a design without them', () => fitCountMixedModel(done, 'k ~ A', { random: 'wholePlot' }), /no whole plots/);
  throws('a measurement has the REML mixed model instead', () => fitCountMixedModel({ ...done, responses: [{ id: 'k' }] }, 'k ~ A', { random: 'block' }), /measurement/);
}

section('by simulation: whole-plot factors and new whole plots, with the small-sample correction');
{
  // 12 whole plots of 2 runs, whole-plot σ 0.5 on the log scale. The GLM ignores the whole plots;
  // the GLMM's plain Wald z interval (lme4's) is too narrow with so few whole plots; the corrected
  // one (√(m/(m − q)) and t on m − q df) holds its level. Then the prediction interval for a new
  // run in a new whole plot, and the size of the whole-plot test when T has no effect.
  let corr = 0, wald = 0, glmIn = 0, piIn = 0, n = 0, rejF = 0, rejChi = 0, n0 = 0;
  const z = 1.959963984540054;
  for (let s = 1; s <= 150; s++) {
    const st = splitPlotCounts({ seed: 1000 + s });
    const f = fitCountMixedModel(st, 'n ~ T + B'), g = fitModel(st, 'n ~ T + B'), j = f.columns.indexOf('T');
    const ci = glmmConfint(f).find(c => c.name === 'T');
    if (ci.lower <= 0.2 && 0.2 <= ci.upper) corr++;
    if (Math.abs(f.coef[j] - 0.2) <= z * f.seWald[j]) wald++;
    if (Math.abs(g.coef[j] - 0.2) <= z * g.se[j]) glmIn++;
    // a new run at T = 30, B = 0 (coded +1, −1) in a new whole plot, drawn as the process would
    const p = predictCountMixed(f, [{ T: 30, B: 0 }], {})[0];
    const mu = 30 * Math.exp(0.2 + 0.25 + 0.5 * normal.ppf(hashUniform('newwp', s))), y = countQuantile('poisson', hashUniform('newrun', s), mu);
    if (p.predLower <= y && y <= p.predUpper) piIn++;
    n++;
    if (s <= 100) {
      const f0 = fitCountMixedModel(splitPlotCounts({ seed: 5000 + s, T: 0 }), 'n ~ T + B'), row = glmmTests(f0, 2).find(r => r.term === 'T');
      if (row.p < 0.05) rejF++; if (row.chi2 > 3.841458820694124) rejChi++; n0++;
    }
  }
  check(`T (hard to change): the corrected 95 % interval covers in ${(100 * corr / n).toFixed(0)} % of ${n}; lme4's Wald z in ${(100 * wald / n).toFixed(0)} %; the GLM's in ${(100 * glmIn / n).toFixed(0)} %`, corr / n >= 0.92 && wald < corr && glmIn / n < 0.6);
  check(`a new run in a new whole plot: the prediction interval covers in ${(100 * piIn / n).toFixed(0)} %`, piIn / n >= 0.89);
  check(`no effect of T: the test of T (F on ${splitPlotCounts().design.runs.length / 2 - 2} df) rejects in ${rejF} of ${n0} at 5 %; the plain χ² in ${rejChi}`, rejF / n0 <= 0.09 && rejF / n0 >= 0.01 && rejChi >= rejF);
  const f = fitCountMixedModel(splitPlotCounts(), 'n ~ T + B');
  check('the group-level coefficients: the intercept and T, on 12 − 2 = 10 df; B keeps z', JSON.stringify(f.groupLevel) === '["(Intercept)","T"]' && f.dfGroups === 10 && f.df[f.columns.indexOf('B')] === Infinity
    && Math.abs(f.se[1] / f.seWald[1] - Math.sqrt(1.2)) < 1e-12 && f.se[2] === f.seWald[2]);
  const t = glmmTests(f, 2);
  check('… its likelihood-ratio test is χ²/df as an F on (1, 10); B\'s a χ²', t[0].term === 'T' && t[0].ddf === 10 && Math.abs(t[0].F - t[0].chi2) < 1e-12 && t[1].F === undefined);
}

section('model reduction against backward elimination of lme4::glmer fits');
// glmer's AIC for nAGQ > 1 leaves out a constant (lme4 1.x) or not (2.x): AICc is compared as the
// change from the starting model's, which both share.
const R = JSON.parse(readFileSync(new URL('./fixtures/reduce-glmm-r.json', import.meta.url), 'utf8'));
const studyOfCase = (c) => {
  const d = c.input.data, ids = Object.keys(d).filter(k => k.length === 1 && k !== 'g' && k !== 'y');
  const runs = d.y.map((_, i) => ({ run: i + 1, settings: Object.fromEntries(ids.map(id => [id, d[id][i]])), [c.input.group]: d.g[i] }));
  return createStudy({ aikidoe: 1, seed: 1, factors: ids.map(id => ({ id, low: -1, high: 1 })),
    responses: [{ id: 'y', distribution: c.input.distribution, ...(c.input.trials ? { trials: c.input.trials } : {}) }],
    design: { runs }, observations: d.y.map((v, i) => ({ run: i + 1, response: 'y', value: v })) });
};
for (const c of R.cases) {
  const st = studyOfCase(c), r = reduceGLMM(st, c.input.formula, { method: c.input.method, alphaOut: c.input.alphaOut, random: c.input.group });
  const want = c.output.steps;
  check(`${c.name}: the same terms dropped in the same order (${want.map(s => s.drop).join(', ')})`, JSON.stringify(r.steps.map(s => s.drop)) === JSON.stringify(want.map(s => s.drop)), r.steps.map(s => s.drop).join(', '));
  check(`${c.name}: the same final model`, JSON.stringify(r.fit.model.terms.map(t => t.label)) === JSON.stringify(c.output.final));
  if (r.steps.length !== want.length) continue;
  check(`${c.name}: whole-plot or block-level terms as F tests on the same df`, r.steps.every((s, i) => (s.F === undefined) === (want[i].F === undefined) && (s.ddf ?? 0) === (want[i].ddf ?? 0) && s.df === want[i].df));
  near(`${c.name}: each step's χ², p and change in AICc`, r.steps.map(s => [s.chi2, s.p, s.aicc - r.start.aicc]), want.map(s => [s.chi2, s.p, s.daicc]), { rel: 2e-4, abs: 2e-4 });
}
{
  const c = R.cases[0], st = studyOfCase(c);
  const k = reduceGLMM(st, c.input.formula, { keep: ['B'] });
  check('keep: B stays (and so the reduction stops short of it)', k.fit.model.terms.some(t => t.label === 'B') && !k.steps.some(s => s.drop === 'B'));
  throws('unknown method', () => reduceGLMM(st, 'y ~ A', { method: 'bic' }), /method must be/);
}

done();
