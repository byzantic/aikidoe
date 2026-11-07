// Run sheets and results import (spec §11, issue #7).
//
//   runSheet(study)                  → { header, rows } in execution order, wide layout
//   runSheetCSV(study, opts)         → CSV text of the run sheet (existing results filled in)
//   runSheetHTML(study, opts)        → printable, self-contained HTML run sheet
//   observationsCSV(study)           → long-format CSV of all observations
//   importResults(study, text, opts) → { format, observations, problems, mapping }
//   applyResults(study, imported, { mode })  → new study with the observations merged
//
// Wide layout: one row per run (or per run × wafer × repeat when there are several), one
// column per response, or per response and drop-in site ("Rs@C") when the response is measured
// at sites and the study has a site scheme. Long layout: one row per observation with columns
// run, response, value and optional lot, wafer, site, slot, operator, repeat, note.
//
// In result cells, blank means "not measured" (no observation); NA, -, null etc. record an
// explicit missing value (an observation whose value is null).
//
// Counts and proportions (issue #64): a binomial response without a fixed number of trials gets a
// column "<id>.trials" (the trials of each run), a count response with the log link a column
// "<id>.exposure" (volume plated, cells counted, area …; blank for 1). In long format: columns
// trials and exposure.
import { parseCSV, writeCSV, parseNumber, guessDecimal, records, detectDelimiter } from './csv.js';
import { createStudy } from '../study.js';
import { parseWell, wellId, excludedSet, plateNumbers, rowLabel } from '../plate.js';

const META = ['lot', 'wafer', 'slot', 'operator', 'repeat'];
const sortedRuns = (study) => (study.design?.runs ?? []).slice().sort((a, b) => a.order - b.order);
const has = (study, key) => (study.design?.runs ?? []).some(r => r[key] !== undefined);
const nested = (study, level) => study.responses.some(r => !r.derived && r.levels.includes(level));
const siteIds = (study) => (study.sites?.positions ?? []).map(p => String(p.id));
const usesSites = (study, r) => r.levels.includes('site') && siteIds(study).length > 0;
const wellOf = (study) => new Map((study.plates?.wells ?? []).filter(w => w.run !== undefined).map(w => [w.run, w]));

const COUNT = ['poisson', 'quasipoisson', 'negbin'], PROP = ['binomial', 'quasibinomial'];
/** The extra columns a response needs: 'trials' (binomial, trials not fixed), 'exposure' (counts, log link). */
export const auxFields = (r) => [
  ...(PROP.includes(r.distribution) && r.trials === undefined ? ['trials'] : []),
  ...(COUNT.includes(r.distribution) && (r.link ?? 'log') === 'log' ? ['exposure'] : []),
];

/** Result columns: [{ header, response, site, aux? }] (aux: 'trials' or 'exposure' of the response). */
function resultColumns(study) {
  const out = [];
  for (const r of study.responses.filter(x => !x.derived)) {
    if (usesSites(study, r)) for (const s of study.sites.positions) out.push({ header: `${r.id}@${s.id}`, response: r.id, site: s.id });
    else out.push({ header: r.id, response: r.id });
    for (const a of auxFields(r)) out.push({ header: `${r.id}.${a}`, response: r.id, aux: a });
  }
  return out;
}

function metaColumns(study) {
  const used = new Set(study.observations.flatMap(o => META.filter(k => o[k] !== undefined)));
  if (nested(study, 'lot')) used.add('lot');
  if (nested(study, 'wafer')) { used.add('wafer'); used.add('slot'); }
  return META.filter(k => used.has(k));
}

/** The run sheet as header and rows of cell values (numbers, strings, null, or ''). */
export function runSheet(study) {
  if (!study.design) throw new Error('the study has no design yet');
  const meta = metaColumns(study), res = resultColumns(study);
  const W = wellOf(study), plated = W.size > 0;
  const header = ['order', 'run', ...(plated ? ['plate', 'well'] : []), ...(has(study, 'wholePlot') ? ['wholePlot'] : []), ...(has(study, 'block') ? ['block'] : []), 'kind',
    ...study.factors.map(f => f.id), ...meta, ...res.map(c => c.header), 'note'];
  const rows = [];
  for (const run of sortedRuns(study)) {
    const obs = study.observations.filter(o => o.run === run.run);
    // one row per combination of the meta fields seen for this run
    const groups = new Map();
    for (const o of obs) {
      const key = JSON.stringify(meta.map(k => o[k] ?? null));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    }
    if (!groups.size) groups.set(JSON.stringify(meta.map(() => null)), []);
    for (const [key, list] of groups) {
      const mv = JSON.parse(key);
      const cells = res.map(c => {
        const hit = list.filter(o => o.response === c.response && (c.site === undefined ? o.site === undefined : String(o.site) === String(c.site)));
        if (hit.length > 1) throw new Error(`run ${run.run}: several values for ${c.header} with the same ${meta.join('/') || 'run'}; export the observations in long format instead`);
        if (c.aux) return hit.length ? hit[0][c.aux] ?? '' : '';
        return hit.length ? (hit[0].value === null ? 'NA' : hit[0].value) : '';
      });
      const notes = [...new Set(list.map(o => o.note).filter(Boolean))].join('; ');
      rows.push([run.order, run.run, ...(plated ? [W.get(run.run)?.plate ?? '', W.get(run.run)?.well ?? ''] : []), ...(has(study, 'wholePlot') ? [run.wholePlot ?? ''] : []), ...(has(study, 'block') ? [run.block ?? ''] : []), run.kind,
        ...study.factors.map(f => run.settings[f.id]), ...mv.map(v => v ?? ''), ...cells, notes]);
    }
  }
  return { header, rows, resultColumns: res, metaColumns: meta };
}

export function runSheetCSV(study, { delimiter = ',' } = {}) {
  const s = runSheet(study);
  return writeCSV(s.header, s.rows, { delimiter });
}

// numbers on the printed sheet: 6 significant digits, exponent form for very large or small
// values (1e15, not 1000000000000000); the CSV keeps full precision
const show = (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || Number.isInteger(v) && Math.abs(v) < 1e6) return v;
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(5).replace(/\.?0+e/, 'e').replace('e+', 'e');
  return String(Number(v.toPrecision(6)));
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Printable HTML run sheet. opts: title, date (string; omitted by default so output is reproducible). */
export function runSheetHTML(study, { title, date } = {}) {
  const s = runSheet(study);
  const group = has(study, 'wholePlot') ? 'wholePlot' : has(study, 'block') ? 'block' : null;
  const gi = group ? s.header.indexOf(group) : -1;
  const label = (h) => {
    const f = study.factors.find(x => x.id === h);
    if (f) return `${esc(f.name)}${f.units ? ` <span class="u">(${esc(f.units)})</span>` : ''}`;
    const ax = /^(.*)\.(trials|exposure)$/.exec(h), ar = ax && study.responses.find(x => x.id === ax[1]);
    if (ar) return `${esc(ar.name)} <span class="u">(${ax[2]})</span>`;
    const r = study.responses.find(x => x.id === h.split('@')[0]);
    if (r) { const site = h.includes('@') ? ` @ ${esc(h.split('@')[1])}` : ''; return `${esc(r.name)}${site}${r.units ? ` <span class="u">(${esc(r.units)})</span>` : ''}`; }
    return esc({ order: 'Order', run: 'Run', plate: 'Plate', well: 'Well', wholePlot: 'Whole plot', block: 'Block', kind: 'Type', note: 'Notes',
      lot: 'Lot', wafer: 'Wafer', slot: 'Slot', operator: 'Operator', repeat: 'Repeat' }[h] ?? h);
  };
  const resStart = s.header.length - 1 - s.resultColumns.length;
  let body = '', prev;
  for (const r of s.rows) {
    if (group && r[gi] !== prev) {
      const set = group === 'wholePlot' ? study.factors.filter(f => f.htc).map(f => `${esc(f.name)} ${esc(show(r[s.header.indexOf(f.id)]))}${f.units ? ` ${esc(f.units)}` : ''}`).join(', ') : '';
      body += `<tr class="g"><th colspan="${s.header.length}">${group === 'wholePlot' ? 'Whole plot' : 'Block'} ${esc(r[gi])}${set ? ` <span class="u">— set once: ${set}</span>` : ''}</th></tr>\n`;
      prev = r[gi];
    }
    body += '<tr>' + r.map((v, j) => `<td${j >= resStart ? ' class="res"' : typeof v === 'number' ? ' class="n"' : ''}>${esc(show(v))}</td>`).join('') + '</tr>\n';
  }
  const rand = study.design.randomisation;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title ?? `${study.name} – run sheet`)}</title>
<style>
  body { font: 13px/1.4 system-ui, sans-serif; margin: 16px; color: #111; background: #fff; }
  h1 { font-size: 18px; margin: 0 0 4px; } p.meta { margin: 0 0 12px; color: #444; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #999; padding: 3px 6px; text-align: left; vertical-align: top; }
  thead th { background: #eee; } .u { font-weight: normal; color: #555; }
  td.n { text-align: right; font-variant-numeric: tabular-nums; } td.res { min-width: 5em; background: #fffdf0; }
  tr.g th { background: #f4f4f4; border-top: 2px solid #333; }
  .wrap { overflow-x: auto; }
  @page { size: landscape; margin: 10mm; }
  @media print { body { margin: 0; font-size: 11px; } .wrap { overflow: visible; } tr { break-inside: avoid; } td.res { background: none; } }
</style></head><body>
<h1>${esc(title ?? study.name)} – run sheet</h1>
<p class="meta">${s.rows.length} rows · ${esc(study.design.kind)} · randomisation: ${esc(rand)} · seed ${esc(study.design.params?.seed ?? study.seed)}${date ? ` · ${esc(date)}` : ''}. Run in the order shown. Leave a result blank if it was not measured; write NA if the measurement failed.</p>
<div class="wrap"><table><thead><tr>${s.header.map(h => `<th>${label(h)}</th>`).join('')}</tr></thead>
<tbody>
${body}</tbody></table></div>
</body></html>
`;
}

/** All observations as a long-format CSV. */
export function observationsCSV(study, { delimiter = ',' } = {}) {
  const opt = ['trials', 'exposure', 'lot', 'wafer', 'site', 'slot', 'operator', 'repeat', 'note'].filter(k => study.observations.some(o => o[k] !== undefined));
  const header = ['run', 'response', 'value', ...opt];
  const rows = study.observations.map(o => [o.run, o.response, o.value === null ? 'NA' : o.value, ...opt.map(k => o[k] ?? '')]);
  return writeCSV(header, rows, { delimiter });
}

// ---------------------------------------------------------------- import

const median = (a) => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const norm = (h) => h.toLowerCase().replace(/\s*[([].*?[)\]]\s*$/, '').replace(/[\s_#.-]+/g, '');
const label = (s) => { const t = String(s).trim(); return /^-?(0|[1-9]\d*)$/.test(t) ? Number(t) : t; };

/**
 * Map file columns to roles. Returns { mapping: { header → role }, unmatched: [headers] }.
 * Roles: 'run', 'response', 'value', 'site', 'note', a META field, { factor }, { result: {response, site} },
 * or 'ignore' for sheet columns that are not read back (order, whole plot, block, type).
 */
function mapColumns(study, header, given = {}) {
  const mapping = {}, unmatched = [];
  // ids match exactly (they are case-sensitive: T and t can be different factors); names, and
  // ids written differently, match loosely only when that is unambiguous
  const lookup = (items) => {
    const exact = new Map(items.map(x => [x.id, x])), loose = new Map(), count = new Map();
    for (const x of items) for (const k of new Set([norm(x.id), norm(x.name)])) { loose.set(k, x); count.set(k, (count.get(k) || 0) + 1); }
    return { has: (h) => exact.has(h.trim()) || count.get(norm(h)) === 1, get: (h) => exact.get(h.trim()) ?? loose.get(norm(h)) };
  };
  const resp = lookup(study.responses.filter(x => !x.derived)), fac = lookup(study.factors);
  for (const h of header) {
    if (given[h] !== undefined) { mapping[h] = given[h]; continue; }
    const k = norm(h);
    if (['run', 'runid', 'runno', 'runnumber'].includes(k)) mapping[h] = 'run';
    else if (['order', 'runorder', 'wholeplot', 'block', 'kind', 'type'].includes(k)) mapping[h] = 'ignore';
    else if (['plate', 'plateno', 'platenumber', 'plateid'].includes(k)) mapping[h] = 'plate';
    else if (['well', 'wellid', 'position', 'wellposition'].includes(k)) mapping[h] = 'well';
    else if (['response', 'value', 'site'].includes(k)) mapping[h] = k;
    else if (['note', 'notes', 'comment', 'comments'].includes(k)) mapping[h] = 'note';
    else if (META.includes(k)) mapping[h] = k;
    else if (k === 'trials' || k === 'exposure') mapping[h] = k;
    else if (/\.(trials|exposure)$/.test(h.trim()) && resp.has(h.trim().replace(/\.(trials|exposure)$/, ''))) mapping[h] = { aux: { response: resp.get(h.trim().replace(/\.(trials|exposure)$/, '')).id, key: /trials$/.test(h.trim()) ? 'trials' : 'exposure' } };
    else if (h.includes('@') && resp.has(h.slice(0, h.indexOf('@')))) mapping[h] = { result: { response: resp.get(h.slice(0, h.indexOf('@'))).id, site: label(h.slice(h.indexOf('@') + 1)) } };
    else if (resp.has(h)) mapping[h] = { result: { response: resp.get(h).id } };
    else if (fac.has(h)) mapping[h] = { factor: fac.get(h).id };
    else { mapping[h] = 'ignore'; unmatched.push(h); }
  }
  return { mapping, unmatched };
}

/**
 * Read results from CSV text (a filled run sheet, or long format). opts: mapping (header → role
 * overrides), decimal ('.' | ','; detected), outlierZ (robust z above which values are flagged;
 * default 5). Nothing is changed in the study; see applyResults.
 * Problems: { severity: 'error' | 'warning' | 'info', line, column, message }.
 */
export function importResults(study, text, opts = {}) {
  const { header, rows, delimiter } = parseCSV(text);
  const { mapping, unmatched } = mapColumns(study, header, opts.mapping);
  const problems = [];
  const err = (line, column, message) => problems.push({ severity: 'error', line, column, message });
  const warn = (line, column, message) => problems.push({ severity: 'warning', line, column, message });
  const roles = header.map(h => mapping[h]);
  const col = (role) => roles.findIndex(r => r === role);
  const iRun = col('run'), iPlate = col('plate'), iWell = col('well');
  const byWell = new Map((study.plates?.wells ?? []).map(w => [`${w.plate}/${w.well}`, w]));
  const plated = iPlate >= 0 && iWell >= 0 && byWell.size > 0;
  if (iRun < 0 && !plated) { err(1, null, study.plates ? 'no "run" column, and no "plate" and "well" columns: the file must say which run (or well) each row belongs to' : 'no "run" column: the file must say which run each row belongs to'); return { format: null, observations: [], readings: [], problems, mapping, unmatched }; }
  const long = col('response') >= 0 && col('value') >= 0;
  const runs = new Map((study.design?.runs ?? []).map(r => [r.run, r]));
  const sites = siteIds(study);
  const decimals = header.map((_, j) => opts.decimal ?? guessDecimal(rows.map(r => r[j]), delimiter));
  const num = (s, j) => parseNumber(s, { decimal: decimals[j] });
  for (const h of unmatched) warn(1, h, `column "${h}" is not a run, factor, response or measurement field and was ignored`);

  const obs = [], readings = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    if (r.every(v => v.trim() === '')) return;
    // the well, when the file has plate and well columns
    let w = null;
    if (plated && (r[iPlate].trim() !== '' || r[iWell].trim() !== '')) {
      const q = parseWell(r[iWell]), pl = num(r[iPlate], iPlate);
      w = q ? byWell.get(`${pl}/${wellId(q.r, q.c)}`) : null;
      if (!w) { err(line, header[iWell], `plate ${r[iPlate]} well ${r[iWell]} is not in the layout${q && excludedSet(study.plates).has(wellId(q.r, q.c)) ? ' (an excluded well)' : ''}`); return; }
    }
    if (w && w.control !== undefined) {
      // a control well: its readings go to plates.readings
      const values = [];
      if (long) {
        const rid = r[col('response')].trim(), resp = study.responses.find(x => x.id === rid || norm(x.name) === norm(rid));
        if (!resp) { err(line, header[col('response')], `unknown response "${rid}"`); return; }
        values.push([resp.id, col('value')]);
      } else roles.forEach((role, j) => { if (role?.result && role.result.site === undefined) values.push([role.result.response, j]); });
      for (const [response, j] of values) {
        const v = num(r[j], j);
        if (v === undefined) continue;
        if (Number.isNaN(v)) { err(line, header[j], `"${r[j]}" is not a number`); continue; }
        readings.push({ plate: w.plate, well: w.well, response, value: v });
      }
      return;
    }
    const runN = iRun >= 0 && r[iRun].trim() !== '' ? num(r[iRun], iRun) : w?.run;
    const run = runs.get(runN);
    if (!run) { err(line, header[iRun >= 0 ? iRun : iWell], `run ${JSON.stringify(iRun >= 0 ? r[iRun] : runN)} is not in the design`); return; }
    if (w && iRun >= 0 && r[iRun].trim() !== '' && w.run !== run.run) { err(line, header[iWell], `run ${run.run} is in plate ${w.plate} well ${w.well}? The layout has run ${w.run} there (rows mixed up?)`); return; }
    // factor settings in the file must agree with the plan
    roles.forEach((role, j) => {
      if (!role?.factor) return;
      const f = study.factors.find(x => x.id === role.factor), planned = run.settings[f.id], cell = r[j].trim();
      if (cell === '') return;
      const ok = f.type === 'categorical' ? String(planned) === cell : Math.abs(num(cell, j) - planned) <= 1e-9 * Math.max(1, Math.abs(planned));
      if (!ok) err(line, header[j], `run ${run.run}: the file says ${f.id} = ${cell} but the plan has ${planned} (rows mixed up?)`);
    });
    const base = { run: run.run };
    roles.forEach((role, j) => { if (META.includes(role) && r[j].trim() !== '') base[role] = role === 'repeat' ? Number(r[j]) : label(r[j]); });
    if (base.repeat !== undefined && !Number.isInteger(base.repeat)) { err(line, 'repeat', `repeat must be an integer`); delete base.repeat; }
    const iNote = col('note'), note = iNote >= 0 ? r[iNote].trim() : '';
    const add = (o, j) => {
      const v = num(r[j], j);
      if (v === undefined) return;
      if (Number.isNaN(v)) { err(line, header[j], `"${r[j]}" is not a number`); return; }
      const out = { ...base, response: o.response, value: v };
      if (o.site !== undefined) {
        if (sites.length && !sites.includes(String(o.site))) { err(line, header[j], `site ${o.site} is not in the site scheme (${sites.join(', ')})`); return; }
        const pos = study.sites?.positions.find(p => String(p.id) === String(o.site));
        out.site = pos ? pos.id : o.site;
      }
      if (note) out.note = note;
      // trials and exposure: the response's own column, or a shared one (long format)
      for (const key of ['trials', 'exposure']) {
        const ja = roles.findIndex(x => x?.aux && x.aux.response === o.response && x.aux.key === key), jj = ja >= 0 ? ja : col(key);
        if (jj < 0 || r[jj].trim() === '') continue;
        const a = num(r[jj], jj);
        if (Number.isNaN(a) || a === undefined) { err(line, header[jj], `"${r[jj]}" is not a number`); continue; }
        if (ja >= 0 || auxFields(study.responses.find(x => x.id === o.response)).includes(key) || (key === 'trials' && study.responses.find(x => x.id === o.response)?.distribution?.includes('binomial'))) out[key] = a;
      }
      obs.push({ o: out, line, column: header[j] });
    };
    if (long) {
      const ir = col('response'), iv = col('value'), is = col('site');
      const rid = r[ir].trim();
      const own = study.responses.filter(x => !x.derived);
      const resp = own.find(x => x.id === rid) ?? (own.filter(x => norm(x.name) === norm(rid) || norm(x.id) === norm(rid)).length === 1
        ? own.find(x => norm(x.name) === norm(rid) || norm(x.id) === norm(rid)) : undefined);
      if (!resp) { if (rid) err(line, header[ir], `unknown response "${rid}"`); return; }
      add({ response: resp.id, site: is >= 0 && r[is].trim() !== '' ? label(r[is]) : undefined }, iv);
    } else roles.forEach((role, j) => { if (role?.result) add(role.result, j); });
  });

  // duplicates, within the file and against what the study already holds
  const keyOf = (o) => JSON.stringify(['run', 'response', 'lot', 'wafer', 'site', 'repeat'].map(k => o[k] ?? null));
  const seen = new Map();
  for (const x of obs) {
    const k = keyOf(x.o);
    if (seen.has(k)) warn(x.line, x.column, `duplicate of line ${seen.get(k)} (same run, response, wafer, site and repeat)`);
    else seen.set(k, x.line);
  }
  const existing = new Set(study.observations.map(keyOf));
  const clash = obs.filter(x => existing.has(keyOf(x.o))).length;
  if (clash) problems.push({ severity: 'info', line: null, column: null, message: `${clash} value(s) replace values already in the study (or are added alongside them with mode "append")` });
  // robust outlier flags per response (and site), never dropped
  const z = opts.outlierZ ?? 5;
  for (const r of study.responses) {
    const v = obs.filter(x => x.o.response === r.id && x.o.value !== null);
    if (v.length < 5) continue;
    const vals = v.map(x => x.o.value);
    const med = median(vals), mad = 1.4826 * median(vals.map(x => Math.abs(x - med)));
    if (!(mad > 0)) continue;
    for (const x of v) if (Math.abs(x.o.value - med) / mad > z) warn(x.line, x.column, `${x.o.value} is far from the other ${r.id} values (robust z = ${((x.o.value - med) / mad).toFixed(1)}); check it, it is kept`);
  }
  const got = new Set(obs.map(x => x.o.run));
  const none = [...runs.keys()].filter(k => !got.has(k) && !study.observations.some(o => o.run === k));
  if (none.length && obs.length) problems.push({ severity: 'info', line: null, column: null, message: `no results yet for run(s) ${none.join(', ')}` });
  if (readings.length) problems.push({ severity: 'info', line: null, column: null, message: `${readings.length} control-well reading(s)` });
  return { format: long ? 'long' : 'wide', observations: obs.map(x => x.o), readings, problems, mapping, unmatched };
}

/**
 * Merge imported observations into a study (returns a new, validated study). mode 'replace'
 * (default): for each run and response in the import, previous observations are removed first.
 * 'append': everything is added. Refuses an import that has errors unless opts.force.
 */
export function applyResults(study, imported, { mode = 'replace', force = false } = {}) {
  const errors = imported.problems.filter(p => p.severity === 'error');
  if (errors.length && !force) throw new Error(`the import has ${errors.length} error(s), e.g. line ${errors[0].line}: ${errors[0].message}`);
  let keep = study.observations;
  if (mode === 'replace') {
    const touched = new Set(imported.observations.map(o => `${o.run}|${o.response}`));
    keep = keep.filter(o => !touched.has(`${o.run}|${o.response}`));
  } else if (mode !== 'append') throw new Error(`mode must be "replace" or "append"`);
  let plates = study.plates;
  if (imported.readings?.length) {
    const k = (x) => `${x.plate}/${x.well}/${x.response}`, got = new Set(imported.readings.map(k));
    plates = { ...plates, readings: [...plates.readings.filter(x => mode === 'append' || !got.has(k(x))), ...imported.readings] };
  }
  return createStudy({ ...study, observations: [...keep, ...imported.observations], ...(plates ? { plates } : {}) });
}

/**
 * A plate reader's grid export (rows A, B, … down, columns 1, 2, … across, one plate) as long CSV
 * text — plate, well, response, value — for importResults. Leading lines before the grid's header
 * row (1, 2, 3, …) are skipped; cells that are blank stay unmeasured.
 */
export function plateGridToLong(text, { plate = 1, response }) {
  if (!response) throw new Error('name the response the grid holds');
  let t = String(text);
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  const all = records(t, detectDelimiter(t)).map(r => r.map(c => c ?? ''));
  const h = all.findIndex(r => r.slice(1).filter(c => c.trim() !== '').every((c, j) => Number(c) === j + 1) && r.slice(1).some(c => c.trim() !== ''));
  if (h < 0) throw new Error('no grid header row (1, 2, 3, … across) found');
  const out = [['plate', 'well', 'response', 'value']];
  for (const r of all.slice(h + 1)) {
    const L = (r[0] ?? '').trim().toUpperCase();
    if (!/^[A-Z]{1,2}$/.test(L)) { if (r.every(c => c.trim() === '')) continue; break; }
    r.slice(1).forEach((v, j) => { if (v.trim() !== '') out.push([plate, `${L}${String(j + 1).padStart(2, '0')}`, response, v.trim()]); });
  }
  if (out.length === 1) throw new Error('the grid has no values');
  return writeCSV(out[0], out.slice(1));
}
