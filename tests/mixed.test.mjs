// REML mixed models (issue #15). Reference: fixture reml-r (lme4 lmer, pbkrtest vcovAdj and
// KRmodcomp) on 10 balanced and unbalanced split-plot and nested data sets.
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import { reml, fitMixedModel, randomEffects, observationTable, mlFit, predictMixed, runMeanWeights, fitMixedML } from '../js/model/mixed.js';
import { reduceMixed } from '../js/model/reduce.js';
import { confirmationRuns, appendStage, checkConfirmation } from '../js/design/augment.js';
import { EXAMPLES } from '../ui/examples.js';
import { parseFormula, modelMatrix } from '../js/model/formula.js';
import { createStudy } from '../js/study.js';
import { fitModel } from '../js/model/ols.js';

const cases = loadFixture('reml-r').cases;
const fitCase = (c) => {
  const factors = c.input.factors.map(x => (x.levels ? { id: x.id, type: 'categorical', levels: x.levels } : { id: x.id, type: 'continuous', low: -1, high: 1 }));
  const model = parseFormula(c.input.formula, factors), m = modelMatrix(model, factors, c.input.rows);
  return reml(m.X, c.input.rows.map(r => r.y), c.input.groups.map(g => ({ name: g, labels: c.input.rows.map(r => r[g]) })), { columns: m.columns, assign: m.assign, terms: model.terms });
};
// lme4's optimiser stops at about 1e−6 relative in the variance parameters; KR df agree far closer
const EST = { rel: 1e-5, abs: 1e-8 };

section('REML vs lme4 and Kenward–Roger vs pbkrtest');
for (const c of cases) {
  const r = fitCase(c), o = c.output;
  check(`${c.name}: converged`, r.converged);
  near(`${c.name}: fixed effects`, r.coef, o.coef, EST);
  const vc = Object.fromEntries(r.varcomp.map(v => [v.name, v.variance]));
  near(`${c.name}: variance components`, Object.keys(o.varcomp).map(k => vc[k]), Object.values(o.varcomp), EST);
  near(`${c.name}: REML criterion`, r.REML, o.REML, { rel: 1e-8 });
  near(`${c.name}: model-based covariance of β`, r.vcov, o.vcov, EST);
  near(`${c.name}: KR-adjusted covariance Φ_A (vcovAdj)`, r.vcovKR, o.vcovKR, EST);
  // pbkrtest orders W as VarCorr does, residual last
  const order = Object.keys(o.varcomp).map(k => (k === 'Residual' ? r.varcomp.length - 1 : r.varcomp.findIndex(v => v.name === k)));
  near(`${c.name}: asymptotic covariance W of the variance components`, order.map(i => order.map(j => r.W[i][j])), o.W, EST);
  near(`${c.name}: KR denominator df to 1e−3`, r.terms.map(t => t.ddfKR), o.kr.map(k => k.ddf), { abs: 1e-3 });
  near(`${c.name}: KR F scaling and F`, r.terms.map(t => [t.scaling, t.FKR]), o.kr.map(k => [k.Fscaling, k.F]), EST);
  check(`${c.name}: boundary reported as such`, o.singular === (r.boundary.length > 0), r.boundary.join());
}

section('maximum likelihood vs lme4 (REML = FALSE)');
for (const c of cases) {
  const factors = c.input.factors.map(x => (x.levels ? { id: x.id, type: 'categorical', levels: x.levels } : { id: x.id, type: 'continuous', low: -1, high: 1 }));
  const m = modelMatrix(parseFormula(c.input.formula, factors), factors, c.input.rows);
  const random = c.input.groups.map(g => ({ name: g, labels: c.input.rows.map(r => r[g]) }));
  const ml = mlFit(m.X, c.input.rows.map(r => r.y), random);
  near(`${c.name}: ML deviance`, ml.deviance, c.output.ml.deviance, { rel: 1e-8 });
  near(`${c.name}: ML fixed effects and variance components`, [ml.coef, ml.varcomp], [c.output.ml.coef, [...c.input.groups.map(g => c.output.ml.varcomp[g]), c.output.ml.varcomp.Residual]], EST);
}

section('mixed-model predictions vs pbkrtest');
for (const c of cases) {
  const factors = c.input.factors.map(x => (x.levels ? { id: x.id, type: 'categorical', levels: x.levels } : { id: x.id, type: 'continuous', low: -1, high: 1 }));
  const model = parseFormula(c.input.formula, factors), mmx = modelMatrix(model, factors, c.input.rows);
  const random = c.input.groups.map(g => ({ id: g, name: g, labels: c.input.rows.map(r => r[g]) }));
  const r = reml(mmx.X, c.input.rows.map(x => x.y), random, { columns: mmx.columns, assign: mmx.assign, terms: model.terms });
  const p = predictMixed({ ...r, model, factors, rows: c.input.rows.map(x => ({ settings: x })), random, positionTerms: [] }, [c.input.rows[0]])[0];
  near(`${c.name}: x β̂, KR standard error and df (KRmodcomp of x)`, [p.fit, p.se, p.df], [c.output.pred.fit, c.output.pred.se, c.output.pred.df], { rel: 1e-5, abs: 1e-6 });
  near(`${c.name}: one new reading: SE and Satterthwaite df`, [p.predSe, p.predDf], [c.output.pred.predSe, c.output.pred.predDf], { rel: 1e-5 });
}

section('containment df');
{
  // balanced split-plot: whole-plot terms in the whole-plot stratum (8 − 1 − 3 = 4), subplot
  // terms in the residual stratum (32 − 8 − 7 = 17); KR equals containment here
  const r = fitCase(cases[0]);
  check('balanced split-plot: strata', JSON.stringify(r.strata) === JSON.stringify([{ name: 'wp', df: 4 }, { name: 'Residual', df: 17 }]), JSON.stringify(r.strata));
  near('… and KR df = containment df', r.terms.map(t => t.ddfKR), r.terms.map(t => t.ddfContainment), { abs: 1e-8 });
  check('A:B is a whole-plot term, A:C a subplot term', r.terms.find(t => t.term === 'A:B').stratum === 'wp' && r.terms.find(t => t.term === 'A:C').stratum === 'Residual');
  const n = fitCase(cases[3]);
  check('nested runs / wafers / sites: run stratum 16 − 1 − 6 = 9, wafer 16, site 128', JSON.stringify(n.strata.map(s => s.df)) === '[9,16,128]', JSON.stringify(n.strata));
}

section('variance component intervals');
{
  const r = fitCase(cases[0]);
  const v = r.varcomp[0];
  check('Satterthwaite interval contains the estimate; df = 2σ⁴/W', v.lower < v.variance && v.variance < v.upper && Math.abs(v.df - 2 * v.variance ** 2 / r.W[0][0]) < 1e-12);
  const b = fitCase(cases[6]);
  check('boundary component: estimate 0, lower 0, no upper', b.varcomp[0].variance === 0 && b.varcomp[0].lower === 0 && Number.isNaN(b.varcomp[0].upper) && b.boundary[0] === 'wp');
}

section('from a study: random effects chosen automatically');
{
  // case 6 as a study: whole plots, runs, two wafers per run (one reading each)
  const c = cases[5];
  const ids = ['A', 'B', 'C', 'D'];
  const runs = new Map();
  c.input.rows.forEach(r => { if (!runs.has(r.run)) runs.set(r.run, { run: Number(r.run), wholePlot: Number(r.wp), settings: Object.fromEntries(ids.map(k => [k, r[k]])) }); });
  const runList = [...runs.values()].sort((a, b) => a.run - b.run).map((r, i) => ({ ...r, order: i + 1 }));
  const seen = new Map();
  const obs = c.input.rows.map(r => { const k = (seen.get(r.run) ?? 0) + 1; seen.set(r.run, k); return { run: Number(r.run), wafer: `W${k}`, response: 'y', value: r.y }; });
  const s = createStudy({ aikidoe: 1, seed: 1, factors: ids.map(id => ({ id, low: -1, high: 1, htc: id === 'A' || id === 'B' })), responses: [{ id: 'y' }], design: { kind: 'split-plot', randomisation: 'restricted', runs: runList }, observations: obs });
  const rows = observationTable(s, 'y');
  check('observation table: one row per reading, with whole plot and wafer labels', rows.length === 64 && rows.every(r => r.wholePlot && r.wafer));
  check('auto: whole plot and run (each wafer has one reading, so wafer is the residual)', randomEffects(rows).map(r => r.id).join() === 'wholePlot,run');
  const f = fitMixedModel(s, c.input.formula);
  const vc = Object.fromEntries(f.varcomp.map(v => [v.name, v.variance]));
  near('same fit as the reference', [f.coef, vc['Whole plot'], vc.Run, vc.Residual], [c.output.coef, c.output.varcomp.wp, c.output.varcomp.run, c.output.varcomp.Residual], EST);
  check('naive least squares on the same readings gives whole-plot tests far too many df', f.terms[0].naiveDf === 64 - 6 && f.terms[0].ddfKR < 6);
  check('explicit random effects', fitMixedModel(s, c.input.formula, { random: ['wholePlot'] }).random.map(r => r.id).join() === 'wholePlot');
  throws('a random effect that is the residual', () => fitMixedModel(s, c.input.formula, { random: ['wholePlot', 'run', 'wafer'] }), /wafer: one observation per group/);
  throws('unknown random effect', () => fitMixedModel(s, c.input.formula, { random: ['operator'] }), /unknown random effect/);
  // with per-run means the whole-plot error is still needed, so the mixed model is the analysis
  check('the least-squares fit of run means has 32 runs', fitModel(s, c.input.formula).n === 32);
}
section('run-mean predictions and confirmation with a mixed model');
{
  const ex = EXAMPLES.find(e => e.id === 'anneal-results').build();
  const f = 'Rs ~ T*t*dose + radius2 + T:radius2';
  const m = fitMixedModel(ex, f);
  const w1 = runMeanWeights(m), w3 = runMeanWeights(m, { runs: 3 }), w3s = runMeanWeights(m, { runs: 3, inOneWholePlot: false });
  near('weights for a run of 2 wafers × 9 sites: whole plot 1, run 1, wafer 1/2, reading 1/18', [w1.wholePlot, w1.run, w1.wafer, w1.residual], [1, 1, 1 / 2, 1 / 18], { rel: 1e-12 });
  near('3 runs in one furnace load: whole plot not averaged; in 3 loads it is', [w3.wholePlot, w3.run, w3s.wholePlot], [1, 1 / 3, 1 / 3], { rel: 1e-12 });
  const at = { T: 950, t: 20, dose: 2e15 };
  const [p1] = predictMixed(m, [at], { weights: w1 }), [pr] = predictMixed(m, [at]);
  const vc = Object.fromEntries(m.varcomp.map(v => [v.name, v.variance]));
  near('run-mean interval: se² + σ²_wp + σ²_run + σ²_wafer/2 + σ²/18', p1.predSe ** 2, p1.se ** 2 + vc['Whole plot'] + vc.Run + vc.Wafer / 2 + vc.Residual / 18, { rel: 1e-12 });
  check('position terms averaged over the sites for a run mean; a single reading is wider', pr.predSe > p1.predSe && Math.abs(pr.fit - p1.fit) < 1e-12);
  check('the furnace-run variance dominates: the interval is far wider than least squares on run means gives', p1.predSe > 2 * p1.se);
  const st = confirmationRuns(ex, m, [at], { replicates: 2 });
  check('confirmation stage from a mixed fit: mixed intervals stored, replicates in one new whole plot', st.params.mixed && st.wholePlot.join() === '1,1' && Number.isFinite(st.params.predictions[0].meanLower));
  const [one, sep] = [predictMixed(m, [at], { weights: runMeanWeights(m, { runs: 2 }) })[0], predictMixed(m, [at], { weights: runMeanWeights(m, { runs: 2, inOneWholePlot: false }) })[0]];
  check('two runs in one furnace load barely help (the load-to-load variance stays); in two loads they do', Math.abs(one.predSe - p1.predSe) / p1.predSe < 0.1 && sep.predSe < 0.8 * p1.predSe);
  let q = appendStage(ex, st);
  const added = q.design.runs.filter(r => r.kind === 'confirm');
  check('appended runs share a new whole plot, run consecutively', new Set(added.map(r => r.wholePlot)).size === 1 && !ex.design.runs.some(r => r.wholePlot === added[0].wholePlot) && Math.abs(added[0].order - added[1].order) === 1);
  // the true response there (the example's simulation, without noise) is 62 − 6·(coded dose) …; use the prediction ± small offsets
  const obs = []; for (const r of added) for (const w of ['W1', 'W2']) for (const site of ex.sites.positions.map(p => p.id)) obs.push({ run: r.run, wafer: `${r.run}${w}`, site, response: 'Rs', value: p1.fit + 0.3 });
  q = createStudy({ ...q, observations: [...q.observations, ...obs] });
  const cc = checkConfirmation(q, 'Rs');
  check('confirmation check uses the stored interval for the mean of the 2 runs', cc.length === 1 && cc[0].n === 2 && cc[0].inside === true && Math.abs(cc[0].upper - st.params.predictions[0].meanUpper) < 1e-12);
}

section('model reduction for mixed models');
{
  const ex = EXAMPLES.find(e => e.id === 'anneal-results').build();
  const start = 'Rs ~ (T+t+dose)^2 + radius2 + T:radius2 + t:radius2 + dose:radius2 + slot';
  const r = reduceMixed(ex, start, { method: 'p' });
  const kept = r.fit.model.terms.map(t => t.label);
  check('p (KR): the simulated terms stay (T, t, dose, T:dose, radius2, T:radius2, slot), null ones go', ['T', 't', 'dose', 'T:dose', 'radius2', 'T:radius2', 'slot'].every(t => kept.includes(t)) && ['t:dose', 't:radius2', 'dose:radius2'].every(t => !kept.includes(t)), r.formula);
  check('steps record KR F, ddf, p', r.steps.every(s => s.p > 0.1 && s.ddf > 0 && Number.isFinite(s.F)));
  check('the random effects are kept from the start', r.fit.random.map(x => x.id).join() === 'wholePlot,run,wafer');
  const a = reduceMixed(ex, 'Rs ~ T*t*dose + radius2 + T:radius2 + t:radius2', { method: 'aicc' });
  check('AICc (ML): drops t:radius2, keeps the radial terms', !a.fit.model.terms.some(t => t.label === 't:radius2') && a.fit.model.terms.some(t => t.label === 'T:radius2'), a.formula);
  check('AICc decreases at every step', a.steps.every((s, i) => s.aicc < (i ? a.steps[i - 1].aicc : a.start.aicc)));
  const k = reduceMixed(ex, start, { method: 'p', keep: ['t:dose'] });
  check('keep is respected', k.fit.model.terms.some(t => t.label === 't:dose'));
  check('ML fit of a formula from a study', fitMixedML(ex, 'Rs ~ T + t').random.length === 3);
}
done();
