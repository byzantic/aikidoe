// REML mixed models (issue #15). Reference: fixture reml-r (lme4 lmer, pbkrtest vcovAdj and
// KRmodcomp) on 10 balanced and unbalanced split-plot and nested data sets.
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import { reml, fitMixedModel, randomEffects, observationTable } from '../js/model/mixed.js';
import { parseFormula, modelMatrix } from '../js/model/formula.js';
import { createStudy } from '../js/study.js';
import { fitModel } from '../js/model/ols.js';

const cases = loadFixture('reml-r').cases;
const fitCase = (c) => {
  const factors = c.input.factors.map(x => (x.levels ? { id: x.id, type: 'categorical', levels: x.levels } : { id: x.id, type: 'continuous', low: -1, high: 1 }));
  const model = parseFormula(c.input.formula, factors), m = modelMatrix(model, factors, c.input.rows);
  return reml(m.X, c.input.rows.map(r => r.y), c.input.groups.map(g => ({ name: g, labels: c.input.rows.map(r => r[g]) })), { columns: m.columns, assign: m.assign, terms: model.terms });
};
// lme4's optimiser stops at about 1e−6 relative in the variance parameters; KR df agree far closer
const EST = { rel: 1e-5, abs: 1e-8 };

section('REML vs lme4 and Kenward–Roger vs pbkrtest');
for (const c of cases) {
  const r = fitCase(c), o = c.output;
  check(`${c.name}: converged`, r.converged);
  near(`${c.name}: fixed effects`, r.coef, o.coef, EST);
  const vc = Object.fromEntries(r.varcomp.map(v => [v.name, v.variance]));
  near(`${c.name}: variance components`, Object.keys(o.varcomp).map(k => vc[k]), Object.values(o.varcomp), EST);
  near(`${c.name}: REML criterion`, r.REML, o.REML, { rel: 1e-8 });
  near(`${c.name}: model-based covariance of β`, r.vcov, o.vcov, EST);
  near(`${c.name}: KR-adjusted covariance Φ_A (vcovAdj)`, r.vcovKR, o.vcovKR, EST);
  // pbkrtest orders W as VarCorr does, residual last
  const order = Object.keys(o.varcomp).map(k => (k === 'Residual' ? r.varcomp.length - 1 : r.varcomp.findIndex(v => v.name === k)));
  near(`${c.name}: asymptotic covariance W of the variance components`, order.map(i => order.map(j => r.W[i][j])), o.W, EST);
  near(`${c.name}: KR denominator df to 1e−3`, r.terms.map(t => t.ddfKR), o.kr.map(k => k.ddf), { abs: 1e-3 });
  near(`${c.name}: KR F scaling and F`, r.terms.map(t => [t.scaling, t.FKR]), o.kr.map(k => [k.Fscaling, k.F]), EST);
  check(`${c.name}: boundary reported as such`, o.singular === (r.boundary.length > 0), r.boundary.join());
}

section('containment df');
{
  // balanced split-plot: whole-plot terms in the whole-plot stratum (8 − 1 − 3 = 4), subplot
  // terms in the residual stratum (32 − 8 − 7 = 17); KR equals containment here
  const r = fitCase(cases[0]);
  check('balanced split-plot: strata', JSON.stringify(r.strata) === JSON.stringify([{ name: 'wp', df: 4 }, { name: 'Residual', df: 17 }]), JSON.stringify(r.strata));
  near('… and KR df = containment df', r.terms.map(t => t.ddfKR), r.terms.map(t => t.ddfContainment), { abs: 1e-8 });
  check('A:B is a whole-plot term, A:C a subplot term', r.terms.find(t => t.term === 'A:B').stratum === 'wp' && r.terms.find(t => t.term === 'A:C').stratum === 'Residual');
  const n = fitCase(cases[3]);
  check('nested runs / wafers / sites: run stratum 16 − 1 − 6 = 9, wafer 16, site 128', JSON.stringify(n.strata.map(s => s.df)) === '[9,16,128]', JSON.stringify(n.strata));
}

section('variance component intervals');
{
  const r = fitCase(cases[0]);
  const v = r.varcomp[0];
  check('Satterthwaite interval contains the estimate; df = 2σ⁴/W', v.lower < v.variance && v.variance < v.upper && Math.abs(v.df - 2 * v.variance ** 2 / r.W[0][0]) < 1e-12);
  const b = fitCase(cases[6]);
  check('boundary component: estimate 0, lower 0, no upper', b.varcomp[0].variance === 0 && b.varcomp[0].lower === 0 && Number.isNaN(b.varcomp[0].upper) && b.boundary[0] === 'wp');
}

section('from a study: random effects chosen automatically');
{
  // case 6 as a study: whole plots, runs, two wafers per run (one reading each)
  const c = cases[5];
  const ids = ['A', 'B', 'C', 'D'];
  const runs = new Map();
  c.input.rows.forEach(r => { if (!runs.has(r.run)) runs.set(r.run, { run: Number(r.run), wholePlot: Number(r.wp), settings: Object.fromEntries(ids.map(k => [k, r[k]])) }); });
  const runList = [...runs.values()].sort((a, b) => a.run - b.run).map((r, i) => ({ ...r, order: i + 1 }));
  const seen = new Map();
  const obs = c.input.rows.map(r => { const k = (seen.get(r.run) ?? 0) + 1; seen.set(r.run, k); return { run: Number(r.run), wafer: `W${k}`, response: 'y', value: r.y }; });
  const s = createStudy({ aikidoe: 1, seed: 1, factors: ids.map(id => ({ id, low: -1, high: 1, htc: id === 'A' || id === 'B' })), responses: [{ id: 'y' }], design: { kind: 'split-plot', randomisation: 'restricted', runs: runList }, observations: obs });
  const rows = observationTable(s, 'y');
  check('observation table: one row per reading, with whole plot and wafer labels', rows.length === 64 && rows.every(r => r.wholePlot && r.wafer));
  check('auto: whole plot and run (each wafer has one reading, so wafer is the residual)', randomEffects(rows).map(r => r.id).join() === 'wholePlot,run');
  const f = fitMixedModel(s, c.input.formula);
  const vc = Object.fromEntries(f.varcomp.map(v => [v.name, v.variance]));
  near('same fit as the reference', [f.coef, vc['Whole plot'], vc.Run, vc.Residual], [c.output.coef, c.output.varcomp.wp, c.output.varcomp.run, c.output.varcomp.Residual], EST);
  check('naive least squares on the same readings gives whole-plot tests far too many df', f.terms[0].naiveDf === 64 - 6 && f.terms[0].ddfKR < 6);
  check('explicit random effects', fitMixedModel(s, c.input.formula, { random: ['wholePlot'] }).random.map(r => r.id).join() === 'wholePlot');
  throws('a random effect that is the residual', () => fitMixedModel(s, c.input.formula, { random: ['wholePlot', 'run', 'wafer'] }), /wafer: one observation per group/);
  throws('unknown random effect', () => fitMixedModel(s, c.input.formula, { random: ['operator'] }), /unknown random effect/);
  // with per-run means the whole-plot error is still needed, so the mixed model is the analysis
  check('the least-squares fit of run means has 32 runs', fitModel(s, c.input.formula).n === 32);
}
done();
