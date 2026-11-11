// Covariates at the design stage (issue #82, phase 3): power with a covariate against the exact
// non-central F and a simulation of the analysis (fixture covariate-design-r,
// tests/ref/covariate_design_r.R); the balance of covariate values against a design (R² and the
// variance inflation, as lm and solve); allocating units to runs; optimising at a covariate value.
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import { createStudy } from '../js/study.js';
import { parseFormula, modelMatrix } from '../js/model/formula.js';
import { powerFromMatrix, designPower } from '../js/model/power.js';
import { allocate, balanceOf, applyAllocation } from '../js/design/allocate.js';
import { fullFactorial, toStudyDesign } from '../js/design/factorial.js';
import { fittedModels, optimiseDesirability } from '../js/model/desirability.js';
import { EXAMPLES } from '../ui/examples.js';

const F = loadFixture('covariate-design-r');
const studyOf = (c) => {
  const k = c.input.design[0].length, ids = 'ABCD'.slice(0, k).split('');
  return createStudy({ name: c.name, seed: 1, factors: ids.map(id => ({ id, low: -1, high: 1 })), responses: [{ id: 'y' }],
    design: { runs: c.input.design.map((r, i) => ({ run: i + 1, settings: Object.fromEntries(ids.map((id, j) => [id, r[j]])) })) } });
};

section('power with a covariate: σ√(1 − ρ²) and one df fewer');
for (const c of F.cases.filter(x => x.output.power)) {
  const st = studyOf(c), mm = modelMatrix(parseFormula(c.input.model, st.factors), st.factors, st.design.runs.map(r => r.settings));
  const p = powerFromMatrix(mm, { delta: c.input.delta, sigma: c.input.sigma, rho: c.input.rho });
  const pw = c.output.columns.map(col => p.parameters.find(q => q.name === col).power);
  near(`${c.name}: the exact power of each coefficient (non-central F, as R's pf)`, [p.dfRes, ...pw], [c.output.dfRes, ...c.output.power], { rel: 1e-8, abs: 1e-12 });   // R's non-central F is good to ~1e-9
  // the simulated power of lm with the covariate, 4000 runs: within 3 binomial standard errors
  const ok = c.output.simulated.every((s, i) => Math.abs(s - pw[i]) < 3 * Math.sqrt(pw[i] * (1 - pw[i]) / c.output.nsim) + 1e-9);
  check(`${c.name}: … and it is the power of the analysis with the covariate (a simulation of lm)`, ok, `${pw} vs ${c.output.simulated}`);
  check(`${c.name}: σ kept, the residual σ reported`, p.sigma === c.input.sigma && Math.abs(p.sigmaResidual - c.input.sigma * Math.sqrt(1 - c.input.rho ** 2)) < 1e-15 && p.covariates === 1);
}
{
  const c = F.cases[0], st = studyOf(c), mm = modelMatrix(parseFormula('A + B + C', st.factors), st.factors, st.design.runs.map(r => r.settings));
  const base = powerFromMatrix(mm, { delta: 2, sigma: 1.5 }), zero = powerFromMatrix(mm, { delta: 2, sigma: 1.5, rho: 0 });
  check('ρ = 0: as without a covariate', JSON.stringify(base.terms) === JSON.stringify(zero.terms) && base.dfRes === 4);
  check('a weakly correlated covariate costs power in a small design (a residual df spent)', powerFromMatrix(mm, { delta: 2, sigma: 1.5, rho: 0.1 }).terms[0].power < base.terms[0].power);
  throws('ρ outside (−1, 1)', () => powerFromMatrix(mm, { rho: 1 }), /between −1 and 1/);
  throws('a covariate with a split-plot design', () => powerFromMatrix(mm, { rho: 0.5, wholePlot: mm.X.map((_, i) => String(i % 4)) }), /split-plot/);
}

section('balance of covariate values against a design, as lm and solve');
for (const c of F.cases.filter(x => x.output.r2 !== undefined)) {
  const b = balanceOf(studyOf(c), c.input.values, { model: c.input.model });
  near(`${c.name}: R², and each coefficient's variance inflation with the covariate added`, [b.r2, ...c.output.columns.map(col => b.vif.find(v => v.column === col).vif)], [c.output.r2, ...c.output.vif], { rel: 1e-9 });
}

section('allocating units to runs');
{
  const s0 = createStudy({ name: 'a', seed: 82, factors: [{ id: 'A', low: -1, high: 1 }, { id: 'B', low: -1, high: 1 }, { id: 'C', low: -1, high: 1 }], responses: [{ id: 'y' }], covariates: [{ id: 'w', units: 'g' }] });
  const st = createStudy({ ...s0, design: toStudyDesign(s0, fullFactorial([2, 2, 2], { replicates: 2 }), { seed: 82 }) });
  const units = Array.from({ length: 18 }, (_, i) => ({ unit: `M${i + 1}`, value: 20 + ((i * 7) % 11) + (i % 3) * 0.4 }));
  const a = allocate(st, units, { model: '2fi' });
  check('every run gets its own unit, two left over', a.assignment.length === 16 && new Set(a.assignment.map(x => x.unit)).size === 16 && a.unused.length === 2 && a.assignment.every(x => !a.unused.some(u => u.unit === x.unit)));
  check('balanced: R² far below a random allocation\'s (and its expected value), every inflation near 1', a.r2 < 0.01 && a.random > 0.05 && a.expected === 6 / 15 && a.vif.every(v => v.vif < 1.02), JSON.stringify([a.r2, a.random]));
  near('… R² as balanceOf computes it for the values allocated', balanceOf(st, a.assignment.map(x => x.value), { model: '2fi' }).r2, a.r2, { rel: 1e-12 });
  check('… the same with the same seed', JSON.stringify(allocate(st, units, { model: '2fi' }).assignment) === JSON.stringify(a.assignment));
  const s2 = createStudy(applyAllocation(st, 'w', a, units));
  check('applied: the covariate\'s values, each with its unit', s2.covariates[0].values.length === 16 && s2.covariates[0].values.every(v => a.assignment.some(x => x.run === v.run && x.unit === v.unit && x.value === v.value)));
  throws('fewer units than runs', () => allocate(st, units.slice(0, 10)), /10 units for 16 runs/);
  throws('repeated labels', () => allocate(st, units.map(u => ({ ...u, unit: 'x' }))), /labels must differ/);
  // order mode: values for the positions in the run order (a forecast); the runs are rearranged
  const slots = Array.from({ length: 16 }, (_, i) => ({ unit: String(i + 1), value: 18 + 0.5 * i + (i % 4) }));
  const o = allocate(st, slots, { order: true, model: 'main' });
  const s3 = createStudy(applyAllocation(st, 'w', o, slots));
  const byOrder = s3.design.runs.slice().sort((x, y) => x.order - y.order);
  check('order mode: each run moved to a position, and given that position\'s value', new Set(s3.design.runs.map(r => r.order)).size === 16
    && byOrder.every((r, i) => s3.covariates[0].values.find(v => v.run === r.run).value === slots[i].value) && o.r2 < 0.01);
  const wp = createStudy({ ...st, design: { ...st.design, runs: st.design.runs.map((r, i) => ({ ...r, wholePlot: Math.floor(i / 2) + 1 })) } });
  throws('order mode with whole plots', () => allocate(wp, slots, { order: true }), /whole plots/);
}

section('optimising at a value of the covariate');
{
  const st = EXAMPLES.find(e => e.id === 'titre-covariate').build();
  const { models } = fittedModels(st, { formulas: { titre: 'titre ~ temp*feed + pH + vcd' } });
  const atMean = optimiseDesirability(st, models, { seed: 1 }), low = optimiseDesirability(st, models, { seed: 1, fixed: { vcd: 0.35 } });
  check('held at a low seed density: the same best settings, a lower predicted titre, the value reported', JSON.stringify(low.settings) === JSON.stringify(atMean.settings) && low.d[0].y < atMean.d[0].y - 0.3 && low.held.vcd === 0.35 && atMean.held === undefined);
  near('… the prediction is the model\'s at that value', low.d[0].y, models[0].predict({ ...low.settings, vcd: 0.35 }), { rel: 1e-12 });
  throws('an id that is neither a factor nor a covariate', () => optimiseDesirability(st, models, { fixed: { zz: 1 } }), /no factor or covariate "zz"/);
}

done();
