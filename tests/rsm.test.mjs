// Response-surface designs (issue #9): CCD and Box–Behnken against R rsm (fixture rsm-rsm),
// α rules, rotatability, orthogonality, uniform-precision centre points (Box & Hunter 1957).
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import { ccd, boxBehnken, predictionVariance, varianceProfile, uniformPrecisionCentre, rotatableAlpha } from '../js/design/rsm.js';
import { toStudyDesign } from '../js/design/factorial.js';
import { createStudy } from '../js/study.js';
import { fitModel } from '../js/model/ols.js';

const key = (r) => r.map(v => (Math.abs(v) < 1e-12 ? 0 : v).toFixed(9)).join(',');
const multiset = (X) => X.map(key).sort().join(';');
// same rows in the same groups, whatever the block labels
const partition = (X, b) => { const g = new Map(); X.forEach((r, i) => { const l = b ? String(b[i]) : '1'; if (!g.has(l)) g.set(l, []); g.get(l).push(key(r)); }); return [...g.values()].map(v => v.sort().join(';')).sort().join(' | '); };

section('CCD and Box–Behnken vs R rsm');
for (const c of loadFixture('rsm-rsm').cases) {
  const i = c.input, o = c.output;
  if (o.error) { check(`${c.name}: reference generated`, false, o.error); continue; }
  let d;
  if (i.kind === 'ccd') {
    const opts = { alpha: i.alpha, inscribed: !!i.inscribed, ...(i.cubeGenerators ? { cubeGenerators: i.cubeGenerators } : {}) };
    if (i.oneblock) d = ccd(i.k, { ...opts, centre: i.n0[0] + i.n0[1] });
    else d = ccd(i.k, { ...opts, blocks: i.cubeBlocks ? i.cubeBlocks + 1 : true, centre: i.n0 });
    near(`${c.name}: α`, Math.max(...d.X.filter(r => r.filter(v => v !== 0).length === 1).flat().map(Math.abs)), o.alpha, { rel: 1e-12 });
  } else d = boxBehnken(i.k, { centre: i.n0, blocks: i.blocked });
  check(`${c.name}: ${o.X.length} runs`, d.X.length === o.X.length, `ours ${d.X.length}`);
  check(`${c.name}: same runs${o.block ? ' in the same blocks' : ''}`, o.block ? partition(d.X, d.block) === partition(o.X, o.block) : multiset(d.X) === multiset(o.X));
}

section('α rules');
{
  near('rotatable α = n_F^¼: k = 2, 3, 4', [2, 3, 4].map(k => ccd(k, { centre: 1 }).params.alpha), [Math.SQRT2, 8 ** 0.25, 2], { rel: 1e-14 });
  check('spherical √k, face-centred 1', Math.abs(ccd(3, { alpha: 'spherical' }).params.alpha - Math.sqrt(3)) < 1e-14 && ccd(3, { alpha: 'faces' }).params.alpha === 1);
  const f = ccd(3, { alpha: 'faces', centre: 2 });
  check('face-centred: three levels per factor', [0, 1, 2].every(j => new Set(f.X.map(r => r[j])).size === 3));
  const ins = ccd(3, { inscribed: true, centre: 2 });
  check('inscribed: axial points at ±1, cube at ±1/α', Math.max(...ins.X.flat().map(Math.abs)) === 1 && Math.abs(ins.params.cubeAt - 1 / rotatableAlpha(8)) < 1e-15);
  for (const k of [2, 3, 4]) {
    const d = ccd(k, { alpha: 'orthogonal', centre: 4 }), N = d.X.length;
    const cs = (j) => { const v = d.X.map(r => r[j] ** 2); const m = v.reduce((a, b) => a + b) / N; return v.map(x => x - m); };
    const a = cs(0), b = cs(1);
    check(`unblocked orthogonal, k = ${k}: centred squares uncorrelated (α = ${d.params.alpha.toFixed(4)})`, Math.abs(a.reduce((s, x, i) => s + x * b[i], 0)) < 1e-12);
  }
  for (const k of [2, 3, 4]) {
    // orthogonal blocking: the block indicator is orthogonal to every quadratic model column
    const d = ccd(k, { blocks: true, centre: [3, 2] }), N = d.X.length;
    const z = d.block.map(b => (b === 2 ? 1 : 0)), zm = z.reduce((a, b) => a + b) / N;
    const cols = [];
    for (let i = 0; i < k; i++) { cols.push(d.X.map(r => r[i])); cols.push(d.X.map(r => r[i] ** 2)); for (let j = i + 1; j < k; j++) cols.push(d.X.map(r => r[i] * r[j])); }
    const worst = Math.max(...cols.map(c => { const m = c.reduce((a, b) => a + b) / N; return Math.abs(c.reduce((s, v, t) => s + (v - m) * (z[t] - zm), 0)); }));
    check(`orthogonal blocking, k = ${k}: blocks orthogonal to the quadratic model`, worst < 1e-12, worst.toExponential(2));
  }
}

section('prediction variance');
{
  for (const k of [2, 3, 4, 5]) {
    const d = ccd(k, { cubeRuns: k === 5 ? 16 : undefined });
    const p = varianceProfile(d.X, { radii: [0, 0.5, 1, 1.5, d.params.alpha] });
    check(`rotatable CCD, k = ${k}: variance constant on spheres`, p.every(x => x.max - x.min < 1e-10 * x.max));
  }
  const f = varianceProfile(ccd(3, { alpha: 'faces', centre: 3 }).X, { radii: [1] })[0];
  check('face-centred CCD is not rotatable', f.max - f.min > 0.1);
  const b = varianceProfile(boxBehnken(3, { centre: 3 }).X, { radii: [1] })[0];
  check('BBD k = 3 is not exactly rotatable', b.max - b.min > 1e-3);
  // a 2² factorial with centre points cannot estimate a full quadratic
  throws('non-estimable model', () => predictionVariance([[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]), /not estimable/);
  // hand check: 2² factorial, first-order model: v(x) = 1 + x1² + x2²
  const v = predictionVariance([[-1, -1], [1, -1], [-1, 1], [1, 1]], { terms: [() => 1, x => x[0], x => x[1]] });
  near('2² first-order model: v(x) = 1 + x1² + x2²', [v([0, 0]), v([1, 0]), v([0.5, 0.5])], [1, 2, 1.5], { rel: 1e-14 });
}

section('uniform-precision centre points (Box & Hunter 1957)');
for (const [k, nF, want] of [[2, 4, 5], [3, 8, 6], [4, 16, 7], [5, 32, 10], [5, 16, 6], [6, 32, 9], [6, 64, 15], [7, 64, 14]])
  check(`k = ${k}, ${nF}-run cube: ${want} centre points`, uniformPrecisionCentre(k, { cubeRuns: nF }) === want);
check('rotatable CCD defaults to uniform precision', ccd(3).params.centrePoints === 6 && ccd(3).X.length === 8 + 6 + 6);

section('Box–Behnken');
{
  for (const k of [3, 4, 5, 6, 7]) {
    const d = boxBehnken(k, { centre: 0 });
    const m = k <= 5 ? 2 : 3;
    check(`k = ${k}: three levels, no corner points, ${m} factors varied per run, balanced`, d.X.every(r => r.filter(v => v !== 0).length === m)
      && [...Array(k).keys()].every(j => d.X.filter(r => r[j] === 1).length === d.X.filter(r => r[j] === -1).length));
  }
  check('k = 3: 12 + 3 runs', boxBehnken(3).X.length === 15);
  throws('k = 8', () => boxBehnken(8), /3 to 7 factors/);
  throws('blocking k = 3', () => boxBehnken(3, { blocks: true }), /k = 4.*k = 5/);
}

section('errors and study runs');
{
  throws('cube of resolution IV rejected', () => ccd(6, { cubeRuns: 16 }), /resolution IV/);
  throws('blocks not 1 + power of 2', () => ccd(3, { blocks: 4 }), /power-of-2/);
  const base = createStudy({ aikidoe: 1, seed: 3, factors: [{ id: 'T', low: 900, high: 1000 }, { id: 't', low: 10, high: 40, transform: 'log' }], responses: [{ id: 'y' }] });
  const des = toStudyDesign(base, ccd(2));
  const ax = des.runs.filter(r => r.kind === 'axial').map(r => r.settings.T).sort((a, b) => a - b);
  near('axial points decode beyond the range (T: 950 ± 50√2)', [ax[0], ax[ax.length - 1]], [950 - 50 * Math.SQRT2, 950 + 50 * Math.SQRT2], { rel: 1e-14 });
  const tl = des.runs.filter(r => r.kind === 'axial' && r.settings.T === 950).map(r => r.settings.t).sort((a, b) => a - b);
  near('log factor: axial points at 20 · 2^(±√2)', [tl[0], tl[1]], [20 * 2 ** -Math.SQRT2, 20 * 2 ** Math.SQRT2], { rel: 1e-13 });
  const cat = createStudy({ aikidoe: 1, seed: 1, factors: [{ id: 'A', low: 0, high: 1 }, { id: 'g', levels: ['a', 'b'] }] });
  throws('categorical factor in a CCD', () => toStudyDesign(cat, ccd(2)), /needs continuous factors; g is categorical/);
  // fit a quadratic to a CCD: recovers the surface
  const study = createStudy({ ...base, design: des, observations: des.runs.map(r => {
    const x1 = (r.settings.T - 950) / 50, x2 = (2 * Math.log10(r.settings.t) - Math.log10(400)) / Math.log10(4);
    return { run: r.run, response: 'y', value: 70 + 3 * x1 - 2 * x2 - 4 * x1 * x1 - 1.5 * x2 * x2 + 0.5 * x1 * x2 };
  }) });
  const fit = fitModel(study, 'y ~ quadratic');
  // term order: T, t, I(T^2), I(t^2) (degree 1, as R orders them), T:t
  near('quadratic fit on a CCD recovers the surface (coded units)', fit.coef, [70, 3, -2, -4, -1.5, 0.5], { rel: 1e-10, abs: 1e-10 });
}
done();
