// Generalised linear models (issue #64, phase 1), against R: glm, MASS::glm.nb, car::Anova,
// MASS confint (profile) and brglm2 (Firth) — tests/ref/glm_r.R.
import { readFileSync } from 'node:fs';
import { section, check, near, done } from './lib/check.mjs';
import { parseFormula, modelMatrix } from '../js/model/formula.js';
import { fitGLM, glmTests, glmConfint, glmPredict, glmCompare, thetaML, glmEnvelope, glmVariance, predictiveInterval, _draw } from '../js/model/glm.js';
import { rng } from '../js/design/rng.js';
import { confirmationRuns, checkConfirmation } from '../js/design/augment.js';
import { fittedModels } from '../js/model/desirability.js';
import { propagationOfError } from '../js/model/robust.js';
import { createStudy, validateStudy } from '../js/study.js';
import { toStudyDesign, fullFactorial } from '../js/design/factorial.js';
import { fitModel, predict, anova, responseTable } from '../js/model/fit.js';
import { noiseModelOf } from '../js/model/noise.js';
import { reduceModel, aicc } from '../js/model/reduce.js';
import { lackOfFit } from '../js/model/ols.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/glm-r.json', import.meta.url)));
const factors = ['A', 'B', 'C'].map(id => ({ id, low: -1, high: 1 }));
const T = { rel: 1e-6, abs: 1e-8 };

function setup(c) {
  const i = c.input, n = i.y.length;
  const rows = i.A.map((a, k) => ({ A: a, B: i.B[k], C: i.C[k] }));
  const mm = modelMatrix(parseFormula(i.formula, factors), factors, rows);
  const binom = i.distribution.includes('binomial');
  const y = binom ? i.y.map((v, k) => v / i.trials[k]) : i.y;
  return { mm, y, opts: { distribution: i.distribution, link: i.link, weights: binom ? i.trials : undefined, offset: i.exposure ? i.exposure.map(Math.log) : undefined }, n };
}

for (const c of fx.cases.filter(c => c.output.columns)) {
  section(c.name);
  const o = c.output, { mm, y, opts } = setup(c);
  const fit = fitGLM(mm, y, opts);
  check('columns as R', fit.columns.join() === o.columns.join(), fit.columns.join());
  near('coefficients', fit.coef, o.coef, T);
  near('standard errors', fit.se, o.se, T);
  near(`${fit.statistic} values and p`, [...fit.t, ...fit.p], [...o.stat, ...o.p], T);
  near('deviance, null deviance, residual df, dispersion', [fit.deviance, fit.nullDeviance, fit.dfRes, fit.dispersion], [o.deviance, o.nullDeviance, o.dfRes, o.dispersion], T);
  if (o.aic !== null) near('AIC', fit.aic, o.aic, T);
  if (o.theta !== undefined) near('θ and its standard error', [fit.theta, fit.thetaSE], [o.theta, o.thetaSE], { rel: 1e-5 });
  near('fitted means', fit.fitted, o.fitted, T);
  near('Pearson and deviance residuals', [...fit.pearson, ...fit.devianceResiduals], [...o.pearson, ...o.devres], T);
  near('leverage, standardised and studentised residuals, Cook’s distance', [...fit.leverage, ...fit.rstandard, ...fit.rstudent, ...fit.cooks], [...o.hat, ...o.rstandard, ...o.rstudent, ...o.cooks], { rel: 1e-5, abs: 1e-7 });
  const a1 = glmTests(fit, 1).filter(r => r.term !== 'Residuals');
  check('sequential analysis of deviance: the same terms', a1.map(r => r.term).join() === o.anova1.term.join(), a1.map(r => r.term).join());
  near('… df, deviance and p', [...a1.map(r => r.df), ...a1.map(r => r.deviance), ...a1.map(r => r.p)], [...o.anova1.df, ...o.anova1.deviance, ...o.anova1.p], T);
  if (o.anova2) {
    for (const [type, ref] of [[2, o.anova2], [3, o.anova3]]) {
      const a = glmTests(fit, type).filter(r => r.term !== 'Residuals');
      check(`type ${type} likelihood-ratio tests: the same terms`, a.map(r => r.term).join() === ref.term.join());
      near(`… χ², df and p (car::Anova)`, [...a.map(r => r.chi2), ...a.map(r => r.df), ...a.map(r => r.p)], [...ref.chi2, ...ref.df, ...ref.p], T);
    }
    const ci = glmConfint(fit);
    // MASS interpolates a spline through the profile; aikidoe solves for the limits
    near('profile-likelihood intervals (MASS confint)', [...ci.map(x => x.lower), ...ci.map(x => x.upper)], [...o.confint.lower, ...o.confint.upper], { rel: 2e-3, abs: 2e-3 });
  }
  const at = c.input.at, X = modelMatrix(fit.model, factors, at.A.map((a, k) => ({ A: a, B: at.B[k], C: at.C[k] }))).X;
  const pr = glmPredict(fit, X);
  near('predictions on the link scale, with standard errors', [...pr.map(p => p.link), ...pr.map(p => p.seLink)], [...o.predict.link, ...o.predict.se], T);
}

section('separation and Firth');
{
  const c = fx.cases.find(x => /separated/.test(x.name)), { mm, y, opts } = setup(c);
  const ml = fitGLM(mm, y, opts);
  check('ordinary maximum likelihood: separation detected and warned', ml.separation && ml.warnings.some(w => /separated/.test(w)), ml.warnings.join('; '));
  const fz = fitGLM(mm, y, { ...opts, firth: true });
  near('Firth: coefficients and standard errors (brglm2 AS_mean)', [...fz.coef, ...fz.se], [...c.output.coef, ...c.output.se], { rel: 1e-6, abs: 1e-8 });
  near('… deviance at the Firth estimates', fz.deviance, c.output.deviance, T);
  check('… finite, no separation warning, Wald tests', fz.coef.every(Number.isFinite) && !fz.separation && glmTests(fz, 2).every(r => r.term === 'Residuals' || r.wald));
  const p = fx.cases.find(x => /Poisson with Firth/.test(x.name)), s = setup(p);
  const fp = fitGLM(s.mm, s.y, { ...s.opts, firth: true });
  near('Firth for a Poisson model', [...fp.coef, ...fp.se], [...p.output.coef, ...p.output.se], { rel: 1e-6, abs: 1e-8 });
}

section('overdispersion check, comparison of nested fits');
{
  const c = fx.cases.find(x => /overdispersion check/.test(x.name)), { mm, y, opts } = setup(c);
  const fit = fitGLM(mm, y, opts);
  near('Pearson χ²/df (the quasi-Poisson dispersion)', fit.overdispersion.ratio, fx.cases.find(x => /quasi-Poisson/.test(x.name)).output.dispersion, { rel: 1e-5 });
  check('overdispersion flagged, with the advice', fit.overdispersion.detected && fit.warnings.some(w => /negative binomial/.test(w)), JSON.stringify(fit.overdispersion));
  const small = fitGLM(modelMatrix(parseFormula('overd ~ A + B + C', factors), factors, c.input.A.map((a, k) => ({ A: a, B: c.input.B[k], C: c.input.C[k] }))), y, opts);
  const cmp = glmCompare(fit, small);
  near('likelihood-ratio test of the three interactions', [cmp.df, cmp.chi2], [3, small.deviance - fit.deviance], T);
}

section('θ alone');
{
  const r = thetaML([0, 2, 5, 9, 1, 14], [3, 3, 5, 6, 4, 8]);
  check('θ finite and positive, with a standard error', r.theta > 0 && r.se > 0, JSON.stringify(r));
}

section('a study with counts and proportions');
{
  // the Poisson case as a study: runs of a replicated 2³, the volume plated as exposure
  const c = fx.cases.find(x => /exposure/.test(x.name)), i = c.input;
  const base = createStudy({ aikidoe: 1, name: 'colonies', factors, responses: [{ id: 'count', distribution: 'poisson' }, { id: 'germ', distribution: 'binomial', trials: 20 }, { id: 'pass', distribution: 'bernoulli' }], seed: 1 });
  const runs = i.A.map((a, k) => ({ run: k + 1, order: k + 1, settings: { A: a, B: i.B[k], C: i.C[k] } }));
  const g = fx.cases.find(x => x.name === 'binomial, logit link').input;
  const s = createStudy({ ...base, design: { kind: 'full', runs }, observations: [
    ...runs.map((r, k) => ({ run: r.run, response: 'count', value: i.y[k], exposure: i.exposure[k] })),
    ...runs.map((r, k) => ({ run: r.run, response: 'germ', value: g.y[k], ...(g.trials[k] !== 20 ? { trials: g.trials[k] } : {}) }))] });
  check('the noise model follows the distribution', noiseModelOf(s, 'count').id === 'poisson' && noiseModelOf(s, 'germ').link.name === 'logit' && noiseModelOf(s, 'pass').distribution === 'binomial');
  const fit = fitModel(s, 'count ~ (A + B + C)^2');
  near('fitModel: as R’s glm with the exposure offset', [...fit.coef, fit.deviance], [...c.output.coef, c.output.deviance], T);
  check('… recorded as a Poisson fit; anova is the analysis of deviance', fit.noise === 'poisson' && anova(fit).at(-1).deviance === fit.deviance && 'chi2' in anova(fit)[0]);
  const pr = predict(fit, [{ A: 0.5, B: -0.2, C: 1 }]);
  near('predict: the rate per unit exposure', pr[0].fit, Math.exp(c.output.predict.link[0]), T);
  check('… with an asymmetric interval from the log scale', pr[0].lower < pr[0].fit && pr[0].upper > pr[0].fit && pr[0].upper - pr[0].fit > pr[0].fit - pr[0].lower);
  const gf = fitModel(s, 'germ ~ (A + B + C)^2');
  near('binomial: trials from the response (20) or the observation (25)', gf.coef, fx.cases.find(x => x.name === 'binomial, logit link').output.coef, T);
  check('lack of fit refuses a count fit', (() => { try { lackOfFit(fit); return false; } catch (e) { return /normal noise/.test(e.message); } })());
  const red = reduceModel(s, 'count ~ (A + B + C)^2');
  check('model reduction by likelihood-ratio tests', red.steps.length > 0 && red.steps.every(st => Number.isFinite(st.chi2) && st.p > 0.1), JSON.stringify(red.steps.map(x => [x.drop, x.p])));
  check('… and by AICc', Number.isFinite(aicc(fit)) && reduceModel(s, 'count ~ (A + B + C)^2', { method: 'aicc' }).formula.length > 0);
  check('responseTable: one row per observation with exposure and trials', responseTable(s, 'count').every((r, k) => r.exposure === i.exposure[k]) && responseTable(s, 'germ').every(r => r.trials >= 20));
}

section('prediction intervals for a new count or proportion');
{
  // coverage by simulation: a replicated 2³, the model fitted, a new run predicted
  const rows = []; for (let r = 0; r < 2; r++) for (const c of [-1, 1]) for (const b of [-1, 1]) for (const a of [-1, 1]) rows.push({ A: a, B: b, C: c });
  const mm = modelMatrix(parseFormula('y ~ A + B + C', factors), factors, rows), at = modelMatrix(mm.model, factors, [{ A: 0.5, B: -0.5, C: 1 }]).X;
  const R = rng(5), N = 300;
  const cases = [
    ['poisson', (mu) => _draw.poisson(R, mu), {}, (x) => Math.exp(2 + 0.4 * x.A - 0.3 * x.B + 0.1 * x.C), [0.93, 0.99]],
    ['binomial', (p) => { let k = 0; for (let i = 0; i < 20; i++) if (R.random() < p) k++; return k / 20; }, { weights: rows.map(() => 20) }, (x) => 1 / (1 + Math.exp(-(0.2 + 0.8 * x.A - 0.5 * x.B))), [0.93, 0.995]],
    // θ estimated from 16 runs is biased upwards: the interval allows for its standard error but
    // still falls a little short
    ['negbin', (mu) => _draw.poisson(R, mu * _draw.gamma(R, 3) / 3), {}, (x) => Math.exp(2 + 0.4 * x.A - 0.3 * x.B + 0.1 * x.C), [0.86, 0.97]],
  ];
  for (const [dist, gen, opts, truth, [lo, hi]] of cases) {
    let hit = 0;
    const mu0 = truth({ A: 0.5, B: -0.5, C: 1 });
    for (let k = 0; k < N; k++) {
      const fit = fitGLM(mm, rows.map(r => gen(truth(r))), { distribution: dist, ...opts });
      const p = glmPredict(fit, at, { trials: 20 })[0], y = gen(mu0);
      if (y >= p.predLower - 1e-12 && y <= p.predUpper + 1e-12) hit++;
    }
    check(`${dist}: 95 % prediction interval covers a new run ${(100 * hit / N).toFixed(1)} % of the time`, hit / N >= lo && hit / N <= hi);
  }
  const f = fitGLM(mm, rows.map(r => Math.round(10 * Math.exp(0.3 * r.A))), { distribution: 'poisson' });
  const one = predictiveInterval(f, Math.log(10), 0, { level: 0.95 });
  check('with no uncertainty in the fit: the Poisson quantiles (10 → 4 … 17)', one.lower === 4 && one.upper === 17, JSON.stringify(one));
  const ten = predictiveInterval(f, Math.log(10), 0, { level: 0.95, n: 10 });
  check('the mean of 10 runs: a narrower interval (Poisson(100) / 10)', ten.lower === 8.1 && ten.upper === 12, JSON.stringify(ten));
  check('variance of a new result: μ (Poisson), μ(1 − μ)/m (binomial)', glmVariance(f, 7) === 7 && Math.abs(glmVariance({ ...f, distribution: 'binomial', weights: [20] }, 0.3) - 0.0105) < 1e-15);
}

section('simulated envelope');
{
  const c = fx.cases.find(x => /overdispersion check/.test(x.name)), { mm, y, opts } = setup(c);
  const fit = fitGLM(mm, y, opts), env = glmEnvelope(fit, { nsim: 99, seed: 3 });
  check('one point per residual, ascending, with bands', env.length === y.length && env.every((e, k) => e.lower <= e.median && e.median <= e.upper && (k === 0 || e.observed >= env[k - 1].observed)));
  check('overdispersed counts under a Poisson model: the largest residuals leave the envelope', env.slice(-4).some(e => e.observed > e.upper));
  const nb = fitGLM(mm, y, { ...opts, distribution: 'negbin' }), env2 = glmEnvelope(nb, { nsim: 99, seed: 3 });
  check('… and the negative binomial keeps them inside', env2.filter(e => e.observed > e.upper || e.observed < e.lower).length <= 1);
}

section('confirmation, optimisation and robustness for counts');
{
  const c = fx.cases.find(x => /exposure/.test(x.name)), i = c.input;
  const runs = i.A.map((a, k) => ({ run: k + 1, order: k + 1, settings: { A: a, B: i.B[k], C: i.C[k] } }));
  let s = createStudy({ aikidoe: 1, name: 'c', seed: 1, factors, responses: [{ id: 'count', distribution: 'poisson', goal: 'maximize', lower: 5, upper: 30 }], design: { kind: 'full', runs },
    observations: runs.map((r, k) => ({ run: r.run, response: 'count', value: i.y[k], exposure: i.exposure[k] })) });
  const fit = fitModel(s, 'count ~ A + B + A:B');
  const conf = confirmationRuns(s, fit, [{ A: 1, B: -1, C: 0 }], { replicates: 2 });
  check('confirmation runs store what the predictive distribution needs', conf.params.glm.distribution === 'poisson' && Number.isFinite(conf.params.predictions[0].seLink) && conf.params.predictions[0].predLower < conf.params.predictions[0].fit);
  const n0 = runs.length;
  s = createStudy({ ...s, design: { ...s.design, runs: [...runs, { run: n0 + 1, order: n0 + 1, kind: 'confirm', settings: { A: 1, B: -1, C: 0 } }, { run: n0 + 2, order: n0 + 2, kind: 'confirm', settings: { A: 1, B: -1, C: 0 } }] },
    history: [{ stage: 'confirm', runs: [n0 + 1, n0 + 2], params: conf.params }],
    observations: [...s.observations, { run: n0 + 1, response: 'count', value: 30, exposure: 2 }, { run: n0 + 2, response: 'count', value: 14, exposure: 1 }] });
  const ck = checkConfirmation(s, 'count')[0];
  check('checked on the rate scale (30 per 2, 14 per 1 → 14.5), with the interval for the mean of 2 runs', ck.observed === 14.5 && ck.n === 2 && ck.lower < ck.predicted && ck.upper > ck.predicted && ck.inside === (14.5 >= ck.lower && 14.5 <= ck.upper), JSON.stringify(ck));
  const m = fittedModels(s, { formulas: { count: 'count ~ A + B + A:B' } }).models[0];
  near('the optimiser’s prediction is the rate (response scale), not the log', m.predict({ A: 1, B: -1, C: 0 }), predict(fit, [{ A: 1, B: -1, C: 0 }])[0].fit, { rel: 1e-12 });
  const poe = propagationOfError(s, m.predict, { A: 0.2, B: 0, C: 0 }, { residualVar: m.residualVar });
  near('robustness: the Poisson variance at the mean is the residual part', poe.residual, poe.mean, { rel: 1e-12 });
}

section('validation of counts and proportions');
{
  const v = (resp, obs) => validateStudy({ aikidoe: 1, name: 'v', seed: 1, factors: [{ id: 'A', low: -1, high: 1 }], responses: [resp], design: { kind: 'full', runs: [{ run: 1, settings: { A: -1 } }, { run: 2, settings: { A: 1 } }] }, observations: obs }).errors;
  check('a valid binomial response', !v({ id: 'y', distribution: 'binomial', trials: 10 }, [{ run: 1, response: 'y', value: 3 }, { run: 2, response: 'y', value: 7, trials: 12 }]).length);
  check('unknown distribution or link', v({ id: 'y', distribution: 'gamma' }, []).length === 1 && /link/.test(v({ id: 'y', distribution: 'poisson', link: 'logit' }, [])[0]));
  check('a count must be a whole number ≥ 0', /count/.test(v({ id: 'y', distribution: 'poisson' }, [{ run: 1, response: 'y', value: 2.5 }])[0] ?? ''));
  check('successes ≤ trials, and trials needed', /0 to the 10/.test(v({ id: 'y', distribution: 'binomial', trials: 10 }, [{ run: 1, response: 'y', value: 11 }])[0] ?? '')
    && /trials/.test(v({ id: 'y', distribution: 'binomial' }, [{ run: 1, response: 'y', value: 1 }])[0] ?? ''));
  check('pass/fail is 0 or 1', /0 or 1/.test(v({ id: 'y', distribution: 'bernoulli' }, [{ run: 1, response: 'y', value: 2 }])[0] ?? ''));
  check('exposure only for counts with the log link; trials only for binomial', v({ id: 'y', distribution: 'poisson', link: 'sqrt' }, [{ run: 1, response: 'y', value: 2, exposure: 2 }]).length === 1
    && v({ id: 'y' }, [{ run: 1, response: 'y', value: 2, trials: 3 }]).length === 1 && v({ id: 'y', trials: 4 }, []).length === 1);
  check('no readings within runs for a count', v({ id: 'y', distribution: 'poisson', levels: ['run', 'site'] }, []).length === 1);
}

done();
