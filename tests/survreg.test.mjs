// Times to an event with right censoring (issue #83): Weibull and log-normal accelerated-life
// models against survival::survreg (fixture survreg-r, tests/ref/survreg_r.R) — coefficients,
// standard errors, log(scale), log-likelihood, likelihood-ratio tests, quantiles of the life with
// their standard errors — and the Kaplan–Meier estimate against survfit; then the study format,
// the run sheet and import, fitModel, the probability plot and the life at each condition.
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import { fitSurvreg, survTests, survPredict, kaplanMeier, timeRatios, lifeAtConditions, probabilityPlot } from '../js/model/survreg.js';
import { createStudy, validateStudy, parseStudy } from '../js/study.js';
import { fitModel, anova, predict } from '../js/model/fit.js';
import { reduceModel } from '../js/model/reduce.js';
import { runSheet, runSheetCSV, importResults, parseFlag } from '../js/io/runsheet.js';
import { probabilitySVG } from '../js/io/svg-space.js';
import { readFileSync } from 'node:fs';

const F = loadFixture('survreg-r');
const tol = { rel: 1e-6, abs: 1e-8 };

// the model matrix as R wrote it: R's assign 0 is the intercept; a term's components from its label
const mmOf = (inp) => ({
  X: inp.X, columns: inp.columns, assign: inp.assign.map(a => a - 1),
  model: { intercept: inp.columns[0] === '(Intercept)', terms: inp.terms.map(l => ({ label: l, comps: l.split(':').map(f => ({ f })) })) },
});

section('fits: as survival::survreg');
for (const c of F.cases.filter(x => x.input.X)) {
  const inp = c.input, o = c.output;
  const fit = fitSurvreg(mmOf(inp), inp.time, { distribution: inp.distribution, status: inp.status });
  check(`${c.name}: converged`, fit.converged);
  near(`${c.name}: coefficients`, fit.coef, o.coef, tol);
  near(`${c.name}: standard errors`, fit.se, o.se, tol);
  near(`${c.name}: log(scale) and its s.e.`, [fit.logScale, fit.logScaleSe], [o.logScale, o.logScaleSe], tol);
  near(`${c.name}: log-likelihood (time scale)`, fit.loglik, o.loglik, tol);
  if (o.chisq) {
    const t = survTests(fit, 1).filter(r => r.term !== 'Residuals');
    near(`${c.name}: sequential likelihood-ratio χ² (anova.survreg)`, t.map(r => r.chi2), o.chisq, { rel: 1e-6, abs: 1e-7 });
    check(`${c.name}: … and their df`, JSON.stringify(t.map(r => r.df)) === JSON.stringify(o.df));
  }
  if (o.drop1) {
    const t3 = survTests(fit, 3).filter(r => r.term !== 'Residuals'), t2 = survTests(fit, 2).filter(r => r.term !== 'Residuals');
    near(`${c.name}: each term last (type 3) as drop1`, o.drop1.terms.map(l => t3.find(r => r.term === l).chi2), o.drop1.chisq, { rel: 1e-6, abs: 1e-7 });
    near(`${c.name}: type 2 = type 3 for main effects`, t2.map(r => r.chi2), t3.map(r => r.chi2), { rel: 1e-9, abs: 1e-9 });
  }
  const q = o.quantiles.p.map(p => survPredict(fit, inp.newX, { p }));
  near(`${c.name}: B10 and median life at new settings (predict, type "quantile")`, inp.newX.map((_, i) => q.map(qq => qq[i].fit)), o.quantiles.fit, tol);
  near(`${c.name}: … their standard errors (time scale)`, inp.newX.map((_, i) => q.map(qq => qq[i].seTime)), o.quantiles.se, tol);
}

section('Kaplan–Meier: as survival::survfit');
for (const c of F.cases.filter(x => /kaplan/.test(x.name))) {
  const k = kaplanMeier(c.input.time, c.input.status);
  near(`${c.name}: failure times, at risk, failed, S`, [k.map(r => r.time), k.map(r => r.atRisk), k.map(r => r.failed), k.map(r => r.S)],
    [c.output.time, c.output.atRisk, c.output.failed, c.output.S], { rel: 1e-12, abs: 1e-14 });
}

section('the study format');
const study = parseStudy(readFileSync(new URL('../examples/interconnect-life.aikidoe.json', import.meta.url), 'utf8'));
check('the example is valid: a weibull response, 8 units per run, censored observations', study.responses[0].distribution === 'weibull' && study.responses[0].unitsPerRun === 8 && study.observations.filter(o => o.censored).length === 16);
const base = { name: 'x', factors: [{ id: 'A', low: -1, high: 1 }], responses: [{ id: 'life', distribution: 'lognormal' }], design: { runs: [{ run: 1, settings: { A: -1 } }, { run: 2, settings: { A: 1 } }] } };
const errs = (s) => validateStudy({ aikidoe: 1, seed: 1, ...s }).errors;
check('censored is only for times to an event', errs({ ...base, responses: [{ id: 'life' }], observations: [{ run: 1, response: 'life', value: 5, censored: true }] }).some(e => /censored/.test(e)));
check('censored is true or false', errs({ ...base, observations: [{ run: 1, response: 'life', value: 5, censored: 'yes' }] }).some(e => /censored/.test(e)));
check('a time must be greater than 0', errs({ ...base, observations: [{ run: 1, response: 'life', value: 0 }] }).some(e => /greater than 0/.test(e)));
check('unitsPerRun only for times to an event', errs({ ...base, responses: [{ id: 'life', unitsPerRun: 4 }] }).some(e => /unitsPerRun/.test(e)));
check('the log link only', errs({ ...base, responses: [{ id: 'life', distribution: 'weibull', link: 'identity' }] }).some(e => /link/.test(e)));
check('a valid lognormal study', errs({ ...base, observations: [{ run: 1, response: 'life', value: 5, censored: true }, { run: 2, response: 'life', value: 3 }] }).length === 0);

section('run sheet and import');
const sh = runSheet(study);
check('the sheet: a row per unit tested (repeat) and a column life.censored', sh.header.includes('repeat') && sh.header.includes('life.censored') && sh.rows.length === 40);
const empty = createStudy({ ...study, observations: [] });
check('… with no results yet: 8 rows per run, from unitsPerRun', runSheet(empty).rows.length === 40);
const imp = importResults(study, runSheetCSV(study));
check('the sheet reads back: 40 times, 16 censored', imp.observations.length === 40 && imp.observations.filter(o => o.censored).length === 16 && !imp.problems.some(p => p.severity === 'error'));
const imp2 = importResults(study, 'run,response,value,censored,repeat\n1,life,1000,yes,1\n1,life,500,,2\n1,life,5,maybe,3\n');
check('long format: yes / blank, and a word that is neither is an error', imp2.observations[0].censored === true && imp2.observations[1].censored === undefined && imp2.problems.some(p => p.severity === 'error' && /maybe/.test(p.message)));
check('flags: 1, yes, true / 0, no, blank', [parseFlag('1'), parseFlag('Yes'), parseFlag(' TRUE '), parseFlag('0'), parseFlag('no'), parseFlag('')].join() === 'true,true,true,false,false,false');

section('fitModel, tests, reduction, prediction');
const add = F.cases.find(c => c.name === 'interconnect weibull additive');
const fit = fitModel(study, 'life ~ temp + J');
check('a survreg fit through the study: 40 units, 24 failed, 16 censored', fit.distribution === 'weibull' && fit.n === 40 && fit.events === 24 && fit.censored === 16);
near('the example\'s coefficients (natural ranges coded) are the fixture\'s', fit.coef, add.output.coef, tol);
near('anova(fit): the likelihood-ratio tests', anova(fit, 1).filter(r => r.term !== 'Residuals').map(r => r.chi2), add.output.chisq, { rel: 1e-6, abs: 1e-7 });
const red = reduceModel(study, 'life ~ temp*J', { method: 'p' });
check('model reduction drops temp:J by its likelihood-ratio test', red.formula === 'life ~ temp + J' && red.steps.length === 1 && red.steps[0].chi2 > 0);
const redA = reduceModel(study, 'life ~ temp*J', { method: 'aicc' });
check('… and by AICc (σ counted as a parameter)', redA.steps[0]?.drop === 'temp:J');
const pr = predict(fit, [{ temp: 150, J: 1 }, { temp: 200, J: 2 }], { p: 0.1 });
near('predict(…, { p: 0.1 }): the B10 life at two corners (fixture rows 1 and 2)', pr.map(p => p.fit), add.output.quantiles.fit.slice(0, 2).map(r => r[0]), tol);
const pm = predict(fit, [{ temp: 175, J: 1.5 }]);
near('… the median by default', pm[0].fit, add.output.quantiles.fit[2][1], tol);
check('… with an interval around it', pm[0].lower < pm[0].fit && pm[0].upper > pm[0].fit);
const tr = timeRatios(fit);
near('time ratios: exp(coef), Wald intervals', [tr[1].ratio, tr[1].lower, tr[1].upper], [Math.exp(fit.coef[1]), Math.exp(fit.coef[1] - 1.959963984540054 * fit.se[1]), Math.exp(fit.coef[1] + 1.959963984540054 * fit.se[1])], { rel: 1e-12 });
check('temperature shortens the life (time ratio below 1)', tr[1].ratio < 1 && tr[1].upper < 1);

section('life at the conditions tested; the probability plot');
const life = lifeAtConditions(fit);
check('five conditions, 8 units each; failures 1, 7, 4, 8, 4 (run order 1 … 5)', life.length === 5 && life.every(c => c.units === 8) && life.map(c => c.failures).join() === '1,7,4,8,4');
check('B10 below the median everywhere', life.every(c => c.quantiles[0].fit < c.quantiles[1].fit));
const pp = probabilityPlot(fit);
check('the plot: a group per condition, a point per failure', pp.groups.length === 5 && pp.groups.reduce((a, g) => a + g.points.reduce((b, p) => b + p.failed, 0), 0) === 24);
const g4 = pp.groups.find(g => g.units === 8 && g.points.length === 8);
near('plotting positions without censoring: (i − ½)/n, on the Weibull scale', g4.points.map(p => p.F), [...Array(8)].map((_, i) => (i + 0.5) / 8), { rel: 1e-12 });
near('… z = log(−log(1 − F))', g4.points.map(p => p.z), g4.points.map(p => Math.log(-Math.log(1 - p.F))), { rel: 1e-12 });
check('labels carry the units', /temp = \d+ °C/.test(pp.groups[0].label));
const svg = probabilitySVG(pp, { timeLabel: 'Time to failure (h)' });
check('the SVG: a fitted line per condition, a circle per failure, a legend', (svg.match(/<path /g) ?? []).length === 5 && (svg.match(/<circle /g) ?? []).length >= 24 + 5);
const ln = fitModel(createStudy({ ...study, responses: [{ ...study.responses[0], distribution: 'lognormal' }] }), 'life ~ temp + J');
check('the log-normal model: the plot on the normal scale', probabilityPlot(ln).distribution === 'lognormal' && ln.loglik < 0);

section('edge cases');
throws('every unit censored: nothing to fit', () => fitSurvreg({ X: [[1], [1]], columns: ['(Intercept)'], assign: [-1], model: { terms: [] } }, [5, 6], { status: [0, 0] }), /every observation is censored/);
throws('times must be positive', () => fitSurvreg({ X: [[1], [1]], columns: ['(Intercept)'], assign: [-1], model: { terms: [] } }, [5, -1]), /positive/);
const al = fitSurvreg({ X: [[1, -1, -1], [1, 1, 1], [1, -1, -1], [1, 1, 1], [1, 1, 1]], columns: ['(Intercept)', 'A', 'B'], assign: [-1, 0, 1], model: { terms: [{ label: 'A', comps: [{ f: 'A' }] }, { label: 'B', comps: [{ f: 'B' }] }] } }, [10, 3, 12, 4, 5]);
check('an aliased column: NaN coefficient, listed', Number.isNaN(al.coef[2]) && al.aliased.join() === 'B' && Number.isFinite(al.coef[1]));
const allFail = fitModel(study, 'life ~ 1');
check('an intercept-only model', allFail.rank === 1 && allFail.k === 2);

done();
