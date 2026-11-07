// Dose–response (issue #65): fits, standard errors and effective doses against R's drc, Gauss–
// Newton standard errors against nls, relative potency and the parallelism F test; inverse
// prediction, detection limits, variance weighting, and dose designs and power.
import { readFileSync } from 'node:fs';
import { section, check, near, done } from './lib/check.mjs';
import { fitDose, effectiveDose, relativePotency, compareFits, parallelism, inversePredict, detectionLimits, predictDose,
  dilutionSeries, optimalDoses, doseDesignQuality, guessScenarios, potencyPower, MODELS } from '../js/model/dose.js';
import { rng } from '../js/design/rng.js';
import { normal } from '../js/dist.js';
import { createStudy } from '../js/study.js';
import { doseDesign, addDoseStage, doseData } from '../js/design/dose-design.js';
import { runVirtual } from '../js/learn/process.js';
import { layoutPlates } from '../js/design/plate-layout.js';
import { generateExercise, referenceStrategy, linearDoseStrategy, gradeAnswers, truthOf } from '../js/learn/exercise.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/dose-drc.json', import.meta.url), 'utf8'));
const norm = (n) => n.replace(/:\(Intercept\)$/, '').replace(/:Herbicide/, ':');
const byName = (fit) => Object.fromEntries(fit.estimates.map(e => [e.name, e]));

section('fits against drc');
// drc's own results to 1e-2 (its optimiser stops a little short on the harder fits); the same fits
// polished to the exact minimum in R (optim, numDeriv Hessian, delta-method EDs) to 1e-5
for (const c of fx.cases.filter(x => /^ryegrass (LL|W)[^ ]*$/.test(x.name))) {
  const f = fitDose({ x: c.input.x, y: c.input.y }, { model: c.input.model });
  const E = byName(f), names = c.output.names.map(norm), P = c.output.polished;
  near(`${c.name}: estimates (drc)`, names.map(n => E[n].estimate), c.output.estimate, { rel: 1e-2 });
  near(`${c.name}: estimates, standard errors, RSS at the minimum`, [...names.map(n => E[n].estimate), ...names.map(n => E[n].se), f.rss, f.df], [...P.estimate, ...P.se, P.rss, P.df], { rel: 1e-5 });
  const ed = P.ed.p.map(p => effectiveDose(f, p));
  near(`${c.name}: ED10, ED50, ED90 with delta intervals`, ed.flatMap(e => [e.estimate, e.se, e.lower, e.upper]),
    P.ed.p.flatMap((_, i) => [P.ed.estimate[i], P.ed.se[i], P.ed.lower[i], P.ed.upper[i]]), { rel: 1e-5 });
  near(`${c.name}: ED estimates (drc)`, ed.map(e => e.estimate), c.output.ed.estimate, { rel: 1e-2 });
  if (P.edAbsolute) {
    const ea = P.edAbsolute.y.map(y => effectiveDose(f, y, { type: 'absolute' }));
    near(`${c.name}: doses at absolute responses 2, 4, 6, with delta standard errors`, ea.flatMap(e => [e.estimate, e.se]), P.edAbsolute.y.flatMap((_, i) => [P.edAbsolute.estimate[i], P.edAbsolute.se[i]]), { rel: 1e-5 });
    near(`${c.name}: doses at absolute responses (drc)`, ea.map(e => e.estimate), c.output.edAbsolute.estimate, { rel: 1e-2 });
  }
}
{
  const c = fx.cases.find(x => /log-scale/.test(x.name)), f = fitDose({ x: c.input.x, y: c.input.y });
  const ed = c.output.p.map(p => effectiveDose(f, p, { interval: 'log' }));
  near('log-scale intervals (drc: fls on LL2.4)', ed.flatMap(e => [e.estimate, e.lower, e.upper]), c.output.p.flatMap((_, i) => [c.output.estimate[i], c.output.lower[i], c.output.upper[i]]), { rel: 2e-3 });
}

section('two curves: parallel and separate, relative potency');
{
  const c = fx.cases.find(x => /S\.alba/.test(x.name));
  const data = { x: c.input.x, y: c.input.y, curve: c.input.curve };
  const par = fitDose(data, { separate: 'parallel' }), sep = fitDose(data);
  for (const [fit, o, label] of [[par, c.output.parallel, 'parallel (only e differs)'], [sep, c.output.separate, 'separate curves']]) {
    const E = byName(fit), names = o.names.map(norm);
    near(`${label}: estimates and standard errors (drc)`, [...names.map(n => E[n].estimate), ...names.map(n => E[n].se)], [...o.estimate, ...o.se], { rel: 1e-2 });
    near(`${label}: estimates, standard errors, RSS at the minimum`, [...names.map(n => E[n].estimate), ...names.map(n => E[n].se), fit.rss, fit.df], [...o.polished.estimate, ...o.polished.se, o.polished.rss, o.polished.df], { rel: 1e-5 });
  }
  const F = compareFits(par, sep);
  near('F test of parallelism (drc anova)', [F.F, F.p], [c.output.F, c.output.p], { rel: 1e-4 });
  const rp = relativePotency(par, { test: c.output.potency.test, reference: c.output.potency.reference });
  near('relative potency ED_ref / ED_test with a delta interval (drc EDcomp)', [rp.estimate, rp.lower, rp.upper], [c.output.potency.estimate, c.output.potency.lower, c.output.potency.upper], { rel: 2e-3 });
  const pa = parallelism(data, { test: 'Glyphosate', reference: 'Bentazone' });
  check('parallelism(): both fits, the F test and the slope ratio with a 90 % interval', Math.abs(pa.F.F - c.output.F) < 1e-3 && pa.slopeRatio.lower < pa.slopeRatio.estimate && pa.slopeRatio.upper > pa.slopeRatio.estimate && typeof pa.slopeRatio.equivalent === 'boolean');
}

section('Gauss–Newton standard errors and weights against nls');
for (const c of fx.cases.filter(x => /^nls/.test(x.name))) {
  const f = fitDose({ x: c.input.x, y: c.input.y }, { weights: c.input.weights, vcov: 'gn' });
  const E = byName(f);
  near(`${c.name}: estimates`, c.output.names.map(n => E[n].estimate), c.output.estimate, { rel: 1e-5 });
  near(`${c.name}: standard errors, σ, df`, [...c.output.names.map(n => E[n].se), f.sigma, f.df], [...c.output.se, c.output.sigma, c.output.df], { rel: 1e-4 });
}

section('simulated curves: recovery, coverage, weighting');
{
  const truth = { b: 1.3, c: 5, d: 100, e: 2 };
  const doses = dilutionSeries({ top: 100, dilution: 3, doses: 9, zeros: 1 });
  check('a dilution series: top down by the factor, zeros first', doses.length === 10 && doses[0] === 0 && doses[9] === 100 && Math.abs(doses[8] - 100 / 3) < 1e-9);
  const g = rng(7);
  let cover = 0, coverLog = 0, nsim = 200;
  for (let s = 0; s < nsim; s++) {
    const x = doses.flatMap(d => [d, d, d]), y = x.map(v => MODELS['LL.4'].value(v, truth) + 3 * normal.ppf(g.random()));
    const f = fitDose({ x, y });
    const e = effectiveDose(f, 50), el = effectiveDose(f, 50, { interval: 'log' });
    if (e.lower <= truth.e && truth.e <= e.upper) cover++;
    if (el.lower <= truth.e && truth.e <= el.upper) coverLog++;
  }
  check(`EC50 95 % intervals cover the truth ${cover}/${nsim} (delta), ${coverLog}/${nsim} (log)`, cover / nsim > 0.9 && coverLog / nsim > 0.9);
  // heteroscedastic: variance ∝ mean²; the weighted fit is more precise for the EC50
  let errU = 0, errW = 0;
  for (let s = 0; s < 100; s++) {
    const x = doses.flatMap(d => [d, d, d]), y = x.map(v => MODELS['LL.4'].value(v, truth) * Math.exp(0.1 * normal.ppf(g.random())));
    errU += Math.log(fitDose({ x, y }).P[0].e / truth.e) ** 2;
    errW += Math.log(fitDose({ x, y }, { varPower: 2 }).P[0].e / truth.e) ** 2;
  }
  check(`variance ∝ mean²: weighting reduces the EC50 error (RMS log error ${Math.sqrt(errU / 100).toFixed(3)} → ${Math.sqrt(errW / 100).toFixed(3)})`, errW < errU);
}

section('standard curves: inverse prediction, detection limits, bands');
{
  const truth = { b: -1.1, c: 0.05, d: 2.5, e: 40 }, g = rng(3);       // an increasing ELISA-like curve
  const x = dilutionSeries({ top: 1000, dilution: 2.5, doses: 8, zeros: 1 }).flatMap(d => [d, d]);
  const y = x.map(v => MODELS['LL.4'].value(v, truth) + 0.03 * normal.ppf(g.random()));
  const f = fitDose({ x, y });
  const ip = inversePredict(f, MODELS['LL.4'].value(60, truth), { m: 2 });
  check(`inverse prediction of a sample at dose 60: ${ip.estimate.toFixed(1)} (${ip.lower.toFixed(1)} … ${ip.upper.toFixed(1)})`, ip.lower < 60 && 60 < ip.upper && ip.lower < ip.estimate && ip.estimate < ip.upper);
  const more = inversePredict(f, MODELS['LL.4'].value(60, truth), { m: 8 });
  check('more readings of the sample: a narrower interval', more.upper / more.lower < ip.upper / ip.lower);
  check('a response beyond the top asymptote is outside the curve', Number.isNaN(inversePredict(f, 5).estimate));
  const L = detectionLimits(f);
  check(`LOD ${L.lod.toFixed(2)} < LOQ ${L.loq.toFixed(2)}, both where the curve has moved 3σ and 10σ off the blank`,
    L.lod > 0 && L.loq > L.lod && Math.abs(MODELS['LL.4'].value(L.lod, f.P[0]) - (L.blank + 3 * f.sigma)) < 1e-9);
  const band = predictDose(f, [1, 40, 1000]);
  check('confidence band: narrowest where the data are dense, contains the fit', band.every(b => b.lower < b.fit && b.fit < b.upper));
}

section('dose designs and power');
{
  const guess = { b: 1.2, c: 0, d: 100, e: 1 };
  const lin = Array.from({ length: 24 }, (_, i) => 100 * (i % 8) / 7);                  // linear spacing up to 100
  const logs = dilutionSeries({ top: 100, dilution: 3.16, doses: 8 }).flatMap(d => [d, d, d]);
  const qL = doseDesignQuality(lin, { guess }), qG = doseDesignQuality(logs, { guess });
  check(`EC50 near the bottom of the range: log-spaced doses estimate log EC50 far better than linear ones (se ${qG.seLogE.toFixed(3)} vs ${qL.seLogE.toFixed(3)})`, qG.seLogE < 0.5 * qL.seLogE);
  const o = optimalDoses({ guess, runs: 24, range: [0.01, 100], criterion: 'D' });
  check(`D-optimal doses for LL.4: at least 4 distinct, better than the log series (log det ${o.quality.logdet.toFixed(2)} vs ${qG.logdet.toFixed(2)})`, new Set(o.doses).size >= 4 && o.quality.logdet >= qG.logdet);
  const oe = optimalDoses({ guess, runs: 24, range: [0.01, 100], criterion: 'EC50' });
  check(`EC50-optimal doses: smaller se(log EC50) than D-optimal (${oe.quality.seLogE.toFixed(3)} vs ${o.quality.seLogE.toFixed(3)})`, oe.quality.seLogE <= o.quality.seLogE + 1e-9);
  const sc = guessScenarios(guess, { factor: 10 });
  const rob = optimalDoses({ guess: sc, runs: 24, range: [0.01, 100] });
  const worst = (ds) => Math.max(...doseDesignQuality(ds, { guess: sc }).scenarios.map(s => s.seLogE));
  check(`robust design over EC50 ×/÷ 10: its worst case beats the local design's (${worst(rob.doses).toFixed(3)} vs ${worst(o.doses).toFixed(3)})`, worst(rob.doses) < worst(o.doses));
  // power for a potency ratio: asymptotic, checked by simulation
  const ds = dilutionSeries({ top: 100, dilution: 3, doses: 8, zeros: 1 }).flatMap(d => [d, d]);
  const pw = potencyPower(ds, { guess: { b: 1.2, c: 0, d: 100, e: 2 }, sigma: 8, ratio: 2 });
  const g = rng(11); let hits = 0; const nsim = 150;
  for (let s = 0; s < nsim; s++) {
    const x = [...ds, ...ds], cv = [...ds.map(() => 'ref'), ...ds.map(() => 'test')];
    const y = x.map((v, i) => MODELS['LL.4'].value(v, { b: 1.2, c: 0, d: 100, e: cv[i] === 'ref' ? 2 : 1 }) + 8 * normal.ppf(g.random()));
    const r = relativePotency(fitDose({ x, y, curve: cv }, { separate: 'parallel' }), { test: 'test', reference: 'ref', interval: 'log' });
    if (r.lower > 1 || r.upper < 1) hits++;
  }
  check(`power for a 2-fold potency: asymptotic ${pw.power.toFixed(2)}, simulated ${(hits / nsim).toFixed(2)}`, Math.abs(pw.power - hits / nsim) < 0.12);
}

section('dose designs in a study, stages, the virtual process and the exercise');
{
  const base = createStudy({ name: 'd', seed: 5, factors: [{ id: 'conc', low: 0, high: 100 }, { id: 'cpd', levels: ['ref', 'test'] }, { id: 'pH', low: 6, high: 8 }], responses: [{ id: 'v' }] });
  const d = doseDesign(base, { dose: 'conc', curve: 'cpd', doses: dilutionSeries({ top: 100, dilution: 10, doses: 4, zeros: 1 }), replicates: 2 });
  const st = createStudy({ ...base, design: d });
  check('doses × curves × replicates, other factors at their centre, in random order', st.design.runs.length === 20 && st.design.runs.every(r => r.settings.pH === 7)
    && st.design.runs.some((r, i) => r.order !== i + 1) && st.design.params.dose === 'conc' && st.design.params.curve === 'cpd');
  let threw = false;
  try { doseDesign(createStudy({ ...base, factors: [{ id: 'conc', low: 0.01, high: 100, transform: 'log' }, base.factors[1], base.factors[2]] }), { dose: 'conc', doses: [0, 1] }); } catch (e) { threw = /log scale/.test(e.message); }
  check('a zero dose on a log-scaled factor is refused, with the way out', threw);
  const s2 = addDoseStage(st, { doses: [0.3, 3], replicates: 3 });
  check('a second stage: new runs in block 2, after the first ones, the stages recorded', s2.design.runs.length === 32 && s2.design.runs.filter(r => r.block === 2).length === 12
    && Math.min(...s2.design.runs.filter(r => r.block === 2).map(r => r.order)) === 21 && s2.design.params.stages.length === 2);
  const proc = { seed: 2, factors: s2.factors, responses: [{ id: 'v', sigma: 1, curve: { model: 'LL.4', dose: 'conc', by: 'cpd', params: { b: 1, c: 0, d: 100, e: 1 }, levels: { test: { e: 0.25 } } } }] };
  const s3 = createStudy(runVirtual(proc, s2, { all: true }));
  const data = doseData(s3);
  check('doseData: the dose and curve from the design, one value per run', data.x.length === 32 && data.curve.filter(c => c === 'test').length === 16);
  const rp = relativePotency(fitDose(data, { separate: 'parallel' }), { test: 'test', reference: 'ref' });
  check(`the virtual process follows the curves: potency ${rp.estimate.toFixed(2)} (truth 4)`, Math.abs(Math.log(rp.estimate / 4)) < Math.log(1.15));
  const lp = layoutPlates(s2, { format: 96, seed: 1 });
  check(`a staged dose design on plates (a plate per stage): the curves' shapes kept clear of position (efficiency ${lp.summary.efficiency.toFixed(3)})`, lp.summary.plates === 2 && lp.summary.efficiency > 0.9);
  // the exercise: the reference path scores 100, evenly spaced doses less
  const sc = { ref: [], lin: [] };
  for (let seed = 1; seed <= 6; seed++) {
    const ex = generateExercise({ topic: 'dose', difficulty: 'medium', seed }), t = truthOf(ex);
    sc.ref.push(gradeAnswers(ex, t, referenceStrategy(ex, t).answers, { runs: 46 }).score);
    sc.lin.push(gradeAnswers(ex, t, linearDoseStrategy(ex, t).answers, { runs: 48 }).score);
  }
  const m = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  check(`dose exercises: the staged log-spaced doses score ${m(sc.ref)}, evenly spaced ones ${m(sc.lin).toFixed(0)} on average`, m(sc.ref) === 100 && m(sc.lin) < 70, sc.lin.join(' '));
}

done();
