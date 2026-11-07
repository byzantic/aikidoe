// Microplates in the app (issue #63): the plate-layout panel (Design step), the plate map and
// plate-reader import (Run step), and controls' Z′ and residuals by well (Analyse step).
import { h, select, download, toast, help, dataTable } from './dom.js';
import { num } from '../js/format.js';
import { createStudy } from '../js/study.js';
import { layoutPlates, layoutReport } from '../js/design/plate-layout.js';
import { pipettingCSV, plateMapHTML } from '../js/io/platemap.js';
import { plateGridToLong, importResults } from '../js/io/runsheet.js';
import { FORMATS, ROLES, LAYOUTS, excludedSet, wellId, rowLabel, plateNumbers, controlSummary, runCapacity } from '../js/plate.js';

const LAYOUT_TEXT = {
  balanced: 'balanced — randomised, with the effects kept clear of plate, edge and gradients',
  random: 'random — one random layout',
  ordered: 'ordered — conditions in rows, replicates side by side (the layout to avoid)',
};
const ROLE_CLASS = { positive: 'pos', negative: 'neg', blank: 'blank', standard: 'std', other: 'oth' };

/** One plate as a grid; cell(well, w) → { text, cls, title, style } for a used well. */
export function plateGrid(study, plate, cell, { small = false } = {}) {
  const P = study.plates, ex = excludedSet(P), at = new Map(P.wells.filter(w => w.plate === plate).map(w => [w.well, w]));
  return h('table', { class: `plate-grid${small ? ' small' : ''}`, 'data-plate': plate },
    h('thead', {}, h('tr', {}, h('th', {}), Array.from({ length: P.cols }, (_, c) => h('th', {}, c + 1)))),
    h('tbody', {}, Array.from({ length: P.rows }, (_, r) => h('tr', {}, h('th', {}, rowLabel(r)), Array.from({ length: P.cols }, (_, c) => {
      const id = wellId(r, c), w = at.get(id);
      if (ex.has(id)) return h('td', { class: 'x', title: `${id}: excluded` });
      if (!w) return h('td', { class: 'e', title: `${id}: empty` });
      const v = cell(id, w) ?? {};
      return h('td', { class: v.cls ?? '', title: `${id}${v.title ? `: ${v.title}` : ''}`, style: v.style ?? '', 'data-well': id }, v.text ?? '');
    })))));
}

const controlCell = (P) => (id, w) => {
  if (w.control === undefined) return null;
  const c = P.controls.find(x => x.id === w.control);
  return { text: w.control, cls: `ctl ${ROLE_CLASS[c?.role] ?? ''}`, title: `${c?.name ?? w.control} (${c?.role})` };
};

/** The plate maps: runs by number, controls by id. */
export function plateMaps(study, { small = true } = {}) {
  const P = study.plates, ctl = controlCell(P);
  return h('div', { class: 'plate-maps' }, plateNumbers(study).map(p => h('figure', {}, h('figcaption', {}, `Plate ${p}`),
    plateGrid(study, p, (id, w) => ctl(id, w) ?? { text: String(w.run), title: `run ${w.run}` }, { small }))));
}

function mapButtons(study) {
  const base = (study.name || 'study').replace(/[^\w.-]+/g, '-');
  return [
    h('button', { class: 'btn', id: 'plate-map-print', onclick: () => { const w = window.open(URL.createObjectURL(new Blob([plateMapHTML(study)], { type: 'text/html' })), '_blank'); if (!w) toast('Allow pop-ups to open the printable plate map'); } }, 'Printable plate map'),
    h('button', { class: 'btn', id: 'pipetting-csv', onclick: () => download(`${base}-pipetting.csv`, pipettingCSV(study), 'text/csv') }, 'Pipetting list (CSV)'),
  ];
}

// ---------------------------------------------------------------- Design step

/** The plate-layout panel for a study with a design. */
export function platePanel(ctx) {
  const { state, setDoc, setUI } = ctx;
  const study = state.study, P = study.plates;
  const ui = state.ui.plates ??= {};
  const set = (patch) => setUI({ plates: { ...ui, ...patch } });
  const open = ui.open ?? !!P;
  if (!open) return h('section', { class: 'panel', id: 'plates' }, h('div', { class: 'row' },
    h('span', { class: 'small' }, 'Are the runs wells on microplates (96-, 384-well …)?'),
    h('button', { class: 'btn', id: 'plates-open', onclick: () => set({ open: true }) }, 'Lay out on plates…'), help('plates', '')));

  const fmt = ui.format ?? (P ? (Object.entries(FORMATS).find(([, g]) => g[0] === P.rows && g[1] === P.cols)?.[0] ?? '96') : '96');
  const controls = ui.controls ?? P?.controls ?? [{ id: 'pos', name: 'Positive control', role: 'positive', perPlate: 4 }, { id: 'neg', name: 'Negative control', role: 'negative', perPlate: 4 }];
  const excludeEdge = ui.excludeEdge ?? (P ? P.exclude.includes('edge') : false);
  const layout = ui.layout ?? P?.layout ?? 'balanced';
  const seed = ui.seed ?? P?.seed ?? study.seed;
  const placed = P ? new Set(P.wells.filter(w => w.run !== undefined).map(w => w.run)) : new Set();
  const unplaced = study.design.runs.filter(r => !placed.has(r.run)).length;
  const measured = study.observations.some(o => o.value !== null) || (P?.readings.length ?? 0) > 0;
  const setCtl = (i, patch) => set({ controls: controls.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const run = (relayout) => {
    try {
      const { study: next, summary } = layoutPlates(study, { format: fmt, exclude: excludeEdge ? ['edge'] : [], controls, layout, seed, relayout });
      state.ui.plates = { ...ui, open: true, controls: undefined, format: undefined, excludeEdge: undefined, layout: undefined, seed: undefined, error: null };
      setDoc(structuredClone(createStudy(next)));
      toast(`${summary.placed} run(s) laid out on ${summary.plates} plate(s)`);
    } catch (e) { set({ error: e.message }); }
  };
  let cap = null;
  try { cap = runCapacity({ rows: FORMATS[fmt][0], cols: FORMATS[fmt][1], exclude: excludeEdge ? ['edge'] : [], controls }); } catch { /* shown on layout */ }
  const nPlates = cap > 0 ? Math.ceil(study.design.runs.length / cap) : null;

  const form = h('div', {},
    h('div', { class: 'row' },
      h('label', { class: 'inline' }, 'plate', select(Object.keys(FORMATS).map(k => ({ value: k, label: `${k} wells (${FORMATS[k][0]} × ${FORMATS[k][1]})` })), fmt, (v) => set({ format: v }), { 'aria-label': 'plate format' })),
      h('label', { class: 'inline', title: 'leave the outer ring empty (or fill it with buffer): it evaporates and warms differently' }, h('input', { type: 'checkbox', checked: excludeEdge, 'aria-label': 'exclude edge wells', onchange: (e) => set({ excludeEdge: e.target.checked }) }), 'leave the edge wells empty'),
      h('label', { class: 'inline' }, 'layout', select(LAYOUTS.map(v => ({ value: v, label: LAYOUT_TEXT[v] })), layout, (v) => set({ layout: v }), { 'aria-label': 'plate layout' })),
      h('label', { class: 'inline' }, 'seed', h('input', { class: 'num', type: 'number', value: seed, 'aria-label': 'plate seed', onchange: (e) => set({ seed: Number(e.target.value) }) }))),
    h('div', { class: 'small', style: 'margin:8px 0 4px' }, h('b', {}, 'Controls on every plate'), ' — spread over the rows and columns, not packed in one column:'),
    h('table', { class: 'controls-table' }, h('tbody', {}, controls.map((c, i) => h('tr', {},
      h('td', {}, h('input', { type: 'text', value: c.id, style: 'width:6em', 'aria-label': `control ${i + 1} id`, onchange: (e) => setCtl(i, { id: e.target.value.trim() }) })),
      h('td', {}, h('input', { type: 'text', value: c.name ?? '', placeholder: 'name', 'aria-label': `control ${i + 1} name`, onchange: (e) => setCtl(i, { name: e.target.value }) })),
      h('td', {}, select(ROLES, c.role, (v) => setCtl(i, { role: v }), { 'aria-label': `control ${i + 1} role` })),
      h('td', {}, h('input', { class: 'num', type: 'number', min: 1, value: c.perPlate, 'aria-label': `control ${i + 1} wells`, onchange: (e) => setCtl(i, { perPlate: Number(e.target.value) }) }), ' per plate'),
      h('td', {}, h('button', { class: 'btn small', onclick: () => set({ controls: controls.filter((_, j) => j !== i) }) }, 'remove')))))),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', id: 'add-control', onclick: () => set({ controls: [...controls, { id: `c${controls.length + 1}`, name: '', role: 'other', perPlate: 2 }] }) }, '+ control'),
      cap !== null ? h('span', { class: 'muted small' }, cap > 0 ? `${cap} wells per plate for runs → ${nPlates} plate${nPlates > 1 ? 's' : ''} for ${study.design.runs.length} runs` : 'no wells left for runs') : null),
    ui.error ? h('div', { class: 'msg error' }, ui.error) : null,
    h('div', { class: 'row' },
      !P?.wells.length
        ? h('button', { class: 'btn primary', id: 'plates-layout', onclick: () => run(false) }, 'Lay out the runs')
        : [measured ? null : h('button', { class: 'btn', id: 'plates-relayout', onclick: () => run(true) }, 'Lay out again'),
          unplaced ? h('button', { class: 'btn primary', id: 'plates-layout-new', onclick: () => run(false) }, `Lay out the ${unplaced} new run${unplaced > 1 ? 's' : ''}`) : null],
      P ? h('button', { class: 'btn', id: 'plates-remove', disabled: measured, title: measured ? 'the study has results from these wells' : '', onclick: () => { const { plates, ...rest } = study; state.ui.plates = { open: false }; setDoc(structuredClone(createStudy(rest))); } }, 'Remove the plate layout') : null),
    measured && P?.wells.length ? h('p', { class: 'muted small' }, 'The study has results from these wells, so the layout is fixed; runs added later (a next stage) go on new plates.') : null);

  let result = null;
  if (P?.wells.length) {
    const rep = layoutReport(study);
    result = h('div', { id: 'plate-result' },
      h('div', { class: 'row small', style: 'margin:10px 0 6px' },
        h('span', { class: 'stat' }, h('b', {}, plateNumbers(study).length), ` plate${plateNumbers(study).length > 1 ? 's' : ''} of ${P.rows} × ${P.cols}`),
        h('span', { class: 'stat' }, 'layout ', h('b', {}, P.layout)),
        rep ? h('span', { class: 'stat', 'data-plate-efficiency': rep.efficiency.toFixed(4), title: 'information about the design’s model kept after adjusting for plate, edge and row/column gradients (1 = position costs nothing)' }, 'efficiency ', h('b', {}, num(rep.efficiency, 3))) : null,
        rep?.worst ? h('span', { class: 'stat' }, 'least efficient term ', h('b', {}, `${rep.worst.term} ${num(rep.worst.efficiency, 3)}`)) : null),
      rep && rep.worst.efficiency < 0.8 ? h('div', { class: 'msg warning' }, `${rep.worst.term} is entangled with position on the plate (plate, edge or a gradient): its variance is ${num(1 / rep.worst.efficiency, 2)}× what it would be without that. The balanced layout avoids this.`) : null,
      unplaced ? h('div', { class: 'msg warning' }, `${unplaced} run(s) are not in a well yet.`) : null,
      plateMaps(study),
      h('div', { class: 'row' }, mapButtons(study)),
      h('p', { class: 'muted small' }, plateNumbers(study).length > 1 ? 'Each run’s block is its plate, so the analysis takes out plate-to-plate shifts. ' : '', 'The analysis also fits the position terms Edge, Row and Col (outer ring, and gradients down and across the plate).'));
  }
  return h('section', { class: 'panel', id: 'plates' }, h('h2', {}, 'Plate layout', help('plates', 'layouts')), form, result);
}

// ---------------------------------------------------------------- Run step

/** Plate maps and plate-reader import on the Run step. */
export function plateRunPanel(ctx) {
  const { state, setUI } = ctx;
  const study = state.study, P = study.plates;
  if (!P?.wells.length) return null;
  const ui = state.ui.run ??= {};
  const plates = plateNumbers(study);
  const plate = ui.gridPlate ?? plates[0], response = ui.gridResponse ?? study.responses[0]?.id;
  const fileIn = h('input', { type: 'file', accept: '.csv,.txt,.tsv', hidden: true, id: 'grid-in', onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const imp = importResults(study, plateGridToLong(await f.text(), { plate, response })); setUI({ run: { ...ui, pending: { name: `${f.name} (plate ${plate}, ${response})`, imp } } }); }
    catch (err) { toast(err.message); }
  } });
  return h('section', { class: 'panel', id: 'plate-run' }, h('h2', {}, 'Plates', help('plates', 'running-and-reading')),
    plateMaps(study),
    h('div', { class: 'row' }, mapButtons(study),
      h('span', { class: 'small' }, 'Plate reader grid:'),
      select(plates.map(p => ({ value: p, label: `plate ${p}` })), plate, (v) => setUI({ run: { ...ui, gridPlate: Number(v) } }), { 'aria-label': 'grid plate' }),
      study.responses.length > 1 ? select(study.responses.map(r => r.id), response, (v) => setUI({ run: { ...ui, gridResponse: v } }), { 'aria-label': 'grid response' }) : null,
      h('button', { class: 'btn', id: 'grid-import', onclick: () => fileIn.click() }, 'Import grid…'), fileIn),
    h('p', { class: 'muted small' }, 'A reader’s grid export (rows A, B, … down, columns 1, 2, … across) is read well by well: run wells give the runs’ results, control wells the controls’ readings. Or import a long file with plate and well columns.'));
}

// ---------------------------------------------------------------- Analyse step

const diverging = (v, m) => {
  if (!Number.isFinite(v) || !(m > 0)) return '';
  const t = Math.max(-1, Math.min(1, v / m)), pct = Math.round(Math.abs(t) * 80);
  return `background: color-mix(in srgb, ${t < 0 ? 'var(--neg, #3b6fd6)' : 'var(--pos, #d6543b)'} ${pct}%, transparent)`;
};

/** Z′ from the controls and the residuals well by well. */
export function plateAnalysisPanel(study, fit, { noPosition, setNoPosition }) {
  const P = study.plates;
  if (!P?.wells.length || !fit) return null;
  const zs = controlSummary(study, fit.response).filter(z => z.controls.length);
  const res = new Map(fit.rows.map((r, i) => [r.run, fit.residuals[i]]));
  const m = Math.max(...[...res.values()].map(Math.abs).filter(Number.isFinite), 0);
  const ctl = controlCell(P);
  const read = new Map(P.readings.filter(x => x.response === fit.response && x.value !== null).map(x => [`${x.plate}/${x.well}`, x.value]));
  const pos = fit.model.terms.filter(t => t.position).map(t => t.label);
  return h('section', { class: 'panel', id: 'plate-analysis' }, h('h2', {}, 'Plates', help('plates', 'analysis')),
    h('div', { class: 'row small' },
      pos.length ? h('span', {}, 'Position terms fitted first: ', h('span', { class: 'mono' }, pos.join(', ')), ' (in the coefficients above).') : h('span', {}, 'No position terms in the model.'),
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: !noPosition, 'aria-label': 'fit position terms', onchange: (e) => setNoPosition(!e.target.checked) }), 'fit Edge, Row and Col')),
    zs.length ? h('div', {}, h('h3', {}, 'Controls'), dataTable([{ key: 'plate', label: 'plate', cls: 'n' },
      ...zs[0].controls.map(c => ({ key: c.id, label: `${c.id} (${c.role}) mean ± sd`, fmt: (_, r) => { const x = r.controls.find(y => y.id === c.id); return x ? `${num(x.mean, 4)} ± ${num(x.sd, 3)} (n ${x.n})` : '—'; } })),
      { key: 'zPrime', label: 'Z′', cls: 'n', fmt: (v) => (Number.isFinite(v) ? h('span', { class: v < 0.5 ? 'low-power' : '' }, num(v, 3)) : '—') }], zs, { rowAttrs: (r) => ({ 'data-zprime': r.plate }) }),
      h('p', { class: 'muted small' }, 'Z′ = 1 − 3(σ₊ + σ₋)/|μ₊ − μ₋| from the positive and negative controls: 0.5 or more is an excellent assay window, 0 to 0.5 marginal, below 0 the controls overlap.')) : null,
    h('h3', {}, `Residuals of ${fit.response} by well`),
    h('div', { class: 'plate-maps' }, plateNumbers(study).map(p => h('figure', {}, h('figcaption', {}, `Plate ${p}`),
      plateGrid(study, p, (id, w) => {
        if (w.control !== undefined) { const c = ctl(id, w), v = read.get(`${p}/${id}`); return { ...c, title: `${c.title}${v !== undefined ? `, reading ${num(v, 4)}` : ''}` }; }
        const v = res.get(w.run);
        return v === undefined ? { text: '', title: `run ${w.run}: no result` } : { text: num(v, 2), style: diverging(v, m), title: `run ${w.run}: residual ${num(v, 4)}` };
      })))),
    h('p', { class: 'muted small' }, 'Red above the model, blue below. A ring, a stripe or a corner left in the residuals is a position effect the model does not capture; scattered colours are what randomisation turns position effects into.'));
}
