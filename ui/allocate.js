// Design step: covariates (issue #82, phase 3) — when to measure them, and, for one known before
// the runs (animals' starting weights, flasks' seed densities, wafers' incoming thickness), which
// unit goes to which run so that it is balanced against the factors.
import { h, help, select, dataTable } from './dom.js';
import { num } from '../js/format.js';
import { parseCSV } from '../js/io/csv.js';
import { allocate, applyAllocation, balanceOf } from '../js/design/allocate.js';
import { createStudy } from '../js/study.js';

const r2Text = (r2) => (r2 < 0.0005 ? 'below 0.001' : num(r2, 3));

/** Units from pasted text: a label and a number per line (comma, tab or space separated); a header line is skipped. */
export function parseUnits(text) {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const l of lines) {
    const parts = l.includes(',') || l.includes('\t') ? parseCSV(l).header : l.split(/\s+/);
    const [a, b] = parts.map(x => String(x).trim());
    if (b === undefined) { if (Number.isFinite(Number(a))) out.push({ unit: String(out.length + 1), value: Number(a) }); continue; }
    if (!Number.isFinite(Number(b)) || b === '') { if (!out.length) continue; throw new Error(`"${l}": the second column is not a number`); }
    out.push({ unit: a, value: Number(b) });
  }
  return out;
}

export function covariateDesignPanel(ctx) {
  const { state, setDoc, setUI } = ctx, study = state.study;
  if (!study.covariates?.length) return null;
  const ui = state.ui.allocate ?? {}, set = (patch) => setUI({ allocate: { ...ui, ...patch } });
  const runs = study.design?.runs.filter(r => r.kind !== 'confirm') ?? [];
  const cid = study.covariates.some(c => c.id === ui.covariate) ? ui.covariate : study.covariates[0].id;
  const c = study.covariates.find(x => x.id === cid);
  const note = h('p', { class: 'small' }, `Covariates (${study.covariates.map(x => x.name).join(', ')}) are measured, not set. Measure each one `, h('b', {}, 'before'),
    ' the run’s settings can affect it — the starting weight, not the weight at the end — and record it on the run sheet. If a value is known before the experiment for each unit (animal, flask, wafer), let the units be allocated to the runs so that it is balanced against the factors.');
  if (!runs.length) return h('section', { class: 'panel', id: 'covariate-design' }, h('h2', {}, 'Covariates', help('analysis', 'covariates-known-in-advance')), note);
  let units = [], perr = null;
  try { units = parseUnits(ui.text ?? ''); } catch (e) { perr = e.message; }
  // the balance of the values the runs have now
  const vals = runs.map(r => c.values.find(v => v.run === r.run && v.lot === undefined && v.wafer === undefined)?.value);
  let now = null;
  if (vals.every(v => v !== undefined)) try { now = balanceOf(study, vals, { model: ui.model ?? 'main' }); } catch { /* not shown */ }
  const doIt = () => {
    try {
      const a = allocate(study, units, { model: ui.model ?? 'main', withinBlocks: !!ui.withinBlocks });
      setDoc(createStudy(applyAllocation(study, cid, a, units)));
      set({ last: { r2: a.r2, random: a.random, expected: a.expected, maxVif: Math.max(1, ...a.vif.map(v => v.vif)), unused: a.unused.map(u => u.unit), covariate: cid }, error: null });
    } catch (e) { set({ error: e.message }); }
  };
  const last = ui.last?.covariate === cid ? ui.last : null;
  const assigned = c.values.filter(v => v.unit !== undefined);
  return h('section', { class: 'panel', id: 'covariate-design' }, h('h2', {}, 'Covariates', help('analysis', 'covariates-known-in-advance')), note,
    h('div', { class: 'row small' },
      study.covariates.length > 1 ? h('label', { class: 'inline' }, 'covariate', select(study.covariates.map(x => ({ value: x.id, label: x.name })), cid, (v) => set({ covariate: v }), { 'aria-label': 'allocate covariate' })) : null,
      h('label', { class: 'inline', title: 'the effects the covariate should be balanced against' }, 'balance against', select([{ value: 'main', label: 'main effects' }, { value: '2fi', label: 'main effects and 2-factor interactions' }], ui.model ?? 'main', (v) => set({ model: v }), { 'aria-label': 'allocate model' })),
      study.design.runs.some(r => r.block !== undefined) ? h('label', { class: 'inline small' }, h('input', { type: 'checkbox', checked: !!ui.withinBlocks, onchange: (e) => set({ withinBlocks: e.target.checked }) }), ' keep units within their block') : null),
    h('div', { class: 'small', style: 'margin-top:8px' }, `Units and their ${c.name}${c.units ? ` (${c.units})` : ''}, one per line — at least ${runs.length}:`),
    h('textarea', { rows: 6, style: 'display:block;width:100%;max-width:28em;font-family:var(--mono, monospace)', placeholder: 'M1, 21.4\nM2, 19.8\n…', 'aria-label': 'units to allocate', value: ui.text ?? '', onchange: (e) => set({ text: e.target.value, error: null }) }),
    h('div', { class: 'row small' }, h('button', { class: 'btn primary', id: 'allocate', disabled: !!perr || units.length < runs.length, onclick: doIt }, `Allocate ${units.length || ''} units to the ${runs.length} runs`),
      h('span', { class: 'muted' }, perr ?? (units.length && units.length < runs.length ? `${runs.length - units.length} more needed` : ''))),
    ui.error ? h('div', { class: 'msg error' }, ui.error) : null,
    last ? h('div', { class: 'msg', id: 'allocation' }, `Allocated: R² of ${c.name} on the effects ${r2Text(last.r2)}, against ${num(last.random, 3)} for a random allocation (${num(last.expected, 3)} on average); the effects’ variances grow by at most ${(last.maxVif - 1) * 100 < 0.05 ? 'less than 0.1' : num((last.maxVif - 1) * 100, 2)} % with ${cid} in the model.`,
      last.unused.length ? ` Not used: ${last.unused.join(', ')}.` : '', ' The run sheet shows each run’s unit.') : null,
    !last && now ? h('p', { class: 'muted small', id: 'covariate-balance' }, `The values recorded now: R² of ${c.name} on the effects ${num(now.r2, 3)} (${num(now.expected, 3)} for a random allocation, on average).`) : null,
    assigned.length ? h('details', {}, h('summary', { class: 'small' }, `units by run (${assigned.length})`), dataTable([{ key: 'run', label: 'run', cls: 'n' }, { key: 'unit', label: 'unit' }, { key: 'value', label: c.name, cls: 'n', fmt: (v) => num(v, 5) }], assigned)) : null);
}
