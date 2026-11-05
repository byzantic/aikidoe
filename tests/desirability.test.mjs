// Desirability (issue #18). Reference: fixture desirability-r (R package desirability 2.1:
// dMax, dMin, dTarget, dBox, dOverall, and the vignette's conversion / activity example).
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import { dValue, dOverall, responseDesirability, optimiseDesirability, profile, desirabilityGrid } from '../js/model/desirability.js';
import { createStudy } from '../js/study.js';

const cases = loadFixture('desirability-r').cases;
const KIND = { max: 'max', min: 'min', target: 'target', box: 'box' };

section('individual desirabilities vs R');
for (const c of cases.filter(x => KIND[x.input.kind])) {
  const a = c.input.args, spec = { kind: KIND[c.input.kind], low: a.low, high: a.high, target: a.target, scale: a.scale, lowScale: a.lowScale, highScale: a.highScale };
  near(c.name, c.input.y.map(y => dValue(spec, y)), c.output.d, { rel: 1e-12, abs: 1e-15 });
}
{
  const c = cases.find(x => x.input.kind === 'overall');
  near(c.name, c.input.y.map(([a, b]) => dOverall([dValue({ kind: 'max', low: 1, high: 5 }, a), dValue({ kind: 'target', low: 0, target: 3, high: 5 }, b)])), c.output.D, { rel: 1e-12, abs: 1e-15 });
  near('importance: weighted geometric mean', dOverall([0.25, 1], [2, 1]), 0.25 ** (2 / 3), { rel: 1e-14 });
}

section('the vignette example: conversion and activity');
{
  const v = cases.find(x => x.input.kind === 'vignette').output;
  const quad = (b) => (x) => b[0] + b[1] * x[0] + b[2] * x[1] + b[3] * x[2] + b[4] * x[0] ** 2 + b[5] * x[1] ** 2 + b[6] * x[2] ** 2 + b[7] * x[0] * x[1] + b[8] * x[0] * x[2] + b[9] * x[1] * x[2];
  near('the vignette’s prediction equations (refitted exactly in R)', [v.conversion[0], v.activity[0]], [81.09, 59.85], { rel: 1e-12 });
  const s = createStudy({ aikidoe: 1, seed: 1, factors: ['time', 'temperature', 'catalyst'].map(id => ({ id, low: -1, high: 1 })),
    responses: [{ id: 'conv', goal: 'maximize', lower: 80, target: 97 }, { id: 'acty', goal: 'target', lower: 55, target: 57.5, upper: 60 }] });
  const conv = quad(v.conversion), acty = quad(v.activity), X = (st) => [st.time, st.temperature, st.catalyst];
  const models = [{ id: 'conv', spec: responseDesirability(s.responses[0]), predict: (st) => conv(X(st)) }, { id: 'acty', spec: responseDesirability(s.responses[1]), predict: (st) => acty(X(st)) }];
  check('response goals map to dMax(80, 97) and dTarget(55, 57.5, 60)', JSON.stringify(models.map(m => [m.spec.kind, m.spec.low, m.spec.high])) === '[["max",80,97],["target",55,60]]');
  for (const [region, opts, ref] of [['square |x| ≤ 1.682', { region: 'cube', radius: 1.682 }, v.square], ['circular, radius 1.682', { region: 'sphere', radius: 1.682 }, v.circular]]) {
    const o = optimiseDesirability(s, models, { ...opts, seed: 3 });
    check(`${region}: D at least the vignette’s (${ref.D.toFixed(6)})`, o.D >= ref.D - 1e-6, o.D);
    near(`${region}: same optimum (time, temperature, catalyst)`, [o.settings.time, o.settings.temperature, o.settings.catalyst], ref.x, { abs: 2e-3 });
    near(`${region}: predicted conversion and activity there`, [o.d[0].y, o.d[1].y], [ref.conv, ref.acty], { abs: 0.01 });
  }
  const held = optimiseDesirability(s, models, { region: 'cube', radius: 1.682, fixed: { catalyst: 0 } });
  check('a factor can be held fixed', held.settings.catalyst === 0 && held.D > 0 && held.D <= 0.9426);
  const pr = profile(s, models.map(m => ({ id: m.id, predictBand: (st) => { const f = m.predict(st); return { fit: f, lower: f - 1, upper: f + 1 }; } })), { time: 0, temperature: 0, catalyst: 0 }, { points: 5 });
  check('profiler: a slice per factor per response, through the current settings', pr.length === 3 && pr[0].curves.length === 2 && Math.abs(pr[0].curves[0].fit[2] - 81.09) < 1e-12);
  const gr = desirabilityGrid(s, models, { time: 0, temperature: 0, catalyst: 0 }, 'time', 'catalyst', { n: 11 });
  check('overlay grid: D and feasibility over two factors', gr.cells.length === 11 && gr.cells[0].length === 11 && gr.cells.flat().some(c => c.ok) && gr.cells.flat().some(c => !c.ok));
}

section('response specs and edge cases');
{
  check('minimise: fully desirable at target (or lower), unacceptable above upper', JSON.stringify(responseDesirability({ goal: 'minimize', target: 2, upper: 5 })) === JSON.stringify({ kind: 'min', low: 2, high: 5, scale: 1, importance: 1 }));
  check('target with two shape weights and importance', JSON.stringify(responseDesirability({ goal: 'target', lower: 1, target: 2, upper: 4, weight: [0.5, 2], importance: 3 })) === JSON.stringify({ kind: 'target', low: 1, target: 2, high: 4, lowScale: 0.5, highScale: 2, importance: 3 }));
  check('no goal or missing limits: not part of the overall desirability', responseDesirability({ goal: 'none' }) === null && responseDesirability({ goal: 'maximize', lower: 1 }) === null);
  const s = createStudy({ aikidoe: 1, seed: 1, factors: [{ id: 'A', low: 0, high: 10 }, { id: 'G', levels: ['a', 'b'] }], constraints: ['A <= 6'] });
  const o = optimiseDesirability(s, [{ id: 'y', spec: { kind: 'max', low: 0, high: 20 }, predict: (st) => st.A + (st.G === 'b' ? 5 : 0) }]);
  near('constraints respected; categorical levels enumerated', [o.settings.A, o.D], [6, 11 / 20], { abs: 1e-6 });
  check('… at the better level', o.settings.G === 'b' && o.feasible);
  throws('no goals', () => optimiseDesirability(s, []), /no response has a desirability goal/);
  throws('importance and weight validated in the study', () => createStudy({ aikidoe: 1, seed: 1, factors: [{ id: 'A', low: 0, high: 1 }], responses: [{ id: 'y', goal: 'maximize', lower: 0, upper: 1, importance: -1 }] }), /importance/);
}
done();
