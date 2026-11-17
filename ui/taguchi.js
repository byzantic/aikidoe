// Analyse step for a crossed (inner × outer) array (issue #85, phase 3): Taguchi's signal-to-noise
// ratios for each set of control settings, and the response table; with the advice that the
// response model (control × noise interactions, below) and robust design on the Optimise step
// separate the mean from the spread, where the S/N ratio mixes them.
import { h, help, dataTable, select } from './dom.js';
import { num } from '../js/format.js';
import { crossedSummaries, responseTable, snGoalOf, SN_GOALS } from '../js/model/taguchi.js';

export function taguchiPanel(ctx, resp, { ui, set }) {
  const study = ctx.state.study, goal = ui.snGoal?.[resp.id] ?? snGoalOf(resp);
  let s, t;
  try { s = crossedSummaries(study, resp.id, { goal }); t = responseTable(s, study); } catch (e) { return h('section', { class: 'panel', id: 'taguchi' }, h('h2', {}, 'Signal-to-noise ratios', help('optimisation', 'inner-and-outer-arrays')), h('div', { class: 'msg' }, e.message)); }
  return h('section', { class: 'panel', id: 'taguchi' }, h('h2', {}, 'Signal-to-noise ratios', help('optimisation', 'inner-and-outer-arrays')),
    h('div', { class: 'row small' }, 'goal', select(Object.entries(SN_GOALS).map(([value, g]) => ({ value, label: g.label })), goal, (v) => set({ snGoal: { ...(ui.snGoal ?? {}), [resp.id]: v } }), { 'aria-label': 'signal-to-noise goal' }),
      h('span', { class: 'muted' }, `over the noise factors ${s.noise.join(', ')}`)),
    dataTable([{ key: 'factor', label: 'control factor' }, { key: 'levels', label: 'average S/N (dB) at each level', fmt: (v, r) => v.map(l => h('span', { class: l.level === r.best ? 'sig' : '', style: 'margin-right:1.2em' }, `${l.level}: ${num(l.sn, 4)}`)) },
      { key: 'range', label: 'range', cls: 'n', fmt: (v) => num(v, 3) }, { key: 'rank', label: 'rank', cls: 'n' }], t, { rowAttrs: (r) => ({ 'data-sn-factor': r.factor }) }),
    h('details', {}, h('summary', { class: 'small' }, `each set of control settings (${s.rows.length})`),
      dataTable([...s.control.map(id => ({ key: id, label: id, fmt: (_, r) => String(r.settings[id]) })), { key: 'n', label: 'n', cls: 'n' }, { key: 'mean', label: 'mean', cls: 'n', fmt: (v) => num(v, 4) },
        { key: 'sd', label: 's', cls: 'n', fmt: (v) => num(v, 3) }, { key: 'sn', label: 'S/N', cls: 'n', fmt: (v) => num(v, 4) }], s.rows)),
    h('p', { class: 'muted small' }, 'The bold level has the highest S/N. The S/N ratio mixes the mean and the spread: the same value can come from different means. The model below, with control × noise interactions, shows which control factors change the effect of the noise; robust design on the Optimise step then finds settings with the mean on target and the least spread.'));
}
