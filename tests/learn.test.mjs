// Virtual processes and exercises (issue #38): deterministic results from (seed, settings,
// replicate); the nuisance; generation reproducible from the seed; across topics × difficulties
// × 50 seeds the reference strategy earns full marks and one-factor-at-a-time scores lower; the
// class-mode round trip from the CLI.
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { section, check, near, throws, done } from './lib/check.mjs';
import { createStudy } from '../js/study.js';
import { toStudyDesign, fullFactorial } from '../js/design/factorial.js';
import { siteScheme } from '../js/model/sites.js';
import { hashUniform, hashNormal, trueMean, observeRuns, runVirtual, countQuantile } from '../js/learn/process.js';
import { generateExercise, referenceStrategy, ofatStrategy, comparisonStrategy, gradeStudy, gradeAnswers, truthOf, keyOf, studentOf, seal, TOPICS, DIFFICULTIES, runExercise, countAnswers } from '../js/learn/exercise.js';
import { gammaP, betaInc } from '../js/dist.js';
import { fitModel } from '../js/model/fit.js';

section('hashed randomness');
{
  const N = 200000; let m = 0, v = 0, z = 0, z2 = 0;
  for (let i = 0; i < N; i++) { const u = hashUniform('k', i); m += u; v += u * u; const n = hashNormal('n', i); z += n; z2 += n * n; }
  near('uniform: mean ½, variance 1/12', [m / N, v / N - (m / N) ** 2], [0.5, 1 / 12], { abs: 0.003 });
  near('normal: mean 0, variance 1', [z / N, z2 / N - (z / N) ** 2], [0, 1], { abs: 0.01 });
  check('same key, same draw; different key, different draw', hashNormal(1, 'a', 2) === hashNormal(1, 'a', 2) && hashNormal(1, 'a', 2) !== hashNormal(1, 'a', 3));
}

section('the true model');
{
  const fs = createStudy({ name: 't', factors: [{ id: 'A', low: 0, high: 10 }, { id: 'B', low: 1, high: 100, transform: 'log' }, { id: 'g', levels: ['x', 'y', 'z'] }, { id: 'h', levels: ['p', 'q'] }] }).factors;
  const proc = { seed: 1, factors: fs, responses: [{ id: 'y', truth: { intercept: 10, terms: { A: 2, B: -1, 'A:B': 0.5, 'I(A^2)': 3, 'g.z': 4, h: 1.5, 'A:radius2': 2 } } }, { id: 'w', transform: 'log', truth: { intercept: 1, terms: { A: 0.5 } } }] };
  // A = 7.5 → +0.5 coded; B = 10 → log-midpoint 0 coded; g = z; h = q → +1; radius2 = 1 (edge)
  near('terms in coded units (log factor, I(), indicator, two-level categorical, position term)', trueMean(proc, 'y', { A: 7.5, B: 10, g: 'z', h: 'q' }, { radius2: 1 }), 10 + 2 * 0.5 + 0 + 0 + 3 * 0.25 + 4 + 1.5 + 2 * 0.5, { rel: 1e-12 });
  near('log transform: exp of the linear predictor', trueMean(proc, 'w', { A: 10, B: 1, g: 'x', h: 'p' }), Math.exp(1.5), { rel: 1e-12 });
  throws('unknown term', () => trueMean({ ...proc, responses: [{ id: 'y', truth: { terms: { Q: 1 } } }] }, 'y', { A: 1, B: 1, g: 'x', h: 'p' }), /no such factor/);
}

section('observing runs');
{
  const s0 = createStudy({ name: 'o', seed: 2, factors: [{ id: 'A', low: 0, high: 1 }, { id: 'B', low: 0, high: 1 }], responses: [{ id: 'y' }] });
  const st = createStudy({ ...s0, design: toStudyDesign(s0, fullFactorial([2, 2], { replicates: 3 }), { seed: 2 }) });
  const proc = { seed: 9, factors: s0.factors, responses: [{ id: 'y', sigma: 1, truth: { intercept: 5, terms: { A: 2 } } }] };
  const a = observeRuns(proc, st), b = observeRuns(proc, st);
  check('deterministic: the same results twice', JSON.stringify(a) === JSON.stringify(b));
  const byRun = Object.fromEntries(a.map(o => [o.run, o.value]));
  const same = st.design.runs.filter(r => r.settings.A === 1 && r.settings.B === 1).map(r => byRun[r.run]);
  check('replicates at the same settings get fresh draws', new Set(same).size === 3);
  // reordering the runs leaves each (settings, replicate) result unchanged
  const re = createStudy({ ...st, design: { ...st.design, runs: st.design.runs.map(r => ({ ...r, order: 13 - r.order })) } });
  const c = Object.fromEntries(observeRuns(proc, re).map(o => [o.run, o.value]));
  check('results depend on (seed, settings, replicate), not on the run order', st.design.runs.every(r => c[r.run] === byRun[r.run]));
  const f = fitModel(createStudy(runVirtual(proc, st)), 'y ~ A*B');
  near('a fit recovers the truth within noise', [f.coef[1], f.coef[2]], [2, 0], { abs: 0.8 });
  // drift, outliers, wafers and sites
  const sw = createStudy({ ...s0, sites: siteScheme(5, { diameter: 200 }), responses: [{ id: 'y', levels: ['run', 'wafer', 'site'] }], design: st.design });
  const ow = observeRuns({ ...proc, nuisance: { wafers: 2, wafer: 0.5, site: 0.2, drift: 0.1 } }, sw);
  check('wafers and sites: 12 runs × 2 wafers × 5 sites, with slots', ow.length === 120 && ow.every(o => o.wafer && o.site !== undefined && o.slot >= 1));
  const drift = observeRuns({ ...proc, responses: [{ id: 'y', sigma: 1e-9, truth: { intercept: 0, terms: {} } }], nuisance: { drift: 1e9 } }, st);
  const ord = Object.fromEntries(st.design.runs.map(r => [r.run, r.order]));
  check('drift grows with the run order', drift.every(o => Math.abs(o.value - (ord[o.run] - 1)) < 1e-6));
}

section('counts and proportions in the virtual process (issue #64)');
{
  // the draws invert the distribution function: the k returned for u satisfies F(k − 1) < u ≤ F(k)
  const F = { poisson: (k, mu) => (k < 0 ? 0 : 1 - gammaP(k + 1, mu)), negbin: (k, mu, o) => (k < 0 ? 0 : betaInc(o.theta / (o.theta + mu), o.theta, k + 1).I),
    binomial: (k, p, o) => (k < 0 ? 0 : k >= o.trials ? 1 : betaInc(1 - p, o.trials - k, k + 1).I) };
  let ok = true;
  for (const [d, mu, o] of [['poisson', 0.3, {}], ['poisson', 12, {}], ['poisson', 900, {}], ['negbin', 150, { theta: 10 }], ['negbin', 2, { theta: 0.5 }], ['binomial', 0.02, { trials: 50 }], ['binomial', 0.6, { trials: 50 }], ['binomial', 0.999, { trials: 20 }]])
    for (const u of [1e-9, 0.01, 0.3, 0.5, 0.77, 0.99, 1 - 1e-9]) { const k = countQuantile(d, u, mu, o); if (!(Number.isInteger(k) && F[d](k - 1, mu, o) < u && u <= F[d](k, mu, o) + 1e-12)) ok = false; }
  check('a draw is the quantile of its distribution at the hashed uniform (Poisson, negative binomial, binomial)', ok);
  const N = 20000; let m = 0, v = 0;
  for (let i = 0; i < N; i++) { const k = countQuantile('negbin', (i + 0.5) / N, 40, { theta: 5 }); m += k; v += k * k; }
  near('negative binomial: mean μ, variance μ + μ²/θ', [m / N, v / N - (m / N) ** 2], [40, 40 + 1600 / 5], { rel: 0.01 });
  const s0 = createStudy({ name: 'c', seed: 2, factors: [{ id: 'A', low: 0, high: 1 }, { id: 'B', low: 0, high: 1 }], responses: [{ id: 'n', distribution: 'poisson' }, { id: 'g', distribution: 'binomial', trials: 40 }] });
  const st = createStudy({ ...s0, design: toStudyDesign(s0, fullFactorial([2, 2], { replicates: 6 }), { seed: 2 }) });
  const proc = { seed: 4, factors: s0.factors, responses: [
    { id: 'n', distribution: 'poisson', exposure: [10, 100], truth: { intercept: Math.log(0.5), terms: { A: Math.log(2) / 2 } } },
    { id: 'g', distribution: 'binomial', truth: { intercept: 0, terms: { B: -Math.log(3) / 2 } } }] };
  near('the true mean: the rate per unit exposure (log link), the proportion (logit link)', [trueMean(proc, 'n', { A: 1, B: 0 }), trueMean(proc, 'g', { A: 0, B: 1 })], [0.5 * Math.SQRT2, 1 / (1 + Math.sqrt(3))], { rel: 1e-12 });
  const obs = observeRuns(proc, st);
  check('counts are whole numbers with their exposure; successes lie within the trials', obs.filter(o => o.response === 'n').every(o => Number.isInteger(o.value) && [10, 100].includes(o.exposure)) && obs.filter(o => o.response === 'g').every(o => Number.isInteger(o.value) && o.value >= 0 && o.value <= 40 && o.exposure === undefined));
  check('deterministic, and both exposures used', JSON.stringify(obs) === JSON.stringify(observeRuns(proc, st)) && new Set(obs.filter(o => o.response === 'n').map(o => o.exposure)).size === 2);
  const done = createStudy(runVirtual(proc, st));
  const fn = fitModel(done, 'n ~ A + B'), fg = fitModel(done, 'g ~ A + B');
  near('Poisson fit with the exposure recovers the rate ratio and the baseline rate', [Math.exp(2 * fn.coef[1]), Math.exp(fn.coef[0])], [2, 0.5], { rel: 0.25 });
  near('binomial fit recovers the odds ratio', Math.exp(2 * fg.coef[2]), 1 / 3, { rel: 0.3 });
  // a shift on the link scale (blocks) multiplies a count's mean
  const sh = observeRuns({ ...proc, responses: [{ ...proc.responses[0], exposure: undefined, truth: { intercept: Math.log(1000), terms: {} } }], nuisance: { block: 1e-9 } }, createStudy({ ...st, design: { ...st.design, runs: st.design.runs.map(r => ({ ...r, block: 1 })) } }));
  check('nuisance shifts act on the link scale', sh.every(o => Math.abs(o.value - 1000) < 200));
}

section('the counts topic: ratios graded on the log scale, least squares as the counterpart');
{
  for (const scenario of ['transformation', 'germination']) {
    const ex = generateExercise({ topic: 'counts', difficulty: 'medium', seed: 3, scenario }), t = truthOf(ex);
    const prop = scenario === 'germination', r0 = ex.study.responses[0];
    check(`${scenario}: the study declares the ${prop ? 'binomial (50 seeds per dish)' : 'Poisson'} response; the questions ask for ${prop ? 'odds' : 'rate'} ratios`,
      r0.distribution === (prop ? 'binomial' : 'poisson') && (!prop || r0.trials === 50) && ex.questions.some(q => q.kind === 'ratios' && q.ratio === (prop ? 'odds' : 'rate')));
    const ref = referenceStrategy(ex), g = gradeStudy(ex, ref.study);
    check(`${scenario}: the model answer earns 100 (${ref.steps.at(-1)})`, g.score === 100 && g.truth.ratios && g.parts.some(p => p.id === 'ratios'));
    if (!prop) check('colonies: every result has the volume plated', ref.study.observations.every(o => [10, 50, 100, 200].includes(o.exposure)));
    const inv = { ...ref.answers, ratios: Object.fromEntries(Object.entries(ref.answers.ratios).map(([k, e]) => [k, { estimate: 1 / e.estimate, lower: 1 / e.upper, upper: 1 / e.lower }])) };
    check(`${scenario}: ratios on the wrong side of 1 lose the ratio points`, gradeAnswers(ex, t, inv, { runs: ex.budget }).parts.find(p => p.id === 'ratios').score === 0);
    const narrow = { ...ref.answers, ratios: Object.fromEntries(Object.entries(g.truth.ratios).map(([k, v]) => [k, { estimate: v * 1.3, lower: v * 1.2, upper: v * 1.4 }])) };
    near(`${scenario}: the right side of 1, an interval that misses: half the points`, gradeAnswers(ex, t, narrow, { runs: ex.budget }).parts.find(p => p.id === 'ratios').score / gradeAnswers(ex, t, narrow, { runs: ex.budget }).parts.find(p => p.id === 'ratios').max, 0.5, { abs: 1e-9 });
  }
  // least squares on the raw counts ignores the volume plated: it misses effects and gets the ratios wrong
  let ls = 0, n = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const ex = generateExercise({ topic: 'counts', difficulty: 'medium', seed, scenario: 'transformation' });
    const o = comparisonStrategy(ex);
    ls += gradeStudy(ex, createStudy({ ...o.study, exercise: { id: ex.id, answers: o.answers } })).score; n++;
    if (seed === 1) check('the counterpart is least squares on the raw counts, on the reference design', /least squares/.test(o.strategy) && o.answers.distribution === 'normal');
  }
  check(`colonies: least squares on the raw counts averages ${(ls / n).toFixed(1)} (the GLM 100)`, ls / n < 75);
  const ex = generateExercise({ topic: 'counts', difficulty: 'hard', seed: 4, scenario: 'transformation' }), ref = referenceStrategy(ex);
  check('hard colonies: overdispersed counts, analysed as negative binomial', truthOf(ex).process.responses[0].distribution === 'negbin' && ref.answers.distribution === 'negbin' && /negative binomial/.test(ref.answers.analysis));
  check('easy colonies: Poisson counts, Poisson analysis', ['poisson'].includes(referenceStrategy(generateExercise({ topic: 'counts', difficulty: 'easy', seed: 4, scenario: 'transformation' })).answers.distribution));
}

section('exercises: reproducible, sealed, keys and student copies');
{
  const a = generateExercise({ topic: 'rsm', difficulty: 'hard', seed: 12 }), b = generateExercise({ topic: 'rsm', difficulty: 'hard', seed: 12 });
  check('the same exercise from the same (topic, difficulty, seed)', JSON.stringify(a) === JSON.stringify(b));
  check('a different seed, a different exercise', JSON.stringify(a.sealed) !== JSON.stringify(generateExercise({ topic: 'rsm', difficulty: 'hard', seed: 13 }).sealed));
  const t = truthOf(a);
  check('sealed truth decodes; it holds the process and the model answer', t.process.responses[0].truth && t.modelAnswer.steps.length >= 1 && !JSON.stringify(a).includes('"truth"'));
  check('key has the truth in the clear; the student copy has none', keyOf(a).truth.process && !('truth' in studentOf(a)) && !('sealed' in studentOf(a)));
  check('seal(keyOf(x)) is x', JSON.stringify(seal(keyOf(a))) === JSON.stringify(a));
  throws('a student copy cannot be run', () => truthOf(studentOf(a)), /class exercise/);
  check('the study has no design; the scenario has units', !a.study.design && a.study.factors.every(f => f.units !== undefined || f.type === 'categorical'));
  throws('unknown topic', () => generateExercise({ topic: 'magic' }), /unknown topic/);
}

section('grading');
{
  const ex = generateExercise({ topic: 'factorial', difficulty: 'easy', seed: 5 }), t = truthOf(ex);
  const ref = referenceStrategy(ex);
  const g = gradeAnswers(ex, t, ref.answers, { runs: 16 });
  check('the model answer earns 100', g.score === 100);
  const wrong = { ...ref.answers, active: ex.study.factors.map(f => f.id).filter(id => !g.truth.active.includes(id)) };
  check('naming the wrong factors loses the active-factor points', gradeAnswers(ex, t, wrong, { runs: 16 }).parts.find(p => p.id === 'active').score === 0);
  check('over budget: −20', gradeAnswers(ex, t, ref.answers, { runs: 20 }).score === 80);
  const flipped = { ...ref.answers, effects: Object.fromEntries(Object.entries(ref.answers.effects).map(([k, e]) => [k, { estimate: -e.estimate, lower: -e.upper, upper: -e.lower }])) };
  check('wrong signs lose the effect points', gradeAnswers(ex, t, flipped, { runs: 16 }).parts.find(p => p.id === 'effects').score === 0);
  const worstCorner = Object.fromEntries(ex.study.factors.map(f => [f.id, f.type === 'categorical' ? f.levels[0] : (g.truth.best[f.id] === f.high ? f.low : f.high)]));
  check('the opposite corner has regret: fewer best-settings points', gradeAnswers(ex, t, { ...ref.answers, best: worstCorner }, { runs: 16 }).parts.find(p => p.id === 'best').score < gradeAnswers(ex, t, ref.answers, { runs: 16 }).parts.find(p => p.id === 'best').max);
  // a study with its own answers is graded on them; without, on the standard analysis of its data
  const own = createStudy({ ...ref.study, exercise: { id: ex.id, answers: { active: [] } } });
  check('given answers are graded as given', gradeStudy(ex, own).derived === false && gradeStudy(ex, own).score < 100);
}

section('done-when: topics × difficulties × 50 seeds — reference full marks, one-factor-at-a-time lower');
for (const topic of Object.keys(TOPICS)) for (const difficulty of Object.keys(DIFFICULTIES)) {
  let refFull = 0, ofat = 0, ofatFull = 0, n = 0, name = 'one-factor-at-a-time';
  for (let seed = 1; seed <= 50; seed++) {
    const ex = generateExercise({ topic, difficulty, seed });
    // a mixture: one component at a time along its Cox direction; counts: least squares on the raw counts
    const r = referenceStrategy(ex), o = TOPICS[topic].mixture || TOPICS[topic].counts ? comparisonStrategy(ex) : ofatStrategy(ex);
    if (gradeStudy(ex, r.study).score === 100 && r.study.design.runs.length <= ex.budget) refFull++;
    if (TOPICS[topic].mixture || TOPICS[topic].counts) name = o.strategy.replace(/ on the raw .*/, ' on the raw values');
    const so = gradeStudy(ex, createStudy({ ...o.study, exercise: { id: ex.id, answers: o.answers } })).score;
    ofat += so; if (so === 100) ofatFull++; n++;
  }
  check(`${topic} / ${difficulty}: reference 100 in ${refFull} of ${n}; ${name} averages ${(ofat / n).toFixed(1)} (100 in ${ofatFull})`, refFull === n && ofat / n < 90);
}

section('class mode round trip from the CLI');
{
  const dir = mkdtempSync(join(tmpdir(), 'aikidoe-class-'));
  const doe = (...a) => spawnSync(process.execPath, [new URL('../tools/doe.mjs', import.meta.url).pathname, ...a], { cwd: dir, encoding: 'utf8' });
  try {
    let r = doe('exercise', 'new', '--set', '3', '--topic', 'blocking', '--difficulty', 'medium', '--seed', '20', '--out', 'cls');
    check('instructor: a set of 3 exercises, keys and student studies', r.status === 0 && ['20', '21', '22'].every(k => existsSync(join(dir, 'cls', `blocking-medium-${k}.key.json`)) && existsSync(join(dir, 'cls', `blocking-medium-${k}.aikidoe.json`))), r.stderr);
    const stu = JSON.parse(readFileSync(join(dir, 'cls', 'blocking-medium-20.aikidoe.json'), 'utf8'));
    check('the student study has the questions but neither truth nor seal', stu.exercise.questions.length >= 2 && !('truth' in stu.exercise) && !('sealed' in stu.exercise));
    r = doe('exercise', 'run', 'cls/blocking-medium-20.aikidoe.json');
    check('students cannot run their own exercise', r.status === 1 && /class exercise: send your run sheet/.test(r.stderr));
    doe('design', 'cls/blocking-medium-20.aikidoe.json', '--full', '--blocks', '2');
    doe('sheet', 'cls/blocking-medium-20.aikidoe.json', '--csv', 'sheet.csv');
    r = doe('exercise', 'run', 'cls/blocking-medium-20.key.json', 'sheet.csv', '--out', 'results.csv');
    check('instructor: results for the student\'s run sheet', r.status === 0 && /results for 16 runs \(budget 16\)/.test(r.stdout), r.stdout + r.stderr);
    const sheet = readFileSync(join(dir, 'sheet.csv'), 'utf8').trim().split('\n');
    writeFileSync(join(dir, 'part.csv'), [sheet[0], ...sheet.slice(1).filter(l => Number(l.split(',')[1]) > 8)].join('\n') + '\n');
    r = doe('exercise', 'run', 'cls/blocking-medium-20.key.json', 'part.csv');
    check('instructor: a sheet without the earlier runs is refused (repeat runs are counted from run 1)', r.status === 1 && /runs 9–16 only; send the whole run sheet/.test(r.stderr), r.stdout + r.stderr);
    r = doe('import', 'cls/blocking-medium-20.aikidoe.json', 'results.csv');
    check('student: imports the results', r.status === 0 && /16 observation/.test(r.stdout), r.stdout + r.stderr);
    r = doe('exercise', 'grade', 'cls/blocking-medium-20.key.json', 'cls/blocking-medium-20.aikidoe.json');
    check('instructor: grades the submission (the blocked factorial is the reference design: 100)', r.status === 0 && /score: 100 \/ 100/.test(r.stdout) && /model answer:/.test(r.stdout), r.stdout + r.stderr);
    // the same results as the reference strategy gets: deterministic from (seed, settings, replicate, order)
    const key = JSON.parse(readFileSync(join(dir, 'cls', 'blocking-medium-20.key.json'), 'utf8'));
    check('the key holds the model answer', key.truth.modelAnswer.answers.active.length >= 1);
    // counts (issue #64): the volume plated comes back with each count, and is imported with it
    r = doe('exercise', 'new', '--set', '1', '--topic', 'counts', '--difficulty', 'medium', '--seed', '7', '--scenario', 'transformation', '--out', 'cnt');
    doe('design', 'cnt/counts-medium-7.aikidoe.json', '--full', '--replicates', '2');
    doe('sheet', 'cnt/counts-medium-7.aikidoe.json', '--csv', 'csheet.csv');
    r = doe('exercise', 'run', 'cnt/counts-medium-7.key.json', 'csheet.csv', '--out', 'cres.csv');
    const res = readFileSync(join(dir, 'cres.csv'), 'utf8').trim().split('\n');
    check('counts, class mode: the results have the volume plated', r.status === 0 && res[0] === 'run,response,value,exposure' && res.slice(1).every(l => [10, 50, 100, 200].includes(Number(l.split(',')[3]))), r.stdout + r.stderr);
    r = doe('import', 'cnt/counts-medium-7.aikidoe.json', 'cres.csv');
    const imported = JSON.parse(readFileSync(join(dir, 'cnt', 'counts-medium-7.aikidoe.json'), 'utf8'));
    check('counts: the student imports the counts with their exposures', r.status === 0 && imported.observations.length === 32 && imported.observations.every(o => o.exposure > 0), r.stdout + r.stderr);
    r = doe('exercise', 'grade', 'cnt/counts-medium-7.key.json', 'cnt/counts-medium-7.aikidoe.json');
    check('counts: graded on the standard analysis — 100, with the true rate ratios', r.status === 0 && /score: 100 \/ 100/.test(r.stdout) && /truth: active .*; rate ratios /.test(r.stdout) && /^ratios +38\.5 \/ 38\.5/m.test(r.stdout), r.stdout + r.stderr);
    const ra = Object.entries(JSON.parse(readFileSync(join(dir, 'cnt', 'counts-medium-7.key.json'), 'utf8')).truth.modelAnswer.answers.ratios)[0];
    r = doe('exercise', 'answer', 'cnt/counts-medium-7.aikidoe.json', '--active', ra[0], '--ratio', `${ra[0]}=${1 / ra[1].estimate}:${1 / ra[1].upper}:${1 / ra[1].lower}`);
    check('counts: --ratio records a ratio answer', r.status === 0 && JSON.parse(readFileSync(join(dir, 'cnt', 'counts-medium-7.aikidoe.json'), 'utf8')).exercise.answers.ratios[ra[0]].estimate > 0, r.stdout + r.stderr);
    r = doe('exercise', 'answer', 'cnt/counts-medium-7.aikidoe.json', '--ratio', `${ra[0]}=-1:0:2`);
    check('counts: a ratio must be positive', r.status === 1 && /ratios, all > 0/.test(r.stderr));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

done();
