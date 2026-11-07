// Laying a design out on microplates (issue #63): which run goes in which well.
//
// Wells differ: the outer ring evaporates and warms differently, dispensers and readers leave row
// and column gradients, and plates differ from each other. A layout that puts the conditions in
// tidy rows confounds them with position. Three layouts:
//
//   balanced  (default) a restricted randomisation: random layouts improved by random swaps,
//             keeping the one whose factor effects are least entangled with position — plate
//             (block), edge, and row and column gradients. Its efficiency is det(information
//             about the model's terms after adjusting for position) relative to before, to the
//             power 1/p: 1 = position costs nothing.
//   random    one random layout.
//   ordered   runs in run-number order, filling plates row by row: the tidy layout to avoid
//             (kept for teaching and for comparison).
//
// Controls go in first, spread over rows and columns of every plate. Runs already in wells keep
// their wells; new runs (a later stage) go on new plates. With more than one plate, each run's
// block becomes its plate, so the analysis takes out plate-to-plate shifts; runs of different
// blocks of the design are never mixed on a plate.
import { rng } from './rng.js';
import { parseFormula, modelMatrix } from '../model/formula.js';
import { defaultFormula } from '../model/defaults.js';
import { chol, cholLogdet, cholInverse, qr } from '../linalg.js';
import { createStudy } from '../study.js';
import { FORMATS, usableWells, runCapacity, parseWell, wellId, ring, plateNumbers } from '../plate.js';

/** Geometry from a format (96, '384', '8x12') → { rows, cols }. */
export function plateFormat(fmt) {
  if (fmt && typeof fmt === 'object') return { rows: fmt.rows, cols: fmt.cols };
  const s = String(fmt ?? 96).trim();
  if (FORMATS[s]) return { rows: FORMATS[s][0], cols: FORMATS[s][1] };
  const m = /^(\d+)\s*[x×]\s*(\d+)$/.exec(s);
  if (m) return { rows: Number(m[1]), cols: Number(m[2]) };
  throw new Error(`plate format: ${Object.keys(FORMATS).join(', ')} or ROWSxCOLS, not "${fmt}"`);
}

/**
 * Control wells for one plate: spread over the rows and columns (each control's wells in
 * different rows and columns where possible), avoiding excluded wells.
 * Returns [{ well, control }].
 */
export function placeControls(plates, g) {
  const U = usableWells(plates), free = new Set(U.map(w => w.id));
  const m = plates.controls.reduce((a, c) => a + c.perPlate, 0);
  if (!m) return [];
  const R = plates.rows, C = plates.cols;
  const ur = g.random(), uc = g.random(), perm = g.shuffle([...Array(m).keys()]);
  const spots = [];
  for (let i = 0; i < m; i++) {
    const r = Math.min(R - 1, Math.floor(((i + ur) * R) / m)), c = Math.min(C - 1, Math.floor(((perm[i] + uc) * C) / m));
    // nearest free usable well
    let best = null, bd = Infinity;
    for (const w of U) if (free.has(w.id)) { const d = (w.r - r) ** 2 + (w.c - c) ** 2 + g.random() * 1e-6; if (d < bd) { bd = d; best = w; } }
    free.delete(best.id); spots.push(best);
  }
  // controls dealt round-robin down the rows, so each spans the plate
  spots.sort((a, b) => a.r - b.r || a.c - b.c);
  const deck = [];
  const left = Object.fromEntries(plates.controls.map(c => [c.id, c.perPlate]));
  while (deck.length < m) for (const c of plates.controls) if (left[c.id]-- > 0) deck.push(c.id);
  return spots.map((w, i) => ({ well: w.id, control: deck[i] }));
}

// ---------------------------------------------------------------- efficiency

const centre = (X) => {
  if (!X.length) return X;
  const p = X[0].length, m = new Array(p).fill(0);
  for (const r of X) for (let j = 0; j < p; j++) m[j] += r[j] / X.length;
  return X.map(r => r.map((v, j) => v - m[j]));
};
function gram(A, B = A) {
  const p = A[0].length, q = B[0].length, G = Array.from({ length: p }, () => new Array(q).fill(0));
  for (let i = 0; i < A.length; i++) { const a = A[i], b = B[i]; for (let j = 0; j < p; j++) { const aj = a[j]; if (aj) for (let k = 0; k < q; k++) G[j][k] += aj * b[k]; } }
  return G;
}
/** The information about the factor columns F after adjusting for nuisance columns N. */
function infoMatrix(F, N) {
  const n = F.length, p = F[0].length;
  const A = gram(F);
  if (N && N[0]?.length) {
    // orthonormal basis of N's columns (Gram–Schmidt, dropping dependent ones), then
    // FᵀF − Σ (qᵀF)ᵀ(qᵀF)
    const basis = [];
    for (let j = 0; j < N[0].length; j++) {
      const v = N.map(r => r[j]);
      const n0 = Math.hypot(...v);
      for (const q of basis) { let d = 0; for (let i = 0; i < n; i++) d += q[i] * v[i]; for (let i = 0; i < n; i++) v[i] -= d * q[i]; }
      const nv = Math.hypot(...v);
      if (nv > 1e-9 * Math.max(1, n0)) basis.push(v.map(x => x / nv));
    }
    for (const q of basis) {
      const t = new Array(p).fill(0);
      for (let i = 0; i < n; i++) if (q[i]) for (let j = 0; j < p; j++) t[j] += q[i] * F[i][j];
      for (let j = 0; j < p; j++) for (let k = 0; k < p; k++) A[j][k] -= t[j] * t[k];
    }
  }
  return A;
}
/** Its log determinant (−∞ when singular). */
function logInfo(F, N) { try { return cholLogdet(chol(infoMatrix(F, N)).L); } catch { return -Infinity; } }

/** Factor columns for the runs: the design's model (default formula), centred, full rank. */
function factorColumns(study, runs, formula) {
  const resp = study.responses[0]?.id ?? 'y';
  const f = formula ?? defaultFormula({ ...study, design: study.design }, resp).replace(/^[^~]*~/, `${resp} ~`);
  const model = parseFormula(f, study.factors);
  const { X, columns } = modelMatrix({ ...model, intercept: false }, study.factors, runs.map(r => r.settings));
  if (!X.length || !X[0].length) return { cols: null, formula: f };
  const Xc = centre(X);
  // keep a full-rank subset of columns (aliased terms cannot be helped by the layout)
  const { rank, perm } = qr(Xc);
  const keep = perm.slice(0, rank).sort((a, b) => a - b);
  return { cols: Xc.map(r => keep.map(j => r[j])), names: keep.map(j => columns[j]), formula: f };
}

/** Nuisance columns for positions: plate (effect coded), edge, row and column gradients — centred. */
function positionColumns(pos, plates) {
  const labels = [...new Set(pos.map(p => p.plate))].sort((a, b) => a - b);
  const anyEdge = pos.some(p => p.edge), anyInner = pos.some(p => !p.edge);
  const N = pos.map(p => {
    const row = [];
    for (let i = 1; i < labels.length; i++) row.push(p.plate === labels[i] ? 1 : p.plate === labels[0] ? -1 : 0);
    if (anyEdge && anyInner) row.push(p.edge ? 1 : 0);
    if (plates.rows > 1) row.push(p.row);
    if (plates.cols > 1) row.push(p.col);
    return row;
  });
  return N[0]?.length ? centre(N) : null;
}

const posOf = (plates, plate, id) => {
  const q = parseWell(id), k = ring(q, plates.rows, plates.cols);
  return { plate, well: id, edge: k === 0, row: plates.rows > 1 ? (2 * q.r) / (plates.rows - 1) - 1 : 0, col: plates.cols > 1 ? (2 * q.c) / (plates.cols - 1) - 1 : 0 };
};

/**
 * How much a study's layout costs in information about the design's model (or formula), over the
 * runs in wells: { efficiency: (det adjusted / det unadjusted)^(1/p), terms: [{ term, efficiency }]
 * (each coefficient's variance without position ÷ with), worst }. 1 = position costs nothing;
 * null without a layout.
 */
export function layoutReport(study, { formula } = {}) {
  const P = study.plates;
  if (!P || !study.design) return null;
  const runOf = new Map(study.design.runs.map(r => [r.run, r]));
  const placed = P.wells.filter(w => w.run !== undefined && runOf.has(w.run));
  if (placed.length < 2) return null;
  const { cols, names } = factorColumns(study, placed.map(w => runOf.get(w.run)), formula);
  if (!cols) return null;
  const N = positionColumns(placed.map(w => posOf(P, w.plate, w.well)), P);
  const p = cols[0].length;
  let A0, A1;
  try { A0 = cholInverse(chol(infoMatrix(cols, null)).L); A1 = cholInverse(chol(infoMatrix(cols, N)).L); } catch { return { efficiency: 0, terms: [], worst: null }; }
  const terms = names.map((term, j) => ({ term, efficiency: A0[j][j] / A1[j][j] }));
  const worst = terms.reduce((a, t) => (t.efficiency < a.efficiency ? t : a), terms[0]);
  return { efficiency: Math.exp((logInfo(cols, N) - logInfo(cols, null)) / p), terms, worst };
}
/** The layout's D-efficiency (see layoutReport); NaN without a layout. */
export const layoutEfficiency = (study, opts) => layoutReport(study, opts)?.efficiency ?? NaN;

// ---------------------------------------------------------------- layout

/**
 * Lay out a study's runs on plates. opts: format (96, 384, '8x12', or { rows, cols }; default the
 * study's plates or 96), exclude (['edge', 'A01', …]), controls ([{ id, role, perPlate, name }]),
 * layout ('balanced' | 'random' | 'ordered'), seed, formula (the model to protect; default the
 * design's), effort (search size, default 1). Settings already in the study's plates are reused
 * unless given. Returns the study object with plates (and blocks = plates when there are several),
 * and a summary { plates, efficiency, capacity, placed }.
 */
export function layoutPlates(study, opts = {}) {
  if (!study.design?.runs.length) throw new Error('the study has no design to lay out');
  const old = study.plates;
  const geo = opts.format !== undefined ? plateFormat(opts.format) : old ? { rows: old.rows, cols: old.cols } : plateFormat(96);
  const relayout = opts.relayout || !old || (old.rows !== geo.rows || old.cols !== geo.cols);
  const plates = {
    ...geo,
    exclude: opts.exclude ?? old?.exclude ?? [],
    controls: opts.controls ?? old?.controls ?? [],
    layout: opts.layout ?? old?.layout ?? 'balanced',
    seed: opts.seed ?? old?.seed ?? study.seed,
  };
  // validate the geometry and controls (createStudy reports problems)
  createStudy({ ...study, plates: { ...plates, wells: [], readings: [] } });
  const cap = runCapacity(plates);
  if (cap < 1) throw new Error('no wells left for runs');
  const g = rng(plates.seed >>> 0);
  const keep = relayout ? [] : old.wells.filter(w => w.run === undefined || study.design.runs.some(r => r.run === w.run));
  // a re-layout drops the readings too: they belong to the old wells
  const readings = relayout ? [] : old.readings;
  const placedRuns = new Set(keep.filter(w => w.run !== undefined).map(w => w.run));
  const todo = study.design.runs.filter(r => !placedRuns.has(r.run)).sort((a, b) => a.run - b.run);
  let next = keep.length ? Math.max(...keep.map(w => w.plate)) + 1 : 1;
  const wells = keep.slice();
  // groups: runs of one design block share plates; never two blocks on a plate
  const groups = new Map();
  for (const r of todo) { const k = r.block === undefined ? '' : String(r.block); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const usable = usableWells(plates);
  for (const runs of groups.values()) {
    const nPlates = Math.ceil(runs.length / cap);
    const slots = [];
    for (let k = 0; k < nPlates; k++) {
      const plate = next + k;
      const ctl = placeControls(plates, g);
      for (const c of ctl) wells.push({ plate, well: c.well, control: c.control });
      const taken = new Set(ctl.map(c => c.well));
      for (const w of usable) if (!taken.has(w.id)) slots.push(posOf(plates, plate, w.id));
    }
    // spread the runs evenly over the group's plates: drop surplus slots plate by plate
    const per = Array.from({ length: nPlates }, (_, k) => Math.floor(runs.length / nPlates) + (k < runs.length % nPlates ? 1 : 0));
    const assign = arrange(study, runs, slots, per, nPlates, next, plates, g, opts);
    runs.forEach((r, i) => wells.push({ plate: assign[i].plate, well: assign[i].well, run: r.run }));
    next += nPlates;
  }
  wells.sort((a, b) => a.plate - b.plate || parseWell(a.well).r - parseWell(b.well).r || parseWell(a.well).c - parseWell(b.well).c);
  const nPl = new Set(wells.map(w => w.plate)).size;
  const plateOf = new Map(wells.filter(w => w.run !== undefined).map(w => [w.run, w.plate]));
  const design = nPl > 1 ? { ...study.design, runs: study.design.runs.map(r => (plateOf.has(r.run) ? { ...r, block: plateOf.get(r.run) } : r)) } : study.design;
  const out = { ...study, design, plates: { ...plates, wells, readings } };
  const rep = layoutReport(out, { formula: opts.formula });
  const efficiency = rep?.efficiency ?? NaN;
  if (Number.isFinite(efficiency)) out.plates.efficiency = +efficiency.toFixed(4);
  else delete out.plates.efficiency;
  return { study: out, summary: { plates: nPl, capacity: cap, placed: todo.length, efficiency, worst: rep?.worst ?? null } };
}

/** Assign runs to slots: [{ plate, well }] per run, by the layout rule. */
function arrange(study, runs, slots, per, nPlates, first, plates, g, opts) {
  // slots by plate, row by row (the 'ordered' fill)
  const byPlate = Array.from({ length: nPlates }, (_, k) => slots.filter(s => s.plate === first + k));
  if (plates.layout === 'ordered') {
    // the tidy layout: conditions in standard order, replicates side by side, row by row
    const seq = [];
    byPlate.forEach((s, k) => seq.push(...s.slice(0, per[k])));
    const key = (r) => study.factors.map(f => String(r.settings[f.id])).join('|');
    const keys = [...new Set(runs.map(key))];
    const idx = runs.map((r, i) => i).sort((a, b) => keys.indexOf(key(runs[a])) - keys.indexOf(key(runs[b])) || runs[a].run - runs[b].run);
    const out = new Array(runs.length);
    idx.forEach((i, j) => { out[i] = seq[j]; });
    return out;
  }
  // each plate's run count is fixed (per); a candidate = for each plate, an ordered choice of wells
  const pool = byPlate.map(s => s.slice());
  const random = () => {
    const pick = [];
    pool.forEach((s, k) => { const sh = g.shuffle(s); pick.push(...sh.slice(0, per[k]).map(x => ({ x, k }))); });
    return g.shuffle(pick);                                   // runs in random order across plates
  };
  if (plates.layout === 'random' || runs.length < 2) return random().map(p => p.x);
  // balanced: maximise the information about the model after adjusting for position
  const { cols: F } = factorColumns(study, runs, opts.formula);
  if (!F) return random().map(p => p.x);
  const score = (cand) => logInfo(F, positionColumns(cand.map(p => p.x), plates));
  const effort = opts.effort ?? 1;
  const starts = Math.max(2, Math.round(3 * effort)), iters = Math.min(2500, Math.round(20 * runs.length * effort));
  let best = null, bestS = -Infinity;
  for (let s = 0; s < starts; s++) {
    let cur = random(), cs = score(cur);
    // unused wells of each plate, for moves into empty wells
    const used = new Set(cur.map(p => `${p.x.plate}/${p.x.well}`));
    const spare = pool.map(s2 => s2.filter(x => !used.has(`${x.plate}/${x.well}`)));
    for (let it = 0; it < iters; it++) {
      const i = g.int(cur.length);
      const k = cur[i].k;
      const toSpare = spare[k].length && g.random() < spare[k].length / (spare[k].length + per[k]);
      if (toSpare) {
        // move run i to an empty well of its plate
        const j = g.int(spare[k].length), old = cur[i];
        cur[i] = { x: spare[k][j], k };
        const ns = score(cur);
        if (ns >= cs) { spare[k][j] = old.x; cs = ns; } else cur[i] = old;
      } else {
        // swap the wells of two runs (any plates: the plate counts stay as they are)
        const j = g.int(cur.length);
        if (j === i) continue;
        [cur[i], cur[j]] = [cur[j], cur[i]];
        const ns = score(cur);
        if (ns >= cs) cs = ns; else [cur[i], cur[j]] = [cur[j], cur[i]];
      }
    }
    if (cs > bestS) { bestS = cs; best = cur; }
  }
  return best.map(p => p.x);
}

export { wellId, plateNumbers };
