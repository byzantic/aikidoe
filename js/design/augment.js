// Sequential experimentation (spec §5, U7; issue #11): add a stage of runs to an existing
// design — fold-over, axial points, optimal augmentation, confirmation runs — and analyse the
// combined design's aliasing.
//
//   foldover(study, { factor })            full fold-over (all two-level factors reversed) or one factor
//   axialPoints(study, { alpha, centre })  turn a two-level design into a central composite
//   optimalAugment(study, { runs, model, criterion, … })   D/I/A-optimal runs given the existing ones
//   confirmationRuns(study, fit, settings, { replicates })  runs at chosen settings, with predictions
//   appendStage(study, stage, { seed })    → new study: the stage's runs added as a new block,
//                                          in their own randomised order after the existing runs
//   sequentialAliases(study, { order })    alias chains of the two-level part of the combined
//                                          design, and effects confounded with blocks
//
// A stage is { kind, X (coded, as factorial.js), runKind, params, note }.
import { code, decode, createStudy } from '../study.js';
import { cubeBlockAlpha, rotatableAlpha } from './rsm.js';
import { optimalDesign } from './optimal.js';
import { rng } from './rng.js';
import { predict } from '../model/ols.js';
import { studentT } from '../dist.js';

const runs = (study) => study.design?.runs ?? (() => { throw new Error('the study has no design yet'); })();
// coded row of a run: continuous coded value, two-level categorical ±1, other categorical index
const codedRow = (study, r) => study.factors.map(f => (f.type === 'categorical' ? (f.levels.length === 2 ? 2 * f.levels.indexOf(r.settings[f.id]) - 1 : f.levels.indexOf(r.settings[f.id])) : code(f, r.settings[f.id])));
const isCube = (study, r) => codedRow(study, r).every((v, j) => (study.factors[j].type === 'categorical' ? study.factors[j].levels.length === 2 : Math.abs(Math.abs(v) - 1) < 1e-9));

/**
 * Fold-over of the two-level ("cube") runs: every two-level factor reversed (full fold-over,
 * which de-aliases main effects from two-factor interactions in a resolution III design), or
 * only `factor` reversed (single-factor fold-over: that factor's main effect and all its 2fis
 * become clear). Centre, axial and confirmation runs are not folded.
 */
export function foldover(study, { factor } = {}) {
  const base = runs(study).filter(r => !['centre', 'axial', 'confirm'].includes(r.kind) && isCube(study, r));
  if (!base.length) throw new Error('no two-level runs to fold over');
  const j0 = factor === undefined ? null : study.factors.findIndex(f => f.id === factor);
  if (factor !== undefined && j0 < 0) throw new Error(`unknown factor "${factor}"`);
  const X = base.map(r => codedRow(study, r).map((v, j) => (j0 === null || j === j0 ? -v : v)));
  return { kind: 'foldover', X, runKind: X.map(() => 'augment'), params: { factor: factor ?? 'all', folded: base.map(r => r.run) },
    note: factor === undefined ? `full fold-over of ${base.length} runs` : `fold-over on ${factor} of ${base.length} runs` };
}

/**
 * Axial (star) points ±α on each factor plus centre points, turning a two-level design into a
 * central composite in a new block. alpha: 'orthogonal' (default: orthogonal blocking with the
 * existing runs as the cube block, so the block effect does not bias the quadratic fit),
 * 'rotatable', 'faces', or a number. centre: centre points in the axial block (default 2).
 */
export function axialPoints(study, { alpha = 'orthogonal', centre = 2 } = {}) {
  if (study.factors.some(f => f.type === 'categorical')) throw new Error('axial points need continuous factors');
  const k = study.factors.length, existing = runs(study).filter(r => r.kind !== 'confirm');
  const nF = existing.filter(r => isCube(study, r)).length, n0c = existing.filter(r => codedRow(study, r).every(v => Math.abs(v) < 1e-12)).length;
  if (!nF) throw new Error('no cube runs to build on');
  const a = typeof alpha === 'number' ? alpha : alpha === 'rotatable' ? rotatableAlpha(nF) : alpha === 'faces' ? 1 : alpha === 'orthogonal' ? cubeBlockAlpha(k, nF, n0c, centre) : NaN;
  if (!(a > 0)) throw new Error(`alpha must be 'orthogonal', 'rotatable', 'faces' or a positive number`);
  const X = [], runKind = [];
  for (let j = 0; j < k; j++) for (const s of [-1, 1]) { const row = new Array(k).fill(0); row[j] = s * a; X.push(row); runKind.push('axial'); }
  for (let i = 0; i < centre; i++) { X.push(new Array(k).fill(0)); runKind.push('centre'); }
  return { kind: 'axial', X, runKind, params: { alpha: a, alphaRule: alpha, cubeRuns: nF, centreCube: n0c, centreAxial: centre }, note: `axial points at α = ${+a.toFixed(4)} and ${centre} centre points` };
}

/** New runs chosen (D-, I- or A-optimally) together with all the existing runs. */
export function optimalAugment(study, opts = {}) {
  const existing = runs(study).filter(r => r.kind !== 'confirm');
  const n = opts.runs;
  if (!Number.isInteger(n) || n < 1) throw new Error('give the number of runs to add');
  const d = optimalDesign(study, { ...opts, runs: existing.length + n, fixed: existing.map(r => r.settings) });
  const X = d.X.slice(existing.length);
  return { kind: 'augment', X, runKind: X.map(() => 'augment'), params: { criterion: d.params.criterion, model: d.params.model, dEfficiency: d.params.dEfficiency, averageVariance: d.params.averageVariance },
    note: `${n} ${d.params.criterion}-optimal runs for ${d.params.model}`, design: d };
}

/**
 * Confirmation runs at given settings (natural units; one object per setting), each repeated
 * `replicates` times, with the fitted model's predictions and 95% prediction intervals stored in
 * the stage, so the results can later be checked against what was predicted.
 */
export function confirmationRuns(study, fit, settings, { replicates = 1, level = 0.95 } = {}) {
  if (!settings.length) throw new Error('give at least one setting to confirm');
  const full = settings.map(s => Object.fromEntries(study.factors.map(f => {
    const v = s[f.id];
    if (v === undefined) throw new Error(`confirmation setting is missing ${f.id}`);
    return [f.id, v];
  })));
  const pred = predict(fit, full, { level });
  const X = [], runKind = [];
  for (const s of full) for (let i = 0; i < replicates; i++) { X.push(codedRow(study, { settings: s })); runKind.push('confirm'); }
  return { kind: 'confirm', X, runKind, note: `${X.length} confirmation run(s) for ${fit.response}`,
    params: { response: fit.response, formula: `${fit.response} ~ ${fit.model.terms.filter(t => !t.block).map(t => t.label).join(' + ') || '1'}`, level,
      sigma: fit.sigma, df: fit.dfRes,
      predictions: full.map((s, i) => ({ settings: s, fit: pred[i].fit, se: pred[i].se, predLower: pred[i].predLower, predUpper: pred[i].predUpper })) } };
}

/**
 * Add a stage to the study's design (returns a new, validated study). Existing runs without a
 * block are put in block 1; the new runs form the next block, get run ids after the existing
 * ones and a seeded random order after the existing orders. The design becomes 'sequential'
 * (its stages listed in params.stages) and the stage is recorded in history.
 */
export function appendStage(study, stage, { seed } = {}) {
  const old = runs(study);
  const nStage = (study.design.params?.stages?.length ?? 1) + 1;
  const g = rng(seed ?? ((study.seed + 7919 * nStage) >>> 0));
  const blocks = [...new Set(old.map(r => r.block).filter(b => b !== undefined))];
  const numeric = blocks.map(Number).filter(Number.isFinite);
  const nextBlock = !blocks.length ? 2 : numeric.length === blocks.length ? Math.max(...numeric) + 1 : blocks.length + 1;
  const base = old.map(r => ({ ...r, block: r.block ?? 1 }));
  const n0 = Math.max(...old.map(r => r.run)), o0 = Math.max(...old.map(r => r.order));
  const settingsOf = (row) => Object.fromEntries(study.factors.map((f, j) => {
    if (f.type !== 'categorical') return [f.id, decode(f, row[j])];
    return [f.id, f.levels[f.levels.length === 2 ? (row[j] + 1) / 2 : row[j]]];
  }));
  const order = g.shuffle(stage.X.map((_, i) => i));
  const added = stage.X.map((row, i) => ({ run: n0 + 1 + i, order: o0 + 1 + order.indexOf(i), block: nextBlock, kind: stage.runKind[i], settings: settingsOf(row) }));
  const first = study.design.kind === 'sequential' ? null : { kind: study.design.kind, params: study.design.params };
  const stages = study.design.kind === 'sequential' ? study.design.params.stages : [first];
  const { design: _d, ...stageParams } = stage.params ?? {};
  const history = study.history.length ? study.history.slice() : [{ stage: study.design.kind, runs: old.map(r => r.run) }];
  history.push({ stage: stage.kind, runs: added.map(r => r.run), note: stage.note, ...(Object.keys(stageParams).length ? { params: stageParams } : {}) });
  return createStudy({ ...study, design: { kind: 'sequential', params: { ...(study.design.kind === 'sequential' ? study.design.params : {}), stages: [...stages, { kind: stage.kind, params: stageParams }], seed: study.design.params?.seed ?? study.seed },
    randomisation: 'blocked', runs: [...base, ...added] }, history });
}

/**
 * Aliasing in the combined two-level runs: chains of main effects and two-factor interactions
 * whose columns are identical up to sign over the cube runs, and the effects confounded with a
 * block difference. names: factor ids. Returns { chains: [[…]], withBlocks: […], runs }.
 */
export function sequentialAliases(study, { order = 2 } = {}) {
  const cube = runs(study).filter(r => r.kind !== 'confirm' && isCube(study, r));
  const k = study.factors.length, ids = study.factors.map(f => f.id);
  if (!cube.length) return { chains: [], withBlocks: [], runs: 0 };
  const X = cube.map(r => codedRow(study, r));
  const effects = [];
  for (let i = 0; i < k; i++) effects.push({ name: ids[i], idx: [i] });
  if (order >= 2) for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) effects.push({ name: `${ids[i]}:${ids[j]}`, idx: [i, j] });
  const col = (e) => X.map(r => e.idx.reduce((p, j) => p * r[j], 1));
  const key = (v) => { const s = v.find(x => x !== 0) < 0 ? -1 : 1; return v.map(x => x * s).join(','); };
  const groups = new Map();
  for (const e of effects) { const kk = key(col(e)); if (!groups.has(kk)) groups.set(kk, []); groups.get(kk).push(e.name); }
  const chains = [...groups.values()].filter(g => g.length > 1);
  // block contrasts: block b against the rest, over the cube runs (centred)
  const labels = [...new Set(cube.map(r => r.block ?? 1))];
  const withBlocks = [];
  if (labels.length > 1) for (const e of effects) {
    const v = col(e), m = v.reduce((a, b) => a + b, 0) / v.length;
    if (labels.some(b => { const z = cube.map(r => ((r.block ?? 1) === b ? 1 : 0)), zm = z.reduce((a, c) => a + c, 0) / z.length; const num = v.reduce((s, x, i) => s + (x - m) * (z[i] - zm), 0); const den = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) * z.reduce((s, x) => s + (x - zm) ** 2, 0)); return den > 0 && Math.abs(num / den) > 1 - 1e-9; }))
      withBlocks.push(e.name);
  }
  return { chains, withBlocks, runs: cube.length };
}

/**
 * Compare confirmation results with the predictions stored when the runs were added: for each
 * confirm stage of the response, the observed mean at each setting, the prediction and whether
 * it falls inside the prediction interval (for a single run, or for the mean of n replicates).
 */
export function checkConfirmation(study, response) {
  const out = [];
  study.history.forEach(h => {
    if (h.stage !== 'confirm' || h.params?.response !== response) return;
    for (const p of h.params.predictions) {
      // settings went through coding and back (log factors): compare numbers to 1e-9 relative
      const eq = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)) : a === b);
      const same = (r) => study.factors.every(f => eq(r.settings[f.id], p.settings[f.id]));
      const ids = h.runs.filter(id => same(runs(study).find(r => r.run === id)));
      const vals = study.observations.filter(o => o.response === response && ids.includes(o.run) && o.value !== null).map(o => o.value);
      const n = vals.length, mean = n ? vals.reduce((a, b) => a + b, 0) / n : null;
      // interval for the mean of n new observations: ŷ ± t · √(se² + σ²/n)
      let lo = p.predLower, hi = p.predUpper;
      if (n > 1) { const t = studentT.ppf(1 - (1 - h.params.level) / 2, h.params.df), w = t * Math.sqrt(p.se ** 2 + h.params.sigma ** 2 / n); lo = p.fit - w; hi = p.fit + w; }
      out.push({ settings: p.settings, predicted: p.fit, lower: lo, upper: hi, n, observed: mean,
        inside: mean === null ? null : mean >= lo && mean <= hi, formula: h.params.formula });
    }
  });
  return out;
}
