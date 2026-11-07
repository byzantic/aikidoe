// Mixtures (issue #62): the study's mixture block, pseudo-components and Scheffé models, designs
// against R's mixexp (simplex lattice, simplex centroid, extreme vertices), fits against lm on
// pseudo-components (R² about the mean, the grouped ANOVA), D-optimal designs against AlgDesign,
// Cox traces, ternary grids, optimisation over the constrained region, and the command line.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { section, check, near, done } from './lib/check.mjs';
import { createStudy, validateStudy } from '../js/study.js';
import { parseFormula } from '../js/model/formula.js';
import { fitModel, predict } from '../js/model/ols.js';
import { defaultFormula } from '../js/model/defaults.js';
import { fittedModels, optimiseDesirability, profile } from '../js/model/desirability.js';
import { simplexLattice, simplexCentroid, extremeVertices, mixtureCandidates, isSimplexRegion, optimalMixture, mixtureDesign, mixtureAnova,
  coxTrace, ternaryGrid, optimiseMixture, mixtureOf } from '../js/design/mixture.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/mixture-r.json', import.meta.url), 'utf8'));
const ids = (q) => Array.from({ length: q }, (_, i) => `x${i + 1}`);
const mixStudy = (lower, upper, extra = {}) => createStudy({ name: 'm', seed: 3, factors: lower.map((l, i) => ({ id: `x${i + 1}`, low: l, high: upper[i] })),
  mixture: { components: ids(lower.length) }, responses: [{ id: 'y' }], ...extra });
const sameSet = (a, b, tol = 1e-6) => a.length === b.length && a.every(p => b.some(q => p.every((v, i) => Math.abs(v - q[i]) <= tol))) && b.every(p => a.some(q => p.every((v, i) => Math.abs(v - q[i]) <= tol)));

section('the mixture block');
{
  const s = mixStudy([0.1, 0.1, 0.2], [0.7, 0.6, 0.5]);
  check('components get their pseudo-component scale (total − Σ lows), not written to the file', s.factors[0].mix.scale === 0.6 && !JSON.stringify(s).includes('"mix"'));
  const err = (doc, re) => validateStudy(doc).errors.some(e => re.test(e));
  const base = { aikidoe: 1, name: 'm', seed: 1, factors: [{ id: 'a', low: 0, high: 1 }, { id: 'b', low: 0, high: 1 }, { id: 'g', levels: ['u', 'v'] }], responses: [{ id: 'y' }] };
  check('a categorical component is refused', err({ ...base, mixture: { components: ['a', 'g'] } }, /must be continuous/));
  check('lower bounds adding up to more than the total are refused', err({ ...base, factors: [{ id: 'a', low: 0.6, high: 1 }, { id: 'b', low: 0.5, high: 1 }], mixture: { components: ['a', 'b'] } }, /lower bounds add up/));
  check('upper bounds adding up to less than the total are refused', err({ ...base, factors: [{ id: 'a', low: 0, high: 0.3 }, { id: 'b', low: 0, high: 0.4 }], mixture: { components: ['a', 'b'] } }, /upper bounds add up/));
  check('runs whose components do not add up to the total are refused', err({ ...base, mixture: { components: ['a', 'b'] }, design: { runs: [{ run: 1, settings: { a: 0.5, b: 0.6, g: 'u' } }] } }, /add up to 1\.1, not 1/));
  check('a total of 100 (per cent)', !validateStudy({ ...base, factors: [{ id: 'a', low: 0, high: 100 }, { id: 'b', low: 0, high: 100 }], mixture: { components: ['a', 'b'], total: 100 } }).errors.length);
}

section('formulas');
{
  const s = mixStudy([0, 0, 0, 0], [1, 1, 1, 1]);
  const lab = (f) => parseFormula(f, s.factors).terms.map(t => t.label).join(' ');
  check('mixlinear: the components, no intercept, implied', lab('y ~ mixlinear') === 'x1 x2 x3 x4' && parseFormula('y ~ mixlinear', s.factors).implied && !parseFormula('y ~ mixlinear', s.factors).intercept);
  check('mixquadratic: + every pair', lab('y ~ mixquadratic').split(' ').length === 4 + 6);
  check('mixspecial: + every triple', lab('y ~ mixspecial').split(' ').length === 4 + 6 + 4);
  check('mixcubic: + delta(A,B) for every pair', lab('y ~ mixcubic').split(' ').length === 4 + 6 + 6 + 4 && lab('y ~ mixcubic').includes('delta(x1,x2)'));
  check('all components written out also drop the intercept', !parseFormula('y ~ x1 + x2 + x3 + x4 + x1:x2', s.factors).intercept);
  let threw = false; try { parseFormula('y ~ mixquadratic', createStudy({ name: 'n', seed: 1, factors: [{ id: 'a', low: 0, high: 1 }], responses: [{ id: 'y' }] }).factors); } catch (e) { threw = /needs a mixture/.test(e.message); }
  check('mixture macros need a mixture', threw);
}

section('designs against mixexp');
for (const c of fx.cases.filter(x => ['lattice', 'centroid'].includes(x.input.kind))) {
  const got = c.input.kind === 'lattice' ? simplexLattice(c.input.q, c.input.m) : simplexCentroid(c.input.q);
  check(`${c.name}: the same ${c.output.points.length} points`, sameSet(got, c.output.points));
}
for (const c of fx.cases.filter(x => x.input.kind === 'vertices')) {
  const s = mixStudy(c.input.lower, c.input.upper);
  const ev = extremeVertices(s, { faces: c.input.ndm });
  const want = c.output.points.map((p, i) => ({ p, d: c.output.dim[i] }));
  check(`${c.name}: vertices`, sameSet(ev.vertices.map(v => v.x), want.filter(w => w.d === 0).map(w => w.p)));
  for (let d = 1; d <= c.input.ndm; d++) check(`${c.name}: centroids of the ${d}-dimensional faces`, sameSet(ev.centroids.filter(x => x.dim === d).map(x => x.x), want.filter(w => w.d === d).map(w => w.p)));
  check(`${c.name}: the overall centroid`, sameSet([ev.overall], want.filter(w => w.d === c.input.lower.length - 1).map(w => w.p)));
}

section('Scheffé fits against lm on pseudo-components');
for (const c of fx.cases.filter(x => x.input.x)) {
  const q = c.input.lower.length;
  const runs = c.input.x.map((x, i) => ({ run: i + 1, settings: Object.fromEntries(x.map((v, j) => [`x${j + 1}`, v])) }));
  const s = mixStudy(c.input.lower, Array(q).fill(1), { design: { kind: 'custom', runs }, observations: c.input.y.map((v, i) => ({ run: i + 1, response: 'y', value: v })) });
  const f = fitModel(s, `y ~ ${c.input.model}`);
  near(`${c.name}: coefficients and standard errors`, [...c.output.names.map(n => f.coef[f.columns.indexOf(n)]), ...c.output.names.map(n => f.se[f.columns.indexOf(n)])], [...c.output.estimate, ...c.output.se], { rel: 1e-9, abs: 1e-9 });
  near(`${c.name}: R² and F about the mean (implied intercept)`, [f.r2, f.fStat, f.dfModel, f.dfRes], [c.output.r2, c.output.F, c.output.dfModel, c.output.dfRes], { rel: 1e-9 });
  const A = mixtureAnova(f);
  near(`${c.name}: ANOVA — linear blending (q − 1 df), then each term`, [A[0].ss, A[0].df, ...c.output.anova.terms.map(t => A.find(r => r.term === t).ss)], [c.output.anova.linearSS, c.output.anova.linearDf, ...c.output.anova.ss], { rel: 1e-7, abs: 1e-9 });
}
{
  const c = fx.cases.find(x => /^D-optimal/.test(x.name)), s = mixStudy(c.input.lower, c.input.upper);
  const ev = extremeVertices(s, { faces: 1 });
  const o = optimalMixture(s, { runs: c.input.runs, model: c.input.model, candidates: [...ev.vertices.map(v => v.x), ...ev.centroids.map(x => x.x), ev.overall] });
  check(`D-optimal from the same candidates: log det ${o.logdet.toFixed(4)} ≥ AlgDesign's ${c.output.logdet.toFixed(4)}`, o.logdet >= c.output.logdet - 1e-6);
}

section('regions, designs in a study, process factors');
{
  const free = mixStudy([0, 0, 0], [1, 1, 1]), cut = mixStudy([0.1, 0.1, 0.2], [0.7, 0.6, 0.5]);
  const lower = mixStudy([0.2, 0.1, 0], [1, 1, 1]);
  check('a simplex region: no bounds, or lower bounds only; cut by upper bounds: not', isSimplexRegion(free) && isSimplexRegion(lower) && !isSimplexRegion(cut));
  const lat = mixtureDesign(lower, { kind: 'lattice', degree: 2, centre: 2 });
  check('a lattice in pseudo-components on lower bounds: actual blends add up to 1, respect the bounds', lat.runs.length === 8 && lat.runs.every(r => Math.abs(r.settings.x1 + r.settings.x2 + r.settings.x3 - 1) < 1e-12 && r.settings.x1 >= 0.2 - 1e-12));
  let threw = false; try { mixtureDesign(cut, { kind: 'lattice' }); } catch (e) { threw = /not a simplex/.test(e.message); }
  check('a lattice on a cut region is refused, with the way out', threw);
  const constr = mixStudy([0, 0, 0], [1, 1, 1], { constraints: ['x1 + x2 <= 0.8'] });
  const ev = extremeVertices(constr);
  check('a linear constraint between components: its vertices satisfy it, and it is active at some', ev.vertices.every(v => v.x[0] + v.x[1] <= 0.8 + 1e-12) && ev.vertices.some(v => Math.abs(v.x[0] + v.x[1] - 0.8) < 1e-12) && ev.vertices.length === 3);
  const proc = createStudy({ name: 'p', seed: 4, factors: [...free.factors.map(f => ({ id: f.id, low: 0, high: 1 })), { id: 'T', low: 900, high: 1100, units: '°C' }], mixture: { components: ['x1', 'x2', 'x3'] }, responses: [{ id: 'y' }] });
  const pd = mixtureDesign(proc, { kind: 'centroid' });
  check('process factors crossed: 7 blends × 2 temperatures', pd.runs.length === 14 && new Set(pd.runs.map(r => r.settings.T)).size === 2);
  check('default model: Scheffé, crossed with the process factors', defaultFormula(createStudy({ ...proc, design: pd }), 'y') === 'y ~ mixspecial + mixlinear:(T)' || /mixlinear:\(T\)/.test(defaultFormula(createStudy({ ...proc, design: pd }), 'y')));
  const od = mixtureDesign(cut, { kind: 'optimal', runs: 9, model: 'mixquadratic', criterion: 'I' });
  check('an I-optimal design: runs add up and stay inside the region', od.runs.length === 9 && od.runs.every(r => r.settings.x1 >= 0.1 - 1e-12 && r.settings.x3 <= 0.5 + 1e-12 && Math.abs(r.settings.x1 + r.settings.x2 + r.settings.x3 - 1) < 1e-9));
  check('candidates: vertices, centroids, overall centroid, axial points', mixtureCandidates(cut).length === 5 + 5 + 1 + 5);
}

section('traces, ternary grids, optimisation');
{
  const cut = mixStudy([0.1, 0.1, 0.2], [0.7, 0.6, 0.5]);
  const f = (s) => 3 * s.x1 + 5 * s.x2 + 2 * s.x3 + 8 * s.x1 * s.x2;
  const tr = coxTrace(cut, f, { points: 11 });
  check('Cox traces: each component from its smallest to its largest feasible value, through the centroid', tr.length === 3 && tr.every(t => t.points[0].x < t.reference && t.points.at(-1).x > t.reference)
    && Math.abs(tr[0].points[0].x - 0.1) < 1e-6 && Math.abs(tr[2].points.at(-1).x - 0.5) < 1e-6);
  const tg = ternaryGrid(cut, f, { n: 10 });
  check('ternary grid: 66 points, the infeasible ones marked', tg.points.length === 66 && tg.points.some(p => !p.feasible) && tg.points.filter(p => p.feasible).every(p => Number.isFinite(p.y)));
  const best = optimiseMixture(cut, (s) => -((s.x1 - 0.3) ** 2 + (s.x2 - 0.45) ** 2));
  near('optimisation over the region: an interior optimum', [best.settings.x1, best.settings.x2, best.settings.x3], [0.3, 0.45, 0.25], { abs: 1e-5 });
  const edge = optimiseMixture(cut, (s) => s.x2 + 0.1 * s.x1);
  check('… and one on the boundary (x2 at its bound 0.6, x1 as large as the others allow)', Math.abs(edge.settings.x2 - 0.6) < 1e-5 && Math.abs(edge.settings.x3 - 0.2) < 1e-5);
  // desirability over a fitted model
  const d = mixtureDesign(cut, { kind: 'vertices', replicates: 2 });
  const st = createStudy({ ...cut, responses: [{ id: 'y', goal: 'maximize', lower: 0, upper: 10 }], design: d, observations: d.runs.map(r => ({ run: r.run, response: 'y', value: f(r.settings) + 0.01 * Math.sin(r.run) })) });
  const ms = fittedModels(st).models;
  const o = optimiseDesirability(st, ms, { seed: 1 });
  const truth = optimiseMixture(st, f);
  check(`desirability over the blends: the best blend of the fitted model (${o.settings.x1.toFixed(3)}, ${o.settings.x2.toFixed(3)}, ${o.settings.x3.toFixed(3)})`, Math.abs(f(o.settings) - truth.value) < 0.01 && Math.abs(o.settings.x1 + o.settings.x2 + o.settings.x3 - 1) < 1e-9);
  const pr = profile(st, ms, o.settings, { points: 9 });
  check('the profiler moves each component along its Cox direction', pr.every(p => p.cox && p.xs.length === 9));
}

section('command line');
{
  const dir = mkdtempSync(join(tmpdir(), 'aikidoe-mix-'));
  const doe = (...a) => { const r = spawnSync(process.execPath, [new URL('../tools/doe.mjs', import.meta.url).pathname, ...a], { cwd: dir, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
  try {
    let r = doe('init', 'g.aikidoe.json', '--factor', 'feldspar:20:50', '--factor', 'silica:20:45', '--factor', 'whiting:10:25', '--factor', 'kaolin:5:20', '--mixture', 'feldspar,silica,whiting,kaolin', '--total', '100', '--response', 'gloss', '--seed', '5');
    check('doe init --mixture --total 100', r.code === 0 && /4 factors/.test(r.out));
    r = doe('design', 'g.aikidoe.json', '--mixture', 'vertices');
    check('doe design --mixture vertices: vertices, centroids, notes the pseudo-components', r.code === 0 && /vertices and \d+ centroids/.test(r.out) && /L-pseudo-components/.test(r.out), r.out + r.err);
    r = doe('design', 'g.aikidoe.json', '--mixture', 'optimal', '--runs', '14', '--model', 'mixquadratic', '--force');
    check('doe design --mixture optimal', r.code === 0 && /D-optimal for mixquadratic/.test(r.out));
    r = doe('info', 'g.aikidoe.json');
    check('doe info shows the mixture', /mixture: feldspar \+ silica \+ whiting \+ kaolin = 100/.test(r.out));
    r = doe('design', 'g.aikidoe.json', '--mixture', 'lattice', '--force');
    check('a lattice on a cut region is refused', r.code === 1 && /not a simplex/.test(r.err));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

done();
