// Split-plot designs (issue #14). References: FrF2 split-plot fractions and skpr optimal
// split-plot designs (fixture splitplot-r, generated on CI), Montgomery (2017) §14.4.
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture, listFixtures } from './lib/fixtures.mjs';
import { createStudy, parseStudy, serializeStudy } from '../js/study.js';
import { toStudyDesign } from '../js/design/factorial.js';
import { splitPlotFraction, splitPlotFull, optimalSplitPlot, splitPlotLogDet } from '../js/design/splitplot.js';
import { compileModel } from '../js/design/optimal.js';
import { parseFormula } from '../js/model/formula.js';

// word-length pattern of a ±1 matrix: words are the column subsets whose product is constant
function wlpOfMatrix(X) {
  const k = X[0].length, A = new Array(k).fill(0);
  for (let s = 1; s < 1 << k; s++) {
    const v = X.map(r => { let p = 1; for (let j = 0; j < k; j++) if (s >> j & 1) p *= r[j]; return p; });
    if (v.every(x => x === v[0])) A[popcount(s) - 1]++;
  }
  return A;
}
const popcount = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };
const constantWithin = (X, wp, cols) => { const m = new Map(); return X.every((r, i) => { const key = cols.map(j => r[j]).join(); if (!m.has(wp[i])) m.set(wp[i], key); return m.get(wp[i]) === key; }); };

section('split-plot fractions: structure');
for (const [N, W, k1, k2] of [[16, 4, 2, 3], [32, 8, 3, 4], [32, 4, 2, 5], [64, 8, 3, 5], [32, 8, 1, 5], [64, 16, 4, 6]]) {
  const htc = [...Array(k1).fill(true), ...Array(k2).fill(false)];
  const d = splitPlotFraction(htc, { runs: N, wholePlots: W });
  const wpCols = [...Array(k1).keys()];
  const sizes = [...new Set(d.wholePlot)].map(w => d.wholePlot.filter(x => x === w).length);
  check(`${N} runs, ${W} whole plots, ${k1}+${k2}: whole-plot factors constant within plots, ${W} plots of ${N / W}`,
    d.X.length === N && sizes.length === W && sizes.every(m => m === N / W) && constantWithin(d.X, d.wholePlot, wpCols));
  check(`${N}/${W}/${k1}+${k2}: subplot factors vary within every plot`, [...new Set(d.wholePlot)].every(w => htc.every((h, j) => h || new Set(d.X.filter((_, i) => d.wholePlot[i] === w).map(r => r[j])).size === 2)));
  near(`${N}/${W}/${k1}+${k2}: reported WLP = WLP of the matrix`, d.params.wlp, wlpOfMatrix(d.X), { abs: 0 });
  check(`${N}/${W}/${k1}+${k2}: whole-plot effects are exactly those constant within plots`, d.params.wholePlotEffects.every(e => {
    const js = e.split(':').map(x => Number(x.slice(1)) - 1);
    const col = d.X.map(r => js.reduce((a, j) => a * r[j], 1));
    return constantWithin(col.map(v => [v]), d.wholePlot, [0]);
  }));
}
throws('no htc factor', () => splitPlotFraction([false, false, false], { runs: 8, wholePlots: 2 }), /at least one hard-to-change/);
throws('too many whole-plot factors', () => splitPlotFraction([true, true, true, true, false], { runs: 16, wholePlots: 4 }), /need more than 4 whole plots/);
throws('whole plots of one run', () => splitPlotFraction([true, false], { runs: 4, wholePlots: 4 }), /at least 2 runs in each/);

section('split-plot fractions vs FrF2');
const fx = listFixtures().includes('splitplot-r') ? loadFixture('splitplot-r').cases : null;
if (fx) for (const c of fx.filter(x => x.input.kind === 'fraction')) {
  if (c.output.error) { check(`${c.name}: FrF2 ran`, false, c.output.error); continue; }
  const { runs, wholePlots, k1, k2 } = c.input;
  const d = splitPlotFraction([...Array(k1).fill(true), ...Array(k2).fill(false)], { runs, wholePlots });
  const ref = c.output.X;
  check(`${c.name}: FrF2's whole-plot factors are constant within its whole plots (sanity)`, (() => { const wp = ref.map(r => r.slice(0, k1).join()); return new Set(wp).size <= wholePlots; })());
  if (ref[0].length > k1 + k2) // FrF2 added pseudo whole-plot factors (k1 < log2 W); so does the search
    near(`${c.name}: word-length pattern with FrF2's pseudo whole-plot factor(s) = FrF2`, d.params.wlpWithPseudo, wlpOfMatrix(ref), { abs: 0 });
  else near(`${c.name}: word-length pattern = FrF2 (minimum aberration)`, d.params.wlp, wlpOfMatrix(ref), { abs: 0 });
} else check('splitplot-r fixture present (generated on CI)', false);

section('full factorial in whole plots: Montgomery §14.4 (paper strength)');
{
  // 3 pulp preparation methods (whole plots) × 4 temperatures, 3 days (replicates, blocks)
  const d = splitPlotFull([3, 4], [true, false], { replicates: 3, replicateBlocks: true });
  const s = createStudy({ aikidoe: 1, seed: 2, factors: [{ id: 'method', levels: ['1', '2', '3'], htc: true }, { id: 'temp', low: 200, high: 275, levels: [200, 225, 250, 275] }] });
  const sd = toStudyDesign(s, d);
  check('36 runs, 9 whole plots of 4, 3 days', sd.runs.length === 36 && new Set(sd.runs.map(r => r.wholePlot)).size === 9 && new Set(sd.runs.map(r => r.block)).size === 3);
  check('each day holds each method once, each whole plot all four temperatures', [1, 2, 3].every(b => { const r = sd.runs.filter(x => x.block === b); return new Set(r.map(x => x.settings.method)).size === 3 && new Set(r.map(x => x.wholePlot)).size === 3; })
    && [...new Set(sd.runs.map(r => r.wholePlot))].every(w => new Set(sd.runs.filter(r => r.wholePlot === w).map(r => r.settings.temp)).size === 4));
  const ordered = sd.runs.slice().sort((a, b) => a.order - b.order);
  check('restricted randomisation: days in turn, whole plots contiguous', sd.randomisation === 'restricted' && ordered.every((r, i) => i === 0 || r.wholePlot === ordered[i - 1].wholePlot || !ordered.slice(0, i).some(x => x.wholePlot === r.wholePlot))
    && ordered.every((r, i) => i === 0 || r.block === ordered[i - 1].block || !ordered.slice(0, i).some(x => x.block === r.block)));
  const st = createStudy({ ...s, design: sd });
  check('valid study; round-trips', serializeStudy(parseStudy(serializeStudy(st))) === serializeStudy(st));
  throws('complete randomisation of a split-plot is refused', () => toStudyDesign(s, d, { randomise: 'complete' }), /cannot be completely randomised/);
}

section('optimal split-plot');
{
  const s = createStudy({ aikidoe: 1, seed: 3, factors: [{ id: 'T', low: 900, high: 1000, htc: true }, { id: 't', low: 10, high: 30 }, { id: 'P', low: 1, high: 2 }, { id: 'G', levels: ['N2', 'O2'] }] });
  const d = optimalSplitPlot(s, { runs: 24, wholePlots: 6, model: '(T+t+P+G)^2', restarts: 10 });
  check('24 runs in 6 whole plots of 4; T constant within plots', d.X.length === 24 && new Set(d.wholePlot).size === 6 && constantWithin(d.X, d.wholePlot, [0]));
  const cm = compileModel(parseFormula('(T+t+P+G)^2', s.factors), s.factors);
  const F = d.X.map(r => cm.f(r.map((v, j) => (j === 3 ? (v + 1) / 2 : v))));
  near('reported log-determinant = GLS information of the design', d.params.logDet, splitPlotLogDet(F, d.wholePlot, 1), { rel: 1e-10 });
  check('T is balanced over whole plots (3 high, 3 low)', [-1, 1].every(v => new Set(d.X.filter(r => r[0] === v).map((_, i) => i)).size > 0) && d.X.filter(r => r[0] === 1).length === 12);
  check('reproducible from the seed', JSON.stringify(optimalSplitPlot(s, { runs: 24, wholePlots: 6, model: '(T+t+P+G)^2', restarts: 10 }).X) === JSON.stringify(d.X));
  const sd = toStudyDesign(s, d);
  check('study design: whole plots recorded, valid', createStudy({ ...s, design: sd }).design.runs.every(r => r.wholePlot >= 1));
  throws('runs must divide into whole plots', () => optimalSplitPlot(s, { runs: 25, wholePlots: 6 }), /do not divide/);
  throws('needs an htc factor', () => optimalSplitPlot(createStudy({ ...s, factors: s.factors.map(f => ({ ...f, htc: false })) }), { runs: 8, wholePlots: 2 }), /hard-to-change/);
}

section('optimal split-plot vs skpr');
if (fx) for (const c of fx.filter(x => x.input.kind === 'optimal')) {
  if (c.output.error) { check(`${c.name}: skpr ran`, false, c.output.error); continue; }
  const ids = Object.keys(c.output.rows[0]);
  const wpIds = c.name.includes('A, B htc') ? ['A', 'B'] : ['A'];
  const s = createStudy({ aikidoe: 1, seed: 11, factors: ids.map(id => (id === 'G' ? { id, levels: c.input.levels } : { id, low: -1, high: 1, htc: wpIds.includes(id) })) });
  const cm = compileModel(parseFormula(c.input.model, s.factors), s.factors);
  const Fr = c.output.rows.map(r => cm.f(s.factors.map(f => (f.type === 'categorical' ? f.levels.indexOf(r[f.id]) : r[f.id]))));
  near(`${c.name}: GLS log|XᵀV⁻¹X| of skpr's design = R`, splitPlotLogDet(Fr, c.output.wholePlot, c.input.eta), c.output.logDet, { rel: 1e-9 });
  const d = optimalSplitPlot(s, { runs: c.input.wholePlots * c.input.perWholePlot, wholePlots: c.input.wholePlots, model: c.input.model, eta: c.input.eta, restarts: 30 });
  const eff = Math.exp((d.params.logDet - c.output.logDet) / cm.p);
  check(`${c.name}: D-efficiency relative to skpr ≥ 99% (${(100 * eff).toFixed(2)}%)`, eff >= 0.99, eff);
}
done();
