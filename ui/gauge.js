// Gauge R&R panel (issue #17): paste or import the gauge readings for a response, see the
// ANOVA-method results, and keep σ_meas on the response (used for power, spec §6.4).
import { h, select, dataTable, messages, help } from './dom.js';
import { plot } from './plot.js';
import { num, pval } from '../js/format.js';
import { gaugeRR, gaugeRowsFromTable } from '../js/model/msa.js';
import { parseCSV, writeCSV } from '../js/io/csv.js';

const TRACE = ['', 't2', 't3', 't4', 't5', 't6'];

export function gaugePanel({ state, update, setUI }, rid) {
  const d = state.doc, r = d.responses.find(x => x.id === rid);
  if (!r) return null;
  const ui = state.ui.gauge ??= {};
  const set = (patch) => setUI({ gauge: { ...ui, ...patch } });
  const m = r.measurement;
  // the readings: pasted text, else the data kept with the response
  const text = ui.text ?? (m?.data ? writeCSV(['part', 'operator', 'value'], m.data.map(x => [x.part, x.operator ?? '', x.value ?? ''])) : '');
  const tolerance = ui.tolerance ?? m?.tolerance ?? '';
  let g = null, err = null, rows = [];
  if (text.trim()) {
    try {
      const t = parseCSV(text);
      rows = gaugeRowsFromTable(t.header, t.rows);
      if (rows.every(x => x.operator === '' || x.operator === undefined)) rows = rows.map(({ operator, ...x }) => x);
      g = gaugeRR(rows, { design: ui.design ?? 'auto', tolerance: Number(tolerance) > 0 ? Number(tolerance) : undefined });
    } catch (e) { err = e.message; }
  }
  const fileIn = h('input', { type: 'file', accept: '.csv,.txt,.tsv', hidden: true, onchange: async (e) => { const f = e.target.files[0]; if (f) set({ text: await f.text() }); } });
  const head = h('div', {},
    h('p', { class: 'small' }, `Gauge study for ${r.name}: the same parts measured repeatedly (by several operators, or by one automated tool). Paste the readings with columns part, operator (optional) and value, one reading per line, or import a CSV.`),
    h('textarea', { id: 'gauge-data', rows: 6, spellcheck: 'false', 'aria-label': 'gauge readings', placeholder: 'part,operator,value\nP01,A,2.48\nP01,A,2.51\n…', value: text, onchange: (e) => set({ text: e.target.value }) }),
    h('div', { class: 'row', style: 'margin-top:6px' },
      h('button', { class: 'btn', onclick: () => fileIn.click() }, 'Import CSV…'), fileIn,
      h('label', { class: 'inline' }, 'design', select([{ value: 'auto', label: 'detect' }, { value: 'crossed', label: 'crossed' }, { value: 'nested', label: 'nested (destructive)' }, { value: 'repeatability', label: 'repeatability only' }], ui.design ?? 'auto', (v) => set({ design: v }), { 'aria-label': 'gauge design' })),
      h('label', { class: 'inline' }, 'tolerance (USL − LSL)', h('input', { class: 'num', type: 'number', min: 0, step: 'any', value: tolerance, 'aria-label': 'tolerance', onchange: (e) => set({ tolerance: e.target.value }) })),
      h('button', { class: 'btn small', onclick: () => set({ open: null }) }, 'close')));
  let body = null;
  if (err) body = h('div', { class: 'msg error' }, err);
  else if (g) {
    const save = () => {
      update(x => {
        const o = x.responses.find(y => y.id === rid);
        o.measurement = { sigma: g.sigmaMeas, method: 'gauge R&R (ANOVA)', design: g.kind, parts: g.parts, operators: g.operators, repeats: g.repeats,
          ...(Number(tolerance) > 0 ? { tolerance: Number(tolerance) } : {}), pctGRR: g.pctGRR, ndc: g.ndc, data: rows.map(x => ({ part: x.part, ...(x.operator !== undefined ? { operator: x.operator } : {}), value: x.value })) };
      });
      state.ui.gauge = { ...ui, text: undefined };
    };
    const parts = [...new Set(rows.map(x => String(x.part)))], ops = [...new Set(rows.map(x => x.operator ?? ''))];
    const series = ops.map((o, i) => ({ cls: TRACE[i % TRACE.length], points: rows.filter(x => (x.operator ?? '') === o && Number.isFinite(x.value)).map(x => ({ x: parts.indexOf(String(x.part)) + 1 + (i - (ops.length - 1) / 2) * 0.12, y: x.value, title: `${x.part}${o ? `, ${o}` : ''}: ${x.value}` })) }));
    const cls = g.pctGRR < 10 ? 'ok' : g.pctGRR <= 30 ? 'warning' : 'error';
    body = h('div', { id: 'gauge-result' },
      h('div', { class: `msg ${cls}` }, h('b', {}, `Gauge R&R ${num(g.pctGRR, 3)} % of study variation`), g.pctTolerance !== undefined ? `, ${num(g.pctTolerance, 3)} % of tolerance` : '', `; ${g.ndc} distinct categories. ${g.verdict[0].toUpperCase()}${g.verdict.slice(1)}.`,
        ' (AIAG: under 10 % good, 10–30 % marginal; ndc ≥ 5.)'),
      h('div', { class: 'row small' }, h('span', { class: 'stat' }, `${g.kind}, ${g.parts} parts${g.operators ? ` × ${g.operators} operators` : ''} × ${g.repeats} repeats`), h('span', { class: 'stat' }, 'σ_meas = ', h('b', {}, num(g.sigmaMeas))),
        g.kind === 'crossed' ? h('span', { class: 'stat' }, g.pooled ? `operator × part pooled (p = ${pval(g.interactionP)})` : `operator × part kept (p ${pval(g.interactionP)})`) : null),
      h('div', { class: 'grid2' },
        dataTable([{ key: 'source', label: 'source' }, { key: 'variance', label: 'variance', cls: 'n', fmt: (v) => num(v) }, { key: 'contribution', label: '% contrib.', cls: 'n', fmt: (v) => num(v, 3) },
          { key: 'sd', label: 'std. dev.', cls: 'n', fmt: (v) => num(v) }, { key: 'pctStudyVar', label: '% study var', cls: 'n', fmt: (v) => num(v, 3) },
          ...(g.pctTolerance !== undefined ? [{ key: 'pctTolerance', label: '% tolerance', cls: 'n', fmt: (v) => num(v, 3) }] : []),
          { key: 'bar', label: '' }], g.components.map(c => ({ ...c, bar: h('span', { class: 'vbar' }, h('span', { style: `width:${Math.min(100, c.pctStudyVar).toFixed(1)}%` })) }))),
        h('figure', {}, h('figcaption', {}, 'Readings by part', ops.length > 1 ? ' and operator' : ''),
          plot({ xLabel: 'part', yLabel: r.units ? `${r.name} (${r.units})` : r.name, height: 220, series }),
          ops.length > 1 ? h('div', { class: 'legend' }, ops.map((o, i) => h('span', {}, h('i', { style: `background: var(--trace-${(i % 6) + 1})` }), o))) : null)),
      h('details', {}, h('summary', {}, 'ANOVA table'), dataTable([{ key: 'source', label: 'source' }, { key: 'df', label: 'df', cls: 'n' }, { key: 'ss', label: 'sum of squares', cls: 'n', fmt: (v) => num(v) },
        { key: 'ms', label: 'mean square', cls: 'n', fmt: (v) => (v === undefined ? '' : num(v)) }, { key: 'F', label: 'F', cls: 'n', fmt: (v) => (v === undefined ? '' : num(v)) }, { key: 'p', label: 'p', cls: 'n', fmt: (v) => (v === undefined ? '' : pval(v)) }], g.reduced ?? g.anova)),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'gauge-save', onclick: save }, m ? 'Update σ_meas on the response' : 'Keep σ_meas on the response'),
        h('span', { class: 'muted small' }, 'Kept with the study (with these readings); the Design step uses it in the power calculation.')));
  }
  return h('section', { class: 'panel', id: 'gauge' }, h('h2', {}, `Gauge R&R — ${r.name}`, help('process','gauge-rr')), head, body);
}
