// Microplates (issue #63): geometry, well ids, the plates part of a study, positions of runs, and
// assay quality (Z′). No dependencies, so the study format can use it; the layout search is in
// design/plate-layout.js and the position terms of the analysis in model/ols.js.
//
// A study's plates: {
//   rows, cols,                       // geometry, e.g. 8 × 12 for a 96-well plate
//   exclude: ['edge', 'A05', …],      // wells not used ('edge' = the outer ring)
//   controls: [{ id, name?, role: positive | negative | blank | standard | other, perPlate }],
//   layout: 'balanced' | 'random' | 'ordered', seed?, efficiency?,
//   wells: [{ plate, well, run } | { plate, well, control }],
//   readings: [{ plate, well, response, value }]     // results of control wells
// }
// Each run sits in one well; the run's block is its plate (set by the layout), so plate-to-plate
// shifts are taken out as a block effect, and the analysis adds terms for the edge and for row and
// column gradients.

export const FORMATS = { 6: [2, 3], 12: [3, 4], 24: [4, 6], 48: [6, 8], 96: [8, 12], 384: [16, 24], 1536: [32, 48] };
export const ROLES = ['positive', 'negative', 'blank', 'standard', 'other'];
export const LAYOUTS = ['balanced', 'random', 'ordered'];
const PLATE_KEYS = ['rows', 'cols', 'exclude', 'controls', 'layout', 'seed', 'efficiency', 'wells', 'readings'];
const ID = /^[A-Za-z_][A-Za-z0-9_]*$/;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Row label of row index r (0-based): A … Z, AA … AF. */
export const rowLabel = (r) => (r < 26 ? String.fromCharCode(65 + r) : String.fromCharCode(64 + Math.floor(r / 26)) + String.fromCharCode(65 + (r % 26)));
/** Well id: row label + two-digit column ('B07'). */
export const wellId = (r, c) => `${rowLabel(r)}${String(c + 1).padStart(2, '0')}`;
/** Parse a well id ('B7', 'B07', 'AF48') → { r, c } (0-based), or null. */
export function parseWell(id) {
  const m = /^([A-Z]{1,2})0*([1-9]\d*)$/.exec(String(id).trim().toUpperCase());
  if (!m) return null;
  const L = m[1], r = L.length === 1 ? L.charCodeAt(0) - 65 : (L.charCodeAt(0) - 64) * 26 + L.charCodeAt(1) - 65;
  return { r, c: Number(m[2]) - 1 };
}

/** Distance from the plate edge in wells: 0 for the outer ring. */
export const ring = (p, rows, cols) => Math.min(p.r, rows - 1 - p.r, p.c, cols - 1 - p.c);

/** All wells of a plate, row by row: [{ id, r, c, ring }]. */
export function allWells(rows, cols) {
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ id: wellId(r, c), r, c, ring: ring({ r, c }, rows, cols) });
  return out;
}

/** The wells in use (not excluded), row by row. */
export function usableWells(plates) {
  const ex = excludedSet(plates);
  return allWells(plates.rows, plates.cols).filter(w => !ex.has(w.id));
}
export function excludedSet(plates) {
  const s = new Set();
  for (const e of plates.exclude ?? []) {
    if (e === 'edge') { for (const w of allWells(plates.rows, plates.cols)) if (w.ring === 0) s.add(w.id); }
    else { const p = parseWell(e); if (p) s.add(wellId(p.r, p.c)); }
  }
  return s;
}

/** Wells per plate available for runs: usable wells less the controls. */
export const runCapacity = (plates) => usableWells(plates).length - (plates.controls ?? []).reduce((a, c) => a + c.perPlate, 0);

/**
 * Position of each run: Map run → { plate, well, r, c, ring, edge, row, col } with row and col
 * coded −1 … +1 over the plate (gradients) and edge true for the outer ring.
 */
export function runPositions(study) {
  const P = study.plates, out = new Map();
  if (!P) return out;
  for (const w of P.wells) if (w.run !== undefined) {
    const p = parseWell(w.well);
    out.set(w.run, { plate: w.plate, well: w.well, r: p.r, c: p.c, ring: ring(p, P.rows, P.cols), edge: ring(p, P.rows, P.cols) === 0,
      row: P.rows > 1 ? (2 * p.r) / (P.rows - 1) - 1 : 0, col: P.cols > 1 ? (2 * p.c) / (P.cols - 1) - 1 : 0 });
  }
  return out;
}

/** The study's plates without the wells and readings (for a new design): { plates } or {}. */
export const platesWithoutWells = (study) => (study.plates ? { plates: { ...study.plates, wells: [], readings: [] } } : {});

/** Plate numbers in use, ascending. */
export const plateNumbers = (study) => [...new Set((study.plates?.wells ?? []).map(w => w.plate))].sort((a, b) => a - b);

/** Validate and normalise a study's plates (errors and warnings pushed). */
export function normPlates(p, design, responses, errors, warnings) {
  if (p === undefined) return undefined;
  if (!isObj(p)) { errors.push('plates: must be an object'); return undefined; }
  for (const k of Object.keys(p)) if (!PLATE_KEYS.includes(k)) errors.push(`plates.${k}: unknown key (allowed: ${PLATE_KEYS.join(', ')})`);
  const out = { rows: p.rows, cols: p.cols };
  if (!Number.isInteger(p.rows) || p.rows < 1 || p.rows > 32) errors.push('plates.rows: must be an integer 1 … 32');
  if (!Number.isInteger(p.cols) || p.cols < 1 || p.cols > 48) errors.push('plates.cols: must be an integer 1 … 48');
  if (errors.some(e => e.startsWith('plates.rows') || e.startsWith('plates.cols'))) return out;
  const inside = (w) => { const q = parseWell(w); return q && q.r < out.rows && q.c < out.cols ? wellId(q.r, q.c) : null; };
  out.exclude = [];
  if (p.exclude !== undefined) {
    if (!Array.isArray(p.exclude)) errors.push('plates.exclude: must be a list of well ids, or "edge"');
    else for (const e of p.exclude) {
      if (e === 'edge') { if (!out.exclude.includes('edge')) out.exclude.push('edge'); continue; }
      const w = inside(e);
      if (!w) errors.push(`plates.exclude: ${JSON.stringify(e)} is not a well of a ${out.rows} × ${out.cols} plate`);
      else if (!out.exclude.includes(w)) out.exclude.push(w);
    }
  }
  out.controls = [];
  if (p.controls !== undefined) {
    if (!Array.isArray(p.controls)) errors.push('plates.controls: must be a list');
    else p.controls.forEach((c, i) => {
      const path = `plates.controls[${i}]`;
      if (!isObj(c)) { errors.push(`${path}: must be an object`); return; }
      for (const k of Object.keys(c)) if (!['id', 'name', 'role', 'perPlate'].includes(k)) errors.push(`${path}.${k}: unknown key`);
      if (typeof c.id !== 'string' || !ID.test(c.id)) errors.push(`${path}.id: must be an identifier`);
      else if (out.controls.some(x => x.id === c.id)) errors.push(`${path}.id: duplicate control "${c.id}"`);
      const role = c.role ?? 'other';
      if (!ROLES.includes(role)) errors.push(`${path}.role: must be one of ${ROLES.join(', ')}`);
      if (!Number.isInteger(c.perPlate) || c.perPlate < 1) errors.push(`${path}.perPlate: must be a positive integer (wells per plate)`);
      out.controls.push({ id: c.id, name: c.name ?? c.id, role, perPlate: c.perPlate });
    });
  }
  out.layout = p.layout ?? 'balanced';
  if (!LAYOUTS.includes(out.layout)) errors.push(`plates.layout: must be one of ${LAYOUTS.join(', ')}`);
  if (p.seed !== undefined) { if (!Number.isInteger(p.seed) || p.seed < 0 || p.seed > 0xffffffff) errors.push('plates.seed: must be an integer 0 … 4294967295'); else out.seed = p.seed; }
  if (p.efficiency !== undefined) { if (!isNum(p.efficiency)) errors.push('plates.efficiency: must be a number'); else out.efficiency = p.efficiency; }
  const ex = excludedSet(out);
  const usable = out.rows * out.cols - ex.size;
  const nCtl = out.controls.reduce((a, c) => a + (c.perPlate || 0), 0);
  if (nCtl >= usable) errors.push(`plates.controls: ${nCtl} control wells per plate leave no room for runs (${usable} wells in use)`);
  // wells
  out.wells = [];
  const runs = new Set(design ? design.runs.map(r => r.run) : []);
  const seenWell = new Set(), seenRun = new Set(), ctlCount = new Map();
  if (p.wells !== undefined && !Array.isArray(p.wells)) errors.push('plates.wells: must be a list');
  for (const [i, w] of (Array.isArray(p.wells) ? p.wells : []).entries()) {
    const path = `plates.wells[${i}]`;
    if (!isObj(w)) { errors.push(`${path}: must be an object`); continue; }
    for (const k of Object.keys(w)) if (!['plate', 'well', 'run', 'control'].includes(k)) errors.push(`${path}.${k}: unknown key`);
    if (!Number.isInteger(w.plate) || w.plate < 1) errors.push(`${path}.plate: must be a positive integer`);
    const id = inside(w.well);
    if (!id) { errors.push(`${path}.well: ${JSON.stringify(w.well)} is not a well of a ${out.rows} × ${out.cols} plate`); continue; }
    if (ex.has(id)) errors.push(`${path}: well ${id} is excluded`);
    const key = `${w.plate}/${id}`;
    if (seenWell.has(key)) errors.push(`${path}: plate ${w.plate} well ${id} is used twice`);
    seenWell.add(key);
    if ((w.run === undefined) === (w.control === undefined)) { errors.push(`${path}: give either a run or a control`); continue; }
    if (w.run !== undefined) {
      if (!runs.has(w.run)) errors.push(`${path}.run: no run ${JSON.stringify(w.run)} in the design`);
      else if (seenRun.has(w.run)) errors.push(`${path}.run: run ${w.run} is in more than one well`);
      seenRun.add(w.run);
      out.wells.push({ plate: w.plate, well: id, run: w.run });
    } else {
      if (!out.controls.some(c => c.id === w.control)) errors.push(`${path}.control: unknown control ${JSON.stringify(w.control)}`);
      ctlCount.set(`${w.control}/${w.plate}`, (ctlCount.get(`${w.control}/${w.plate}`) ?? 0) + 1);
      out.wells.push({ plate: w.plate, well: id, control: w.control });
    }
  }
  if (out.wells.length && design) {
    const missing = design.runs.filter(r => !seenRun.has(r.run)).map(r => r.run);
    if (missing.length) warnings.push(`plates: run${missing.length > 1 ? 's' : ''} ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''} not in a well yet (lay out the new runs)`);
  }
  // control readings
  out.readings = [];
  const ctlWells = new Set(out.wells.filter(w => w.control).map(w => `${w.plate}/${w.well}`));
  const rids = new Set(responses.map(r => r.id));
  if (p.readings !== undefined && !Array.isArray(p.readings)) errors.push('plates.readings: must be a list');
  for (const [i, x] of (Array.isArray(p.readings) ? p.readings : []).entries()) {
    const path = `plates.readings[${i}]`;
    if (!isObj(x)) { errors.push(`${path}: must be an object`); continue; }
    const id = inside(x.well);
    if (!id || !ctlWells.has(`${x.plate}/${id}`)) errors.push(`${path}: plate ${x.plate} well ${x.well} is not a control well`);
    if (!rids.has(x.response)) errors.push(`${path}.response: unknown response ${JSON.stringify(x.response)}`);
    if (!(x.value === null || isNum(x.value))) errors.push(`${path}.value: must be a number or null`);
    out.readings.push({ plate: x.plate, well: id ?? x.well, response: x.response, value: x.value });
  }
  return out;
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

/**
 * Assay quality from the controls, per plate and response: Z′ = 1 − 3 (σ₊ + σ₋) / |μ₊ − μ₋|
 * (Zhang, Chung & Oldenburg 1999), from the positive and negative controls' readings, with each
 * control's mean, sd and n. Z′ ≥ 0.5 is usually taken as an excellent assay, 0 … 0.5 marginal.
 */
export function controlSummary(study, response) {
  const P = study.plates;
  if (!P) return [];
  const role = Object.fromEntries(P.controls.map(c => [c.id, c.role]));
  const ctlOf = new Map(P.wells.filter(w => w.control).map(w => [`${w.plate}/${w.well}`, w.control]));
  const out = [];
  for (const plate of plateNumbers(study)) {
    const by = {};
    for (const x of P.readings) if (x.plate === plate && x.response === response && x.value !== null) {
      const c = ctlOf.get(`${x.plate}/${x.well}`);
      (by[c] ??= []).push(x.value);
    }
    const controls = Object.entries(by).map(([id, v]) => ({ id, role: role[id], n: v.length, mean: mean(v), sd: v.length > 1 ? sd(v) : NaN }));
    const pos = controls.find(c => c.role === 'positive'), neg = controls.find(c => c.role === 'negative');
    const zPrime = pos && neg && pos.n > 1 && neg.n > 1 ? 1 - 3 * (pos.sd + neg.sd) / Math.abs(pos.mean - neg.mean) : NaN;
    out.push({ plate, controls, zPrime });
  }
  return out;
}

/** Plate map as text: one grid per plate, cells = run number, control id, '·' empty, 'x' excluded. */
export function plateMapText(study) {
  const P = study.plates;
  if (!P) return '';
  const ex = excludedSet(P), at = new Map(P.wells.map(w => [`${w.plate}/${w.well}`, w.run !== undefined ? String(w.run) : w.control]));
  const width = Math.max(3, ...[...at.values()].map(s => s.length));
  const pad = (s) => s.padStart(width);
  const lines = [];
  for (const plate of plateNumbers(study)) {
    lines.push(`plate ${plate}`);
    lines.push(`${' '.repeat(3)}${Array.from({ length: P.cols }, (_, c) => pad(String(c + 1))).join(' ')}`);
    for (let r = 0; r < P.rows; r++) {
      const cells = Array.from({ length: P.cols }, (_, c) => { const id = wellId(r, c); return pad(ex.has(id) ? 'x' : at.get(`${plate}/${id}`) ?? '·'); });
      lines.push(`${rowLabel(r).padEnd(3)}${cells.join(' ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
