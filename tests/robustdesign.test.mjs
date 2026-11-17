// Robust design (issue #85, phase 3), against R (fixture robustdesign-r, tests/ref/robustdesign_r.R):
// alias correlations of designs built with FrF2 and DoE.base; Taguchi's signal-to-noise ratios and
// response table for a crossed array. Then the crossed-array generator, the study, the default
// model and the recommender.
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import { aliasCorrelation, polyContrasts, studyAliasCorrelation } from '../js/design/aliascorr.js';
import { crossedArray, smallArray } from '../js/design/crossed.js';
import { crossedSummaries, responseTable, SN_GOALS } from '../js/model/taguchi.js';
import { createStudy } from '../js/study.js';
import { toStudyDesign } from '../js/design/factorial.js';
import { candidates, buildCandidate, recommend } from '../js/design/recommend.js';
import { defaultFormula } from '../js/model/defaults.js';
import { fitModel } from '../js/model/fit.js';

const F = loadFixture('robustdesign-r');
const tol = { rel: 1e-9, abs: 1e-10 };

section('alias correlations: as R');
for (const c of F.cases.filter(x => x.input.kind === 'alias')) {
  const r = aliasCorrelation(c.input.X, c.input.kinds);
  near(`${c.name}: largest |r| main vs 2fi, between main effects, rms`, [r.max, r.mainMax, r.rms], [c.output.max, c.output.mainMax, c.output.rms], tol);
}
near('polynomial contrasts orthonormal (3 and 4 levels)', [3, 4].map(s => polyContrasts(s).flatMap((a, i) => polyContrasts(s).map((b, j) => a.reduce((t, v, k) => t + v * b[k], 0) - (i === j ? 1 : 0)))).flat(), new Array(4 + 9).fill(0), { abs: 1e-12 });

section('Taguchi\'s analysis: as R');
for (const c of F.cases.filter(x => x.input.kind === 'taguchi')) {
  const factors = [...['A', 'B', 'C'].map(id => ({ id, low: 0, high: 2, levels: [0, 1, 2] })), { id: 'M', low: -1, high: 1 }, { id: 'N', low: -1, high: 1 }];
  const runs = c.input.runs.map((r, i) => ({ run: i + 1, order: i + 1, kind: 'fraction', settings: { A: r.A, B: r.B, C: r.C, M: r.M, N: r.N } }));
  const st = createStudy({ name: 't', seed: 1, factors, responses: [{ id: 'y' }], design: { kind: 'crossed-array', params: { noise: [3, 4] }, runs }, observations: c.input.runs.map((r, i) => ({ run: i + 1, response: 'y', value: r.y })) });
  const s = crossedSummaries(st, 'y', { goal: c.input.goal });
  near(`${c.name}: S/N, mean and s of each inner run`, [s.rows.map(r => r.sn), s.rows.map(r => r.mean), s.rows.map(r => r.sd)], [c.output.sn, c.output.mean, c.output.sd], tol);
  const t = responseTable(s, st);
  near('… the response table: the level averages of S/N and their ranges', [t.map(x => x.levels.map(l => l.sn)), t.map(x => x.range)], [c.output.table.map(x => x.sn), c.output.table.map(x => x.range)], tol);
  check('… the best levels', t.map(x => x.best).join() === c.output.table.map(x => x.best).join());
}
check('larger the better needs positive results', Number.isNaN(SN_GOALS.larger.f([1, -2])));

section('the crossed array');
const d = crossedArray([3, 3, 3, 2, 2], [false, false, false, true, true]);
check('three three-level control factors × two two-level noise factors: L9 × 2² = 36 runs', d.X.length === 36 && d.params.inner === 'L9 (3^4)' && d.params.outer === 'full factorial 2×2' && d.params.innerRuns === 9 && d.params.outerRuns === 4);
check('every inner run at every outer condition', [...new Set(d.innerIndex)].every(a => { const rows = d.X.filter((_, i) => d.innerIndex[i] === a); return rows.length === 4 && new Set(rows.map(r => `${r[3]},${r[4]}`)).size === 4 && new Set(rows.map(r => r.slice(0, 3).join())).size === 1; }));
check('two control factors: the full factorial when no bigger than an array', smallArray([3, 3]).runs === 9 && /full factorial/.test(smallArray([3, 3]).name));
check('arrays given by name', crossedArray([2, 2, 2, 2, 2], [false, false, false, false, true], { inner: 'L8' }).params.inner === 'L8 (2^7)');
throws('needs a noise factor', () => crossedArray([2, 2], [false, false]), /noise factor/);
throws('needs a control factor', () => crossedArray([2, 2], [true, true]), /control factor/);

section('the study, the default model, the recommender');
const s0 = createStudy({ name: 'x', seed: 4, factors: [{ id: 'A', low: 0, high: 2, levels: [0, 1, 2] }, { id: 'B', low: 0, high: 2, levels: [0, 1, 2] }, { id: 'C', low: 0, high: 2, levels: [0, 1, 2] },
  { id: 'M', low: -1, high: 1, noise: { sd: 0.5 } }, { id: 'N', low: -1, high: 1, noise: { sd: 0.5 } }], responses: [{ id: 'y', goal: 'maximize' }] });
const cs = candidates(s0), cr = cs.find(c => c.kind === 'crossed');
check('noise factors in the study: an inner × outer candidate', cr?.runs === 36 && /L9 \(3\^4\) × full factorial 2×2/.test(cr.label));
const sd = createStudy({ ...s0, design: toStudyDesign(s0, buildCandidate(s0, cr)) });
check('the study keeps which factors are noise', sd.design.kind === 'crossed-array' && sd.design.params.noise.join() === '3,4' && sd.design.runs.length === 36);
check('the default model: main effects with control × noise interactions (the response-model approach)', defaultFormula(sd, 'y') === 'y ~ A + B + C + M + N + (A + B + C):(M + N) + I(A^2) + I(B^2) + I(C^2)');
const obs = sd.design.runs.map(r => ({ run: r.run, response: 'y', value: 20 + r.settings.A + r.settings.M * (1 - 0.5 * r.settings.C) + 0.01 * (r.run % 5) }));
const st = createStudy({ ...sd, observations: obs });
const f = fitModel(st, defaultFormula(sd, 'y'));
check('it fits: 15 parameters in 36 runs', f.rank === 15 && f.dfRes === 21);
const sm = crossedSummaries(st, 'y');
check('the summaries from the design\'s noise factors, larger the better from the goal', sm.goal === 'larger' && sm.rows.length === 9 && sm.rows.every(r => r.n === 4));
const ac = studyAliasCorrelation(sd, sd.design.runs);
check('a crossed array: control × noise interactions clear of main effects', ac.mainMax < 1e-9);
const rec = recommend(s0, { optimal: false });
check('the recommender gives each option its largest alias correlation', rec.options.filter(o => o.estimable).every(o => typeof o.aliasMax === 'number' && o.aliasMax >= 0 && o.aliasMax <= 1 + 1e-9));

done();
