// Orthogonal arrays for factors with more than two levels (issue #85, phase 2), against DoE.base
// (fixture arrays-r, tests/ref/arrays_r.R): the generalised word-length patterns of the app's own
// arrays equal those of DoE.base's (built independently: regular arrays over GF(s), difference
// matrices, expansive replacement); the column choice reaches the least (A3, A4) of a complete
// search over DoE.base's arrays; the GWLP formula on random mixed-level matrices. Then strength 2
// for every array, the difference matrices, the design, the study and the recommender.
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import { ARRAYS, orthogonalArray, gwlp, gwlpDirect, chooseColumns, chooseArray, arrayDesign, DIFFERENCE_MATRICES } from '../js/design/arrays.js';
import { createStudy } from '../js/study.js';
import { toStudyDesign } from '../js/design/factorial.js';
import { candidates, buildCandidate } from '../js/design/recommend.js';
import { defaultFormula } from '../js/model/defaults.js';
import { fitModel } from '../js/model/fit.js';

const F = loadFixture('arrays-r');
const tol = { rel: 1e-8, abs: 1e-8 };

section('the arrays\' patterns: as DoE.base\'s arrays');
for (const c of F.cases.filter(x => x.input.kind === 'array')) {
  const A = orthogonalArray(c.input.id);
  check(`${c.name}: the same numbers of levels`, JSON.stringify(A.levels.slice().sort((a, b) => a - b)) === JSON.stringify(c.input.levels));
  near(`${c.name}: GWLP (A1 … A${c.output.gwlp.length})`, gwlp(A.X, A.levels, c.output.gwlp.length), c.output.gwlp, tol);
}

section('the least (A3, A4): as a complete search over DoE.base\'s arrays');
for (const c of F.cases.filter(x => x.input.kind === 'gma')) {
  const levels = Object.entries(c.input.need).flatMap(([s, n]) => new Array(n).fill(Number(s)));
  const A = orthogonalArray(c.input.id), r = chooseColumns(A, levels);
  check('… by a complete search', r.exhaustive);
  if (c.input.id === 'L36.3.13.4.1') {
    // the app's L36 (3^13 4) has DoE.base's pattern as a whole but is not isomorphic to it (built
    // from D(12,12,3) and the 4 × 3 factorial): its projections can be better, and are here
    check(`${c.name}: at least as good (lexicographically) as DoE.base's array`, r.gwlp[0] < c.output.a34[0] - 1e-9 || (Math.abs(r.gwlp[0] - c.output.a34[0]) < 1e-9 && r.gwlp[1] <= c.output.a34[1] + 1e-9), `got ${r.gwlp}`);
    const X = A.X.map(row => r.columns.map(j => row[j]));
    near('… its pattern by the contrasts as well', gwlpDirect(X, levels, 4).slice(2), r.gwlp, tol);
  } else near(`${c.name}`, r.gwlp, c.output.a34, tol);
}

section('the GWLP formula on random matrices');
for (const c of F.cases.filter(x => x.input.kind === 'random')) {
  near(`${c.name}: by the distances between runs (MacWilliams)`, gwlp(c.input.X, c.input.levels, c.input.levels.length), c.output.gwlp, tol);
  near('… and by the contrasts', gwlpDirect(c.input.X, c.input.levels, c.input.levels.length), c.output.gwlp, tol);
}

section('every array has strength 2; the difference matrices');
for (const a of ARRAYS) {
  const A = orthogonalArray(a.id), k = A.levels.length;
  let ok = A.X.length === a.runs;
  for (let i = 0; i < k && ok; i++) for (let j = i + 1; j < k && ok; j++) {
    const n = new Map();
    for (const r of A.X) n.set(`${r[i]},${r[j]}`, (n.get(`${r[i]},${r[j]}`) ?? 0) + 1);
    ok = n.size === A.levels[i] * A.levels[j] && [...n.values()].every(v => v === a.runs / (A.levels[i] * A.levels[j]));
  }
  check(`${a.name}: every pair of columns in all combinations equally often`, ok);
}
const gfAdd = (s) => (s === 4 ? (a, b) => a ^ b : (a, b) => (a + b) % s);
const gfNeg = (s) => (s === 4 ? (a) => a : (a) => (s - a) % s);
for (const [name, { s, rows }] of Object.entries(DIFFERENCE_MATRICES)) {
  const D = rows.map(t => [...t].map(Number)), r = D.length, add = gfAdd(s), neg = gfNeg(s);
  let ok = true;
  for (let a = 0; a < r && ok; a++) for (let b = a + 1; b < r && ok; b++) { const n = new Array(s).fill(0); D.forEach(row => { n[add(row[a], neg(row[b]))]++; }); ok = n.every(v => v === r / s); }
  check(`${name}: every two columns' differences hold each element of GF(${s}) ${r / s} times`, ok);
}

section('designs');
const d = arrayDesign([2, 3, 3, 3, 3]);
check('one two-level and four three-level factors: L18, its best columns, two-level as ±1', d.params.name === 'L18 (2 3^7)' && d.X.length === 18 && d.X.every(r => [-1, 1].includes(r[0]) && r.slice(1).every(v => [0, 1, 2].includes(v))) && d.params.exhaustive);
near('… A3, A4 as the complete search (3.5, 4.5)', d.params.gwlp, [3.5, 4.5], tol);
const d4 = arrayDesign([4, 4, 4, 2, 2]);
check('three four-level and two two-level factors: L16 (2^3 4^4)', d4.params.name === 'L16 (2^3 4^4)' && d4.X.length === 16);
check('columns given', arrayDesign([2, 3, 3], { array: 'L18', columns: [0, 1, 2] }).params.columns.join() === '0,1,2');
check('replicates', arrayDesign([3, 3, 3], { replicates: 2 }).X.length === 18);
check('the smallest array that fits: 5^3 in L25, 2^1 4^5 in L32', arrayDesign([5, 5, 5]).params.runs === 25 && arrayDesign([2, 4, 4, 4, 4, 4]).params.name === 'L32 (2 4^9)');
const big = chooseArray([2, 2, 3, 3, 3, 3, 3, 3], { sizes: 1 });
check('two two-level and six three-level factors: the 36-run arrays, least aberration first', big.length === 2 && big.every(a => a.runs === 36) && big[0].gwlp[0] <= big[1].gwlp[0]);
throws('no array with columns of six levels for two factors', () => arrayDesign([6, 6]), /no orthogonal array/);
throws('a column with the wrong number of levels', () => arrayDesign([2, 3], { array: 'L18', columns: [1, 2] }), /column 2 of L18 \(2 3\^7\) has 3 levels; factor 1 has 2/);
throws('a column given twice', () => arrayDesign([3, 3], { array: 'L18', columns: [1, 1] }), /two factors/);

section('the study, the default model and the recommender');
const s0 = createStudy({ name: 'x', seed: 4, factors: [{ id: 'cat', type: 'categorical', levels: ['a', 'b'] }, { id: 'T', low: 20, high: 40, levels: [20, 30, 40] },
  { id: 'P', low: 1, high: 3, levels: [1, 2, 3] }, { id: 'C', type: 'categorical', levels: ['x', 'y', 'z'] }, { id: 'S', low: 5, high: 15, levels: [5, 10, 15] }], responses: [{ id: 'y' }] });
const cs = candidates(s0), oa = cs.find(c => c.kind === 'array');
check('an L18 candidate (and a 36-run one)', oa?.runs === 18 && /L18/.test(oa.label) && cs.some(c => c.kind === 'array' && c.runs === 36));
const sd = createStudy({ ...s0, design: toStudyDesign(s0, buildCandidate(s0, oa)) });
check('the study\'s runs: categories and listed levels', sd.design.kind === 'orthogonal-array' && sd.design.runs.length === 18 && sd.design.runs.every(r => ['a', 'b'].includes(r.settings.cat) && [20, 30, 40].includes(r.settings.T)));
check('the default model: main effects and the continuous factors\' quadratic parts', defaultFormula(sd, 'y') === 'y ~ main + I(T^2) + I(P^2) + I(S^2)');
const f = fitModel(createStudy({ ...sd, observations: sd.design.runs.map(r => ({ run: r.run, response: 'y', value: 5 + 0.1 * r.settings.T + (r.settings.C === 'y' ? 1 : 0) + 0.01 * (r.run % 7) })) }), defaultFormula(sd, 'y'));
check('it fits: 10 parameters in 18 runs, nothing aliased', f.rank === 10 && f.dfRes === 8 && !f.aliased.length);
check('no array candidates when every factor has two levels', !candidates(createStudy({ ...s0, factors: s0.factors.filter(x => x.id === 'cat').concat([{ id: 'u', low: 0, high: 1 }, { id: 'v', low: 0, high: 1 }]) })).some(c => c.kind === 'array'));

done();
