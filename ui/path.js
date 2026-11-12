// Optimise step: moving to a better region (issue #81). When the first experiment shows the best
// settings lie outside the ranges, the path of steepest ascent from its centre (ridge analysis
// with curvature), with the confidence cone of its direction; its points added as a stage of runs
// (run in step order); once they have results, where the response stopped improving and a new
// study centred there.
import { h, help, select, dataTable, download } from './dom.js';
import { num } from '../js/format.js';
import { serializeStudy } from '../js/study.js';
import { fitModel } from '../js/model/fit.js';
import { steepestPath, directionRegion, pathStage, pathResults, nextStudy } from '../js/model/path.js';
import { appendStage } from '../js/design/augment.js';

export function pathPanel(ctx) {
  const { state, setDoc, setUI, toast } = ctx, study = state.study;
  if (!study?.design || !study.factors.some(f => f.type !== 'categorical' && !study.mixture?.components.includes(f.id)) || study.mixture) return null;
  const resps = study.responses.filter(r => !r.derived && !r.distribution && study.observations.some(o => o.response === r.id && o.value !== null));
  if (!resps.length) return null;
  const ui = state.ui.path ?? {}, set = (p) => setUI({ path: { ...ui, ...p } });
  const resp = resps.find(r => r.id === ui.response) ?? resps[0];
  const formula = state.ui.analyse?.formulas?.[resp.id]?.includes('~') ? state.ui.analyse.formulas[resp.id] : `${resp.id} ~ main`;
  const head = h('div', { class: 'row' },
    resps.length > 1 ? h('label', { class: 'inline' }, 'for', select(resps.map(r => r.id), resp.id, (v) => set({ response: v }), { 'aria-label': 'path response' })) : null,
    h('span', { class: 'muted small' }, `model ${formula} (as on Analyse)`));
  const panel = (...body) => h('section', { class: 'panel', id: 'path' }, h('h2', {}, 'Moving to a better region', help('designs-sequential', 'moving-to-a-better-region-steepest-ascent')), head, ...body);

  // the path's runs, once added: results against predictions, the best step, the next study
  const res = pathResults(study, { response: resp.id });
  if (res) {
    const fs = study.factors.filter(f => f.type !== 'categorical' && res.points.some(q => q.settings[f.id] !== res.points[0].settings[f.id]));
    const table = dataTable([{ key: 'step', label: 'step', cls: 'n' }, ...fs.map(f => ({ key: f.id, label: f.units ? `${f.id} (${f.units})` : f.id, cls: 'n', fmt: (v) => num(v, 5) })),
      { key: 'predicted', label: 'predicted', cls: 'n', fmt: (v) => (v === null ? '' : num(v, 4)) }, { key: 'observed', label: 'observed', cls: 'n', fmt: (v, r) => (v === null ? '—' : h(res.best?.run === r.run ? 'b' : 'span', {}, num(v, 4))) }],
      res.points.map(q => ({ ...q, ...Object.fromEntries(fs.map(f => [f.id, q.settings[f.id]])) })), { rowAttrs: (r) => ({ 'data-path-step': r.step }) });
    const verdict = !res.best ? 'No results along the path yet: run the points in step order (the Run step lists them last), one or two at a time.'
      : res.stoppedImproving ? `The response stopped improving after step ${res.best.step} (${num(res.best.observed, 4)}): the next experiment belongs there.`
        : res.done < res.points.length ? `Still improving at step ${res.best.step}: run the next steps.` : 'Still improving at the last step: extend the path, or centre the next experiment at the last step.';
    const kind = ui.nextDesign ?? 'factorial';
    const make = () => nextStudy(study, res.best.settings, { design: kind });
    const actions = res.best ? h('div', { class: 'row', id: 'path-next' },
      h('label', { class: 'inline' }, 'next experiment', select([{ value: 'factorial', label: 'factorial with centre points' }, { value: 'ccd', label: 'central composite' }, { value: 'none', label: 'no design yet' }], kind, (v) => set({ nextDesign: v }), { 'aria-label': 'next design' })),
      h('button', { class: 'btn', id: 'path-next-download', onclick: () => { try { const n = make(); download(`${(study.name || 'study').replace(/[^\w-]+/g, '-')}-next.aikidoe.json`, serializeStudy(n), 'application/json'); toast('Next study downloaded'); } catch (e) { toast(e.message); } } }, 'Download it'),
      h('button', { class: 'btn primary', id: 'path-next-open', onclick: () => { try { const n = make(); state.step = n.design ? 'design' : 'define'; setDoc(structuredClone(n)); toast(`New study centred at step ${res.best.step} (the old one is replaced: download it first to keep it)`); } catch (e) { toast(e.message); } } }, `Open it, centred at step ${res.best.step}`),
      h('span', { class: 'muted small' }, 'the same factors and widths, centred on the best point (within the operating limits)')) : null;
    const gap = res.points.filter(q => q.observed !== null && q.predicted !== null);
    return panel(table, h('p', { class: 'small', id: 'path-verdict' }, verdict,
      gap.length >= 3 && Math.abs(gap.at(-1).observed - gap.at(-1).predicted) > 2 * Math.abs(gap[0].observed - gap[0].predicted) ? ' The results fall behind the predictions further along: the plane fitted to the first experiment no longer holds there, as expected near an optimum.' : ''), actions);
  }

  // the path itself
  let fit, p, region = null, err = null;
  const steps = ui.steps ?? 6;
  try {
    fit = fitModel(study, formula);
    p = steepestPath(study, fit, { steps });
    if (p.method === 'linear') region = directionRegion(study, fit);
  } catch (e) { err = e.message; }
  if (err) return panel(h('p', { class: 'muted small' }, `No path: ${err}`));
  const fs = p.factors.map(id => study.factors.find(f => f.id === id));
  const cone = !region ? null : region.k < 2 ? 'One factor: the direction is up or down.'
    : region.fraction >= 1 ? h('span', { class: 'low-power' }, 'The direction is not determined: the data are consistent with every direction (95 %). Replicate, or widen the ranges, before walking anywhere.')
      : `95 % confidence cone about the direction: half-angle ${num(region.angle, 3)}°, ${num(100 * region.fraction, 2)} % of all directions${region.determined ? ' — well determined.' : ' — poorly determined: the path may be off.'}`;
  const table = dataTable([{ key: 'step', label: 'step', cls: 'n' }, ...fs.map(f => ({ key: f.id, label: f.units ? `${f.id} (${f.units})` : f.id, cls: 'n', fmt: (v) => num(v, 5) })),
    { key: 'fit', label: `${resp.id} predicted`, cls: 'n', fmt: (v, r) => h('span', { class: r.outside ? 'muted' : '' }, num(v, 4)) }, { key: 'note', label: '' }],
    p.points.map(q => ({ ...q, ...Object.fromEntries(fs.map(f => [f.id, q.settings[f.id]])), note: [q.outside ? 'beyond the runs' : '', q.limited.length ? `${q.limited.join(', ')} at limit` : ''].filter(Boolean).join('; ') })), { rowAttrs: (r) => ({ 'data-path-point': r.step }) });
  const add = () => {
    try {
      const next = appendStage(study, pathStage(study, fit, { steps }));
      state.step = 'run'; setDoc(structuredClone(next)); toast(`${steps} runs along the path added: run them in step order`);
    } catch (e) { toast(e.message); }
  };
  return panel(
    h('p', { class: 'small' }, p.method === 'linear'
      ? `The path of steepest ${p.goal} from the centre: each step moves ${fs.map(f => `${f.id} ${p.increments[f.id] >= 0 ? '+' : ''}${num(p.increments[f.id], 4)}${f.units ? ` ${f.units}` : ''}`).join(', ')}. `
      : `The model has curvature: the path is by ridge analysis (the best point at each distance from the centre). `,
      Object.keys(p.held).length ? `Held: ${Object.entries(p.held).map(([k, v]) => `${k} = ${v}`).join(', ')}. ` : '', cone ?? ''),
    table,
    p.stopped ? h('p', { class: 'small' }, `Stopped: ${p.stopped}.`) : null,
    h('div', { class: 'row' },
      h('label', { class: 'inline' }, 'steps', h('input', { class: 'num', type: 'number', min: 1, max: 30, value: steps, 'aria-label': 'path steps', onchange: (e) => set({ steps: Math.max(1, Math.min(30, Math.round(Number(e.target.value) || 6))) }) })),
      h('button', { class: 'btn primary', id: 'path-add', onclick: add }, 'Add these runs as a new stage'),
      h('span', { class: 'muted small' }, 'the predictions beyond the runs are extrapolation: run the path and stop where it stops improving')));
}
