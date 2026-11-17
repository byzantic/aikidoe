// Crossed (inner × outer) arrays (issue #85, phase 3): Taguchi's design for robustness. The
// control factors — those set in production — are run in an inner array; the noise factors —
// varied in the experiment but not controlled in production — in an outer array; every inner run
// is tried at every outer condition. Each inner run then gives a mean and a spread over the noise
// (summarised by Taguchi's signal-to-noise ratios: js/model/taguchi.js).
//
// It costs inner × outer runs. A combined array — control and noise factors in one design, the
// model with control × noise interactions, then propagation of error (js/model/robust.js) — usually
// gives the same information in far fewer runs (Shoemaker, Tsui & Wu 1991; Myers & Montgomery,
// ch. 11), which is why the app offers both and says so.
//
//   smallArray(levels)                 the smaller of the full factorial and the best orthogonal array
//   crossedArray(levels, isNoise, opts) { kind: 'crossed-array', params, levels, X, runKind }

import { fullFactorial, finish } from './factorial.js';
import { arrayDesign } from './arrays.js';

/** The full factorial for these levels if it is no bigger than the smallest orthogonal array, otherwise that array. */
export function smallArray(levels, { array } = {}) {
  const full = levels.reduce((a, b) => a * b, 1);
  let oa = null;
  try { oa = arrayDesign(levels, array ? { array } : {}); } catch (e) { if (array) throw e; }
  if (!array && (!oa || full <= oa.X.length)) {
    const f = fullFactorial(levels);
    return { name: levels.length ? `full factorial ${levels.join('×')}` : 'one run', X: f.X, runs: f.X.length };
  }
  return { name: oa.params.name, X: oa.X, runs: oa.X.length, array: oa.params.array, columns: oa.params.columns, gwlp: oa.params.gwlp };
}

/**
 * The crossed array. levels: per factor; isNoise: per factor, true for a noise factor. opts: inner,
 * outer (array ids, default the smallest designs), replicates. X: two-level columns ±1, others
 * 0 … s−1; the runs in inner-run order, each inner run's outer conditions together. params:
 * { inner, outer (names), innerRuns, outerRuns, noise (factor indices) }; innerIndex: the inner
 * run of each run (before replication).
 */
export function crossedArray(levels, isNoise, opts = {}) {
  const ctl = levels.map((_, j) => j).filter(j => !isNoise[j]), nz = levels.map((_, j) => j).filter(j => isNoise[j]);
  if (!nz.length) throw new Error('a crossed array needs at least one noise factor (mark them as noise)');
  if (!ctl.length) throw new Error('a crossed array needs at least one control factor (not noise)');
  const I = smallArray(ctl.map(j => levels[j]), { array: opts.inner }), O = smallArray(nz.map(j => levels[j]), { array: opts.outer });
  const X = [], innerIndex = [];
  I.X.forEach((ir, a) => O.X.forEach(or => {
    const row = new Array(levels.length);
    ctl.forEach((j, t) => { row[j] = ir[t]; }); nz.forEach((j, t) => { row[j] = or[t]; });
    X.push(row); innerIndex.push(a);
  }));
  const params = { inner: I.name, outer: O.name, innerRuns: I.runs, outerRuns: O.runs, noise: nz };
  return { ...finish({ kind: 'crossed-array', params, levels: levels.slice(), X, runKind: X.map(() => 'fraction') }, { replicates: opts.replicates }), innerIndex };
}
