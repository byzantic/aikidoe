// The noise-model interface (issue #64, phase 0): fitting, tests, predictions, model comparison
// and power go through it, and for normal noise nothing changes.
import { section, check, done } from './lib/check.mjs';

const close = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const refuses = (fn) => { try { fn(); return false; } catch { return true; } };
import { NOISE_MODELS, noiseModel, noiseModelOf, noiseOf, normal } from '../js/model/noise.js';
import { fitModel, predict, anova } from '../js/model/fit.js';
import { fitOLS, olsPredict, olsAnova, lackOfFit, boxCox, twoLevelEffects } from '../js/model/ols.js';
import { parseFormula, modelMatrix } from '../js/model/formula.js';
import { aicc, reduceModel } from '../js/model/reduce.js';
import { powerFromMatrix } from '../js/model/power.js';
import { createStudy } from '../js/study.js';
import { toStudyDesign, fullFactorial } from '../js/design/factorial.js';

section('the interface');
{
  const need = ['fit', 'predict', 'tests', 'residuals', 'compare', 'loglik', 'weights'];
  check('every noise model has the methods, a link and capabilities', Object.values(NOISE_MODELS).every(m => need.every(k => typeof m[k] === 'function')
    && ['fun', 'inv', 'deriv'].every(k => typeof m.link[k] === 'function') && typeof m.capabilities === 'object'));
  check('normal: identity link', normal.link.name === 'identity' && normal.link.inv(3.5) === 3.5 && normal.link.deriv(1) === 1);
  check('normal is the default, and an unknown noise model is refused', noiseModel() === normal && noiseOf({}) === normal && refuses(() => noiseModel('gamma')));
}

// a replicated 2³ with a known response
const factors = ['A', 'B', 'C'].map(id => ({ id, low: -1, high: 1 }));
const base = createStudy({ aikidoe: 1, name: 'n', factors, responses: [{ id: 'y' }], seed: 4 });
const design = toStudyDesign(base, fullFactorial(factors.map(() => 2), { replicates: 2 }), { seed: 4 });
const yOf = (s, run) => 10 + 2 * s.A - 1.5 * s.B + 0.8 * s.A * s.B + 0.3 * s.C + 0.4 * Math.sin(7 * run);
const study = createStudy({ ...base, design, observations: design.runs.map(r => ({ run: r.run, response: 'y', value: yOf(r.settings, r.run) })) });

section('fitting through the interface is least squares, unchanged');
{
  const fit = fitModel(study, 'y ~ (A+B+C)^2');
  const mm = modelMatrix(parseFormula('y ~ (A+B+C)^2', study.factors), study.factors, fit.rows.map(r => r.settings));
  const o = fitOLS(mm, fit.rows.map(r => r.y));
  check('the fit records its noise model', fit.noise === 'normal' && noiseModelOf(study, 'y') === normal);
  check('coefficients, SEs and σ identical to fitOLS', fit.coef.every((b, j) => b === o.coef[j]) && fit.se.every((v, j) => v === o.se[j]) && fit.sigma === o.sigma);
  const at = [{ A: 0.5, B: -0.2, C: 1 }, { A: -1, B: 1, C: 0 }];
  const p = predict(fit, at), q = olsPredict(o, modelMatrix(fit.model, fit.factors, at).X);
  check('predict = olsPredict on the model matrix', p.every((r, i) => ['fit', 'se', 'lower', 'upper', 'predLower', 'predUpper'].every(k => r[k] === q[i][k])));
  check('anova (types 1–3) = olsAnova', [1, 2, 3].every(t => JSON.stringify(anova(fit, t)) === JSON.stringify(olsAnova(o, t))));
  const r = normal.residuals(fit);
  check('residuals: raw, standardised and studentised from the fit', r.response === fit.residuals && r.standardised === fit.rstandard && r.studentised === fit.rstudent);
}

section('model comparison and AICc');
{
  const big = fitModel(study, 'y ~ (A+B+C)^2'), small = fitModel(study, 'y ~ A + B + C + A:B');
  const c = normal.compare(big, small);
  const F = ((small.rss - big.rss) / 2) / (big.rss / big.dfRes);
  check('compare: the partial F test', c.df === 2 && close(c.F, F, 1e-12));
  const { loglik, k } = normal.loglik(big), n = big.n;
  check('log-likelihood as R logLik.lm (σ counted)', k === big.rank + 1 && close(-2 * loglik, n * Math.log(2 * Math.PI) + n * Math.log(big.rss / n) + n, 1e-12));
  check('AICc from it', close(aicc(big), -2 * loglik + 2 * k + 2 * k * (k + 1) / (n - k - 1), 1e-12));
  const red = reduceModel(study, 'y ~ (A+B+C)^2');
  check('reduction (through compare) drops A:C and B:C first and keeps A:B', red.steps.slice(0, 2).map(x => x.drop).sort().join() === 'A:C,B:C' && /A:B/.test(red.formula), red.formula);
}

section('normal-theory tools refuse other noise models');
{
  const fit = { ...fitModel(study, 'y ~ A*B*C'), noise: 'gamma' };
  check('lack of fit, Box–Cox and Lenth effects name the assumption (for any noise model but normal)', [() => lackOfFit(fit), () => boxCox(fit), () => twoLevelEffects(fit)].every(f => {
    try { f(); return false; } catch (e) { return /normal noise/.test(e.message); } }));
  check('and the façade refuses an unknown noise model', refuses(() => predict(fit, [{ A: 0, B: 0, C: 0 }])) && refuses(() => anova(fit)));
}

section('power: normal noise weights every run equally');
{
  const mm = modelMatrix(parseFormula('y ~ A*B', study.factors), study.factors, design.runs.map(r => r.settings));
  const a = powerFromMatrix(mm, { delta: 1.5 }), b = powerFromMatrix(mm, { delta: 1.5, noise: 'normal', mean: mm.X.map(() => 10) });
  check('the same power with the noise model given explicitly', JSON.stringify(a) === JSON.stringify(b) && normal.weights(mm.X, {}) === null);
}

done();
