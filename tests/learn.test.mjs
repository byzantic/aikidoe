// Virtual processes and exercises (issue #38): deterministic results from (seed, settings,
// replicate); the nuisance; generation reproducible from the seed; across topics × difficulties
// × 50 seeds the reference strategy earns full marks and one-factor-at-a-time scores lower; the
// class-mode round trip from the CLI.
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { section, check, near, throws, done } from './lib/check.mjs';
import { createStudy } from '../js/study.js';
import { toStudyDesign, fullFactorial } from '../js/design/factorial.js';
import { siteScheme } from '../js/model/sites.js';
import { hashUniform, hashNormal, trueMean, observeRuns, runVirtual } from '../js/learn/process.js';
import { generateExercise, referenceStrategy, ofatStrategy, gradeStudy, gradeAnswers, truthOf, keyOf, studentOf, seal, TOPICS, DIFFICULTIES, runExercise } from '../js/learn/exercise.js';
import { fitModel } from '../js/model/ols.js';

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
  let refFull = 0, ofat = 0, ofatFull = 0, n = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const ex = generateExercise({ topic, difficulty, seed });
    const r = referenceStrategy(ex), o = ofatStrategy(ex);
    if (gradeStudy(ex, r.study).score === 100 && r.study.design.runs.length <= ex.budget) refFull++;
    const so = gradeStudy(ex, createStudy({ ...o.study, exercise: { id: ex.id, answers: o.answers } })).score;
    ofat += so; if (so === 100) ofatFull++; n++;
  }
  check(`${topic} / ${difficulty}: reference 100 in ${refFull} of ${n}; one-factor-at-a-time averages ${(ofat / n).toFixed(1)} (100 in ${ofatFull})`, refFull === n && ofat / n < 90);
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
    r = doe('import', 'cls/blocking-medium-20.aikidoe.json', 'results.csv');
    check('student: imports the results', r.status === 0 && /16 observation/.test(r.stdout), r.stdout + r.stderr);
    r = doe('exercise', 'grade', 'cls/blocking-medium-20.key.json', 'cls/blocking-medium-20.aikidoe.json');
    check('instructor: grades the submission (the blocked factorial is the reference design: 100)', r.status === 0 && /score: 100 \/ 100/.test(r.stdout) && /model answer:/.test(r.stdout), r.stdout + r.stderr);
    // the same results as the reference strategy gets: deterministic from (seed, settings, replicate, order)
    const key = JSON.parse(readFileSync(join(dir, 'cls', 'blocking-medium-20.key.json'), 'utf8'));
    check('the key holds the model answer', key.truth.modelAnswer.answers.active.length >= 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

done();
