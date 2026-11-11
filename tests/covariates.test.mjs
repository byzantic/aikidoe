// Covariates (ANCOVA; issue #82): measured variables in the study and as model terms. Reference:
// fixture covariate-r (tests/ref/covariate_r.R: lm, car::Anova, predict.lm, glm, lme4 with
// pbkrtest), each fitted here through the study — fitModel, fitMixedModel — as a user's would be.
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import { createStudy, validateStudy, serializeStudy, parseStudy, covariatesWithoutValues } from '../js/study.js';
import { fitModel, predict, anova } from '../js/model/fit.js';
import { fitMixedModel, predictMixed } from '../js/model/mixed.js';
import { withCovariates, covariateAt, covariateTable, droppedNote } from '../js/model/covariates.js';
import { parseFormula } from '../js/model/formula.js';
import { reduceModel } from '../js/model/reduce.js';
import { runSheet, runSheetCSV, runSheetHTML, importResults, applyResults, covariateCell, setCovariateCell } from '../js/io/runsheet.js';
import { covariateSlopes } from '../js/model/covariates.js';
import { fitSurrogates } from '../js/sim/surrogate.js';
import { fittedModels, optimiseDesirability } from '../js/model/desirability.js';
import { EXAMPLES } from '../ui/examples.js';

const F = loadFixture('covariate-r'), TOL = { rel: 1e-8, abs: 1e-9 };
const byName = (n) => F.cases.find(c => c.name === n);

// a study from a fixture case: one run per row (or per run number, with wafers), the covariate x
const studyOf = (c, { distribution } = {}) => {
  const rows = c.input.rows, cov = c.input.covariate ?? 'x';
  const ids = Object.keys(rows[0]).filter(k => !['x', 'w', 'y', 'run', 'wafer'].includes(k));
  const factors = ids.map(id => (id === 'G' ? { id, type: 'categorical', levels: c.input.levels } : { id, low: -1, high: 1 }));
  const nested = rows[0].run !== undefined;
  const runNo = (r, i) => (nested ? r.run : i + 1);
  const runs = [...new Map(rows.map((r, i) => [runNo(r, i), { run: runNo(r, i), settings: Object.fromEntries(ids.map(id => [id, r[id]])) }])).values()];
  const perRun = cov === 'w';
  const values = perRun ? runs.map(u => ({ run: u.run, value: rows.find(r => r.run === u.run).w }))
    : rows.map((r, i) => ({ run: runNo(r, i), value: r[cov], ...(nested ? { wafer: r.wafer } : {}) })).filter(v => v.value !== null && v.value !== undefined);
  return createStudy({ name: c.name, seed: 1, factors, responses: [{ id: 'y', ...(distribution ? { distribution } : {}), ...(nested ? { levels: ['run', 'wafer'] } : {}) }],
    covariates: [{ id: cov, name: 'Covariate', units: 'u', values }],
    design: { runs }, observations: rows.map((r, i) => ({ run: runNo(r, i), response: 'y', value: r.y, ...(nested ? { wafer: r.wafer } : {}) })) });
};

section('least squares with a covariate against lm, car::Anova and predict.lm');
for (const c of F.cases.filter(x => x.output.anova2)) {
  const st = studyOf(c), fit = fitModel(st, c.input.formula), o = c.output, cv = fit.covariates[0];
  check(`${c.name}: the columns, in R's order`, JSON.stringify(fit.columns.map(n => n.replace(/^G\[(\w+)\]/, (m, l) => `G${c.input.levels.indexOf(l)}`))) === JSON.stringify(o.columns), fit.columns.join());
  near(`${c.name}: the covariate's mean and half-range over the ${o.n} rows used`, [cv.n, cv.mean, cv.halfRange], [o.n, o.mean, o.halfRange], TOL);
  near(`${c.name}: coefficients, standard errors, σ, residual df`, [fit.coef, fit.se, fit.sigma, fit.dfRes], [o.coef, o.se, o.sigma, o.dfRes], TOL);
  const j = fit.columns.indexOf('x');
  near(`${c.name}: the slope per unit of the covariate, as lm on the covariate as measured`, [fit.coef[j] / cv.halfRange, fit.se[j] / cv.halfRange], [o.slope, o.slopeSe], TOL);
  for (const type of [2, 3]) {
    const a = anova(fit, type), ref = o[`anova${type}`].filter(r => r.term !== '(Intercept)' && r.term !== 'Residuals');
    near(`${c.name}: type ${type === 2 ? 'II' : 'III'} tests (${ref.map(r => r.term).join(', ')})`, ref.map(r => { const t = a.find(x => x.term === r.term); return [t.df, t.ss, t.F, t.p]; }), ref.map(r => [r.df, r.ss, r.F, r.p]), { rel: 1e-7, abs: 1e-10 });
  }
  const p = predict(fit, c.input.at);
  near(`${c.name}: predictions at covariate values, and at its mean when none is given`, p.map(q => [q.fit, q.lower, q.upper, q.predLower, q.predUpper]), o.pred.map(q => [q.fit, q.lower, q.upper, q.predLower, q.predUpper]), TOL);
}
{
  const c = byName('covariate missing for two runs'), fit = fitModel(studyOf(c), c.input.formula);
  check('runs without the covariate are left out, and named', fit.rows.length === 14 && JSON.stringify(fit.dropped) === JSON.stringify([{ run: 4, covariate: 'x' }, { run: 11, covariate: 'x' }])
    && droppedNote(fit.dropped) === 'runs 4, 11 are left out: no value of x');
  const plain = fitModel(studyOf(c), 'y ~ A + B + C + A:B');
  check('… a model without the covariate keeps every run, and reports no covariates', plain.rows.length === 16 && plain.covariates === undefined);
}
{
  // types II and III: the same without an interaction with the covariate, different with one
  const a = fitModel(studyOf(byName('three groups, common slope')), 'y ~ G + x'), b = fitModel(studyOf(byName('three groups, separate slopes')), 'y ~ G * x');
  const F2 = (f, t) => anova(f, 2).find(x => x.term === t).F, F3 = (f, t) => anova(f, 3).find(x => x.term === t).F;
  check('types II and III agree for G + x, and differ for G once it interacts with x', Math.abs(F2(a, 'G') - F3(a, 'G')) < 1e-9 && Math.abs(F2(b, 'G') - F3(b, 'G')) > 1e-3);
}

section('counts: a Poisson GLM with a covariate against glm');
{
  const c = byName('poisson with a covariate'), st = studyOf(c, { distribution: 'poisson' }), fit = fitModel(st, c.input.formula), o = c.output;
  near('coefficients, standard errors and the deviance', [fit.coef, fit.se, fit.deviance], [o.coef, o.se, o.deviance], { rel: 1e-7, abs: 1e-9 });
  const t = anova(fit, 2);
  near('likelihood-ratio tests (car::Anova, type II)', o.lr.map(r => { const x = t.find(y => y.term === r.term); return [x.df, x.chisq ?? x.deviance ?? x.stat, x.p]; }), o.lr.map(r => [r.df, r.chisq, r.p]), { rel: 1e-6, abs: 1e-9 });
  near('the predicted count at a covariate value', predict(fit, [{ A: 1, B: -1, x: 10 }])[0].fit, o.pred, { rel: 1e-8 });
}

section('REML with a covariate against lme4 and pbkrtest');
for (const c of F.cases.filter(x => x.output.REML !== undefined)) {
  const st = studyOf(c), m = fitMixedModel(st, c.input.formula), o = c.output, id = c.input.covariate;
  near(`${c.name}: the covariate's coding`, [m.covariates[0].mean, m.covariates[0].halfRange], [o.mean, o.halfRange], TOL);
  near(`${c.name}: fixed effects, variance components, the REML criterion`, [m.coef, m.varcomp.map(v => v.variance), m.REML], [o.coef, [o.varcomp.run, o.varcomp.Residual], o.REML], { rel: 2e-5, abs: 1e-6 });
  near(`${c.name}: Kenward–Roger df and F of A, B and the covariate`, ['A', 'B', id].map(t => { const x = m.terms.find(y => y.term === t); return [x.ddfKR, x.FKR]; }), o.kr.map(k => [k.ddf, k.F]), { rel: 2e-4, abs: 1e-4 });
  const p0 = predictMixed(m, [{ A: 1, B: 1 }])[0], pm = predictMixed(m, [{ A: 1, B: 1, [id]: m.covariates[0].mean }])[0];
  near(`${c.name}: a prediction without the covariate is at its mean`, p0.fit, pm.fit, { rel: 1e-12 });
}
{
  // a wafer's own value before the run's; a run-means model takes the mean of the run's values
  const c = byName('REML, a covariate per wafer'), st = studyOf(c);
  const r0 = c.input.rows[0], runRows = c.input.rows.filter(r => r.run === r0.run);
  near('covariateAt: the wafer\'s own value', covariateAt(st, 'x', { run: r0.run, obs: { wafer: r0.wafer } }), r0.x, TOL);
  near('… and the mean of the run\'s values for a run mean', [covariateAt(st, 'x', { run: r0.run }), covariateTable(st, 'x').find(t => t.run === r0.run).value], [1, 1].map(() => runRows.reduce((s, r) => s + r.x, 0) / runRows.length), TOL);
  const mixed = createStudy({ ...st, covariates: [{ id: 'x', values: [{ run: r0.run, value: 7 }, { run: r0.run, wafer: 2, value: 9 }] }] });
  check('… a run-level value for the wafers without their own', covariateAt(mixed, 'x', { run: r0.run, obs: { wafer: 1 } }) === 7 && covariateAt(mixed, 'x', { run: r0.run, obs: { wafer: 2 } }) === 9 && covariateAt(mixed, 'x', { run: 99 }) === undefined);
}

section('the study format');
{
  const c = byName('2^3 x 2 with a covariate'), st = studyOf(c);
  check('covariates round-trip through the file', JSON.stringify(parseStudy(serializeStudy(st)).covariates) === JSON.stringify(st.covariates) && st.covariates[0].values.length === 16);
  check('a study without covariates has no covariates key', createStudy({ ...st, covariates: [] }).covariates === undefined && !('covariates' in JSON.parse(serializeStudy(createStudy({ ...st, covariates: undefined })))));
  const bad = (cov) => validateStudy({ ...st, covariates: cov }).errors.join('\n');
  check('ids differ from factors and responses', /used more than once/.test(bad([{ id: 'A' }])) && /used more than once/.test(bad([{ id: 'y' }])));
  check('ids with a meaning in formulas are refused', /meaning of its own in formulas/.test(bad([{ id: 'quadratic' }])) && /meaning of its own/.test(bad([{ id: 'slot' }])));
  check('values: a run of the design, a number, one per run (and wafer)', /no run 99/.test(bad([{ id: 'x', values: [{ run: 99, value: 1 }] }])) && /must be a number/.test(bad([{ id: 'x', values: [{ run: 1, value: null }] }]))
    && /a second value for run 1/.test(bad([{ id: 'x', values: [{ run: 1, value: 1 }, { run: 1, value: 2 }] }])) && bad([{ id: 'x', values: [{ run: 1, value: 1 }, { run: 1, wafer: 2, value: 2 }] }]) === '');
  check('unknown keys are reported', /unknown key/i.test(bad([{ id: 'x', valuess: [] }])) || /valuess/.test(bad([{ id: 'x', valuess: [] }])));
  check('covariatesWithoutValues: for a new design', JSON.stringify(covariatesWithoutValues(st)) === JSON.stringify({ covariates: [{ id: 'x', name: 'Covariate', units: 'u', values: [] }] }) && JSON.stringify(covariatesWithoutValues({})) === '{}');
}

section('formulas');
{
  const c = byName('2^3 x 2 with a covariate'), st = studyOf(c);
  const cov = withCovariates(st, 'y ~ quadratic + x', st.design.runs.map(r => ({ run: r.run, settings: r.settings })));
  const labels = parseFormula('y ~ 2fi + x', cov.factors).terms.map(t => t.label);
  check('main, 2fi and quadratic are over the factors that are set; the covariate is named', JSON.stringify(labels) === JSON.stringify(['A', 'B', 'C', 'x', 'A:B', 'A:C', 'B:C']), labels.join());
  check('a formula without the covariate leaves rows and factors alone', withCovariates(st, 'y ~ A + B', []).factors === st.factors);
  throws('a covariate that is not in the study is an unknown factor', () => fitModel(st, 'y ~ A + humidity'), /unknown factor "humidity"/);
  throws('a covariate with one value cannot be a term', () => fitModel(createStudy({ ...st, covariates: [{ id: 'x', values: st.design.runs.map(r => ({ run: r.run, value: 3 })) }] }), 'y ~ A + x'), /same value \(3\) for every run/);
  throws('no values at all', () => fitModel(createStudy({ ...st, covariates: [{ id: 'x' }] }), 'y ~ A + x'), /no values of x/);
  // model reduction treats the covariate as any other term
  const red = reduceModel(st, 'y ~ A + B + C + A:B + x', { criterion: 'p' });
  check('backward elimination keeps a covariate that matters (and drops C)', /\bx\b/.test(red.formula) && !/\bC\b/.test(red.formula), red.formula);
}

section('the run sheet and imports');
{
  const st = EXAMPLES.find(e => e.id === 'titre-covariate').build();
  const sh = runSheet(st), iV = sh.header.indexOf('vcd'), iRun = sh.header.indexOf('run');
  check('a column per covariate, between the factors and the results, filled in', JSON.stringify(sh.covariateColumns) === '["vcd"]' && iV === sh.header.indexOf('feed') + 1 && iV === sh.header.indexOf('titre') - 1
    && sh.rows.every(r => r[iV] === st.covariates[0].values.find(v => v.run === r[iRun]).value));
  check('the printable sheet names it, with units', /<th>Seed density <span class="u">\(10⁶ cells\/mL\)<\/span><\/th>/.test(runSheetHTML(st)));
  // the CSV reads back to the same study
  const blank = createStudy({ ...st, observations: [], covariates: [{ ...st.covariates[0], values: [] }] });
  const imp = importResults(blank, runSheetCSV(st));
  const back = applyResults(blank, imp);
  check('the sheet\'s CSV reads back: results and covariate values', imp.covariates.length === 16 && !imp.problems.some(p => p.severity !== 'info') && JSON.stringify(back.covariates) === JSON.stringify(st.covariates) && back.observations.length === 16);
  check('… a column headed by the covariate\'s name is matched too', importResults(blank, 'run,Seed density\n1,0.4\n').covariates[0]?.value === 0.4);
  // modes
  const one = importResults(st, 'run,vcd\n3,0.9\n');
  check('replace and append both put the new value in place of the run\'s old one', [applyResults(st, one), applyResults(st, one, { mode: 'append' })].every(n => n.covariates[0].values.length === 16 && covariateCell(n, 'vcd', 3) === 0.9));
  check('blank cells are not values; text is an error', importResults(st, 'run,vcd\n3,\n').covariates.length === 0 && importResults(st, 'run,vcd\n3,abc\n').problems.some(p => p.severity === 'error' && /not a number/.test(p.message)));
  // wafers: a row of a wafer holds that wafer's value
  const nested = createStudy({ ...st, responses: [{ id: 'titre', levels: ['run', 'wafer'] }], covariates: [{ id: 'vcd', values: [] }],
    observations: st.design.runs.flatMap(r => [1, 2].map(w => ({ run: r.run, wafer: w, response: 'titre', value: r.run + w / 10 }))) });
  const wide = importResults(nested, 'run,wafer,vcd,titre\n1,1,10,5\n1,2,12,6\n2,1,11,5\n');
  const nx = applyResults(nested, wide);
  check('per wafer: the value belongs to the row\'s wafer', wide.covariates.length === 3 && covariateCell(nx, 'vcd', 1, { wafer: 2 }) === 12 && covariateCell(nx, 'vcd', 1) === undefined
    && runSheet(nx).rows.find(r => r[runSheet(nx).header.indexOf('run')] === 1 && r[runSheet(nx).header.indexOf('wafer')] === 2)[runSheet(nx).header.indexOf('vcd')] === 12);
  const doc = JSON.parse(JSON.stringify(nx));
  setCovariateCell(doc, 'vcd', 1, { wafer: 2 }, 13); setCovariateCell(doc, 'vcd', 2, { wafer: 1 }, undefined); setCovariateCell(doc, 'vcd', 4, {}, 9);
  const ed = createStudy(doc);
  check('setCovariateCell: change, clear and add a cell', covariateCell(ed, 'vcd', 1, { wafer: 2 }) === 13 && covariateCell(ed, 'vcd', 2, { wafer: 1 }) === undefined && covariateCell(ed, 'vcd', 4) === 9 && ed.covariates[0].values.length === 3);
}

section('what else takes a model with a covariate');
{
  const st = EXAMPLES.find(e => e.id === 'titre-covariate').build(), f = 'titre ~ temp*feed + pH + vcd';
  const fit = fitModel(st, f), plain = fitModel(st, 'titre ~ temp*feed + pH');
  const cs = covariateSlopes(fit)[0];
  check('the example: the covariate takes σ from 0.19 to 0.06, and pH shows', plain.sigma > 0.18 && fit.sigma < 0.06 && plain.p[plain.columns.indexOf('pH')] > 0.05 && fit.p[fit.columns.indexOf('pH')] < 0.001 && Math.abs(cs.slope - 2.156) < 1e-3 && !cs.interacts);
  check('… the slope is flagged when the covariate interacts with a factor', covariateSlopes(fitModel(st, 'titre ~ temp*vcd + feed + pH'))[0].interacts);
  const at = { temp: 37, pH: 6.8, feed: 4 };
  const sur = fitSurrogates(st, { formulas: { titre: f } }).models[0];
  near('surrogates (yield, sensitivity) predict at the covariate\'s mean', sur.predict(at), predict(fit, [at])[0].fit, { rel: 1e-12 });
  const { models } = fittedModels(st, { formulas: { titre: f } });
  const best = optimiseDesirability(st, models, { seed: 1 });
  check('optimisation: the best settings, predicted at the covariate\'s mean', best.settings.temp === 37 && best.settings.feed === 4 && best.settings.vcd === undefined && best.D > 0.8, JSON.stringify(best.settings));
}

done();
