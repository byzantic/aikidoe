// The fitted response over the factor space (issue #88, phase 2): the canonical analysis of a
// second-order fit against base R (tests/ref/surface_r.R: lm, solve, eigen; the same quantities as
// rsm::canonical), slices equal to predict at the same points, for least squares, GLMs and GLMMs,
// and the runs on a slice.
import { readFileSync } from 'node:fs';
import { section, check, near, throws, done } from './lib/check.mjs';
import { responseSlice, stationaryPoint, runsOnSlice, predictorOf, canonicalAxesOn } from '../js/model/surface.js';
import { createStudy } from '../js/study.js';
import { fitModel, predict } from '../js/model/fit.js';
import { fitCountMixedModel, predictCountMixed } from '../js/model/glmm.js';
import { toStudyDesign } from '../js/design/factorial.js';
import { splitPlotFull } from '../js/design/splitplot.js';
import { runVirtual } from '../js/learn/process.js';
import { contourSVG } from '../js/io/svg-space.js';

const F = JSON.parse(readFileSync(new URL('./fixtures/surface-r.json', import.meta.url), 'utf8'));
const studyOf = (c) => {
  const ids = Object.keys(c.input.rows[0]).filter(k => k !== 'y');
  const factors = ids.map(id => (id === 'G' ? { id, type: 'categorical', levels: c.input.levels } : { id, low: -1, high: 1 }));
  const runs = c.input.rows.map((r, i) => ({ run: i + 1, settings: Object.fromEntries(ids.map(id => [id, r[id]])) }));
  return createStudy({ aikidoe: 1, seed: 1, factors, responses: [{ id: 'y' }], design: { runs }, observations: c.input.rows.map((r, i) => ({ run: i + 1, response: 'y', value: r.y })) });
};

section('the stationary point and canonical analysis against base R');
for (const c of F.cases) {
  const st = studyOf(c), fit = fitModel(st, c.input.formula), sp = stationaryPoint(st, fit), o = c.output;
  check(`${c.name}: found, over ${c.input.factors.join(', ')}`, sp && JSON.stringify(sp.factors) === JSON.stringify(c.input.factors));
  near(`${c.name}: x_s = −½B⁻¹b (coded), the fitted value there, the eigenvalues`, [...c.input.factors.map(id => sp.x[id]), sp.value, ...sp.eigen.map(e => e.value)], [...o.xs, o.value, ...o.eigenvalues], { rel: 1e-9, abs: 1e-12 });
  // eigenvectors up to sign
  check(`${c.name}: the canonical axes (eigenvectors, up to sign)`, sp.eigen.every((e, m) => { const r = o.vectors[m], s = Math.sign(e.vector.reduce((t, v, i) => t + v * r[i], 0)); return e.vector.every((v, i) => Math.abs(s * v - r[i]) < 1e-9); }));
  const kind = o.eigenvalues.every(v => v < 0) ? 'maximum' : o.eigenvalues.every(v => v > 0) ? 'minimum' : 'saddle';
  check(`${c.name}: a ${kind}`, sp.kind === kind);
  if (c.input.slice) near(`${c.name}: fitted values on a slice, as predict.lm`, predictorOf(fit)(c.input.slice), o.slice, { rel: 1e-10 });
}
{
  const c = F.cases[1], st = studyOf(c), sp = stationaryPoint(st, fitModel(st, c.input.formula));
  const ax = canonicalAxesOn(sp, 'A', 'B');
  check('canonical axes on a slice: at most the two lying most in it, through the stationary point', ax.length >= 1 && ax.length <= 2 && ax.every(t => t.x === sp.x.A && t.y === sp.x.B && Math.hypot(t.dx, t.dy) > 0.3) && canonicalAxesOn(sp, 'A', 'Z').length === 0);
}
{
  const st = studyOf(F.cases[0]);
  check('no squares in the model: no stationary point', stationaryPoint(st, fitModel(st, 'y ~ A * B')) === null);
}

section('slices: the grid is predict at the same points');
{
  const c = F.cases[1], st = studyOf(c), fit = fitModel(st, c.input.formula);
  const sl = responseSlice(st, fit, { x: 'A', y: 'C', at: { B: 0.4 }, n: 7 });
  const pts = sl.ys.flatMap(yv => sl.xs.map(xv => ({ A: xv, B: 0.4, C: yv })));
  near('least squares: 7 × 7 values over A and C (B at 0.4), out to the axial points', sl.z.flat(), predict(fit, pts).map(p => p.fit), { rel: 1e-12 });
  check('… the grid runs to the axial points', Math.abs(sl.xs[6] - 8 ** 0.25) < 1e-12 && sl.min <= sl.max);
  const on = runsOnSlice(st, fit, { x: 'A', y: 'C', at: { B: 0.4 } });
  check('the runs on the slice: coded positions, distance in B, residuals', on.length === st.design.runs.length && on.every(r => Math.abs(r.residual - (r.observed - r.fitted)) < 1e-12) && Math.abs(on[0].distance - Math.abs(-1 - 0.4)) < 1e-12);
  throws('two different continuous factors', () => responseSlice(st, fit, { x: 'A', y: 'A' }), /different/);
  // the SVG: one cell per grid point, a run per run inside, the stationary point marked
  const svg = contourSVG({ ...sl, runs: on.map(r => ({ x: r.x, y: r.y, fade: r.distance / 2 })), best: { x: 0.3, y: -0.7 }, valueLabel: 'y' });
  check('the contour SVG: cells, runs and the stationary point', (svg.match(/<rect x=/g) ?? []).length >= 49 && (svg.match(/class="run"/g) ?? []).length === on.length && /class="best"/.test(svg));
}
{
  // counts: the GLM on the response scale, and the GLMM for a typical whole plot
  const s0 = createStudy({ name: 'n', seed: 3, factors: [{ id: 'T', low: 20, high: 30, htc: true }, { id: 'B', low: 0, high: 1 }], responses: [{ id: 'n', distribution: 'poisson' }] });
  const sd = createStudy({ ...s0, design: toStudyDesign(s0, splitPlotFull([2, 2], [true, false], { replicates: 6 }), { seed: 3 }) });
  const d = createStudy(runVirtual({ seed: 1, factors: s0.factors, responses: [{ id: 'n', distribution: 'poisson', truth: { intercept: Math.log(30), terms: { T: 0.2, B: -0.25 } } }], nuisance: { wholePlot: 0.4 } }, sd));
  const g = fitModel(d, 'n ~ T * B'), sg = responseSlice(d, g, { x: 'T', y: 'B', n: 3 });
  near('a GLM: counts on the response scale (exp of the linear predictor)', sg.z.flat(), predict(g, sg.ys.flatMap(yv => sg.xs.map(xv => ({ T: 25 + 5 * xv, B: 0.5 + 0.5 * yv })))).map(p => p.fit), { rel: 1e-12 });
  const m = fitCountMixedModel(d, 'n ~ T * B'), sm = responseSlice(d, m, { x: 'T', y: 'B', n: 3 });
  near('a GLMM: a typical whole plot', sm.z.flat(), predictCountMixed(m, sm.ys.flatMap(yv => sm.xs.map(xv => ({ T: 25 + 5 * xv, B: 0.5 + 0.5 * yv })))).map(p => p.fit), { rel: 1e-12 });
  check('predictorOf picks the GLMM\'s predictions', predictorOf(m) !== predictorOf(g));
}

done();
