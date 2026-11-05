// comb-over simulator editor for the Define step (issue #21): the netlist, each study factor's
// place in it (a .param, a substrate key or the etch bias) and each response's metric.
import { h, select, messages } from './dom.js';
import { parseNetlist } from '../vendor/comb-over/js/netlist.js';
import { makeEvaluator, factorNominal } from '../js/sim/combover.js';
import { num } from '../js/format.js';

const SUBSTRATE = ['er', 'h', 't', 'tand'];
const mapValue = (m) => (!m ? '' : m.etch ? 'etch' : m.substrate ? `substrate:${m.substrate}` : `param:${m.param}`);
const mapOf = (v) => (v === 'etch' ? { etch: true } : v.startsWith('substrate:') ? { substrate: v.slice(10) } : v.startsWith('param:') ? { param: v.slice(6) } : null);

export const combOverChoice = { value: 'comb-over', label: 'comb-over', make: () => ({ adapter: 'comb-over', netlist: '', factors: {}, metrics: {} }) };

export function combOverEditor(d, update) {
  const sim = d.simulator;
  let parsed = null, err = null;
  if (sim.netlist?.trim()) { try { parsed = parseNetlist(sim.netlist); } catch (e) { err = `netlist: ${e.message}`; } }
  const opts = [{ value: '', label: '—' }, ...(parsed?.params ?? []).map(p => ({ value: `param:${p.name}`, label: `.param ${p.name}${p.tune ? ' (tune)' : ''}` })),
    ...(parsed?.substrate ? SUBSTRATE.map(k => ({ value: `substrate:${k}`, label: `substrate ${k}${k === 'h' ? ' (mm)' : k === 't' ? ' (µm)' : ''}` })) : []), { value: 'etch', label: 'etch bias (µm per edge)' }];
  let check = null;
  if (parsed && !err) {
    try { makeEvaluator(sim); } catch (e) { check = e.message; }
  }
  const fileIn = h('input', { type: 'file', accept: '.cir,.txt,.net', hidden: true, onchange: async (e) => { const f = e.target.files[0]; if (!f) return; const t = await f.text(); update(x => { x.simulator.netlist = t; }); } });
  const rows = (d.factors ?? []).map(f => {
    const m = sim.factors?.[f.id];
    let nom = '';
    if (parsed && m) { try { nom = `nominal ${num(factorNominal(m, parsed), 5)}`; } catch (e) { nom = e.message; } }
    return h('tr', {}, h('td', {}, f.id), h('td', {}, select(opts, mapValue(m), (v) => update(x => { x.simulator.factors ??= {}; const mm = mapOf(v); if (mm) x.simulator.factors[f.id] = mm; else delete x.simulator.factors[f.id]; }), { 'aria-label': `comb-over factor ${f.id}` })),
      h('td', { class: 'muted small' }, nom));
  });
  return h('div', { id: 'comb-over' },
    h('p', { class: 'muted small' }, 'comb-over (github.com/byzantic/comb-over) solves the netlist for each run. Map each factor to a .param, a substrate key or the etch bias (per edge: narrows every W=, widens every S=). Metrics are comb-over trace expressions at a frequency, e.g. -db(S31) @ 5G, or over a band, e.g. min(db(S31/S41)) @ 4.5G..5.5G.'),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => fileIn.click() }, 'Load netlist…'), fileIn, parsed ? h('span', { class: 'muted small' }, `${parsed.params.length} params${parsed.substrate ? `, substrate ${parsed.substrate.name}` : ''}`) : null),
    h('textarea', { rows: 8, style: 'width:100%', class: 'mono small', 'aria-label': 'comb-over netlist', value: sim.netlist ?? '', onchange: (e) => update(x => { x.simulator.netlist = e.target.value; }) }),
    messages(err ? [err] : [], 'error'),
    h('div', { class: 'grid2' },
      h('div', {}, h('h3', {}, 'Factors'), h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, h('th', {}, 'factor'), h('th', {}, 'in the netlist'), h('th', {}, ''))), h('tbody', {}, rows)))),
      h('div', {}, h('h3', {}, 'Metrics'), (d.responses ?? []).map(r => h('div', { class: 'row' }, h('label', { class: 'inline' }, `${r.id} =`,
        h('input', { type: 'text', class: 'formula', style: 'width:22em', value: sim.metrics?.[r.id] ?? '', placeholder: 'db(S21) @ 5G', 'aria-label': `comb-over metric ${r.id}`,
          onchange: (e) => update(x => { x.simulator.metrics ??= {}; if (e.target.value.trim()) x.simulator.metrics[r.id] = e.target.value.trim(); else delete x.simulator.metrics[r.id]; }) })))))),
    check && !err ? h('div', { class: 'msg warning' }, check) : null);
}
