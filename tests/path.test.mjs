// Paths to a better region (issue #81): steepest ascent and descent (first order), ridge analysis
// (second order) and the canonical path, against rsm::steepest and rsm::canonical.path (fixture
// path-r, tests/ref/path_r.R); the confidence region for the direction (Box & Draper); natural
// units, categorical factors, operating limits and constraints.
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import { createStudy, validateStudy } from '../js/study.js';
import { fitModel, predict } from '../js/model/fit.js';
import { steepestPath, canonicalPath, directionRegion, surfaceCoefficients, pathStage, pathResults, nextStudy } from '../js/model/path.js';
import { appendStage } from '../js/design/augment.js';
import { parseStudy } from '../js/study.js';
import { readFileSync } from 'node:fs';

const F = loadFixture('path-r');
const byName = (n) => F.cases.find(c => c.name === n);
const coded3 = [{ id: 'x1', low: -1, high: 1 }, { id: 'x2', low: -1, high: 1 }, { id: 'x3', low: -1, high: 1 }];
const studyOf = (rows, factors = coded3, extra = {}) => createStudy({ name: 'x', factors, responses: [{ id: 'y', goal: 'maximize' }], ...extra,
  design: { runs: rows.map((r, i) => ({ run: i + 1, settings: Object.fromEntries(factors.map(f => [f.id, r[f.id]])) })) },
  observations: rows.map((r, i) => ({ run: i + 1, response: 'y', value: r.y })) });
const xs = (p) => p.points.map(q => ['x1', 'x2', 'x3'].map(id => q.coded[id]));
// rsm rounds the path to 3 decimals and predicts there (its points come from uniroot, good to about
// 1e-3; the exact paths are in the fixture too)
const atRounded = (fit, xr) => predict(fit, xr.map(x => ({ x1: x[0], x2: x[1], x3: x[2] }))).map(p => p.fit);

section('first-order path: as rsm::steepest (ascent and descent)');
{
  const c = byName('first order ascent'), s = studyOf(c.input.rows), fit = fitModel(s, 'y ~ main');
  const p = steepestPath(s, fit, { distances: c.input.dist });
  check('a straight path, ascent (the response is maximised)', p.method === 'linear' && p.goal === 'ascent' && p.points.length === c.output.dist.length);
  near('the path, exactly (b/|b| × distance)', xs(p), c.output.exact, { abs: 1e-12 });
  near('… and as rsm::steepest prints it (3 decimals, uniroot)', xs(p), c.output.x, { abs: 1.5e-3 });
  near('the fitted response at rsm\'s points', atRounded(fit, c.output.x), c.output.yhat, { abs: 5.0001e-4 });
  const d = byName('first order descent'), q = steepestPath(s, fit, { distances: d.input.dist, descent: true });
  near('descent', xs(q), d.output.exact, { abs: 1e-12 });
  near('… as rsm', xs(q), d.output.x, { abs: 1.5e-3 });
  check('… the response falls along it', q.points.every((pt, i) => i === 0 || pt.fit < q.points[i - 1].fit));
  // Box & Wilson's step: the factor with the largest effect moves one coded unit a step
  const bw = steepestPath(s, fit, { steps: 4 });
  check('default steps: x1 (the largest effect) moves 1 coded unit a step', bw.points.length === 5 && bw.points.every((pt, i) => Math.abs(pt.coded.x1 - i) < 1e-12));
  check('… the others in proportion to their effects', Math.abs(bw.points[1].coded.x2 / bw.points[1].coded.x1 - fit.coef[fit.columns.indexOf('x2')] / fit.coef[fit.columns.indexOf('x1')]) < 1e-12);
  check('points beyond the experiment\'s range are marked', !bw.points[1].outside && bw.points[2].outside);
}

section('the direction\'s confidence region (Box & Draper)');
{
  const c = byName('first order ascent'), s = studyOf(c.input.rows), fit = fitModel(s, 'y ~ main');
  const r = directionRegion(s, fit), o = c.output.region;
  near('half-angle of the cone and the fraction of directions in it', [r.angle, r.fraction, r.F], [o.angle, o.fraction, o.F], { rel: 1e-9 });
  check(`a strong first-order fit: the direction is well determined (${(100 * r.fraction).toPrecision(2)} % of directions)`, r.determined && r.fraction < 0.05);
  const w = byName('first order weak'), sw = studyOf(w.input.rows), fw = fitModel(sw, 'y ~ main'), rw = directionRegion(sw, fw);
  check('a weak fit: every direction is possible', rw.fraction === w.output.region.fraction && rw.angle === 180 && !rw.determined);
}

section('second order: ridge analysis (rsm::steepest) and the canonical path (rsm::canonical.path)');
{
  const c = byName('second order ridge'), s = studyOf(c.input.rows), fit = fitModel(s, 'y ~ quadratic');
  const p = steepestPath(s, fit, { distances: c.input.dist });
  check('ridge analysis for a model with curvature', p.method === 'ridge');
  near('the ridge path (solved to 1e-14 in R)', xs(p), c.output.exact, { abs: 1e-9 });
  near('… as rsm::steepest prints it', xs(p), c.output.x, { abs: 1.5e-3 });
  near('… the fitted response at rsm\'s points', atRounded(fit, c.output.x), c.output.yhat, { abs: 5.0001e-4 });
  check('each point is at its radius', p.points.every(pt => Math.abs(Math.hypot(pt.coded.x1, pt.coded.x2, pt.coded.x3) - pt.distance) < 1e-9));
  const d = byName('second order ridge descent'), q = steepestPath(s, fit, { distances: d.input.dist, descent: true });
  near('ridge descent', xs(q), d.output.exact, { abs: 1e-9 });
  near('… as rsm', xs(q), d.output.x, { abs: 1.5e-3 });
  const cp = byName('canonical path'), cc = canonicalPath(s, fit, { distances: cp.input.dist });
  near('stationary point', cc.stationary, cp.output.stationary, { rel: 1e-8 });
  // the eigenvector's sign is arbitrary: compare the path or its reverse
  const got = xs(cc), want = cp.output.x, rev = got.slice().reverse();
  const close = (a) => a.every((x, i) => x.every((v, j) => Math.abs(v - want[i][j]) < 5.0001e-4));
  check('the canonical path (up to the axis\'s sign)', close(got) || close(rev));
  near('… the fitted response at rsm\'s points', atRounded(fit, want), cp.output.yhat, { abs: 5.0001e-4 });
  throws('no confidence region for a second-order fit', () => directionRegion(s, fit));
}

section('natural units, categorical factors, limits and constraints');
{
  // a temperature and a time, with a catalyst; yield rises with both, catalyst B better
  const fs = [{ id: 'T', name: 'Temperature', units: '°C', low: 150, high: 170, limits: { upper: 190 } }, { id: 't', name: 'Time', units: 'min', low: 20, high: 40 }, { id: 'cat', type: 'categorical', levels: ['A', 'B'] }];
  const rows = [];
  for (const T of [150, 170]) for (const t of [20, 40]) for (const cat of ['A', 'B']) rows.push({ T, t, cat, y: 50 + 0.4 * (T - 160) + 0.1 * (t - 30) + (cat === 'B' ? 1.5 : 0) + (rows.length % 3) * 0.05 });
  for (let i = 0; i < 3; i++) rows.push({ T: 160, t: 30, cat: i % 2 ? 'B' : 'A', y: 50 + (i % 2 ? 1.5 : 0) + 0.03 * i });
  const s = studyOf(rows, fs), fit = fitModel(s, 'y ~ main');
  const p = steepestPath(s, fit, { steps: 6 });
  check('categorical factor held at its best level (B)', p.held.cat === 'B' && p.points.every(pt => pt.settings.cat === 'B'));
  check('natural units: T 10 °C a step (its largest coded effect), t in proportion', Math.abs(p.points[1].settings.T - 170) < 1e-9 && Math.abs(p.increments.T - 10) < 1e-9 && p.increments.t > 0);
  check('T stops at its operating limit (190 °C) and the path goes on in t', p.points.at(-1).settings.T === 190 && p.points.at(-1).limited.includes('T') && p.points.at(-1).settings.t > p.points[3].settings.t, JSON.stringify(p.points.map(q => q.settings)));
  const step = steepestPath(s, fit, { steps: 3, stepFactor: 't', stepNatural: 5 });
  check('a step set in natural units of one factor: t 5 min a step', step.points.every((pt, i) => Math.abs(pt.settings.t - (30 + 5 * i)) < 1e-9));
  const cons = createStudy({ ...s, constraints: ['T + t <= 215'] });
  const pc = steepestPath(cons, fitModel(cons, 'y ~ main'), { steps: 6 });
  check('a constraint ends the path', /constraint/.test(pc.stopped) && pc.points.every(pt => pt.settings.T + pt.settings.t <= 215 + 1e-9));
  check('limits must contain the range', /must contain/.test(validateStudy({ aikidoe: 1, name: 'x', factors: [{ id: 'A', low: 0, high: 10, limits: { upper: 5 } }], responses: [{ id: 'y' }] }).errors.join()));
  throws('a categorical factor interacting with a continuous one', () => surfaceCoefficients(s, fitModel(s, 'y ~ T * cat + t')));
  const min = steepestPath(createStudy({ ...s, responses: [{ id: 'y', goal: 'minimize' }] }), fit, { steps: 2 });
  check('a response to minimise: descent', min.goal === 'descent' && min.points[1].settings.T < 160 && min.held.cat === 'A');
}

section('running the path: a stage, its results, and the next study (phase 2)');
{
  const rd = (f) => parseStudy(readFileSync(new URL(`../examples/${f}.aikidoe.json`, import.meta.url), 'utf8'));
  const s = rd('reaction-ascent'), fit = fitModel(s, 'yield ~ main');
  const st = appendStage(s, pathStage(s, fit, { steps: 8 }));
  const path = st.design.runs.filter(r => r.kind === 'path');
  check('8 path runs in a new block, in step order', path.length === 8 && new Set(path.map(r => r.block)).size === 1 && path.every((r, i) => i === 0 || r.order === path[i - 1].order + 1));
  check('… temperature at its limit from step 7', path[6].settings.temp === 190 && path[7].settings.temp === 190 && path[7].settings.time > path[6].settings.time);
  check('the path runs are not fitted with the first experiment', fitModel(st, 'yield ~ main').n === 9);
  check('no results yet: nothing best', pathResults(st).best === null && pathResults(st).done === 0);
  const r = pathResults(rd('reaction-path'));
  check('with results: best at step 5, stopped improving after two worse steps', r.best.step === 5 && r.best.observed === 70.5 && r.stoppedImproving && r.after === 7, JSON.stringify(r.best));
  check('… the predictions kept with the stage, and the centre of the first experiment as the base', Math.abs(r.points[0].predicted - 61.607) < 1e-3 && Math.abs(r.base - 55.1) < 1e-9);
  const n = nextStudy(rd('reaction-path'), r.best.settings);
  const T = n.factors.find(f => f.id === 'temp'), tm = n.factors.find(f => f.id === 'time');
  check('the next study: centred at step 5, the same widths, a factorial with 4 centre points', T.low === 175 && T.high === 185 && Math.abs(tm.low + tm.high - 2 * r.best.settings.time) < 1e-4 && n.design.runs.length === 8 && n.observations.length === 0);
  const nearLimit = nextStudy(rd('reaction-path'), { time: 50, temp: 188 });
  check('… shifted to stay within the operating limits (temp at most 190)', nearLimit.factors.find(f => f.id === 'temp').high === 190 && nearLimit.factors.find(f => f.id === 'temp').low === 180);
  check('… or a central composite design', nextStudy(rd('reaction-path'), r.best.settings, { design: 'ccd' }).design.runs.length === 4 + 4 + 4);
}

done();
