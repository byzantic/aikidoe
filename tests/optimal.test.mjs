// Definitive screening and optimal designs (issue #10). References: daewr::DefScreen (published
// DSDs), skpr::gen_design and AlgDesign::optFederov (fixture optimal-r), and known optima.
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import { conferenceMatrix, definitiveScreening, dsdOrder } from '../js/design/dsd.js';
import { optimalDesign, evaluateDesign, momentMatrix, compileModel } from '../js/design/optimal.js';
import { toStudyDesign } from '../js/design/factorial.js';
import { createStudy, feasible } from '../js/study.js';
import { parseFormula } from '../js/model/formula.js';

const fx = loadFixture('optimal-r').cases;
const study = (k, extra = {}) => createStudy({ aikidoe: 1, seed: 1, factors: [...Array(k).keys()].map(i => ({ id: `x${i + 1}`, low: -1, high: 1 })), ...extra });
const dot = (X, a, b) => X.reduce((s, r) => s + a(r) * b(r), 0);
// second-order columns (2fis and squares) of a three-level design, centred
const secondOrder = (X, k, cats = []) => {
  const fs = [];
  for (let i = 0; i < k; i++) { if (!cats.includes(i)) fs.push(r => r[i] * r[i]); for (let j = i + 1; j < k; j++) fs.push(r => r[i] * r[j]); }
  return fs;
};

section('conference matrices');
for (const m of [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 26, 28, 30, 32]) {
  const C = conferenceMatrix(m);
  let ok = C.length === m && C.every((r, i) => r[i] === 0 && r.every((v, j) => j === i || Math.abs(v) === 1));
  for (let i = 0; i < m && ok; i++) for (let j = 0; j < m; j++) { const s = dot(C, r => r[i], r => r[j]); if (s !== (i === j ? m - 1 : 0)) { ok = false; break; } }
  check(`order ${m}: CᵀC = ${m - 1} I, zero diagonal, ±1 elsewhere`, ok);
}
throws('order 22 does not exist', () => conferenceMatrix(22), /no conference matrix of order 22/);
check('k = 21, 22 use order 24', dsdOrder(21) === 24 && dsdOrder(22) === 24);

section('definitive screening designs: defining properties, k = 3 … 30');
for (let k = 3; k <= 30; k++) {
  const d = definitiveScreening(k), X = d.X, m = d.params.order;
  const me = [...Array(k).keys()].map(j => r => r[j]), so = secondOrder(X, k);
  let meme = 0, meso = 0;
  for (let a = 0; a < k; a++) { for (let b = a + 1; b < k; b++) meme = Math.max(meme, Math.abs(dot(X, me[a], me[b]))); for (const f of so) meso = Math.max(meso, Math.abs(dot(X, me[a], f))); }
  const cen = (f) => { const v = X.map(f), mu = v.reduce((s, x) => s + x) / v.length; return v.map(x => x - mu); };
  const C = so.map(cen); let maxr = 0;
  for (let a = 0; a < C.length; a++) for (let b = a + 1; b < C.length; b++) { const r = Math.abs(C[a].reduce((s, x, i) => s + x * C[b][i], 0)) / (Math.hypot(...C[a]) * Math.hypot(...C[b])); maxr = Math.max(maxr, r); }
  check(`k = ${k}: ${2 * m + 1} runs; main effects orthogonal to each other and to every 2fi and square; no two second-order terms completely aliased (max |r| ${maxr.toFixed(3)})`,
    X.length === 2 * m + 1 && meme === 0 && meso < 1e-12 && maxr < 1 - 1e-9);
}
{
  const d = definitiveScreening(6, { fake: 2 });
  check('fake factors: k = 6 with 2 fake → order 8, 17 runs', d.params.order === 8 && d.X.length === 17 && d.X[0].length === 6);
  for (const [k, cats] of [[6, [5]], [8, [6, 7]], [10, [9]]]) {
    const c = definitiveScreening(k, { categorical: cats }), X = c.X, m = c.params.order;
    const so = secondOrder(X, k, cats);
    const meso = Math.max(...[...Array(k).keys()].flatMap(a => so.map(f => Math.abs(dot(X, r => r[a], f)))));
    const corr = Math.max(...[...Array(k).keys()].flatMap(a => [...Array(k).keys()].filter(b => b > a).map(b => Math.abs(dot(X, r => r[a], r => r[b])) / Math.sqrt(dot(X, r => r[a], r => r[a]) * dot(X, r => r[b], r => r[b])))));
    check(`categorical ${cats} in k = ${k}: two levels, ${2 * m + 2} runs, main effects orthogonal to all second-order terms, main-effect |corr| ≤ ${corr.toFixed(3)} (small)`,
      cats.every(j => X.every(r => Math.abs(r[j]) === 1)) && X.length === 2 * m + 2 && meso < 1e-12 && corr < 0.2);
  }
}

section('DSDs vs daewr::DefScreen (published designs)');
// invariants under row and column permutation and column sign changes: run count and the
// sorted |entries| of the second-order information matrix
const invariant = (X, k) => {
  const so = secondOrder(X, k), C = [...[...Array(k).keys()].map(j => r => r[j]), ...so].map(f => X.map(f));
  const out = []; for (let a = 0; a < C.length; a++) for (let b = a; b < C.length; b++) out.push(Math.abs(C[a].reduce((s, x, i) => s + x * C[b][i], 0)));
  return out.sort((a, b) => a - b).join(',');
};
// daewr has Jones & Nachtsheim's (2011) tables; for odd m those are search-based 2m + 1-run
// designs, while aikidoe (like the conference-matrix construction of Xiao, Lin & Bai 2012) uses
// order m + 1, i.e. 2m + 3 runs. Even m up to 10 have a unique conference matrix up to
// equivalence, so the designs must match exactly; for larger m both must be valid DSDs.
// the defining DSD property: every main effect orthogonal to every second-order term
const meOrthSecondOrder = (X, k) => { const so = secondOrder(X, k); return [...Array(k).keys()].every(a => so.every(f => Math.abs(dot(X, r => r[a], f)) < 1e-12)); };
const meOrthogonal = (X, k) => [...Array(k).keys()].every(a => [...Array(k).keys()].every(b => a === b || dot(X, r => r[a], r => r[b]) === 0));
for (const c of fx.filter(c => c.input.kind === 'dsd')) {
  const { m, c: nc } = c.input, o = c.output;
  if (o.error) { check(`${c.name}: reference generated`, false, o.error); continue; }
  const k = m + nc;
  // (fake: 0 — the published tables have none; aikidoe adds 2 by default for k = 4, issue #79)
  const ours = definitiveScreening(k, { fake: 0, ...(nc ? { categorical: [...Array(nc).keys()].map(i => m + i) } : {}) });
  if (nc) { check(`${c.name}: ${o.X.length} runs`, ours.X.length === o.X.length, `ours ${ours.X.length}`); continue; }
  check(`${c.name}: daewr's design has main effects orthogonal to all second-order terms`, meOrthSecondOrder(o.X, k));
  // Jones & Nachtsheim's 2011 search-based designs for m = 5 and 12 have slightly correlated
  // main effects; the conference-matrix construction makes them exactly orthogonal
  if (!meOrthogonal(o.X, k)) check(`${c.name}: daewr's main effects are correlated, ours are orthogonal`, meOrthogonal(ours.X, k));
  if (m % 2) check(`${c.name}: daewr ${2 * m + 1} runs (search-based), ours ${2 * m + 3} (conference matrix of order ${m + 1})`, o.X.length === 2 * m + 1 && ours.X.length === 2 * m + 3);
  else if (m <= 10) check(`${c.name}: same design up to equivalence (second-order information structure)`, invariant(ours.X, k) === invariant(o.X, k));
  else check(`${c.name}: both ${2 * m + 1} runs`, ours.X.length === o.X.length);
}

section('optimal designs: known optima');
{
  check('D, first order, k = 3, N = 8: the 2³ factorial (D-efficiency 100%)', Math.abs(optimalDesign(study(3), { runs: 8, model: 'main' }).params.dEfficiency - 100) < 1e-9);
  check('D, main + 2fi, k = 3, N = 8: 100%', Math.abs(optimalDesign(study(3), { runs: 8, model: '2fi' }).params.dEfficiency - 100) < 1e-9);
  near('D, quadratic in one factor, N = 3: {−1, 0, 1}', optimalDesign(study(1), { runs: 3, model: 'quadratic' }).X.map(r => r[0]).sort((a, b) => a - b), [-1, 0, 1]);
  near('I, quadratic in one factor, N = 4: weights ¼, ½, ¼ → {−1, 0, 0, 1}', optimalDesign(study(1), { runs: 4, model: 'quadratic', criterion: 'I' }).X.map(r => r[0]).sort((a, b) => a - b), [-1, 0, 0, 1]);
  near('D, quadratic in one factor, N = 6: each point twice', optimalDesign(study(1), { runs: 6, model: 'quadratic' }).X.map(r => r[0]).sort((a, b) => a - b), [-1, -1, 0, 0, 1, 1]);
  // exact moments of the cube: E[x²] = 1/3, E[x⁴] = 1/5
  const W = momentMatrix(compileModel(parseFormula('quadratic', study(1).factors), study(1).factors), study(1)).W;
  near('moment matrix of 1, x, x² on [−1, 1]', W, [[1, 0, 1 / 3], [0, 1 / 3, 0], [1 / 3, 0, 1 / 5]], { rel: 1e-15 });
  throws('too few runs', () => optimalDesign(study(3), { runs: 9, model: 'quadratic' }), /9 runs cannot estimate 10/);
}

section('optimal designs: constraints, fixed runs, candidates, factor types');
{
  const s = study(2, { constraints: [{ expr: 'x1 + x2 <= 0.5', units: 'coded' }, 'x1 >= -0.8'] });
  const d = optimalDesign(s, { runs: 10, model: 'quadratic', criterion: 'I' });
  check('constrained region: every run feasible', toStudyDesign(s, d).runs.every(r => feasible(s, r.settings)));
  check('constrained region: the search uses the boundary', d.X.some(r => Math.abs(r[0] + r[1] - 0.5) < 1e-6) && d.X.some(r => Math.abs(r[0] + 0.8) < 1e-6));
  const nat = createStudy({ aikidoe: 1, seed: 2, factors: [{ id: 'T', low: 100, high: 200 }, { id: 't', low: 1, high: 100, transform: 'log' }], constraints: ['T + 2*t <= 300'] });
  const dn = optimalDesign(nat, { runs: 8, model: 'main + T:t' });
  check('constraint in natural units with a log factor: every run feasible', toStudyDesign(nat, dn).runs.every(r => feasible(nat, r.settings)));
  const fixedRows = [{ x1: 0, x2: 0, x3: 0 }, { x1: 1, x2: 1, x3: 1 }];
  const df = optimalDesign(study(3), { runs: 10, model: 'main', fixed: fixedRows });
  check('fixed runs kept unchanged at the start', JSON.stringify(df.X.slice(0, 2)) === JSON.stringify([[0, 0, 0], [1, 1, 1]]) && df.params.fixedRuns === 2);
  const cands = []; for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) cands.push({ x1: a, x2: b });
  const dc = optimalDesign(study(2), { runs: 6, model: 'quadratic', candidates: cands });
  check('candidate set: every run is a candidate', dc.X.every(r => cands.some(c => c.x1 === r[0] && c.x2 === r[1])));
  const mixed = createStudy({ aikidoe: 1, seed: 3, factors: [{ id: 'A', low: 0, high: 10 }, { id: 'B', levels: [1, 2, 5] }, { id: 'g', levels: ['p', 'q', 'r'] }] });
  const dm = optimalDesign(mixed, { runs: 12, model: 'A*g + B' });
  const runs = toStudyDesign(mixed, dm).runs;
  check('categorical (3 levels) and listed numeric levels respected', runs.every(r => ['p', 'q', 'r'].includes(r.settings.g) && [1, 2, 5].includes(r.settings.B)) && new Set(runs.map(r => r.settings.g)).size === 3);
  check('same seed, same design', JSON.stringify(optimalDesign(study(3), { runs: 10, model: '2fi', seed: 9 }).X) === JSON.stringify(optimalDesign(study(3), { runs: 10, model: '2fi', seed: 9 }).X));
  throws('equality constraints not supported', () => optimalDesign(study(2, { constraints: ['x1 + x2 = 0'] }), { runs: 4 }), /equality/);
}

section('diagnostics');
{
  const d = optimalDesign(study(3), { runs: 8, model: 'main' });
  const g = d.diagnostics;
  check('orthogonal design: A- and G-efficiency 100%, correlations 0', Math.abs(g.aEfficiency - 100) < 1e-9 && Math.abs(g.gEfficiency - 100) < 1e-6 && g.correlations.r.every((r, i) => r.every((v, j) => (i === j ? Math.abs(v - 1) < 1e-12 : v < 1e-12))));
  check('FDS curve non-decreasing, 21 points', g.fds.length === 21 && g.fds.every((x, i) => !i || x.variance >= g.fds[i - 1].variance));
  near('average variance of the 2³ (first order) = tr(W/8 · I) = (1 + 3·⅓)/8', g.averageVariance, (1 + 3 / 3) / 8, { rel: 1e-12 });
}

section('benchmarks vs skpr and AlgDesign (efficiency ≥ 99%)');
for (const c of fx.filter(c => c.input.kind === 'optimal')) {
  const i = c.input, o = c.output;
  if (o.error) { check(`${c.name}: reference generated`, false, o.error); continue; }
  const factors = [...Array(i.k).keys()].map(j => ({ id: `x${j + 1}`, low: -1, high: 1 }));
  if (i.categorical) factors.push({ id: 'g', levels: i.categorical });
  const s = createStudy({ aikidoe: 1, seed: 11, factors, ...(i.constraint ? { constraints: [{ expr: i.constraint, units: 'coded' }] } : {}) });
  const model = i.model.replace(/^~\s*/, '');
  const t0 = Date.now();
  const ours = optimalDesign(s, { runs: i.runs, model, criterion: i.criterion });
  const secs = (Date.now() - t0) / 1000;
  const evalRows = (rows) => evaluateDesign(s, rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v]))), { model });
  const ev = { ours: ours.diagnostics, skpr: evalRows(o.skpr), algdesign: evalRows(o.algdesign) };
  const p = compileModel(parseFormula(model, s.factors), s.factors).p;
  for (const ref of ['skpr', 'algdesign']) {
    const eff = i.criterion === 'D' ? Math.exp((ev.ours.logDet - ev[ref].logDet) / p) : ev[ref].averageVariance / ev.ours.averageVariance;
    check(`${c.name}: ${i.criterion}-efficiency relative to ${ref} = ${(100 * eff).toFixed(2)}% (${secs.toFixed(1)} s)`, eff >= 0.99);
  }
}
done();
