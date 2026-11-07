// Formulas, OLS, ANOVA, diagnostics, Box–Cox (issue #6) against R lm / anova / car::Anova /
// MASS::boxcox (fixture ols-r); formula parsing and hierarchy; Lenth.
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture, listFixtures } from './lib/fixtures.mjs';
import { createStudy } from '../js/study.js';
import { parseFormula, modelMatrix, hierarchyViolations } from '../js/model/formula.js';
import { fitModel, anova } from '../js/model/fit.js';
import { fitOLS, lackOfFit, boxCox, lenth, halfNormal, twoLevelEffects } from '../js/model/ols.js';

const TOL = { rel: 1e-8, abs: 1e-10 };
const nn = (v) => (Array.isArray(v) ? v.map(nn) : v === null ? NaN : v);

const studyFor = (factors) => createStudy({ aikidoe: 1, seed: 1, factors: factors.map(f => ({ ...f })), responses: [{ id: 'y' }] });
const anovaRows = (rows) => rows.map(r => ({ term: r.term, df: r.df, ss: r.ss, F: r.F ?? NaN, p: r.p ?? NaN }));

section('OLS and ANOVA vs R (12 datasets)');
for (const c of loadFixture('ols-r').cases) {
  const { factors, rows, y, formula } = c.input, o = c.output;
  const study = studyFor(factors);
  const model = parseFormula(formula, study.factors);
  const mm = modelMatrix(model, study.factors, rows);
  const fit = fitOLS(mm, y);
  const n = c.name;
  check(`${n}: rank ${o.rank}, residual df ${o.dfRes}`, fit.rank === o.rank && fit.dfRes === o.dfRes);
  check(`${n}: ${o.columns.length} columns`, fit.columns.length === o.columns.length, fit.columns.join(' '));
  near(`${n}: coefficients`, fit.coef, nn(o.coef), TOL);
  near(`${n}: standard errors, t, p`, [fit.se, fit.t, fit.p], [nn(o.se), nn(o.t), nn(o.p)], TOL);
  near(`${n}: σ, R², adjusted R², PRESS`, [fit.sigma, fit.r2, fit.adjR2, fit.press], [o.sigma, o.r2, o.adjR2, nn(o.press)], TOL);
  near(`${n}: fitted, residuals, leverage`, [fit.fitted, fit.residuals, fit.leverage], [o.fitted, o.residuals, o.leverage], TOL);
  near(`${n}: standardised and studentised residuals, Cook's D`, [fit.rstandard, fit.rstudent, fit.cooks], [nn(o.rstandard), nn(o.rstudent), nn(o.cooks)], TOL);
  for (const t of [1, 2, 3]) {
    const ref = o[`anova${t}`];
    if (!ref) continue;
    const ours = anovaRows(anova(fit, t));
    // car's tables list the residual line last, as ours does; R's sequential table too
    check(`${n}: ANOVA type ${t} terms`, JSON.stringify(ours.map(r => r.term)) === JSON.stringify(ref.map(r => r.term)),
      `ours ${ours.map(r => r.term)}, R ${ref.map(r => r.term)}`);
    near(`${n}: ANOVA type ${t}`, ours, anovaRows(ref).map(r => ({ ...r, F: nn(r.F), p: nn(r.p) })), TOL);
  }
  if (o.pureError) {
    const keys = rows.map(r => JSON.stringify(Object.entries(r).sort()));
    const l = lackOfFit({ ...fit, rows: rows.map(s => ({ settings: s })) }, keys);
    near(`${n}: pure error`, l.pureError, o.pureError, TOL);
    if (o.lackOfFit) near(`${n}: lack of fit`, l.lackOfFit, o.lackOfFit, TOL);
    else check(`${n}: no lack-of-fit df`, !l.lackOfFit);
  }
  if (o.boxcox) {
    const b = boxCox(fit, o.boxcox.lambda);
    near(`${n}: Box–Cox log-likelihood on the grid`, b.loglik, o.boxcox.loglik, TOL);
    const i = o.boxcox.loglik.indexOf(Math.max(...o.boxcox.loglik));
    check(`${n}: Box–Cox λ̂ = ${b.best.toFixed(3)} within a grid step of R's grid maximum`, Math.abs(b.best - o.boxcox.lambda[i]) <= 0.1 + 1e-9);
    check(`${n}: Box–Cox CI contains λ̂`, b.ci[0] <= b.best && b.best <= b.ci[1]);
  }
}

section('formula parsing');
{
  const s = studyFor([{ id: 'A', low: -1, high: 1 }, { id: 'B', low: -1, high: 1 }, { id: 'C', low: -1, high: 1 }, { id: 'g', levels: ['x', 'y', 'z'] }]);
  const labels = (f) => parseFormula(f, s.factors).terms.map(t => t.label).join(' + ');
  check('A*B = A + B + A:B', labels('y ~ A*B') === 'A + B + A:B');
  check('(A+B+C)^2', labels('(A+B+C)^2') === 'A + B + C + A:B + A:C + B:C');
  check('(A+B+C)^3 includes A:B:C', labels('(A+B+C)^3').endsWith('A:B:C'));
  check('terms ordered by degree, order of appearance kept', labels('A:B + C + I(A^2) + A') === 'C + I(A^2) + A + A:B');
  check('removing a term', labels('A*B*C - A:B:C') === 'A + B + C + A:B + A:C + B:C');
  check('main', labels('main') === 'A + B + C + g');
  check('2fi', labels('2fi').split(' + ').length === 4 + 6);
  check('quadratic: squares of continuous factors only', labels('quadratic').includes('I(A^2)') && !labels('quadratic').includes('I(g^2)') && labels('quadratic').split(' + ').length === 4 + 6 + 3);
  check('A:A = A, duplicates dropped', labels('A + A:A + A') === 'A');
  check('I(A) is A; I(A*B) is one variable', labels('I(A) + I(A*B)') === 'A + I(A*B)');
  check('interaction labels follow study factor order', labels('B:A') === 'A:B');
  const m = parseFormula('y ~ A - 1', s.factors);
  check('-1 removes the intercept, response parsed', !m.intercept && m.response === 'y');
  check('+0 removes the intercept too', !parseFormula('A + 0', s.factors).intercept);
  throws('unknown factor', () => parseFormula('A + Q', s.factors), /unknown factor "Q"/);
  throws('categorical inside I()', () => parseFormula('I(g^2)', s.factors), /categorical factor "g"/);
  throws('bad power', () => parseFormula('(A+B)^0', s.factors), /positive integer/);
  throws('unbalanced parentheses', () => parseFormula('(A + B', s.factors), /expected "\)"/);
  const mm = modelMatrix(parseFormula('g*A', s.factors), s.factors, [{ A: 0.5, B: 0, C: 0, g: 'z' }]);
  check('categorical × continuous columns: names (study factor order) and values', JSON.stringify(mm.columns) === '["(Intercept)","g[y]","g[z]","A","A:g[y]","A:g[z]"]'
    && JSON.stringify(mm.X[0]) === '[1,0,1,0.5,0,0.5]');
}

section('hierarchy');
{
  const s = studyFor([{ id: 'A', low: -1, high: 1 }, { id: 'B', low: -1, high: 1 }]);
  const v = (f) => hierarchyViolations(parseFormula(f, s.factors));
  check('A + A:B: B missing', JSON.stringify(v('A + A:B')) === '[{"term":"A:B","missing":["B"]}]');
  check('I(A^2) alone: A missing', JSON.stringify(v('I(A^2)')) === '[{"term":"I(A^2)","missing":["A"]}]');
  check('full quadratic is hierarchical', v('quadratic').length === 0);
  check('I(A^3) needs I(A^2)', v('A + I(A^3)')[0].missing.includes('I(A^2)'));
}

section('Lenth and half-normal');
{
  // effects of the drill advance 2^4 (log scale removes the interactions); checked against a
  // hand calculation of Lenth's rule here, and against BsMD when its fixture is present
  const c = loadFixture('ols-r').cases.find(x => x.name.startsWith('drill advance'));
  const s = studyFor(c.input.factors);
  const fit = fitOLS(modelMatrix(parseFormula('(A+B+C+D)^4', s.factors), s.factors, c.input.rows), c.input.y.map(Math.log10));
  const eff = twoLevelEffects(fit);
  check('saturated 2^4: 15 effects', eff.length === 15 && fit.dfRes === 0);
  const L = lenth(eff.map(e => e.effect));
  // by hand: s0 = 1.5 · median|c|; PSE = 1.5 · median of |c| below 2.5 s0
  const a = eff.map(e => Math.abs(e.effect)).sort((x, y) => x - y);
  const s0 = 1.5 * a[7], keep = a.filter(x => x < 2.5 * s0);
  const med = keep.length % 2 ? keep[(keep.length - 1) / 2] : (keep[keep.length / 2 - 1] + keep[keep.length / 2]) / 2;
  near('Lenth s0 and PSE by hand', [L.s0, L.pse], [s0, 1.5 * med], { rel: 1e-14 });
  check('Lenth d = m/3 = 5', L.df === 5);
  check('drill advance (log): B, C, D active by ME', JSON.stringify(eff.filter((e, i) => L.active[i]).map(e => e.name)) === '["B","C","D"]',
    eff.filter((e, i) => L.active[i]).map(e => e.name).join());
  const h = halfNormal([3, -1, 2]);
  check('half-normal: sorted |effects|, quantiles of (i − ½)/m', JSON.stringify(h.map(x => x.abs)) === '[1,2,3]' && Math.abs(h[0].q - 0.21042839424792484) < 1e-12);
  if (listFixtures().includes('lenth-bsmd')) {
    for (const lc of loadFixture('lenth-bsmd').cases) {
      const r = lenth(lc.input.effects);
      near(`${lc.name}: PSE, ME, SME vs BsMD::LenthPlot`, [r.pse, r.me, r.sme], [lc.output.pse, lc.output.me, lc.output.sme], { rel: 1e-8 });
    }
  } else check('lenth-bsmd fixture present', false, 'run the fixtures workflow (BsMD is installed there)');
}

section('fitModel on a study');
{
  const study = createStudy({ aikidoe: 1, seed: 1, factors: [{ id: 'A', low: 10, high: 20 }, { id: 'B', low: 0, high: 1 }], responses: [{ id: 'y' }],
    design: { runs: [1, 2, 3, 4, 5].map((r, i) => ({ run: r, settings: { A: [10, 20, 10, 20, 15][i], B: [0, 0, 1, 1, 0.5][i] } })) },
    observations: [
      { run: 1, response: 'y', value: 1 }, { run: 1, response: 'y', value: 3 }, { run: 2, response: 'y', value: 5 },
      { run: 3, response: 'y', value: 2 }, { run: 4, response: 'y', value: 7 }, { run: 5, response: 'y', value: null }] });
  const f = fitModel(study, 'y ~ A + B');
  check('per-run means, missing values dropped', f.n === 4 && f.rows[0].y === 2 && f.rows[0].n === 2);
  // run means 2, 5, 2, 7 on a 2² in coded units: β0 = 4, βA = (−2 + 5 − 2 + 7)/4 = 2, βB = 0.5
  near('coded units: coefficient = half the effect of a factor across its range', f.coef, [4, 2, 0.5], { rel: 1e-12 });
  throws('response must exist', () => fitModel(study, 'z ~ A'), /no response "z"/);
}
done();
