// Allocating units to runs so that a covariate known in advance is balanced against the factors
// (issue #82, phase 3): animals by starting weight, wafers by incoming film thickness, flasks by
// seed density measured before the treatments.
//
//   allocate(study, units, opts)      which unit goes to which run
//   balanceOf(study, values, opts)    how balanced given covariate values (one per run) are
//
// Balance: R², the share of the covariate's variation (about its mean) that the model's columns
// explain — 0 when it is uncorrelated with every effect, so the effects are estimated as precisely
// with the covariate in the model as without, and the adjustment moves them least. Also the
// variance inflation of each coefficient when the covariate joins the model (car::vif's
// 1 / (1 − R²_j)), and the largest correlation with a single column. A random allocation gives R²
// of about (p − 1) / (n − 1) on average (p columns, n runs).
//
// Search: from several random allocations (seeded), swap pairs of runs' units — or a run's unit
// with an unused one, when there are more units than runs — while R² falls; keep the best. With
// blocks, units are swapped only within a block when opts.withinBlocks (e.g. units that arrived
// in batches).
//
// Order mode (opts.order): the values belong to positions in the run order (a forecast of the
// room temperature for each slot, say) instead of to units; the runs are rearranged among the
// positions. Only for designs without whole plots, and within blocks.

import { qr } from '../linalg.js';
import { parseFormula, modelMatrix } from '../model/formula.js';
import { rng } from './rng.js';

const mean = (v) => v.reduce((a, x) => a + x, 0) / v.length;

/** The model matrix of a design's runs for a model (default the main effects), with blocks. */
function designMatrix(study, runs, model) {
  const parsed = parseFormula(model, study.factors);
  const mm = modelMatrix(parsed, study.factors, runs.map(r => r.settings));
  // blocks: a column per block contrast, so the covariate is balanced within blocks too
  const blocks = [...new Set(runs.map(r => r.block).filter(b => b !== undefined))];
  if (blocks.length > 1) for (const b of blocks.slice(1)) mm.X.forEach((row, i) => row.push(runs[i].block === b ? 1 : runs[i].block === blocks[0] ? -1 : 0));
  return mm;
}

/** The pieces for fast R² of values v: an orthonormal basis Q (columns) of the model's space. */
function basis(X) {
  const f = qr(X), Q = f.Q();
  const k = f.rank;
  return Q.map(row => row.slice(0, k));
}

/** R² of v on the model (with an intercept): 1 − RSS / TSS. */
function r2Of(Q, v) {
  const n = v.length, m = mean(v), tss = v.reduce((a, x) => a + (x - m) ** 2, 0);
  if (!(tss > 0)) return 0;
  const k = Q[0].length;
  let proj = 0;
  for (let j = 0; j < k; j++) { let s = 0; for (let i = 0; i < n; i++) s += Q[i][j] * v[i]; proj += s * s; }
  return Math.max(0, Math.min(1, (proj - n * m * m) / tss));
}

/**
 * The balance of covariate values (one per run, in the order of the design's runs) against the
 * model: { r2, expected (a random allocation's average), vif: [{ column, vif }], maxCorr: { column, r } }.
 */
export function balanceOf(study, values, { model = 'main', runs = study.design?.runs.filter(r => r.kind !== 'confirm') } = {}) {
  if (!runs?.length) throw new Error('the study has no design yet');
  if (values.length !== runs.length) throw new Error(`${values.length} values for ${runs.length} runs`);
  const mm = designMatrix(study, runs, model), Q = basis(mm.X), p = Q[0].length, n = runs.length;
  const r2 = r2Of(Q, values);
  // VIF of each coefficient with the covariate (centred) added: diag((XᵀX)⁻¹) with and without
  const m = mean(values), z = values.map(x => x - m);
  const vif = mm.columns.map((c, j) => ({ column: c, j })).filter(c => c.column !== '(Intercept)' && c.j < mm.X[0].length).map(({ column, j }) => {
    const without = diagInv(mm.X)[j], withZ = diagInv(mm.X.map((r, i) => [...r, z[i]]))[j];
    return { column, vif: withZ / without };
  }).filter(x => Number.isFinite(x.vif));
  // the largest correlation with a single (non-constant) column
  let maxCorr = { column: null, r: 0 };
  mm.columns.forEach((c, j) => {
    const col = mm.X.map(r => r[j]), cm = mean(col), d = col.map(x => x - cm), ss = d.reduce((a, x) => a + x * x, 0);
    if (!(ss > 0)) return;
    const r = d.reduce((a, x, i) => a + x * z[i], 0) / Math.sqrt(ss * z.reduce((a, x) => a + x * x, 0));
    if (Math.abs(r) > Math.abs(maxCorr.r)) maxCorr = { column: c, r };
  });
  return { r2, expected: (p - 1) / (n - 1), vif, maxCorr, columns: p, runs: n };
}

function diagInv(X) {
  const f = qr(X);
  const C = f.unscaledCov();
  return C.map((r, i) => r[i]);
}

/**
 * Allocate units to runs. units: [{ unit, value }] (at least as many as runs; the extra ones are
 * left over). opts: model ('main'; a formula's right side or a shortcut), starts (20), seed (the
 * study's), withinBlocks (false), order (false: see above).
 * Returns { assignment: [{ run, unit, value }], unused: [units], r2, expected, random (R² of the
 * first random start), vif, maxCorr }.
 */
export function allocate(study, units, { model = 'main', starts = 20, seed = study.seed ?? 1, withinBlocks = false, order = false } = {}) {
  const runs = study.design?.runs.filter(r => r.kind !== 'confirm');
  if (!runs?.length) throw new Error('the study has no design yet');
  if (!units?.length) throw new Error('no units to allocate');
  if (units.length < runs.length) throw new Error(`${units.length} units for ${runs.length} runs: at least one unit per run is needed`);
  if (units.some(u => !Number.isFinite(u.value))) throw new Error('every unit needs a number');
  if (new Set(units.map(u => String(u.unit))).size !== units.length) throw new Error('unit labels must differ');
  if (order) {
    if (runs.some(r => r.wholePlot !== undefined)) throw new Error('order mode: not for designs with whole plots (their runs must stay together)');
    if (units.length !== runs.length) throw new Error(`order mode: one value per position in the run order (${runs.length}), got ${units.length}`);
  }
  const n = runs.length, U = units.length;
  const mm = designMatrix(study, runs, model), Q = basis(mm.X);
  const blockOf = runs.map(r => r.block ?? '');
  // in order mode, positions are taken in run order and swaps stay within blocks
  const sameBlockOnly = withinBlocks || order;
  const g = rng(seed);
  let best = null, firstR2 = null;
  for (let s = 0; s < starts; s++) {
    // a random start: a permutation of the units; the first n go to the runs
    let perm = g.shuffle([...Array(U).keys()]);
    if (order) {
      // positions keep their blocks: assign each block's positions to its runs at random
      perm = new Array(n);
      const byBlock = new Map();
      runs.map(r => r).sort((a, b) => a.order - b.order).forEach((r, pos) => { const b = r.block ?? ''; if (!byBlock.has(b)) byBlock.set(b, { pos: [], runs: [] }); byBlock.get(b).pos.push(pos); });
      runs.forEach((r, i) => byBlock.get(r.block ?? '').runs.push(i));
      for (const { pos, runs: rs } of byBlock.values()) { const sh = g.shuffle(pos.slice()); rs.forEach((i, t) => { perm[i] = sh[t]; }); }
    }
    const v = (p) => p.slice(0, n).map(u => units[u].value);
    let cur = perm, val = r2Of(Q, v(cur));
    if (firstR2 === null) firstR2 = val;
    let improved = true;
    while (improved) {
      improved = false;
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < U; b++) {
          if (b < n && sameBlockOnly && blockOf[a] !== blockOf[b]) continue;
          const nxt = cur.slice(); [nxt[a], nxt[b]] = [nxt[b], nxt[a]];
          const nv = r2Of(Q, v(nxt));
          if (nv < val - 1e-15) { cur = nxt; val = nv; improved = true; }
        }
      }
    }
    if (!best || val < best.r2) best = { perm: cur, r2: val };
  }
  const values = best.perm.slice(0, n).map(u => units[u].value);
  const bal = balanceOf(study, values, { model, runs });
  return {
    assignment: runs.map((r, i) => ({ run: r.run, unit: units[best.perm[i]].unit, value: units[best.perm[i]].value })),
    unused: best.perm.slice(n).map(u => units[u]),
    r2: bal.r2, expected: bal.expected, random: firstR2, vif: bal.vif, maxCorr: bal.maxCorr, order,
  };
}

/**
 * A study with an allocation applied: the covariate's values set (each with its unit), and in
 * order mode the runs' order rearranged so that each run takes its position's slot.
 */
export function applyAllocation(study, covariateId, alloc, units) {
  const c = (study.covariates ?? []).find(x => x.id === covariateId);
  if (!c) throw new Error(`no covariate "${covariateId}" in the study`);
  const covariates = study.covariates.map(x => (x.id !== covariateId ? x : { ...x, values: alloc.assignment.map(a => ({ run: a.run, value: a.value, ...(alloc.order ? {} : { unit: String(a.unit) }) })) }));
  if (!alloc.order) return { ...study, covariates };
  // order mode: the unit labels are positions 1 … n in the run order
  const sorted = study.design.runs.filter(r => r.kind !== 'confirm').slice().sort((a, b) => a.order - b.order);
  const slotOrder = new Map(units.map((u, i) => [String(u.unit), sorted[i].order]));
  const newOrder = new Map(alloc.assignment.map(a => [a.run, slotOrder.get(String(a.unit))]));
  return { ...study, covariates, design: { ...study.design, runs: study.design.runs.map(r => (newOrder.has(r.run) ? { ...r, order: newOrder.get(r.run) } : r)) } };
}
