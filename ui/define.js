// Define step: factors, responses, constraints, measurement structure (spec §12 step 1).
import { h, select, messages } from './dom.js';
import { siteScheme, addSummaries, SUMMARY_STATS } from '../js/model/sites.js';
import { gaugePanel } from './gauge.js';
import { num } from '../js/format.js';

const MEASURED = [
  { value: 'run', label: 'once per run', levels: ['run'] },
  { value: 'wafer', label: 'per wafer', levels: ['run', 'wafer'] },
  { value: 'wafer-site', label: 'per wafer and site', levels: ['run', 'wafer', 'site'] },
  { value: 'site', label: 'per site', levels: ['run', 'site'] },
];
const measuredKey = (lv = ['run']) => (MEASURED.find(m => JSON.stringify(m.levels) === JSON.stringify(lv)) ?? MEASURED[0]).value;
const numOrDelete = (obj, key, text) => { const t = String(text).trim(); if (t === '') delete obj[key]; else obj[key] = Number.isFinite(Number(t)) ? Number(t) : t; };
const nextId = (taken, base) => { if (!taken.includes(base)) return base; for (let i = 2; ; i++) if (!taken.includes(base + i)) return base + i; };

export function render(ctx) {
  const { state, update, go, setUI } = ctx;
  const d = state.doc;
  const locked = !!d.design;             // factor structure fixed once there is a design
  const lockNote = locked ? h('div', { class: 'msg warning' }, 'This study has a design, so factor ids, types and levels are fixed (names, units and ranges can still change). ',
    h('button', { class: 'btn danger', onclick: () => update(x => { delete x.design; x.observations = []; x.history = []; }) }, `Remove the design${d.observations?.length ? ` and its ${d.observations.length} results` : ''}`)) : null;

  const errs = messages(state.errors.map(e => e.replace(/^study: /, '')), 'error');
  const warns = messages(state.warnings, 'warning');

  // ---------------------------------------------------------------- factors
  const fRows = d.factors.map((f, i) => {
    const set = (fn) => update(x => fn(x.factors[i]));
    const cat = f.type === 'categorical' || (f.type === undefined && Array.isArray(f.levels) && f.levels.some(v => typeof v === 'string'));
    return h('tr', { 'data-factor': f.id },
      h('td', {}, h('input', { class: 'id', value: f.id ?? '', disabled: locked, 'aria-label': 'factor id', onchange: (e) => set(o => { o.id = e.target.value.trim(); }) })),
      h('td', {}, h('input', { type: 'text', value: f.name ?? '', 'aria-label': 'name', onchange: (e) => set(o => { o.name = e.target.value; }) })),
      h('td', {}, h('input', { class: 'short', value: f.units ?? '', 'aria-label': 'units', onchange: (e) => set(o => { if (e.target.value) o.units = e.target.value; else delete o.units; }) })),
      h('td', {}, select([{ value: 'continuous', label: 'continuous' }, { value: 'categorical', label: 'categorical' }], cat ? 'categorical' : 'continuous', (v) => set(o => {
        if (v === 'categorical') { o.type = 'categorical'; o.levels = ['L1', 'L2']; delete o.low; delete o.high; delete o.transform; delete o.tolerance; }
        else { o.type = 'continuous'; delete o.levels; o.low = -1; o.high = 1; }
      }), { disabled: locked, 'aria-label': 'type' })),
      cat
        ? h('td', { colspan: 3 }, h('input', { type: 'text', value: (f.levels ?? []).join(', '), disabled: locked, 'aria-label': 'levels', title: 'levels, separated by commas',
            onchange: (e) => set(o => { o.levels = e.target.value.split(',').map(s => s.trim()).filter(Boolean); }) }))
        : [h('td', {}, h('input', { class: 'num', value: f.low ?? '', 'aria-label': 'low', onchange: (e) => set(o => numOrDelete(o, 'low', e.target.value)) })),
           h('td', {}, h('input', { class: 'num', value: f.high ?? '', 'aria-label': 'high', onchange: (e) => set(o => numOrDelete(o, 'high', e.target.value)) })),
           h('td', {}, select(['linear', 'log'], f.transform === 'log' ? 'log' : 'linear', (v) => set(o => { if (v === 'log') o.transform = 'log'; else delete o.transform; }), { 'aria-label': 'scale' }))],
      h('td', { class: 'n' }, h('input', { type: 'checkbox', checked: !!f.htc, 'aria-label': 'hard to change', title: 'hard to change: set once per batch / furnace run (whole plot)', onchange: (e) => set(o => { o.htc = e.target.checked; }) })),
      h('td', {}, h('button', { class: 'btn', disabled: locked || d.factors.length < 2, title: 'remove factor', onclick: () => update(x => { x.factors.splice(i, 1); x.constraints = []; }) }, '✕')));
  });
  const factors = h('section', { class: 'panel' }, h('h2', {}, 'Factors'),
    lockNote,
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, ['id', 'name', 'units', 'type', 'low', 'high', 'scale', 'hard to change', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, fRows))),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'btn', disabled: locked, onclick: () => update(x => { const id = nextId(x.factors.map(f => f.id), String.fromCharCode(65 + Math.min(x.factors.length, 25))); x.factors.push({ id, name: `Factor ${id}`, low: -1, high: 1 }); }) }, '+ continuous factor'),
      h('button', { class: 'btn', disabled: locked, onclick: () => update(x => { const id = nextId(x.factors.map(f => f.id), 'g'); x.factors.push({ id, name: 'Categorical factor', type: 'categorical', levels: ['L1', 'L2'] }); }) }, '+ categorical factor'),
      h('span', { class: 'muted small' }, 'Ids are used in formulas (letters, digits, _). Coded units run from −1 at low to +1 at high; log scale codes log10.')));

  // ---------------------------------------------------------------- responses
  const anySite = d.responses?.some(r => (r.levels ?? []).includes('site'));
  const rRows = (d.responses ?? []).map((r, i) => {
    const set = (fn) => update(x => fn(x.responses[i]));
    const goal = r.goal ?? 'none';
    return h('tr', { 'data-response': r.id },
      h('td', {}, h('input', { class: 'id', value: r.id ?? '', 'aria-label': 'response id', onchange: (e) => update(x => {
        // rename the response and its observations in one change
        const old = x.responses[i].id, id = e.target.value.trim();
        x.responses[i].id = id;
        for (const ob of x.observations ?? []) if (ob.response === old) ob.response = id;
      }) })),
      h('td', {}, h('input', { type: 'text', value: r.name ?? '', 'aria-label': 'name', onchange: (e) => set(o => { o.name = e.target.value; }) })),
      h('td', {}, h('input', { class: 'short', value: r.units ?? '', 'aria-label': 'units', onchange: (e) => set(o => { if (e.target.value) o.units = e.target.value; else delete o.units; }) })),
      h('td', {}, select(['none', 'maximize', 'minimize', 'target', 'range'], goal, (v) => set(o => { o.goal = v; }), { 'aria-label': 'goal' })),
      ['lower', 'target', 'upper'].map(k => h('td', {}, h('input', { class: 'num', value: r[k] ?? '', 'aria-label': k, disabled: goal === 'none' || (k === 'target' && goal !== 'target'),
        onchange: (e) => set(o => numOrDelete(o, k, e.target.value)) }))),
      r.derived ? h('td', { class: 'muted small' }, `wafer ${SUMMARY_STATS[r.derived.stat]?.name ?? r.derived.stat} of ${r.derived.from}`)
        : h('td', {}, select(MEASURED, measuredKey(r.levels), (v) => set(o => { o.levels = MEASURED.find(m => m.value === v).levels; }), { 'aria-label': 'measured' })),
      h('td', {}, r.derived ? null : h('button', { class: 'btn small', 'data-gauge': r.id, title: 'gauge R&R study for this response', onclick: () => setUI({ gauge: { open: r.id } }) },
        r.measurement ? `σ_meas ${num(r.measurement.sigma, 3)}` : 'gauge…')),
      h('td', {}, h('button', { class: 'btn', title: 'remove response', disabled: (d.observations ?? []).some(o => o.response === r.id), onclick: () => update(x => { x.responses.splice(i, 1); }) }, '✕')));
  });
  const responses = h('section', { class: 'panel' }, h('h2', {}, 'Responses'),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, ['id', 'name', 'units', 'goal', 'lower', 'target', 'upper', 'measured', 'measurement system', ''].map(t => h('th', {}, t)))), h('tbody', {}, rRows))),
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: () => update(x => { x.responses ??= []; x.responses.push({ id: nextId(x.responses.map(r => r.id), 'y'), name: 'Response' }); }) }, '+ response'),
      siteResponses(d, update),
      h('span', { class: 'muted small' }, 'Responses measured per wafer or site are analysed reading by reading with a mixed model (whole plots, runs and wafers as random effects).')));

  // ---------------------------------------------------------------- sites
  const sites = anySite ? sitePanel(d, update) : null;

  // ---------------------------------------------------------------- constraints
  const cons = h('section', { class: 'panel' }, h('h2', {}, 'Constraints'),
    h('p', { class: 'muted small' }, 'Linear limits on factor settings in natural units, e.g. ', h('span', { class: 'mono' }, 'T + 2*t <= 1050'), '. Designs from later steps (optimal designs) respect them; runs that break one are flagged.'),
    (d.constraints ?? []).map((c, i) => h('div', { class: 'row', style: 'margin-bottom:6px' },
      h('input', { type: 'text', class: 'formula', style: 'max-width:420px', value: typeof c === 'string' ? c : c.expr, 'aria-label': `constraint ${i + 1}`,
        onchange: (e) => update(x => { x.constraints[i] = typeof c === 'string' ? e.target.value : { ...c, expr: e.target.value }; }) }),
      h('button', { class: 'btn', onclick: () => update(x => { x.constraints.splice(i, 1); }) }, '✕'))),
    h('button', { class: 'btn', onclick: () => update(x => { x.constraints ??= []; x.constraints.push(`${x.factors[0].id} <= ${x.factors[0].high ?? 1}`); }) }, '+ constraint'));

  const desc = h('section', { class: 'panel' }, h('h2', {}, 'Notes'),
    h('textarea', { rows: 2, style: 'width:100%', placeholder: 'What is this study for?', value: d.description ?? '', onchange: (e) => update(x => { if (e.target.value) x.description = e.target.value; else delete x.description; }) }));

  const next = state.study ? h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => go(d.design ? 'run' : 'design') }, d.design ? 'Go to Run →' : 'Choose a design →')) : null;
  const gauge = state.ui.gauge?.open ? gaugePanel(ctx, state.ui.gauge.open) : null;
  return h('div', {}, errs, warns, factors, responses, gauge, sites, simulatorPanel(d, update), cons, desc, next);
}

// computer experiments (§10): the simulator that runs the design. Adapters with their own UI
// (comb-over) register an editor in SIMULATOR_EDITORS.
export const SIMULATOR_EDITORS = {
  expression: (d, update) => h('div', {},
    h('p', { class: 'muted small' }, 'Each response as a formula in the factor ids: + − * / ^, parentheses, sin cos tan exp log log10 sqrt abs min max pow tanh, pi.'),
    (d.responses ?? []).map(r => h('div', { class: 'row' }, h('label', { class: 'inline' }, `${r.id} =`,
      h('input', { type: 'text', class: 'formula', style: 'width:32em', value: d.simulator.responses?.[r.id] ?? '', placeholder: '—', 'aria-label': `simulator ${r.id}`,
        onchange: (e) => update(x => { x.simulator.responses ??= {}; if (e.target.value.trim()) x.simulator.responses[r.id] = e.target.value.trim(); else delete x.simulator.responses[r.id]; }) }))))),
};
export const SIMULATOR_CHOICES = [{ value: 'expression', label: 'formulas', make: () => ({ adapter: 'expression', responses: {} }) }];

function simulatorPanel(d, update) {
  const sim = d.simulator;
  const choose = h('div', { class: 'row' }, SIMULATOR_CHOICES.map(c => h('button', { class: 'btn', 'data-simulator': c.value, disabled: sim?.adapter === c.value,
    onclick: () => update(x => { x.simulator = c.make(x); }) }, sim ? `Use ${c.label} instead` : `Simulate with ${c.label}`)),
    sim ? h('button', { class: 'btn', onclick: () => update(x => { delete x.simulator; }) }, 'No simulator') : null);
  if (!sim) return h('section', { class: 'panel', id: 'simulator' }, h('details', {}, h('summary', {}, 'Simulator (computer experiments)'),
    h('p', { class: 'muted small' }, 'Run the design on a simulator instead of in the lab: the Run step fills in the results, and the Optimise step estimates yield and sensitivities from a surrogate model.'), choose));
  const ed = SIMULATOR_EDITORS[sim.adapter];
  return h('section', { class: 'panel', id: 'simulator' }, h('h2', {}, 'Simulator'), choose,
    ed ? ed(d, update) : h('div', { class: 'msg warning' }, `The "${sim.adapter}" simulator runs from the command line only.`));
}

// per-wafer summaries of site-measured responses, as derived responses
function siteResponses(d, update) {
  const src = (d.responses ?? []).filter(r => !r.derived && ((r.levels ?? []).includes('site') || (r.levels ?? []).includes('wafer')));
  if (!src.length) return null;
  return h('span', { class: 'row small' }, 'per-wafer summaries of', src.map(r => h('span', {}, ` ${r.id}: `,
    Object.keys(SUMMARY_STATS).map(st => h('button', { class: 'btn small', 'data-summary': `${r.id}_${st}`, disabled: (d.responses ?? []).some(x => x.id === `${r.id}_${st}`),
      title: `add ${r.id}_${st}: the ${SUMMARY_STATS[st].name} of each wafer's readings, computed from the data`, onclick: () => update(x => { Object.assign(x, addSummaries(x, r.id, [st])); }) }, st)))));
}

function sitePanel(d, update) {
  const pos = d.sites?.positions ?? [];
  const preset = (n) => update(x => { x.sites = siteScheme(n, { diameter: x.sites?.diameter ?? 200 }); });
  return h('section', { class: 'panel' }, h('h2', {}, 'Drop-in sites'),
    h('p', { class: 'muted small' }, 'Positions of the test structures on the wafer (mm from the centre). Responses measured per site get one result column per site on the run sheet.'),
    h('div', { class: 'row', style: 'margin-bottom:8px' }, h('button', { class: 'btn', onclick: () => preset(5) }, '5-site preset'), h('button', { class: 'btn', onclick: () => preset(9) }, '9-site preset'),
      h('label', { class: 'inline' }, 'wafer diameter (mm)', h('input', { class: 'num', type: 'number', min: 1, value: d.sites?.diameter ?? '', placeholder: '—', 'aria-label': 'wafer diameter',
        onchange: (e) => update(x => { x.sites ??= { scheme: 'custom', positions: [] }; if (e.target.value) x.sites.diameter = Number(e.target.value); else delete x.sites.diameter; }) })),
      h('span', { class: 'muted small' }, pos.length ? `${pos.length} sites (${d.sites.scheme})` : 'no sites yet')),
    pos.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data', style: 'max-width:420px' },
      h('thead', {}, h('tr', {}, ['site', 'x (mm)', 'y (mm)', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, pos.map((p, i) => h('tr', {},
        h('td', {}, h('input', { class: 'id', value: p.id, onchange: (e) => update(x => { x.sites.positions[i].id = e.target.value.trim(); x.sites.scheme = 'custom'; }) })),
        ['x', 'y'].map(k => h('td', {}, h('input', { class: 'num', value: p[k], onchange: (e) => update(x => { x.sites.positions[i][k] = Number(e.target.value); x.sites.scheme = 'custom'; }) }))),
        h('td', {}, h('button', { class: 'btn', onclick: () => update(x => { x.sites.positions.splice(i, 1); x.sites.scheme = 'custom'; }) }, '✕'))))))) : null);
}
