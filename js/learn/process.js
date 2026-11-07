// Virtual processes (spec §16.2, issue #38): a seeded simulator with a hidden true model, for the
// tutorial, the exercise generator, the app's examples and as a test bed.
//
// A process is plain data:
//   { seed, factors: [study factors],
//     responses: [{ id, truth: { intercept, terms: { label: coef } }, sigma, transform?: 'log', decimals? }],
//     nuisance: { wholePlot: sd, block: sd, drift: per run (in σ), outliers: { p, size (σ) },
//                 gauge: { bias }, wafers: n, wafer: sd, site: sd, slot: coef per slot,
//                 plate: { edge, corner, col, colQuad, rowSd, sd } },
//     controls: { id: { mean, sd } } }
// plate: position effects for runs laid out on microplates (study.plates), in the response's
// units (log scale for a log response): edge = shift of the outer ring, corner = extra shift of
// the four corners, col = linear gradient (column coded −1 … +1), colQuad = a bow across the
// columns (coded col², centred), rowSd = a random offset per row and plate (a multichannel
// pipette's channels), sd = plate-to-plate shift. Control wells read controls[id] (mean, sd) plus
// the same position effects.
// Truth terms are labels over coded factor values (−1 … +1; log factors on the log scale):
// 'A', 'A:B', 'I(A^2)', 'I(A*B)', a two-level categorical factor as −1 / +1 (first level −1),
// 'g.L' for an indicator of level L of a categorical factor, and the position terms 'radius2'
// (2ρ² − 1, centre −1 → edge +1) and 'slot' (the boat slot, centred). Interactions of position
// terms with factors are allowed ('T:radius2').
//
// Every random quantity is a deterministic function of (seed, what it is, where it is): the
// run-to-run error of a run depends on (seed, response, settings, replicate index) — the
// replicate index counts earlier runs with the same settings — and a whole plot's or block's
// shift on (seed, its label). So an exercise is reproducible, and repeating a run gives a fresh
// but repeatable draw.
import { code } from '../study.js';
import { runPositions, parseWell, ring } from '../plate.js';
import { sitePositions } from '../model/sites.js';
import { normal } from '../dist.js';

// ---------------------------------------------------------------- hashed randomness

function hash32(str, h = 0x811c9dc5) {             // FNV-1a, then a murmur finaliser
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
/** A uniform in (0, 1) determined by its key parts. */
export function hashUniform(...parts) {
  const s = parts.map(String).join('\u0001');
  const a = hash32(s), b = hash32(s, 0x9747b28c);
  return ((a * 2 ** 21 + (b >>> 11)) + 0.5) / 2 ** 53;
}
/** A standard normal determined by its key parts. */
export const hashNormal = (...parts) => normal.ppf(hashUniform(...parts));

const settingsKey = (factors, s) => factors.map(f => (typeof s[f.id] === 'number' ? +s[f.id].toPrecision(12) : s[f.id])).join('|');

// ---------------------------------------------------------------- the true model

/** Coded value of a component of a truth term. ctx: { coded, factors, radius2, slot }. */
function compValue(comp, ctx) {
  let m;
  if ((m = /^I\((.+)\)$/.exec(comp))) {
    return m[1].split('*').reduce((a, part) => { const [id, p] = part.split('^'); return a * compValue(id.trim(), ctx) ** (p ? Number(p) : 1); }, 1);
  }
  if (comp === 'radius2') return ctx.radius2 ?? 0;
  if (comp === 'slot') return ctx.slot ?? 0;
  if ((m = /^([A-Za-z_]\w*)\.(.+)$/.exec(comp)) && ctx.factorsById[m[1]]?.type === 'categorical') return ctx.raw[m[1]] === m[2] || String(ctx.raw[m[1]]) === m[2] ? 1 : 0;
  const v = ctx.coded[comp];
  if (v === undefined) throw new Error(`truth term "${comp}": no such factor`);
  return v;
}

/** The true mean of a response (on the response's own scale, before nuisance). */
export function trueMean(process, responseId, settings, ctx = {}) {
  const r = process.responses.find(x => x.id === responseId);
  const fById = Object.fromEntries(process.factors.map(f => [f.id, f]));
  const coded = Object.fromEntries(process.factors.map(f => [f.id, f.type === 'categorical' ? (f.levels.length === 2 ? (String(settings[f.id]) === String(f.levels[0]) ? -1 : 1) : 0) : code(f, settings[f.id])]));
  const c = { coded, raw: settings, factorsById: fById, ...ctx };
  let y = r.truth.intercept ?? 0;
  for (const [label, coef] of Object.entries(r.truth.terms ?? {})) y += coef * label.split(':').reduce((a, comp) => a * compValue(comp, c), 1);
  return r.transform === 'log' ? Math.exp(y) : y;
}

// ---------------------------------------------------------------- observing runs

/**
 * Observations for the runs of a study's design: each run's settings through the truth plus the
 * nuisance. opts: runs (run numbers to observe; default those without results), all (every run).
 * Wafers and sites follow each response's measurement levels and study.sites. offset(run,
 * response): an extra shift for nuisance that depends on how the runs were done (exercise.js).
 * Returns observations.
 */
export function observeRuns(process, study, { runs, all = false, offset = null } = {}) {
  if (!study.design) throw new Error('the study has no design to run');
  const n = process.nuisance ?? {}, seed = process.seed;
  const have = new Set(study.observations.filter(o => o.value !== null).map(o => o.run));
  const want = new Set(runs ?? study.design.runs.filter(r => all || !have.has(r.run)).map(r => r.run));
  // replicate index: earlier runs (by run number) with the same settings
  const repOf = new Map(), seen = new Map();
  for (const r of study.design.runs.slice().sort((a, b) => a.run - b.run)) {
    const k = settingsKey(process.factors, r.settings); const i = seen.get(k) ?? 0; seen.set(k, i + 1); repOf.set(r.run, i);
  }
  const P = study.sites ? sitePositions(study) : null;
  const wells = study.plates ? runPositions(study) : null;
  const slotNext = new Map(), out = [];
  for (const r of study.design.runs.slice().sort((a, b) => (a.order ?? a.run) - (b.order ?? b.run))) {
    if (!want.has(r.run)) continue;
    const key = settingsKey(process.factors, r.settings), rep = repOf.get(r.run), order = r.order ?? r.run;
    for (const resp of process.responses) {
      const sr = study.responses.find(x => x.id === resp.id);
      if (!sr || sr.derived) continue;
      const sigma = resp.sigma ?? 1;
      const shared = (n.wholePlot && r.wholePlot !== undefined ? n.wholePlot * hashNormal(seed, resp.id, 'wp', r.wholePlot) : 0)
        + (n.block && r.block !== undefined ? n.block * hashNormal(seed, resp.id, 'block', r.block) : 0)
        + (n.drift ? n.drift * sigma * (order - 1) : 0)
        + sigma * hashNormal(seed, resp.id, 'run', key, rep)
        + (offset ? offset(r.run, resp.id) : 0)
        + (n.plate && wells?.has(r.run) ? plateEffect(process, study, resp.id, wells.get(r.run)) : 0);
      const outlier = n.outliers && hashUniform(seed, resp.id, 'outlier', key, rep) < n.outliers.p ? (hashUniform(seed, resp.id, 'osign', key, rep) < 0.5 ? -1 : 1) * n.outliers.size * sigma : 0;
      const bias = n.gauge?.bias ?? 0;
      const levels = sr.levels ?? ['run'];
      const finish = (v) => { const y = (resp.transform === 'log' ? v : v) + bias; return resp.decimals !== undefined ? +y.toFixed(resp.decimals) : y; };
      const mean = (ctx) => {
        if (resp.transform === 'log') return Math.exp(Math.log(trueMean(process, resp.id, r.settings, ctx)) + shared + outlier);
        return trueMean(process, resp.id, r.settings, ctx) + shared + outlier;
      };
      if (!levels.includes('wafer') && !levels.includes('site')) { out.push({ run: r.run, response: resp.id, value: finish(mean({})) }); continue; }
      const nW = levels.includes('wafer') ? (n.wafers ?? 1) : 1;
      for (let w = 1; w <= nW; w++) {
        const wafer = levels.includes('wafer') ? `${r.run}W${w}` : undefined;
        const slot = r.wholePlot !== undefined ? (slotNext.get(r.wholePlot) ?? 0) + 1 : w;
        if (r.wholePlot !== undefined) slotNext.set(r.wholePlot, slot);
        const waf = n.wafer ? n.wafer * hashNormal(seed, resp.id, 'wafer', key, rep, w) : 0;
        const slotEff = n.slot ? n.slot * (slot - (n.slotCentre ?? 4.5)) : 0;
        const sites = levels.includes('site') && P ? [...P] : [[undefined, null]];
        for (const [site, p] of sites) {
          const ctx = p ? { radius2: 2 * p.rho ** 2 - 1, slot: slot - (n.slotCentre ?? 4.5) } : { slot: slot - (n.slotCentre ?? 4.5) };
          const e = (n.site && site !== undefined ? n.site * hashNormal(seed, resp.id, 'site', key, rep, w, site) : 0);
          out.push({ run: r.run, ...(wafer !== undefined ? { wafer } : {}), ...(site !== undefined ? { site } : {}), ...(levels.includes('wafer') ? { slot } : {}), response: resp.id, value: finish(mean(ctx) + waf + slotEff + e) });
        }
      }
    }
  }
  return out;
}

/** Position effect of a well on a plate (process.nuisance.plate), for one response. */
export function plateEffect(process, study, response, pos) {
  const q = process.nuisance?.plate ?? {}, seed = process.seed, P = study.plates;
  const corner = (pos.r === 0 || pos.r === P.rows - 1) && (pos.c === 0 || pos.c === P.cols - 1);
  return (q.edge && pos.ring === 0 ? q.edge : 0) + (q.corner && corner ? q.corner : 0)
    + (q.col ? q.col * pos.col : 0) + (q.colQuad ? q.colQuad * (pos.col ** 2 - 1 / 3) : 0)
    + (q.rowSd ? q.rowSd * hashNormal(seed, response, 'plate-row', pos.plate, pos.r) : 0)
    + (q.sd ? q.sd * hashNormal(seed, response, 'plate', pos.plate) : 0);
}

/** Readings of the control wells (process.controls), for plates that hold the given runs. */
export function observeControls(process, study, { plates } = {}) {
  const P = study.plates;
  if (!P || !process.controls) return [];
  const want = plates ?? new Set(P.wells.map(w => w.plate));
  const out = [];
  for (const w of P.wells) if (w.control !== undefined && want.has(w.plate)) {
    const q = parseWell(w.well), k = ring(q, P.rows, P.cols);
    const pos = { plate: w.plate, r: q.r, c: q.c, ring: k, col: P.cols > 1 ? (2 * q.c) / (P.cols - 1) - 1 : 0 };
    for (const resp of process.responses) {
      const c = process.controls[w.control]?.[resp.id] ?? process.controls[w.control];
      if (!c || !Number.isFinite(c.mean)) continue;
      const e = (c.sd ?? 0) * hashNormal(process.seed, resp.id, 'control', w.plate, w.well);
      const sh = process.nuisance?.plate ? plateEffect(process, study, resp.id, pos) : 0;
      let v = resp.transform === 'log' ? Math.exp(Math.log(c.mean) + sh + e) : c.mean + sh + e;
      if (resp.decimals !== undefined) v = +v.toFixed(resp.decimals);
      out.push({ plate: w.plate, well: w.well, response: resp.id, value: v });
    }
  }
  return out;
}

/** The study with the process's results filled in (runs without results; all: every run). */
export function runVirtual(process, study, opts = {}) {
  const obs = observeRuns(process, study, opts);
  const done = new Set(obs.map(o => o.run));
  const out = { ...study, observations: [...study.observations.filter(o => !done.has(o.run)), ...obs] };
  if (study.plates && process.controls) {
    // the controls of plates whose runs were just observed (and that have no readings yet)
    const plateOf = new Map(study.plates.wells.filter(w => w.run !== undefined).map(w => [w.run, w.plate]));
    const read = new Set(study.plates.readings.map(x => x.plate));
    const plates = new Set([...done].map(r => plateOf.get(r)).filter(p => p !== undefined && !read.has(p)));
    out.plates = { ...study.plates, readings: [...study.plates.readings, ...observeControls(process, study, { plates })] };
  }
  return out;
}
