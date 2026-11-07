// Generalised linear models (issue #64, phase 1), against R: glm, MASS::glm.nb, car::Anova,
// MASS confint (profile) and brglm2 (Firth) — tests/ref/glm_r.R.
import { readFileSync } from 'node:fs';
import { section, check, near, done } from './lib/check.mjs';
import { parseFormula, modelMatrix } from '../js/model/formula.js';
import { fitGLM, glmTests, glmConfint, glmPredict, glmCompare, thetaML } from '../js/model/glm.js';
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
