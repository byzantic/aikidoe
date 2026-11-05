// Sequential experimentation (issue #11): fold-over, axial points, optimal augmentation,
// confirmation runs, block term, predictions (R reference: fixture augment-r).
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import { createStudy, parseStudy, serializeStudy, code } from '../js/study.js';
import { fractionalFactorial, toStudyDesign } from '../js/design/factorial.js';
import { foldover, axialPoints, optimalAugment, confirmationRuns, appendStage, sequentialAliases, checkConfirmation } from '../js/design/augment.js';
import { fitModel, anova, predict } from '../js/model/ols.js';

const TOL = { rel: 1e-8, abs: 1e-10 };

section('block term and predictions vs R');
{
  const [c1, c2] = loadFixture('augment-r').cases;
  const mk = (c, blocked) => createStudy({ aikidoe: 1, seed: 1, factors: [{ id: 'x1', low: -1, high: 1 }, { id: 'x2', low: -1, high: 1 }], responses: [{ id: 'y' }],
    design: { runs: c.input.rows.map((r, i) => ({ run: i + 1, ...(blocked ? { block: r.block } : {}), settings: { x1: r.x1, x2: r.x2 } })) },
    observations: c.input.y.map((v, i) => ({ run: i + 1, response: 'y', value: v })) });
  const s1 = mk(c1, true), f1 = fitModel(s1, c1.input.formula);
  check('Block added first, effect coded', f1.model.terms[0].label === 'Block' && f1.columns.slice(0, 3).join() === '(Intercept),Block[2],Block[3]');
  near('blocked fit: coefficients and σ = R lm with contr.sum', [f1.coef, f1.sigma], [c1.output.coef, c1.output.sigma], TOL);
  near('blocked fit: sequential ANOVA (Block first)', anova(f1, 1).map(r => ({ term: r.term, df: r.df, ss: r.ss })), c1.output.anova.map(r => ({ ...r, term: r.term.replace(/^Block$/, 'Block') })), TOL);
  const keys = ['fit', 'se', 'lower', 'upper', 'predLower', 'predUpper'];
  near('prediction at the average block, CI and PI', predict(f1, c1.input.newdata), c1.output.predict.fit.map((_, i) => Object.fromEntries(keys.map(k => [k, c1.output.predict[k][i]]))), TOL);
  const s2 = mk(c2, false), f2 = fitModel(s2, c2.input.formula);
  check('no blocks: no Block term', !f2.model.terms.some(t => t.block));
  near('unblocked: predict.lm confidence and prediction intervals', predict(f2, c2.input.newdata).map(p => ({ fit: p.fit, lower: p.lower, upper: p.upper, predLower: p.predLower, predUpper: p.predUpper })),
    c2.output.predict.fit.map((_, i) => Object.fromEntries(['fit', 'lower', 'upper', 'predLower', 'predUpper'].map(k => [k, c2.output.predict[k][i]]))), TOL);
  check('blocks: false leaves the Block term out', !fitModel(s1, c1.input.formula, { blocks: false }).model.terms.some(t => t.block));
}

// ---------------------------------------------------------------- the issue's sequence
const base = () => createStudy({ aikidoe: 1, seed: 31, name: 'Sequential',
  factors: [{ id: 'A', low: 10, high: 20 }, { id: 'B', low: 1, high: 3 }, { id: 'C', low: 100, high: 200 }, { id: 'D', low: 0, high: 1 }, { id: 'E', low: 5, high: 50, transform: 'log' }],
  responses: [{ id: 'y' }] });
// truth in coded units, with a shift per stage (block)
const shift = { 1: 0, 2: 3, 3: -2 };
const truth = (s, r) => { const c = Object.fromEntries(s.factors.map(f => [f.id, code(f, r.settings[f.id])])); return 50 + 4 * c.A - 3 * c.B + 2 * c.C + 1.5 * c.A * c.B - 2 * c.A * c.A + (shift[r.block ?? 1] ?? 0); };
const observe = (s, ids) => createStudy({ ...s, observations: [...s.observations, ...s.design.runs.filter(r => ids.includes(r.run)).map(r => ({ run: r.run, response: 'y', value: truth(s, r) }))] });
function sequence() {
  let s = base();
  s = createStudy({ ...s, design: toStudyDesign(s, fractionalFactorial(5, { runs: 8 })) });
  s = observe(s, s.design.runs.map(r => r.run));
  const a1 = sequentialAliases(s);
  s = appendStage(s, foldover(s)); s = observe(s, s.history[1].runs);
  const a2 = sequentialAliases(s);
  s = appendStage(s, axialPoints(s)); s = observe(s, s.history[2].runs);
  return { s, a1, a2 };
}

section('2^(5−2) → fold-over → axial points (issue #11)');
{
  const { s, a1, a2 } = sequence();
  check('stage 1: resolution III — main effects aliased with 2fis', a1.chains.some(c => c.some(e => !e.includes(':')) && c.some(e => e.includes(':'))));
  check('after the full fold-over: no main effect aliased with a 2fi (resolution IV)', a2.chains.every(c => c.every(e => e.includes(':'))) && a2.runs === 16);
  check('three stages, three blocks, history recorded', s.design.kind === 'sequential' && s.design.params.stages.map(x => x.kind).join() === 'fractional-factorial,foldover,axial'
    && JSON.stringify([...new Set(s.design.runs.map(r => r.block))]) === '[1,2,3]' && s.history.map(h => h.stage).join() === 'fractional-factorial,foldover,axial');
  check('run ids continue, orders after the earlier stages', s.design.runs.length === 8 + 8 + 12 && s.design.runs.filter(r => r.block === 3).every(r => r.order > 16 && r.run > 16));
  const ax = s.design.params.stages[2].params;
  near('axial α for orthogonal blocking: α² = (2k + n0a)/2 = 6', ax.alpha, Math.sqrt(6), { rel: 1e-14 });
  // orthogonal blocking: each block contrast orthogonal to every squared column
  const X = s.design.runs.map(r => s.factors.map(f => code(f, r.settings[f.id])));
  const orth = [1, 2, 3].every(b => { const z = s.design.runs.map(r => (r.block === b ? 1 : 0)), zm = z.reduce((a, c) => a + c) / z.length;
    return [0, 1, 2, 3, 4].every(j => { const v = X.map(r => r[j] ** 2), vm = v.reduce((a, c) => a + c) / v.length; return Math.abs(v.reduce((acc, x, i) => acc + (x - vm) * (z[i] - zm), 0)) < 1e-9; }); });
  check('blocks orthogonal to the quadratic terms', orth);
  const fit = fitModel(s, 'y ~ main + A:B + I(A^2) + I(B^2) + I(C^2) + I(D^2) + I(E^2)');
  check('the block effect is in the model automatically', fit.model.terms[0].block && anova(fit, 1)[0].term === 'Block' && anova(fit, 1)[0].df === 2);
  // columns: intercept, Block[2], Block[3], A … E, I(A^2) … I(E^2) (degree 1, as R orders them), A:B.
  // Effect-coded blocks: each block coefficient is that block's shift minus the mean shift (1/3).
  const m = (0 + 3 - 2) / 3;
  near('fit recovers the effects (coded units) and the block shifts', fit.coef, [50 + m, 3 - m, -2 - m, 4, -3, 2, 0, 0, -2, 0, 0, 0, 0, 1.5], { rel: 1e-9, abs: 1e-9 });
  const text = serializeStudy(s);
  check('the whole sequence is in one study file and parses back unchanged', serializeStudy(parseStudy(text)) === text);
  check('reproducible: the same steps give the identical study', serializeStudy(sequence().s) === text);
}

section('single-factor fold-over');
{
  let s = base();
  s = createStudy({ ...s, design: toStudyDesign(s, fractionalFactorial(5, { runs: 8 })) });
  s = appendStage(s, foldover(s, { factor: 'A' }));
  const a = sequentialAliases(s);
  check('A and every interaction with A are clear', a.chains.every(c => c.every(e => !e.split(':').includes('A'))));
  throws('unknown factor', () => foldover(s, { factor: 'Q' }), /unknown factor/);
}

section('optimal augmentation and confirmation runs');
{
  let s = base();
  s = createStudy({ ...s, factors: s.factors.slice(0, 4), design: undefined });
  s = createStudy({ ...s, design: toStudyDesign(s, fractionalFactorial(4, { runs: 8 })) });
  const before = s.design.runs.map(r => JSON.stringify(r.settings));
  const st = optimalAugment(s, { runs: 6, model: '2fi', restarts: 5 });
  s = appendStage(s, st);
  check('optimal augmentation: existing runs unchanged, 6 runs added', s.design.runs.slice(0, 8).every((r, i) => JSON.stringify(r.settings) === before[i]) && s.design.runs.length === 14);
  s = observe(s, s.design.runs.map(r => r.run));
  const f = fitModel(s, 'y ~ 2fi');
  check('after augmentation all two-factor interactions and the block are estimable', f.aliased.length === 0 && f.rank === f.columns.length && f.model.terms[0].block);

  // confirmation, against a model with noise-free data plus a little jitter
  let q = sequence().s;
  q = createStudy({ ...q, observations: q.observations.map((o, i) => ({ ...o, value: o.value + 0.2 * Math.sin(5 * i) })) });
  const qf = fitModel(q, 'y ~ main + A:B + I(A^2)');
  const at = [{ A: 15, B: 2, C: 150, D: 0.5, E: Math.sqrt(250) }, { A: 20, B: 1, C: 200, D: 0, E: 50 }];
  const conf = confirmationRuns(q, qf, at, { replicates: 2 });
  q = appendStage(q, conf);
  const ids = q.history[3].runs;
  check('confirmation stage: 4 runs, predictions stored', ids.length === 4 && q.history[3].params.predictions.length === 2 && q.design.runs.filter(r => ids.includes(r.run)).every(r => r.kind === 'confirm'));
  const pred = predict(qf, at);
  q = createStudy({ ...q, observations: [...q.observations,
    { run: ids[0], response: 'y', value: pred[0].fit + 0.1 }, { run: ids[1], response: 'y', value: pred[0].fit - 0.1 },
    { run: ids[2], response: 'y', value: pred[1].fit + 25 }, { run: ids[3], response: 'y', value: pred[1].fit + 25 }] });
  const cc = checkConfirmation(q, 'y');
  check('confirmation check: first setting inside, second (25 off) outside', cc.length === 2 && cc[0].inside === true && cc[1].inside === false && cc[0].n === 2);
  check('confirmation runs are left out of later fits', fitModel(q, 'y ~ main + A:B + I(A^2)').n === qf.n);
  check('interval for a mean of 2 is narrower than for one run', cc[0].upper - cc[0].lower < q.history[3].params.predictions[0].predUpper - q.history[3].params.predictions[0].predLower);
  throws('confirmation settings must give every factor', () => confirmationRuns(q, qf, [{ A: 15 }]), /missing B/);
}
done();
