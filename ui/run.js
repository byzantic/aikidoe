// Run step: run sheet with results entered in place, downloads, results import (spec §12 step 3).
import { h, messages, download, toast, help } from './dom.js';
import { num } from '../js/format.js';
import { runSheet, runSheetCSV, runSheetHTML, importResults, applyResults, setCovariateCell } from '../js/io/runsheet.js';
import { parseNumber } from '../js/io/csv.js';
import { studyAdapter } from '../js/sim/adapters.js';
import { runOnSimulator } from '../js/sim/adapter.js';
import { plateRunPanel } from './plates.js';

export function render(ctx) {
  const { state, update, setDoc, setUI, go } = ctx;
  const study = state.study, ui = state.ui.run ??= {};
  const sheet = runSheet(study);
  const runs = study.design.runs, done = new Set(study.observations.filter(o => o.value !== null).map(o => o.run));
  const base = (study.name || 'study').replace(/[^\w.-]+/g, '-');

  // ---------------------------------------------------------------- summary and actions
  const fileIn = h('input', { type: 'file', accept: '.csv,.txt,.tsv', hidden: true, id: 'results-in', onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const imp = importResults(study, await f.text());
    setUI({ run: { ...ui, pending: { name: f.name, imp } } });
  } });
  const head = h('section', { class: 'panel' }, h('h2', {}, 'Run sheet', help('getting-started','run')),
    h('div', { class: 'row small', style: 'margin-bottom:10px' },
      h('span', { class: 'stat' }, h('b', {}, runs.length), ' runs'),
      h('span', { class: 'stat' }, 'results for ', h('b', { 'data-done': done.size }, done.size), ` of ${runs.length} `, h('span', { class: 'progress' }, h('span', { style: `width:${(100 * done.size / runs.length).toFixed(1)}%` }))),
      h('span', { class: 'stat' }, `${study.design.kind}, randomisation ${study.design.randomisation}, seed ${study.design.params?.seed ?? study.seed}`)),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => download(`${base}-run-sheet.csv`, runSheetCSV(study), 'text/csv') }, 'Download CSV'),
      h('button', { class: 'btn', onclick: () => { const w = window.open(URL.createObjectURL(new Blob([runSheetHTML(study)], { type: 'text/html' })), '_blank'); if (!w) toast('Allow pop-ups to open the printable sheet'); } }, 'Printable sheet'),
      h('button', { class: 'btn', onclick: () => fileIn.click() }, 'Import results…'), fileIn,
      study.simulator ? h('button', { class: 'btn primary', id: 'run-simulator', onclick: async (e) => {
        const b = e.target; b.disabled = true; const label = b.textContent;
        try {
          const ad = await studyAdapter(study);
          const next = await runOnSimulator(study, ad, { all: done.size === runs.length, onProgress: (n, t) => { b.textContent = `Simulating… ${n}/${t}`; } });
          setDoc(structuredClone(next)); toast(`Simulated ${runs.length - (done.size === runs.length ? 0 : done.size)} runs (${ad.name})`);
        } catch (err) { toast(`Simulator: ${err.message}`); b.disabled = false; b.textContent = label; }
      } }, done.size === runs.length ? 'Re-run on the simulator' : `Run on the simulator (${study.simulator.adapter})`) : null,
      done.size ? h('button', { class: 'btn primary', onclick: () => go('analyse') }, 'Analyse →') : null),
    h('p', { class: 'muted small' }, 'Run in the order shown. Type results into the sheet, or fill in the CSV and import it. Leave a cell blank if it was not measured; type NA if the measurement failed.',
      study.covariates?.length ? ` Covariates (${study.covariates.map(c => c.name).join(', ')}) are filled in the same way: the value measured at each run.` : ''));

  // ---------------------------------------------------------------- pending import
  let pending = null;
  if (ui.pending) {
    const { imp, name } = ui.pending;
    const errs = imp.problems.filter(p => p.severity === 'error'), warns = imp.problems.filter(p => p.severity === 'warning'), info = imp.problems.filter(p => p.severity === 'info');
    const fmt = (p) => `${p.line ? `line ${p.line}${p.column ? `, ${p.column}` : ''}: ` : ''}${p.message}`;
    const apply = (mode, force = false) => { try { const next = applyResults(study, imp, { mode, force }); state.ui.run = { ...ui, pending: null }; setDoc(structuredClone(next)); toast(`${imp.observations.length + (imp.covariates?.length ?? 0)} value(s) imported${imp.readings?.length ? `, ${imp.readings.length} control reading(s)` : ''}`); } catch (e) { toast(e.message); } };
    pending = h('section', { class: 'panel', id: 'import-review' }, h('h2', {}, `Import ${name}`),
      h('p', { class: 'small' }, `${imp.observations.length} value(s) read (${imp.format ?? '?'} format)${imp.covariates?.length ? `, ${imp.covariates.length} covariate value(s)` : ''}${imp.readings?.length ? ` and ${imp.readings.length} control-well reading(s)` : ''}.`),
      messages(errs.map(fmt), 'error'), messages(warns.map(fmt), 'warning'), messages(info.map(fmt), 'ok'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', disabled: !!errs.length || !(imp.observations.length || imp.readings?.length || imp.covariates?.length), onclick: () => apply('replace') }, 'Import (replace)'),
        h('button', { class: 'btn', disabled: !!errs.length || !(imp.observations.length || imp.readings?.length || imp.covariates?.length), onclick: () => apply('append') }, 'Import (add to existing)'),
        errs.length && imp.observations.length ? h('button', { class: 'btn danger', onclick: () => apply('replace', true) }, `Import the ${imp.observations.length} valid values anyway`) : null,
        h('button', { class: 'btn', onclick: () => setUI({ run: { ...ui, pending: null } }) }, 'Cancel')));
  }

  // ---------------------------------------------------------------- the sheet, editable
  const H = sheet.header, iRun = H.indexOf('run');
  const metaIdx = sheet.metaColumns.map(m => H.indexOf(m));
  const resIdx = sheet.resultColumns.map(c => H.indexOf(c.header));
  const covIdx = sheet.covariateColumns.map(id => H.indexOf(id));
  // a covariate's value for the row: for the run, or the row's lot and wafer
  const setCov = (row, id, text) => update(d => {
    const v = parseNumber(text);
    if (Number.isNaN(v)) { toast(`"${text}" is not a number`); return; }
    const keys = Object.fromEntries(['lot', 'wafer'].filter(k => sheet.metaColumns.includes(k) && row[H.indexOf(k)] !== '').map(k => [k, row[H.indexOf(k)]]));
    setCovariateCell(d, id, row[iRun], keys, v);
  });
  const label = (key) => {
    const f = study.factors.find(x => x.id === key); if (f) return [f.name, f.units ? h('span', { class: 'muted' }, ` (${f.units})`) : null];
    const cu = study.covariates?.find(x => `${x.id}.unit` === key); if (cu) return [cu.name, h('span', { class: 'muted' }, ': unit')];
    const cv = study.covariates?.find(x => x.id === key); if (cv) return [cv.name, h('span', { class: 'muted' }, cv.units ? ` (${cv.units}, measured)` : ' (measured)')];
    const c = sheet.resultColumns.find(x => x.header === key);
    if (c?.aux) { const r = study.responses.find(x => x.id === c.response); return [r.name, h('span', { class: 'muted' }, ` (${c.aux}${c.aux === 'exposure' ? ', blank = 1' : ''})`)]; }
    if (c) { const r = study.responses.find(x => x.id === c.response); return [r.name, c.site !== undefined ? ` @ ${c.site}` : '', r.units ? h('span', { class: 'muted' }, ` (${r.units})`) : null]; }
    const bv = study.design.blocking?.find(x => x.id === key); if (bv) return bv.name ?? bv.id;
    return { order: 'order', run: 'run', wholePlot: 'whole plot', block: 'block', kind: 'type', note: 'notes' }[key] ?? key;
  };
  const setCell = (row, col, text) => update(d => {
    const run = row[iRun], meta = Object.fromEntries(sheet.metaColumns.map((m, j) => [m, row[metaIdx[j]] === '' ? undefined : row[metaIdx[j]]]));
    const same = (o) => o.run === run && o.response === col.response && String(o.site ?? '') === String(col.site ?? '') && sheet.metaColumns.every(m => String(o[m] ?? '') === String(meta[m] ?? ''));
    const old = (d.observations ?? []).find(same);
    const v = parseNumber(text);
    if (Number.isNaN(v)) { toast(`"${text}" is not a number`); return; }
    if (col.aux) {
      // trials or exposure of the run's result (a result not entered yet is held as missing)
      if (old) { if (v === undefined) delete old[col.aux]; else old[col.aux] = v; return; }
      if (v === undefined) return;
      const o = { run, response: col.response, value: null, [col.aux]: v };
      for (const m of sheet.metaColumns) if (meta[m] !== undefined) o[m] = meta[m];
      d.observations.push(o);
      return;
    }
    d.observations = (d.observations ?? []).filter(o => !same(o));
    const keep = Object.fromEntries(['trials', 'exposure'].filter(k => old?.[k] !== undefined).map(k => [k, old[k]]));
    if (v === undefined) { if (Object.keys(keep).length) d.observations.push({ run, response: col.response, value: null, ...keep }); return; }
    const o = { run, response: col.response, value: v, ...keep };
    if (col.site !== undefined) o.site = col.site;
    for (const m of sheet.metaColumns) if (meta[m] !== undefined) o[m] = meta[m];
    d.observations.push(o);
  });
  // grouped by whole plot, block, or a Latin square's rows or a crossover's periods (issue #80)
  const byBlocking = study.design.blocking?.find(b => b.role === 'row' || b.role === 'period');
  const groupKey = H.includes('wholePlot') ? 'wholePlot' : H.includes('block') ? 'block' : byBlocking ? byBlocking.id : null;
  const rows = [];
  let prev;
  sheet.rows.forEach((row) => {
    if (groupKey && row[H.indexOf(groupKey)] !== prev) { prev = row[H.indexOf(groupKey)]; rows.push(h('tr', { class: 'group' }, h('td', { colspan: H.length - 1 }, `${groupKey === 'wholePlot' ? 'Whole plot' : groupKey === 'block' ? 'Block' : byBlocking.name ?? byBlocking.id} ${prev}`,
      groupKey === 'wholePlot' ? h('span', { class: 'muted' }, ` — set once: ${study.factors.filter(f => f.htc).map(f => `${f.name} ${row[H.indexOf(f.id)]}${f.units ? ` ${f.units}` : ''}`).join(', ')}`) : null))); }
    rows.push(h('tr', { 'data-run': row[iRun] }, H.map((key, j) => {
      if (key === 'note') return null;
      const ri = resIdx.indexOf(j);
      if (ri >= 0) return h('td', { class: 'res' }, h('input', { type: 'text', inputmode: 'decimal', value: row[j] ?? '', 'aria-label': `run ${row[iRun]} ${H[j]}`,
        onchange: (e) => setCell(row, sheet.resultColumns[ri], e.target.value) }));
      const ci = covIdx.indexOf(j);
      if (ci >= 0) return h('td', { class: 'res cov' }, h('input', { type: 'text', inputmode: 'decimal', value: row[j] ?? '', 'aria-label': `run ${row[iRun]} ${H[j]}`,
        onchange: (e) => setCov(row, sheet.covariateColumns[ci], e.target.value) }));
      const v = row[j];
      return h('td', { class: typeof v === 'number' ? 'n' : '' }, typeof v === 'number' && !Number.isInteger(v) ? num(v, 6) : v);
    })));
  });
  const table = h('section', { class: 'panel' }, h('div', { class: 'table-wrap' }, h('table', { class: 'data', id: 'run-sheet' },
    h('thead', {}, h('tr', {}, H.filter(k => k !== 'note').map(k => h('th', { class: resIdx.includes(H.indexOf(k)) || covIdx.includes(H.indexOf(k)) ? 'n' : '' }, label(k))))),
    h('tbody', {}, rows))));
  return h('div', {}, head, pending, plateRunPanel(ctx), table);
}
