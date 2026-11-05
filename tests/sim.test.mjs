// Computer experiments (issue #20): Latin hypercubes, tolerance distributions, Sobol indices,
// Monte Carlo yield with a trust check, surrogates with cross-validated error, simulator adapters.
// References are analytic: the Ishigami function's Sobol indices (Ishigami & Homma 1990; formulas
// in Saltelli et al., Global Sensitivity Analysis: The Primer, 2008), normal / uniform yields.
import { section, check, near, throws, done } from './lib/check.mjs';
import { createStudy } from '../js/study.js';
import { toStudyDesign } from '../js/design/factorial.js';
import { normal } from '../js/dist.js';
import { rng } from '../js/design/rng.js';
import { maximinLHS, deviationSampler, toleranceSd } from '../js/sim/sample.js';
import { sobolIndices } from '../js/sim/sensitivity.js';
import { monteCarloYield, wilson } from '../js/sim/yield.js';
import { compileExpression } from '../js/sim/expression.js';
import { functionAdapter, runOnSimulator } from '../js/sim/adapter.js';
import { studyAdapter } from '../js/sim/adapters.js';
import { compiledPredictor, lhsDesign, fitSurrogates, surrogateYield, surrogateSensitivity, directYieldCheck } from '../js/sim/surrogate.js';
import { propagationOfError } from '../js/model/robust.js';
import { fitModel, predict as olsPredict } from '../js/model/ols.js';

section('maximin Latin hypercube');
{
  const n = 20, k = 4, { X, minDist } = maximinLHS(n, k, { seed: 3 });
  const strata = (j) => X.map(r => Math.floor((r[j] + 1) / 2 * n)).sort((a, b) => a - b);
  check('every column has one point in each of the n strata', [...Array(k).keys()].every(j => strata(j).every((s, i) => s === i)));
  check('points at stratum centres in [−1, 1]', X.every(r => r.every(v => Math.abs(((v + 1) / 2 * n) % 1 - 0.5) < 1e-12)));
  // against random Latin hypercubes with the same seed stream: the search should beat their median
  const g = rng(9), rand = [];
  for (let t = 0; t < 50; t++) {
    const P = Array.from({ length: k }, () => g.shuffle([...Array(n).keys()]));
    const Y = Array.from({ length: n }, (_, i) => P.map(p => -1 + 2 * (p[i] + 0.5) / n));
    let m = Infinity; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) m = Math.min(m, Math.hypot(...Y[i].map((v, c) => v - Y[j][c])));
    rand.push(m);
  }
  check(`smallest distance ${minDist.toFixed(3)} beats every one of 50 random LHSs (best ${Math.max(...rand).toFixed(3)})`, minDist > Math.max(...rand));
  check('same seed, same design', JSON.stringify(maximinLHS(n, k, { seed: 3 }).X) === JSON.stringify(X));
  throws('n < 2 refused', () => maximinLHS(1, 2), /n ≥ 2/);
}

section('tolerance distributions');
{
  const g = rng(1), u = () => g.random() * (1 - 2 ** -52) + 2 ** -53;
  const moments = (s, N = 200000) => { let m = 0, v = 0, lo = Infinity, hi = -Infinity; const xs = []; for (let i = 0; i < N; i++) { const x = s(u); xs.push(x); m += x; lo = Math.min(lo, x); hi = Math.max(hi, x); } m /= N; for (const x of xs) v += (x - m) ** 2; return { m, sd: Math.sqrt(v / (N - 1)), lo, hi }; };
  const a = moments(deviationSampler(0.5));
  near('normal: mean 0, sd 0.5', [a.m, a.sd], [0, 0.5], { abs: 0.005 });
  const b = moments(deviationSampler({ sd: 0.5, dist: 'uniform' }));
  near('uniform: sd 0.5, bounded at ±√3·0.5', [b.sd, b.hi, -b.lo], [0.5, 0.5 * Math.sqrt(3), 0.5 * Math.sqrt(3)], { abs: 0.005 });
  const c = moments(deviationSampler({ sd: 0.5, dist: 'truncated', at: 1.5 }));
  near('truncated at ±1.5 sd: actual sd = toleranceSd, bounded', [c.sd, c.hi], [toleranceSd({ sd: 0.5, dist: 'truncated', at: 1.5 }), 0.75], { abs: 0.005 });
  // truncated N(0,1) at ±a: variance 1 − 2aφ(a)/(2Φ(a) − 1)
  near('toleranceSd(truncated, a = 2) = √(1 − 2·2φ(2)/(2Φ(2)−1))', toleranceSd({ sd: 1, dist: 'truncated' }), Math.sqrt(1 - 4 * normal.pdf(2) / (2 * normal.cdf(2) - 1)), { rel: 1e-12 });
  throws('unknown distribution', () => deviationSampler({ sd: 1, dist: 'cauchy' }), /unknown tolerance distribution/);
}

section('Sobol indices: Ishigami function (done-when: within 1 % of analytic)');
{
  const a = 7, b = 0.1, pi4 = Math.PI ** 4, pi8 = Math.PI ** 8;
  const f = ([x1, x2, x3]) => Math.sin(x1) + a * Math.sin(x2) ** 2 + b * x3 ** 4 * Math.sin(x1);
  const V1 = 0.5 * (1 + b * pi4 / 5) ** 2, V2 = a * a / 8, V13 = b * b * pi8 * (1 / 18 - 1 / 50), V = V1 + V2 + V13;
  const S = [V1 / V, V2 / V, 0], ST = [(V1 + V13) / V, V2 / V, V13 / V];
  near('analytic S = 0.3139, 0.4424, 0; ST = 0.5576, 0.4424, 0.2437', [...S, ...ST], [0.3139, 0.4424, 0, 0.5576, 0.4424, 0.2437], { abs: 5e-5 });
  const U = (u) => -Math.PI + 2 * Math.PI * u();
  const r = sobolIndices(f, [U, U, U], { N: 1 << 16, seed: 1 });
  near('first-order within 0.01', r.first.map(x => x.S), S, { abs: 0.01 });
  near('total within 0.01', r.total.map(x => x.S), ST, { abs: 0.01 });
  near('variance V = a²/8 + bπ⁴/5 + b²π⁸/18 + ½', r.V, V, { rel: 0.01 });
  // interval coverage, over 20 independent seeds: nominal 95 %, so each index covered ≥ 16 times
  const cover = Array(6).fill(0);
  for (let sd = 1; sd <= 20; sd++) {
    const q = sobolIndices(f, [U, U, U], { N: 1 << 14, seed: 100 + sd });
    [...q.first, ...q.total].forEach((x, i) => { if (x.lower <= [...S, ...ST][i] && [...S, ...ST][i] <= x.upper) cover[i]++; });
  }
  check(`95% intervals cover the analytic values (of 20 seeds: ${cover.join(', ')})`, cover.every(c => c >= 16));
  check('(k + 2)·N evaluations', r.evaluations === 5 * (1 << 16));
  const mc = sobolIndices(f, [U, U, U], { N: 1 << 16, seed: 1, qmc: false });
  check('plain Monte Carlo (qmc: false) has wider intervals than quasi-random', mc.first[0].upper - mc.first[0].lower > 2 * (r.first[0].upper - r.first[0].lower));
}

section('Sobol indices: additive linear function');
{
  const c = [1, 2, 3], sd = [1, 0.5, 2];
  const samplers = sd.map(s => deviationSampler(s));
  const r = sobolIndices((x) => x.reduce((a, v, i) => a + c[i] * v, 0), samplers, { N: 1 << 14 });
  const w = c.map((ci, i) => (ci * sd[i]) ** 2), tot = w.reduce((a, v) => a + v, 0);
  near('S_i = ST_i = c_i²σ_i² / Σ', [...r.first.map(x => x.S), ...r.total.map(x => x.S)], [...w, ...w].map(v => v / tot), { abs: 0.005 });
}

section('Monte Carlo yield (done-when: analytic yield inside the interval)');
{
  // y = a + b, a, b ~ N(0, σ²) about nominal 0: y ~ N(0, 2σ²); pass when |y| ≤ L
  const sigma = 0.3, L = 0.5, exact = 2 * normal.cdf(L / (sigma * Math.SQRT2)) - 1;
  const y = monteCarloYield((s) => ({ y: s.a + s.b }), { a: 0, b: 0 }, { a: sigma, b: sigma }, [{ id: 'y', lower: -L, upper: L }], { N: 40000, seed: 2 });
  check(`normal: exact ${exact.toFixed(4)} in [${y.lower.toFixed(4)}, ${y.upper.toFixed(4)}]`, y.lower <= exact && exact <= y.upper);
  near('below and above split evenly', y.perResponse[0].below, y.perResponse[0].above, { abs: 0.01 });
  // uniform with sd s: a ∈ ±√3 s; P(a ≤ L) = (L + √3 s) / (2√3 s), one-sided limit
  const s = 1, Lu = 0.8, ex2 = (Lu + Math.sqrt(3) * s) / (2 * Math.sqrt(3) * s);
  const y2 = monteCarloYield((t) => ({ y: t.a }), { a: 0 }, { a: { sd: s, dist: 'uniform' } }, [{ id: 'y', upper: Lu }], { N: 40000, seed: 3 });
  check(`uniform, one-sided: exact ${ex2.toFixed(4)} in [${y2.lower.toFixed(4)}, ${y2.upper.toFixed(4)}]`, y2.lower <= ex2 && ex2 <= y2.upper);
  // Wilson interval: 0 of 100 → [0, 0.037]
  near('Wilson interval for 0/100 (upper z²/(n + z²))', wilson(0, 100).upper, 1.959963984540054 ** 2 / (100 + 1.959963984540054 ** 2), { rel: 1e-9 });
  // a surrogate error comparable to the margin makes the result untrustworthy
  const t1 = monteCarloYield((t) => ({ y: t.a }), { a: 0 }, { a: 0.3 }, [{ id: 'y', lower: -0.5, upper: 0.5, cvError: 0.001 }], { N: 20000 });
  const t2 = monteCarloYield((t) => ({ y: t.a }), { a: 0 }, { a: 0.3 }, [{ id: 'y', lower: -0.5, upper: 0.5, cvError: 0.1 }], { N: 20000 });
  check('small CV error: trust good', t1.trust === 'good' && t1.bounds.loose - t1.bounds.strict < 0.01);
  check('CV error ⅕ of the margin: poor, flagged, with bounds', t2.trust === 'poor' && !t2.trustworthy && t2.bounds.strict < t2.yield && t2.yield < t2.bounds.loose);
  const t3 = monteCarloYield((t) => ({ y: t.a }), { a: 0 }, { a: 0.3 }, [{ id: 'y', lower: -0.5, upper: 0.5, cvError: 0.02 }], { N: 20000 });
  check(`CV error 1/25 of the margin: fair (bounds ${t3.bounds.strict.toFixed(3)} … ${t3.bounds.loose.toFixed(3)})`, t3.trust === 'fair' && t3.trustworthy);
  throws('no spec limits', () => monteCarloYield(() => ({}), {}, {}, []), /no response has specification limits/);
}

section('expression evaluator');
{
  const f = compileExpression('sin(a) + 7*sin(b)^2 + 0.1*c^4*sin(a)', ['a', 'b', 'c']);
  near('Ishigami at (1, 2, 3)', f({ a: 1, b: 2, c: 3 }), Math.sin(1) + 7 * Math.sin(2) ** 2 + 8.1 * Math.sin(1), { rel: 1e-15 });
  near('precedence: −2^2, 2^3^2, 1 − 2 − 3, 8/2/2, max, pi', [compileExpression('-2^2')({}), compileExpression('2^3^2')({}), compileExpression('1-2-3')({}), compileExpression('8/2/2')({}), compileExpression('max(1, 4, 2)')({}), compileExpression('pi')({})], [-4, 512, -4, 2, 4, Math.PI]);
  throws('unknown name', () => compileExpression('a + q', ['a']), /unknown name q/);
  throws('unknown function', () => compileExpression('foo(1)'), /unknown function foo/);
  throws('trailing garbage', () => compileExpression('1 2'), /unexpected "2"/);
}

section('study format: tolerances, spec limits, simulator');
{
  const st = createStudy({ name: 's', seed: 1, factors: [{ id: 'a', low: 0, high: 1, tolerance: { sd: 0.1, dist: 'uniform' } }, { id: 'b', low: 0, high: 1, tolerance: 0.05 }],
    responses: [{ id: 'y', spec: { upper: 3 } }], simulator: { adapter: 'expression', responses: { y: 'a + 2*b' } } });
  check('tolerance object, spec and simulator kept', st.factors[0].tolerance.dist === 'uniform' && st.responses[0].spec.upper === 3 && st.simulator.responses.y === 'a + 2*b');
  throws('bad tolerance', () => createStudy({ name: 's', factors: [{ id: 'a', low: 0, high: 1, tolerance: { sd: 1, dist: 'x' } }] }), /tolerance: must be/);
  throws('empty spec', () => createStudy({ name: 's', factors: [{ id: 'a', low: 0, high: 1 }], responses: [{ id: 'y', spec: {} }] }), /spec: must be/);
  throws('reversed spec', () => createStudy({ name: 's', factors: [{ id: 'a', low: 0, high: 1 }], responses: [{ id: 'y', spec: { lower: 2, upper: 1 } }] }), /upper must be greater/);
  throws('simulator without adapter', () => createStudy({ name: 's', factors: [{ id: 'a', low: 0, high: 1 }], simulator: {} }), /simulator: must be/);
  // POE uses the actual sd of a tolerance distribution
  const p = propagationOfError(st, (s) => s.a + 2 * s.b, { a: 0.5, b: 0.5 });
  near('propagation of error with a uniform tolerance: Var = 0.1² + (2·0.05)²', p.var, 0.01 + 0.01, { rel: 1e-6 });
}

section('surrogate yield on an analytic simulator (done-when: matches direct MC within its CI)');
{
  let st = createStudy({ name: 'q', seed: 4, factors: [{ id: 'a', low: -2, high: 2, tolerance: 0.4 }, { id: 'b', low: -2, high: 2, tolerance: { sd: 0.3, dist: 'uniform' } }, { id: 'c', low: -1, high: 1, tolerance: { sd: 0.5, dist: 'truncated' } }],
    responses: [{ id: 'y', spec: { lower: 9, upper: 11.5 } }, { id: 'z', spec: { upper: 3.6 } }],
    simulator: { adapter: 'expression', responses: { y: '10 + 2*a - 1.5*b + 0.8*a*b + 0.6*a^2 + 0.3*c', z: '3 + b^2 - c' } } });
  const d = lhsDesign(st);
  check('LHS default size max(10k, p + 5) = 30 runs, coded, space-filling', d.X.length === 30 && d.runKind.every(k => k === 'space-filling'));
  st = createStudy({ ...st, design: toStudyDesign(st, d, { seed: 4 }) });
  const ad = await studyAdapter(st);
  let progress = 0;
  st = await runOnSimulator(st, ad, { batch: 7, onProgress: (n) => { progress = n; } });
  check('runOnSimulator fills every run in batches', st.observations.length === 60 && progress === 30);
  const { models } = fitSurrogates(st);
  check('quadratic surrogates (default for an LHS), exact here: RMSE_cv ≈ 0', models.length === 2 && models.every(m => m.formula.endsWith('~ quadratic') && m.cvRmse < 1e-9));
  const y = surrogateYield(st, models, { N: 40000, seed: 5 });
  const dir = await directYieldCheck(st, models, ad, { M: 40000, seed: 6 });
  check(`surrogate yield ${y.yield.toFixed(4)} [${y.lower.toFixed(4)}, ${y.upper.toFixed(4)}] overlaps direct ${dir.yield.toFixed(4)} [${dir.lower.toFixed(4)}, ${dir.upper.toFixed(4)}]`, y.lower <= dir.upper && dir.lower <= y.upper);
  check('surrogate and simulator agree point by point', dir.agree === 1 && dir.rmse.y < 1e-9, JSON.stringify(dir.rmse));
  check('trustworthy (no surrogate error)', y.trustworthy);
  const sens = surrogateSensitivity(st, models, { over: 'tolerance', N: 1 << 14 });
  // z = 3 + b² − c: b uniform sd 0.3 about 0 gives Var(b²) = 0.0324·4/5 = 0.02592·... ; c truncated
  const vb2 = (0.3 * Math.sqrt(3)) ** 4 * (1 / 5 - 1 / 9), vc = toleranceSd({ sd: 0.5, dist: 'truncated' }) ** 2;
  near('z: S_b = Var(b²)/(Var(b²) + Var(c)), S_c the rest, a none', sens[1].first.map(x => x.S), [0, vb2 / (vb2 + vc), vc / (vb2 + vc)], { abs: 0.005 });
}

section('compiled surrogate predictor = model-matrix prediction');
{
  let st = createStudy({ name: 'c', seed: 8, factors: [{ id: 'a', low: 1, high: 10, transform: 'log' }, { id: 'b', low: -2, high: 3 }, { id: 'c', low: 0, high: 1 }], responses: [{ id: 'y' }],
    simulator: { adapter: 'expression', responses: { y: 'log(a)*b + c^3 + exp(b/3)' } } });
  st = createStudy({ ...st, design: toStudyDesign(st, lhsDesign(st, { runs: 40 }), { seed: 8 }) });
  st = await runOnSimulator(st, await studyAdapter(st));
  const g = rng(3), pts = Array.from({ length: 50 }, () => ({ a: 1 + 9 * g.random(), b: -2 + 5 * g.random(), c: g.random() }));
  for (const formula of ['y ~ quadratic', 'y ~ a + b + c + a:b:c + I(c^3) + I(a^2*b)']) {
    const fit = fitModel(st, formula), fast = compiledPredictor(fit);
    near(`${formula}: same predictions (log factor, I() terms)`, pts.map(fast), olsPredict(fit, pts).map(p => p.fit), { rel: 1e-10, abs: 1e-10 });
  }
  const cat = createStudy({ name: 'k', factors: [{ id: 'a', low: 0, high: 1 }, { id: 'g', levels: ['x', 'y'] }], responses: [{ id: 'y' }],
    design: { kind: 'custom', runs: [0, 1, 2, 3].map(i => ({ run: i + 1, settings: { a: i / 3, g: i % 2 ? 'y' : 'x' } })) }, observations: [1, 2, 4, 3].map((v, i) => ({ run: i + 1, response: 'y', value: v })) });
  check('categorical factor: no compiled predictor (falls back)', compiledPredictor(fitModel(cat, 'y ~ a + g')) === null);
}

section('trust warning: a poor surrogate');
{
  let st = createStudy({ name: 'w', seed: 2, factors: [{ id: 'a', low: -3, high: 3, tolerance: 0.2 }, { id: 'b', low: -3, high: 3, tolerance: 0.2 }], responses: [{ id: 'y', spec: { lower: -0.5, upper: 1.5 } }],
    simulator: { adapter: 'expression', responses: { y: 'sin(2*a) + cos(3*b)' } } });
  st = createStudy({ ...st, design: toStudyDesign(st, lhsDesign(st, { runs: 25 }), { seed: 2 }) });
  st = await runOnSimulator(st, await studyAdapter(st));
  const { models } = fitSurrogates(st);
  const y = surrogateYield(st, models, { settings: { a: 0.3, b: 0.2 } });
  check(`quadratic misses an oscillating response (RMSE_cv ${models[0].cvRmse.toFixed(2)}): yield flagged`, !y.trustworthy && y.bounds.loose - y.bounds.strict > 0.2);
}

section('adapters');
{
  const st = createStudy({ name: 'a', factors: [{ id: 'a', low: 0, high: 1 }], responses: [{ id: 'y' }] });
  await studyAdapter(st).then(() => check('no simulator refused', false), (e) => check('no simulator refused', /no simulator/.test(e.message)));
  await studyAdapter({ ...st, simulator: { adapter: 'nope' } }).then(() => check('unknown adapter refused', false), (e) => check('unknown adapter refused', /unknown simulator adapter "nope"/.test(e.message)));
  const fa = functionAdapter('f', (s) => ({ y: s.a > 0.5 ? NaN : s.a }), st.factors, st.responses);
  const st2 = createStudy({ ...st, design: { kind: 'custom', runs: [{ run: 1, settings: { a: 0.2 } }, { run: 2, settings: { a: 0.9 } }] } });
  const done2 = await runOnSimulator(st2, fa);
  check('non-finite simulator results are stored empty', done2.observations.find(o => o.run === 2).value === null && done2.observations.find(o => o.run === 1).value === 0.2);
}

done();
