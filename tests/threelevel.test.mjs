// Regular three-level fractions 3^(k−p) (issue #85, phase 1), against DoE.base (fixture
// threelevel-r, tests/ref/threelevel_r.R): the minimum-aberration word-length patterns found by a
// complete search over DoE.base's saturated arrays, and the GWLP of fractions from given
// generators (DoE.base counts a word and its square: GWLP = 2 × WLP). Then the structure of the
// designs, generators, aliasing, the study and the recommender.
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import { fraction3, minimumAberration3, threeLevelWLP, definingWords3, parseWord3, word3 } from '../js/design/threelevel.js';
import { createStudy } from '../js/study.js';
import { toStudyDesign } from '../js/design/factorial.js';
import { candidates, buildCandidate } from '../js/design/recommend.js';
import { defaultFormula } from '../js/model/defaults.js';
import { fitModel } from '../js/model/fit.js';

const F = loadFixture('threelevel-r');

section('minimum aberration: as a complete search over DoE.base\'s arrays');
for (const c of F.cases.filter(x => x.input.kind === 'ma')) {
  const { runs, k } = c.input, m = Math.round(Math.log(runs) / Math.log(3));
  const d = fraction3(k, { runs });
  near(`${c.name}: 2 × (A3, A4, …)`, d.params.wlp.slice(2).map(a => 2 * a), c.output.gwlp, { abs: 1e-9 });
  check(`… ${d.params.exhaustive ? 'a complete search' : 'the sequential search reaches it'}`, d.params.exhaustive || m === 4);
}

section('fractions from given generators: GWLP as DoE.base');
for (const c of F.cases.filter(x => x.input.kind === 'generators')) {
  near(`${c.name}`, threeLevelWLP(c.input.generators, c.input.m).slice(2).map(a => 2 * a), c.output.gwlp, { abs: 1e-9 });
}

section('the designs');
const d = fraction3(5, { runs: 27 });
check('27 runs of 5 factors at 0, 1, 2; each factor\'s levels equally often', d.X.length === 27 && d.X.every(r => r.length === 5 && r.every(v => [0, 1, 2].includes(v))) && [0, 1, 2, 3, 4].every(j => [0, 1, 2].every(v => d.X.filter(r => r[j] === v).length === 9)));
check('orthogonal: every pair of factors in all 9 combinations, 3 times each', [0, 1, 2, 3, 4].every(a => [0, 1, 2, 3, 4].every(b => a >= b || new Set(d.X.map(r => `${r[a]}${r[b]}`)).size === 9 && d.X.filter(r => r[a] === 0 && r[b] === 0).length === 3)));
check('the generators hold in every run (D = BC: x_D = x_B + x_C mod 3)', d.params.generators[0] === 'D=BC' && d.X.every(r => r[3] === (r[1] + r[2]) % 3));
check('the defining relation: (3² − 1)/2 = 4 words, first exponent 1', d.params.definingRelation.length === 4 && d.params.definingRelation.every(w => !/^[A-Z]²/.test(w)));
check('resolution III, and the aliases of main effects with 2fi components', d.params.resolution === 3 && d.params.aliases.main.D.join() === 'BC' && d.params.aliases.main.B.join() === 'CD²');
const g = fraction3(4, { generators: 'D=ABC' });
check('3^(4−1) with D = ABC: resolution IV, I = ABCD², no main effect aliased with a 2fi', g.params.resolution === 4 && g.params.definingRelation.join() === 'ABCD²' && Object.values(g.params.aliases.main).every(v => !v.length));
const g2 = fraction3(5, { generators: 'D=AB, E=AB^2C' });
check('generators written with ² , 2 or ^2', g2.params.generators.join() === 'D=AB,E=AB²C' && word3(parseWord3('AB2C', 3)) === 'AB²C');
check('the square of a generator is the same column: written with first exponent 1', fraction3(4, { generators: 'D=A2B2C2' }).params.generators[0] === 'D=ABC');
check('9 runs, 4 factors: the saturated L9, resolution III', fraction3(4, { runs: 9 }).X.length === 9 && fraction3(4, { runs: 9 }).params.resolution === 3);
const r81 = fraction3(5, { runs: 81 });
check('81 runs, 5 factors: resolution V (E = ABCD)', r81.params.resolution === 5 && r81.params.wlp[4] === 1);
check('replicates', fraction3(4, { runs: 9, replicates: 2 }).X.length === 18);
check('words over GF(3): 3^(6−3) has (3³ − 1)/2 = 13', definingWords3(minimumAberration3(6, 3).gens, 3).length === 13);
throws('14 factors do not fit in 27 runs', () => fraction3(14, { runs: 27 }), /more than 27 runs/);
throws('runs must be a power of 3', () => fraction3(5, { runs: 32 }), /power of 3/);
throws('an added factor must combine base factors', () => fraction3(4, { generators: 'D=A' }), /two or more/);
throws('generators in order of the added factors', () => fraction3(5, { generators: 'E=AB, D=AC' }), /should define D/);
throws('a repeated column', () => fraction3(5, { generators: 'D=AB, E=A2B2' }), /same column/);
throws('an unknown factor in a word', () => fraction3(4, { generators: 'D=ABX' }), /not a word|not among/);

section('the study, the default model and the recommender');
const s0 = createStudy({ name: 'x', seed: 4, factors: [{ id: 'T', low: 20, high: 40, levels: [20, 30, 40] }, { id: 'P', low: 1, high: 3, levels: [1, 2, 3] }, { id: 'cat', type: 'categorical', levels: ['a', 'b', 'c'] }, { id: 'S', low: 5, high: 15, levels: [5, 10, 15] }], responses: [{ id: 'y' }] });
const cands = candidates(s0);
const c27 = cands.find(c => c.id === 'frac3-27'), c9 = cands.find(c => c.id === 'frac3-9');
check('four three-level factors: 3^(4−1) in 27 runs (resolution IV) and 3^(4−2) in 9 offered', c27?.res === 4 && c9?.res === 3 && c27.label === '3^(4−1) fraction');
const sd = createStudy({ ...s0, design: toStudyDesign(s0, buildCandidate(s0, c27)) });
check('the study\'s runs: listed levels and categories', sd.design.kind === 'fractional-factorial-3' && sd.design.runs.length === 27 && sd.design.runs.every(r => [20, 30, 40].includes(r.settings.T) && ['a', 'b', 'c'].includes(r.settings.cat)));
check('the default model: main effects with the continuous factors\' quadratic parts', defaultFormula(sd, 'y') === 'y ~ main + I(T^2) + I(P^2) + I(S^2)');
const obs = sd.design.runs.map(r => ({ run: r.run, response: 'y', value: 10 + 0.1 * r.settings.T + (r.settings.cat === 'b' ? 2 : 0) - 0.01 * (r.settings.S - 10) ** 2 + 0.01 * (r.run % 5) }));
const f = fitModel(createStudy({ ...sd, observations: obs }), defaultFormula(sd, 'y'));
check('it fits: 9 parameters in 27 runs, nothing aliased', f.rank === 9 && f.dfRes === 18 && !f.aliased.length);
check('no three-level fractions when a factor has two levels', !candidates(createStudy({ ...s0, factors: [...s0.factors.slice(0, 3), { id: 'S', low: 5, high: 15 }] })).some(c => c.kind === 'fraction3'));

done();
