// Ordinal scores (issue #83, phase 2): cumulative link models against ordinal::clm, MASS::polr and
// emmeans (fixture ordinal-r, tests/ref/ordinal_r.R) — coefficients, standard errors, cut points,
// log-likelihood, likelihood-ratio tests, the test of proportional odds, category probabilities and
// the mean score with their standard errors; then the study format, the run sheet and import,
// fitModel and the scores at each condition.
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import { fitOrdinal, ordinalPredict, ordinalTests, proportionalOddsTest, oddsRatios, scoresAtConditions } from '../js/model/ordinal.js';
import { createStudy, validateStudy, parseStudy } from '../js/study.js';
import { fitModel, anova, predict } from '../js/model/fit.js';
import { reduceModel } from '../js/model/reduce.js';
import { runSheet, runSheetCSV, importResults, parseScore } from '../js/io/runsheet.js';
import { scoresSVG } from '../js/io/svg-space.js';
import { readFileSync } from 'node:fs';

const F = loadFixture('ordinal-r');
const tol = { rel: 1e-5, abs: 1e-6 };
const mmOf = (inp) => ({
  X: inp.X, columns: inp.columns, assign: inp.assign.map(a => a - 1),
  model: { intercept: true, terms: inp.terms.map(l => ({ label: l, comps: l.split(':').map(f => ({ f })) })) },
});

section('fits: as ordinal::clm (and MASS::polr)');
for (const c of F.cases) {
  const inp = c.input, o = c.output;
  const fit = fitOrdinal(mmOf(inp), inp.y, { K: inp.K, link: inp.link });
  check(`${c.name}: converged`, fit.converged);
  near(`${c.name}: coefficients`, fit.coef, o.coef, tol);
  near(`${c.name}: standard errors`, fit.se, o.se, tol);
  near(`${c.name}: cut points and their standard errors`, [fit.thresholds.map(t => t.estimate), fit.thresholds.map(t => t.se)], [o.thresholds, o.thresholdsSe], tol);
  near(`${c.name}: log-likelihood`, fit.loglik, o.loglik, tol);
  if (o.polr) near(`${c.name}: polr agrees (coefficients, zeta)`, [fit.coef, fit.thresholds.map(t => t.estimate)], [o.polr.coef, o.polr.zeta], { rel: 1e-4, abs: 1e-5 });
  near(`${c.name}: sequential likelihood-ratio χ² (nested clm fits)`, ordinalTests(fit, 1).filter(r => r.term !== 'Residuals').map(r => r.chi2), o.sequential, tol);
  const t3 = ordinalTests(fit, 3);
  near(`${c.name}: each term last, as drop1`, o.drop1.terms.map(l => t3.find(r => r.term === l).chi2), o.drop1.chisq, tol);
  if (o.nominal) {
    const po = proportionalOddsTest(fit);
    const both = o.nominal.terms.map((l, k) => [po.find(r => r.term === l), o.nominal.chisq[k]]).filter(([, x]) => x !== null);
    near(`${c.name}: proportional-odds tests (nominal_test)`, both.map(([r]) => r.chi2), both.map(([, x]) => x), { rel: 1e-4, abs: 1e-5 });
    check(`${c.name}: … on (K − 2) df per column`, both.every(([r], k) => r.df === o.nominal.df[o.nominal.terms.indexOf(r.term)]));
  }
  const pr = ordinalPredict(fit, inp.newX);
  near(`${c.name}: category probabilities at new settings (emmeans "prob")`, pr.map(p => p.probs.map(q => q.p)), o.probs, tol);
  near(`${c.name}: … their standard errors`, pr.map(p => p.probs.map(q => q.se)), o.probsSe, tol);
  near(`${c.name}: mean score and its standard error (emmeans "mean.class")`, [pr.map(p => p.fit), pr.map(p => p.se)], [o.mean, o.meanSe], tol);
}

section('odds ratios, intervals, edge cases');
const wine = F.cases.find(c => c.name === 'wine logit'), wf = fitOrdinal(mmOf(wine.input), wine.input.y, { K: 5 });
const or = oddsRatios(wf);
near('odds ratios: exp(coef) with Wald intervals', [or[0].ratio, or[0].lower, or[0].upper], [Math.exp(wf.coef[0]), Math.exp(wf.coef[0] - 1.959963984540054 * wf.se[0]), Math.exp(wf.coef[0] + 1.959963984540054 * wf.se[0])], { rel: 1e-12 });
const p0 = ordinalPredict(wf, [wine.input.newX[0]])[0];
check('probabilities add to 1; intervals inside 0 … 1 and around them', Math.abs(p0.probs.reduce((a, q) => a + q.p, 0) - 1) < 1e-12 && p0.probs.every(q => q.lower > 0 && q.upper < 1 && q.lower < q.p && q.upper > q.p));
throws('an empty category in the middle: merge it', () => fitOrdinal({ X: [[1], [1], [1]], columns: ['(Intercept)'], assign: [-1], model: { terms: [] } }, [1, 3, 3], { K: 3 }), /no scores in category 2/);
throws('scores must be whole numbers 1 … K', () => fitOrdinal({ X: [[1], [1]], columns: ['(Intercept)'], assign: [-1], model: { terms: [] } }, [1, 2.5]), /whole numbers/);
const sep = fitOrdinal({ X: [[1, -1], [1, -1], [1, 1], [1, 1], [1, -1], [1, 1]], columns: ['(Intercept)', 'A'], assign: [-1, 0], model: { terms: [{ label: 'A', comps: [{ f: 'A' }] }] } }, [1, 2, 3, 3, 1, 3], { K: 3 });
check('complete separation: a warning, not a crash', sep.warnings.some(w => /converge/.test(w)) || sep.coef[0] > 10);

section('the study format');
const study = parseStudy(readFileSync(new URL('../examples/coating-panel.aikidoe.json', import.meta.url), 'utf8'));
check('the example: an ordinal response, four categories, five scores per run', study.responses[0].distribution === 'ordinal' && study.responses[0].categories.length === 4 && study.responses[0].unitsPerRun === 5 && study.observations.length === 40);
const base = { name: 'x', factors: [{ id: 'A', low: -1, high: 1 }], responses: [{ id: 's', distribution: 'ordinal', categories: ['low', 'mid', 'high'] }], design: { runs: [{ run: 1, settings: { A: -1 } }, { run: 2, settings: { A: 1 } }] } };
const errs = (s) => validateStudy({ aikidoe: 1, seed: 1, ...s }).errors;
check('an ordinal response needs three or more different categories', errs({ ...base, responses: [{ id: 's', distribution: 'ordinal' }] }).some(e => /categories/.test(e)) && errs({ ...base, responses: [{ id: 's', distribution: 'ordinal', categories: ['a', 'a', 'b'] }] }).some(e => /categories/.test(e)));
check('categories only for an ordinal response', errs({ ...base, responses: [{ id: 's', categories: ['a', 'b', 'c'] }] }).some(e => /categories/.test(e)));
check('a score is a whole number 1 … K', errs({ ...base, observations: [{ run: 1, response: 's', value: 4 }] }).some(e => /1 \(low\) to 3 \(high\)/.test(e)));
check('a valid ordinal study, with unitsPerRun', errs({ ...base, responses: [{ ...base.responses[0], unitsPerRun: 3, link: 'probit' }], observations: [{ run: 1, response: 's', value: 1 }, { run: 2, response: 's', value: 3 }] }).length === 0);

section('run sheet and import: scores or category names');
check('a row per judge', runSheet(createStudy({ ...study, observations: [] })).rows.length === 40);
const imp = importResults(study, runSheetCSV(study));
check('the sheet reads back', imp.observations.length === 40 && !imp.problems.some(p => p.severity === 'error'));
const imp2 = importResults(study, 'run,repeat,look\n1,1,Good\n1,2,4\n1,3,superb\n1,4,5\n');
check('names (any case) and scores; other words and scores beyond K are errors', imp2.observations.map(o => o.value).join() === '3,4' && imp2.problems.filter(p => p.severity === 'error').length === 2 && imp2.problems.some(p => /superb/.test(p.message) && /poor, fair, good, excellent/.test(p.message)));
check('parseScore', [parseScore(study.responses[0], 'EXCELLENT'), parseScore(study.responses[0], ' 2 '), parseScore(study.responses[0], '')].join() === '4,2,' && Number.isNaN(parseScore(study.responses[0], '0')));

section('fitModel, tests, reduction, prediction');
const ex = F.cases.find(c => c.name === 'coating logit');
const fit = fitModel(study, 'look ~ temp*time + primer');
check('an ordinal fit through the study', fit.distribution === 'ordinal' && fit.K === 4 && fit.n === 40 && fit.columns.join() === 'temp,time,primer[applied],temp:time');
near('… the fixture\'s coefficients (the app codes primer −1 / +1, R 0 / 1: half R\'s estimate)', [fit.coef[0], fit.coef[1], 2 * fit.coef[2], fit.coef[3]], ex.output.coef, tol);
near('… the same log-likelihood', fit.loglik, ex.output.loglik, tol);
near('anova(fit, 3): drop1\'s tests', ['primer', 'temp:time'].map(l => anova(fit, 3).find(r => r.term === l).chi2), ex.output.drop1.chisq, tol);
const red = reduceModel(study, 'look ~ temp*time + primer', { method: 'p' });
check('reduction by likelihood-ratio p (temp:time at p 0.065 stays below 0.1)', red.steps.length === 0);
const redA = reduceModel(study, 'look ~ (temp + time + primer)^2', { method: 'aicc' });
check('… by AICc, dropping the weak interactions', redA.steps.length >= 1 && redA.steps.every(s => s.drop.includes(':')));
const pr = predict(fit, [{ temp: 160, time: 30, primer: 'applied' }]);
near('predict: the probabilities and mean score at a corner (fixture row 1)', [pr[0].probs.map(q => q.p), pr[0].fit], [ex.output.probs[0], ex.output.mean[0]], tol);
check('… the most likely score: excellent', pr[0].mostLikely === 4);

section('the scores at each condition');
const sc = scoresAtConditions(fit);
check('eight conditions of five scores, observed counts as given', sc.length === 8 && sc.every(c => c.n === 5 && c.observed.reduce((a, b) => a + b, 0) === 5) && sc[0].observed.join() === '5,0,0,0');
const svg = scoresSVG(sc, study.responses[0].categories);
check('the picture: a bar per category per condition, model and observed, and a legend', (svg.match(/<rect /g) ?? []).length >= 8 * 4 + 4 && /excellent/.test(svg));

done();
