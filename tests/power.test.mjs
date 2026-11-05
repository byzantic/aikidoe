// Power and model reduction (issue #12): references power-r (base R non-central F),
// power-skpr (skpr::eval_design, pwr::pwr.t.test) and reduce-r (drop1 / AICc elimination).
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture, listFixtures } from './lib/fixtures.mjs';
import { createStudy } from '../js/study.js';
import { designPower, studyPower, detectableEffect } from '../js/model/power.js';
import { reduceModel, aicc } from '../js/model/reduce.js';
import { fitModel } from '../js/model/ols.js';

const TOL = { rel: 1e-9, abs: 1e-12 };
// R's pnbeta (behind pf with ncp) stops at an error of 1e-9, so power is compared to 1e-8
const PTOL = { rel: 1e-8, abs: 1e-9 };

// a study whose factors are the fixture's columns, coded = natural (−1 … +1)
function studyFor(input, withY) {
  const ids = Object.keys(input.rows[0]).filter(k => k !== 'y');
  const factors = ids.map(id => (typeof input.rows[0][id] === 'string' ? { id, levels: input.levels } : { id, low: -1, high: 1 }));
  const runs = input.rows.map((r, i) => ({ run: i + 1, settings: Object.fromEntries(ids.map(id => [id, r[id]])) }));
  return createStudy({ aikidoe: 1, seed: 1, factors, responses: [{ id: 'y' }], design: { runs },
    observations: withY ? input.rows.map((r, i) => ({ run: i + 1, response: 'y', value: r.y })) : [] });
}
const codedX = (s, rows) => rows.map(r => s.factors.map(f => (f.type === 'categorical' ? f.levels.indexOf(r[f.id]) : r[f.id])));

section('power vs base R (non-central F)');
for (const c of loadFixture('power-r').cases) {
  const s = studyFor(c.input), opts = { model: c.input.model, delta: c.input.delta, alpha: c.input.alpha };
  const p = designPower(s, codedX(s, c.input.rows), opts);
  check(`${c.name}: residual df`, p.dfRes === c.output.dfRes, `${p.dfRes} vs ${c.output.dfRes}`);
  near(`${c.name}: term λ`, p.terms.map(t => ({ term: t.term, df: t.df, lambda: t.lambda })), c.output.terms.map(t => ({ term: t.term, df: t.df, lambda: t.lambda })), TOL);
  near(`${c.name}: term power`, p.terms.map(t => t.power), c.output.terms.map(t => t.power), PTOL);
  near(`${c.name}: coefficient λ and power`, p.parameters.map(q => [q.lambda, q.power]), c.output.parameters.slice(1).map(q => [q.lambda, q.power]), PTOL);
  near(`${c.name}: the same from the study's design`, studyPower(s, opts).terms.map(t => t.power), p.terms.map(t => t.power), { rel: 1e-14, abs: 0 });
}

section('power vs skpr and pwr');
if (listFixtures().includes('power-skpr')) {
  const cases = loadFixture('power-skpr').cases;
  for (const c of cases.filter(x => x.input.rows)) {
    if (c.output.error) { check(`${c.name}: skpr ran`, false, c.output.error); continue; }
    // skpr rescales each continuous column of a design it did not generate to −1 … +1 (for the
    // CCD: axial points at ±1, cube at ±1/α); aikidoe keeps the factor's low/high at ±1. Compare
    // on skpr's scaling.
    const s = studyFor(c.input), X = codedX(s, c.input.rows);
    const scale = s.factors.map((f, j) => (f.type === 'categorical' ? 1 : Math.max(...X.map(r => Math.abs(r[j])))));
    const p = designPower(s, X.map(r => r.map((v, j) => v / scale[j])), { model: c.input.model, delta: c.input.delta, alpha: c.input.alpha });
    const eff = c.output.type.map((t, i) => [t, c.output.parameter[i], c.output.power[i]]).filter(x => x[0] === 'effect.power' && x[1] !== '(Intercept)');
    const par = c.output.type.map((t, i) => [t, c.output.parameter[i], c.output.power[i]]).filter(x => x[0] === 'parameter.power' && x[1] !== '(Intercept)');
    near(`${c.name}: effect power = skpr to 1e−4`, p.terms.map(t => t.power), eff.map(x => x[2]), { abs: 1e-4 });
    near(`${c.name}: parameter power = skpr to 1e−4`, p.parameters.map(t => t.power), par.map(x => x[2]), { abs: 1e-4 });
  }
  const t = cases.find(x => x.name.startsWith('pwr.t.test'));
  const s = createStudy({ aikidoe: 1, seed: 1, factors: [{ id: 'x1', low: -1, high: 1 }], design: { runs: [...Array(12).keys()].map(i => ({ run: i + 1, settings: { x1: i < 6 ? -1 : 1 } })) } });
  near('one factor, 6 + 6 runs: power = pwr.t.test (two-sample, d = Δ/σ)', studyPower(s, { model: 'x1', delta: t.input.d, alpha: t.input.alpha }).terms[0].power, t.output.power, { rel: 1e-8 });
} else check('power-skpr fixture present (generated on CI)', false);

section('power: options and properties');
{
  const c = loadFixture('power-r').cases[2];         // CCD
  const s = studyFor(c.input), X = codedX(s, c.input.rows);
  near('Δ and σ enter only as Δ/σ', designPower(s, X, { model: 'quadratic', delta: 4, sigma: 2 }).terms.map(t => t.power), designPower(s, X, { model: 'quadratic', delta: 2 }).terms.map(t => t.power), { rel: 1e-14 });
  const per = designPower(s, X, { model: 'quadratic', delta: { x1: 3, default: 2 } }), all2 = designPower(s, X, { model: 'quadratic' });
  check('Δ per term: only x1 changes (CCD: estimates uncorrelated)', per.terms[0].power > all2.terms[0].power && per.terms.slice(1).every((t, i) => Math.abs(t.power - all2.terms[i + 1].power) < 1e-12));
  const det = detectableEffect(designPower(s, X, { model: 'quadratic', sigma: 2, delta: 3 }), { power: 0.8 });
  near('detectable Δ gives power 0.8', designPower(s, X, { model: 'quadratic', sigma: 2, delta: Object.fromEntries(det.map(e => [e.term, e.delta])) }).terms.map(t => t.power), det.map(() => 0.8), { abs: 1e-9 });
  near('… and does not depend on the Δ used', det.map(d => d.ratio), detectableEffect(designPower(s, X, { model: 'quadratic' })).map(d => d.ratio), { rel: 1e-9 });
  const sat = createStudy({ aikidoe: 1, seed: 1, factors: [{ id: 'A', low: -1, high: 1 }, { id: 'B', low: -1, high: 1 }], design: { runs: [[-1, -1], [1, -1], [-1, 1], [1, 1]].map((r, i) => ({ run: i + 1, settings: { A: r[0], B: r[1] } })) } });
  check('saturated design: no residual df, power NaN', studyPower(sat, { model: 'A*B' }).terms.every(t => Number.isNaN(t.power)));
  const blk = createStudy({ ...sat, design: { runs: [...sat.design.runs, ...sat.design.runs.map(r => ({ ...r, run: r.run + 4 }))].map((r, i) => ({ ...r, order: i + 1, block: i < 4 ? 1 : 2 })) } });
  const bp = studyPower(blk, { model: 'A + B' });
  check('blocks: fitted as a nuisance term, costing a residual df', bp.terms[0].block && Number.isNaN(bp.terms[0].power) && bp.dfRes === 8 - 4);
  throws('σ must be positive', () => studyPower(sat, { sigma: 0 }), /σ must be positive/);
}

section('model reduction vs R');
for (const c of loadFixture('reduce-r').cases) {
  const s = studyFor(c.input, true);
  const r = reduceModel(s, c.input.formula, { method: c.input.method, alphaOut: c.input.alphaOut });
  check(`${c.name}: same terms dropped in the same order`, JSON.stringify(r.steps.map(x => x.drop)) === JSON.stringify(c.output.steps.map(x => x.drop)), r.steps.map(x => x.drop).join(', '));
  check(`${c.name}: same final model`, JSON.stringify(r.fit.model.terms.map(t => t.label)) === JSON.stringify(c.output.final), r.formula);
  near(`${c.name}: AICc of the starting model`, aicc(fitModel(s, c.input.formula)), c.output.start_aicc, TOL);
  near(`${c.name}: AICc${c.input.method === 'p' ? ', F and p' : ''} at each step`, r.steps.map(x => (c.input.method === 'p' ? [x.aicc, x.F, x.p] : [x.aicc])),
    c.output.steps.map(x => (c.input.method === 'p' ? [x.aicc, x.F, x.p] : [x.aicc])), TOL);
}

section('model reduction: options');
{
  const c = loadFixture('reduce-r').cases[0], s = studyFor(c.input, true);
  const r = reduceModel(s, c.input.formula, { keep: ['D', 'A:D'] });
  check('keep: kept terms stay', r.fit.model.terms.some(t => t.label === 'D') && r.fit.model.terms.some(t => t.label === 'A:D'));
  const nh = reduceModel(s, 'y ~ C*D', { hierarchy: false, alphaOut: 0.5 });
  check('hierarchy: false allows a main effect to go before its interaction', nh.steps[0]?.drop !== 'C:D', nh.steps.map(x => x.drop).join());
  const hy = reduceModel(s, 'y ~ C*D', { alphaOut: 0.5 });
  check('hierarchy kept: C:D goes before C and D', hy.steps[0]?.drop === 'C:D');
  throws('saturated start with p-values', () => reduceModel(studyFor({ ...c.input, rows: c.input.rows }, true), 'y ~ (A+B+C+D)^4'), /no residual degrees of freedom/);
  throws('unknown method', () => reduceModel(s, 'y ~ A', { method: 'bic' }), /method must be/);
}
done();
