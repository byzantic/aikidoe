// Where the runs sit (issue #88): the runs in coded units, the scaled prediction variance of a
// design for a model and the variance dispersion graph, against base R (tests/ref/space_r.R:
// model.matrix and (FᵀF)⁻¹ at given points, R's treatment contrasts for a categorical factor);
// against rsm.js's predictionVariance for the quadratic; slices, constraints and the SVG plots.
import { readFileSync } from 'node:fs';
import { section, check, near, throws, done } from './lib/check.mjs';
import { codedRuns, spvFunction, spvSlice, vdg, feasibleSlice } from '../js/design/space.js';
import { ccd, predictionVariance, varianceProfile } from '../js/design/rsm.js';
import { toStudyDesign } from '../js/design/factorial.js';
import { createStudy } from '../js/study.js';
import { fractionalFactorial } from '../js/design/factorial.js';
import { foldover, axialPoints, appendStage } from '../js/design/augment.js';
import { pairsSVG, contourSVG, vdgSVG, standalone, viridis } from '../js/io/svg-space.js';

const F = JSON.parse(readFileSync(new URL('./fixtures/space-r.json', import.meta.url), 'utf8'));
// G is the categorical factor (level indices 0, 1, 2 in the input); the others are continuous, coded −1 … +1
const studyOf = (ids) => createStudy({ name: 's', seed: 1, factors: ids.map(id => (id === 'G' ? { id, type: 'categorical', levels: ['a', 'b', 'c'] } : { id, low: -1, high: 1 })), responses: [{ id: 'y' }] });

section('scaled prediction variance against base R');
for (const c of F.cases) {
  const X = c.input.design, st = studyOf(c.input.factors);
  const { v } = spvFunction(st, X, c.input.model);
  near(`${c.name}: at ${c.input.points.length} points`, c.input.points.map(v), c.output.spv, { rel: 1e-9 });
  if (c.output.vdg) {
    const g = vdg(st, X, c.input.model, { radii: c.input.radii, directions: c.input.directions }).curves;
    near(`${c.name}: the variance dispersion graph (min, mean, max at ${c.input.radii.length} radii)`, g.flatMap(x => [x.min, x.mean, x.max]), c.output.vdg.flatMap(x => [x.min, x.mean, x.max]), { rel: 1e-9 });
  }
}

section('the study\'s runs, slices, constraints');
{
  const s0 = createStudy({ name: 'c', seed: 1, factors: ['A', 'B', 'C'].map(id => ({ id, low: 10, high: 20 })), responses: [{ id: 'y' }] });
  const d = ccd(3, { centre: 4 }), st = createStudy({ ...s0, design: toStudyDesign(s0, d, { seed: 1 }) });
  const cr = codedRuns(st), X = cr.runs.map(r => r.x);
  check('codedRuns: 18 runs, the kinds of a CCD, the 4 centre runs counted as one point ×4', cr.runs.length === 18 && JSON.stringify([...new Set(cr.runs.map(r => r.kind))]) === '["factorial","centre","axial"]' && cr.runs.filter(r => r.kind === 'centre').every(r => r.count === 4));
  near('the quadratic: as rsm.js\'s predictionVariance', [[0, 0, 0], [1, 0, 0], [0.4, -0.8, 1.1]].map(spvFunction(st, X, 'quadratic').v), [[0, 0, 0], [1, 0, 0], [0.4, -0.8, 1.1]].map(predictionVariance(d.X)), { rel: 1e-12 });
  near('the VDG: as varianceProfile', vdg(st, X, 'quadratic', { radii: [0, 1, 1.5] }).curves.map(c => c.max), varianceProfile(d.X, { radii: [0, 1, 1.5] }).map(c => c.max), { rel: 1e-12 });
  const sl = spvSlice(st, X, 'quadratic', { x: 'A', y: 'C', n: 11, at: { B: 0.5 } });
  check('a slice: 11 × 11 over A and C out to the axial points, B held at 0.5; each value v at that point', sl.xs.length === 11 && Math.abs(sl.xs[10] - d.params.alpha) < 1e-12
    && Math.abs(sl.z[3][7] - spvFunction(st, X, 'quadratic').v([sl.xs[7], 0.5, sl.ys[3]])) < 1e-12 && sl.min <= sl.max);
  throws('a slice needs two different continuous factors', () => spvSlice(st, X, 'quadratic', { x: 'A', y: 'A' }), /different/);
  throws('a model the design cannot estimate', () => spvFunction(st, X.slice(0, 8), 'quadratic'), /not estimable/);
  const cs = createStudy({ ...st, constraints: [{ expr: 'A + B <= 35' }] });
  const fs = feasibleSlice(cs, { x: 'A', y: 'B', n: 5 });
  check('constraints over a slice: A + B ≤ 35 (coded A + B ≤ 1)', fs.ok[4][4] === false && fs.ok[0][0] === true && fs.ok[2][2] === true && feasibleSlice(st, { x: 'A', y: 'B' }) === null);
}

section('the pictures: every run drawn, after augmentation too; contour values are the variance');
{
  // runs named in a panel's marks (each mark's title lists its runs)
  const runsIn = (svg, pair) => { const g = svg.slice(svg.indexOf(`data-pair="${pair}"`)); const p = g.slice(0, g.indexOf('</g>'));
    return [...p.matchAll(/runs? ([\d, ]+):/g)].flatMap(m => m[1].split(',').map(x => Number(x.trim()))).sort((a, b) => a - b); };
  const s0 = createStudy({ name: 'f', seed: 1, factors: ['A', 'B', 'C', 'D'].map(id => ({ id, low: 0, high: 10 })), responses: [{ id: 'y' }] });
  let st = createStudy({ ...s0, design: toStudyDesign(s0, fractionalFactorial(4, { runs: 8 }), { seed: 1 }) });
  const svg0 = pairsSVG(codedRuns(st));
  check('a 2^(4−1): 8 runs, each drawn in every panel (6 panels)', ['A:B', 'A:C', 'A:D', 'B:C', 'B:D', 'C:D'].every(pr => JSON.stringify(runsIn(svg0, pr)) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8])));
  st = appendStage(st, foldover(st), { seed: 2 });
  st = appendStage(st, axialPoints(st, { centre: 2 }), { seed: 3 });
  const sp = codedRuns(st), svg1 = pairsSVG(sp, { group: 'block' });
  check(`after a fold-over and axial points: all ${st.design.runs.length} runs in each panel, the kinds told apart, blocks coloured`,
    runsIn(svg1, 'A:B').length === st.design.runs.length && runsIn(svg1, 'C:D').length === st.design.runs.length && /axial run/.test(svg1) && /centre run/.test(svg1) && /blocks:/.test(svg1), `${runsIn(svg1, 'A:B').length} of ${st.design.runs.length}`);
  const X = sp.runs.map(r => r.x), sl = spvSlice(st, X, 'main', { x: 'A', y: 'B', n: 9 });
  const c = contourSVG({ ...sl, runs: sp.runs.map(r => ({ x: r.x[0], y: r.x[1] })), valueLabel: 'v' });
  check('the contour: one cell per grid point, filled by viridis of the value', (c.match(/<rect x=/g) ?? []).length >= 81 && c.includes(viridis(1)) && c.includes(viridis(0)));
  check('its runs: each run inside the slice drawn', (c.match(/class="run"/g) ?? []).length === sp.runs.filter(r => Math.abs(r.x[0]) <= sl.xs[8] + 1e-9 && Math.abs(r.x[1]) <= sl.ys[8] + 1e-9).length);
  check('standalone files carry the SVG namespace', standalone(vdgSVG([{ radius: 0, min: 1, mean: 1, max: 1 }, { radius: 1, min: 2, mean: 3, max: 4 }])).includes('xmlns="http://www.w3.org/2000/svg"'));
}

done();
