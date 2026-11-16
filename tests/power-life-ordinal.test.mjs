// Power for times to failure and ordinal scores (issue #83, phase 3), against the fixture
// power-life-ordinal-r (tests/ref/power_life_ordinal_r.R): the expected information per unit with
// Type I censoring (stats::integrate; the extreme-value textbook values), Whitehead's formula for
// the proportional-odds model, and power simulated in R with survreg and clm — which the app's
// power (from the expected information) and its own simulation must agree with, within the Monte
// Carlo error. Then the study-level functions, the cost of censoring, and the Guide.
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import { unitInformation, lifePower, simulateLifePower, detectableTimeRatio, studyLifePower } from '../js/model/power-life.js';
import { ordinalPower, simulateOrdinalPower, detectableOddsRatio, studyOrdinalPower } from '../js/model/power-ordinal.js';
import { parseStudy } from '../js/study.js';
import { advise, nextQuestion } from '../js/guide.js';
import { readFileSync } from 'node:fs';

const F = loadFixture('power-life-ordinal-r');
const of = (kind) => F.cases.filter(c => c.input.kind === kind);
// a replicated 2² in coded units, as the R simulations
const mm = { X: [[1, -1, -1], [1, 1, -1], [1, -1, 1], [1, 1, 1]], columns: ['(Intercept)', 'A', 'B'], assign: [-1, 0, 1], model: { terms: [{ label: 'A', comps: [{ f: 'A' }] }, { label: 'B', comps: [{ f: 'B' }] }] } };
const mm2 = { X: [[1, -1], [1, 1]], columns: ['(Intercept)', 'A'], assign: [-1, 0], model: { terms: [{ label: 'A', comps: [{ f: 'A' }] }] } };

section('expected information per unit, with censoring: as stats::integrate');
for (const c of of('information')) {
  const u = unitInformation(c.input.distribution, c.input.zc ?? Infinity);
  near(`${c.name}: A, B, C and the fraction failing`, [u.A, u.B, u.C, u.failed], [c.output.A, c.output.B, c.output.C, c.output.failed], { rel: 1e-8, abs: 1e-9 });
}

section('ordinal: Whitehead\'s formula');
for (const c of of('whitehead')) {
  const r = ordinalPower(mm2, { baseline: c.input.baseline, ratio: c.input.ratio, scoresPerRun: c.input.N / 2 });
  near(`${c.name}: the non-centrality (information at the null, as Whitehead with the centre's probabilities)`, r.terms[0].lambda, c.output.lambdaCentre, { rel: 1e-10 });
}

section('power: the expected information and the app\'s simulation against survreg / clm simulations');
// agreement within the Monte Carlo error: R's 1000 experiments, the app's simulation 1000
const mc = (p, n) => Math.sqrt(p * (1 - p) / n);
for (const c of of('life')) {
  const o = { distribution: c.input.dist, median: c.input.median, ratio: c.input.ratio, shape: c.input.shape, sigma: c.input.sigma, unitsPerRun: c.input.units, testEnd: c.input.testEnd ?? Infinity };
  const R = c.output.power, a = lifePower(mm, o).terms[0], s = simulateLifePower(mm, { ...o, nsim: 1000, seed: 83 })[0];
  const se = Math.sqrt(mc(R, 1000) ** 2 + mc(s.power, 1000) ** 2);
  check(`${c.name}: the app's simulation ${s.power.toFixed(3)} agrees with survreg's ${R} (within 4 s.e.)`, Math.abs(s.power - R) < 4 * se, `diff ${(s.power - R).toFixed(3)}, se ${se.toFixed(3)}`);
  check(`… the expected-information power ${a.power.toFixed(3)} within 0.06`, Math.abs(a.power - R) < 0.06);
  near(`… the fraction failing as simulated`, s.failed, c.output.failed, { abs: 0.02 });
}
for (const c of of('ordinal')) {
  const o = { baseline: c.input.baseline, ratio: c.input.ratio, scoresPerRun: c.input.scoresPerRun };
  const R = c.output.power, a = ordinalPower(mm, o).terms[0], s = simulateOrdinalPower(mm, { ...o, nsim: 1000, seed: 83 })[0];
  const se = Math.sqrt(mc(R, 1000) ** 2 + mc(s.power, 1000) ** 2);
  check(`${c.name}: the app's simulation ${s.power.toFixed(3)} agrees with clm's ${R} (within 4 s.e.)`, Math.abs(s.power - R) < 4 * se, `diff ${(s.power - R).toFixed(3)}`);
  check(`… the expected-information power ${a.power.toFixed(3)} within 0.05`, Math.abs(a.power - R) < 0.05);
}

section('censoring, detectable ratios, the study');
const o = { distribution: 'weibull', median: 800, ratio: 0.5, unitsPerRun: 6 };
const p1000 = lifePower(mm, { ...o, testEnd: 1000 }).terms[0], p300 = lifePower(mm, { ...o, testEnd: 300 }).terms[0], pInf = lifePower(mm, o).terms[0];
check('stopping the test earlier costs power; running to failure gives the most', p300.power < p1000.power && p1000.power < pInf.power && Math.abs(p1000.powerUncensored - pInf.power) < 1e-12);
check('the fraction failing at each run, with the term at its effect: shorter life, more failures', p1000.failed[0] < p1000.failed[1] && pInf.failed[0] === 1);
const dl = detectableTimeRatio(lifePower(mm, { ...o, testEnd: 1000 }), { power: 0.8 })[0];
check('the detectable time ratio gives 80 % power, and lies below 1 for a shortening effect', dl.ratio < 1 && Math.abs(lifePower(mm, { ...o, testEnd: 1000, ratio: dl.ratio }).terms[0].power - 0.8) < 1e-6);
const dlUp = detectableTimeRatio(lifePower(mm, { ...o, ratio: 2 }), { power: 0.8 })[0];
check('… above 1 for a lengthening one, and the same size (no censoring: symmetric)', dlUp.ratio > 1 && Math.abs(Math.log(dlUp.ratio) + Math.log(detectableTimeRatio(lifePower(mm, o), { power: 0.8 })[0].ratio)) < 1e-6);
const dOr = detectableOddsRatio(ordinalPower(mm, { ratio: 2, scoresPerRun: 10 }), { power: 0.8 })[0];
check('the detectable odds ratio gives 80 % power', Math.abs(ordinalPower(mm, { ratio: dOr.ratio, scoresPerRun: 10 }).terms[0].power - 0.8) < 1e-6);
throws('a life test needs the median life', () => lifePower(mm, { distribution: 'weibull' }), /median/);
throws('chances that do not add to 1', () => ordinalPower(mm, { baseline: [0.5, 0.3, 0.3] }), /add up to 1/);
throws('two categories are not ordinal', () => ordinalPower(mm, { baseline: [0.5, 0.5] }), /three or more/);
const life = parseStudy(readFileSync(new URL('../examples/interconnect-life.aikidoe.json', import.meta.url), 'utf8'));
const sl = studyLifePower(life, { distribution: 'weibull', median: 800, ratio: 0.5, unitsPerRun: 8, testEnd: 1000 });
check('the example life test: two terms, 40 units, power well above 80 % at a time ratio of 0.5', sl.terms.length === 2 && sl.units === 40 && sl.terms.every(t => t.power > 0.85));
const panel = parseStudy(readFileSync(new URL('../examples/coating-panel.aikidoe.json', import.meta.url), 'utf8'));
const so = studyOrdinalPower(panel, { model: 'temp*time + primer', ratio: 3, scoresPerRun: 5 });
check('the coating panel: four terms, 40 scores, equal power for each ±1 column', so.terms.length === 4 && so.scores === 40 && so.terms.every(t => Math.abs(t.power - so.terms[0].power) < 1e-9));

section('the Guide: times to failure and scores');
const base = { aim: 'understand', factors: 3, kinds: 'continuous', htc: 'no', budget: null };
const walk = (answers) => { const a = { ...base, ...answers }; for (let k = 0; k < 40; k++) { const q = nextQuestion(a); if (!q) break; if (a[q.id] !== undefined) break; a[q.id] = q.options ? q.options[0].value : q.optional ? null : q.min ?? 1; } return a; };
const at = walk({ result: 'time', lifeRatio: 'medium', censoring: 'half' });
const qs = []; { const a = { ...base, result: 'time' }; for (let k = 0; k < 40; k++) { const q = nextQuestion(a); if (!q) break; qs.push(q.id); a[q.id] = q.options ? q.options[0].value : q.optional ? null : q.min ?? 1; } }
check('a time to failure asks how big a change in life matters, and how many units will fail', qs.includes('lifeRatio') && qs.includes('censoring') && !qs.includes('effect') && !qs.includes('ratio'));
const adv = advise(at);
check('… and advises the life model, censoring, units per run and the power check', /Weibull/.test(adv.notes.join(' ')) && /still working/.test(adv.notes.join(' ')) && /units/.test(adv.notes.join(' ')) && adv.life?.ratio === 2);
const few = advise(walk({ result: 'time', lifeRatio: 'medium', censoring: 'few' }));
check('few failures expected: a warning, and more units than with half failing', few.warnings.some(w => /few units fail/i.test(w)) && few.life.units > adv.life.units);
const sc = advise(walk({ result: 'score', ratio: 'medium' }));
check('a score: the proportional-odds model and a number of scores', /ordinal/.test(sc.notes.join(' ')) && /proportional/.test(sc.notes.join(' ')) && sc.scores?.ratio === 2 && sc.scores.n > 50);

done();
