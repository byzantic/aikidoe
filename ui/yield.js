// Yield and sensitivity panel of the Optimise step (spec §10, issue #20): tolerance distributions
// and specification limits, Monte Carlo yield on surrogate models with their cross-validated
// error, Sobol indices, and a direct check on the study's simulator.
import { h, select, dataTable, messages } from './dom.js';
import { plot } from './plot.js';
import { num } from '../js/format.js';
import { fitSurrogates, surrogateYield, surrogateSensitivity, directYieldCheck } from '../js/sim/surrogate.js';
import { toleranceSd } from '../js/sim/sample.js';
import { studyAdapter } from '../js/sim/adapters.js';

const DISTS = [{ value: 'normal', label: 'normal' }, { value: 'uniform', label: 'uniform' }, { value: 'truncated', label: 'normal, cut at ±2 sd' }];
const tolOf = (f) => (f.tolerance === undefined ? null : typeof f.tolerance === 'number' ? { sd: f.tolerance, dist: 'normal' } : f.tolerance);

export function yieldPanel({ state, update, setUI }, at, set, ui) {
  const study = state.study;
  const cont = study.factors.filter(f => f.type !== 'categorical');
  if (!cont.length) return null;
  const formulas = state.ui.analyse?.formulas ?? {};

  // ---------------------------------------------------------------- inputs
  const setTol = (id, patch) => update(d => {
    const o = d.factors.find(x => x.id === id), t = { ...(tolOf(o) ?? { sd: 0, dist: 'normal' }), ...patch };
    if (!(t.sd > 0)) delete o.tolerance; else o.tolerance = t.dist === 'normal' && t.at === undefined ? t.sd : t;
  });
  const tolTable = dataTable([{ key: 'f', label: 'factor' }, { key: 'sd', label: 'tolerance sd' }, { key: 'dist', label: 'distribution' }, { key: 'eff', label: 'actual sd', cls: 'n' }],
    cont.map(f => { const t = tolOf(f); return { f: f.units ? `${f.id} (${f.units})` : f.id,
      sd: h('input', { class: 'num', type: 'number', min: 0, step: 'any', value: t?.sd ?? '', placeholder: '—', 'aria-label': `yield ${f.id} sd`, onchange: (e) => setTol(f.id, { sd: e.target.value === '' ? 0 : Number(e.target.value) }) }),
      dist: select(DISTS, t?.dist ?? 'normal', (v) => setTol(f.id, { dist: v }), { 'aria-label': `yield ${f.id} distribution`, disabled: !t }),
      eff: t ? num(toleranceSd(t), 4) : '' }; }));
  const setSpec = (id, key, text) => update(d => {
    const r = d.responses.find(x => x.id === id), sp = { ...(r.spec ?? {}) };
    if (text === '') delete sp[key]; else sp[key] = Number(text);
    if (sp.lower === undefined && sp.upper === undefined) delete r.spec; else r.spec = sp;
  });
  const specTable = dataTable([{ key: 'r', label: 'response' }, { key: 'lo', label: 'lower spec' }, { key: 'hi', label: 'upper spec' }],
    study.responses.map(r => ({ r: r.units ? `${r.id} (${r.units})` : r.id,
      lo: h('input', { class: 'num', type: 'number', step: 'any', value: r.spec?.lower ?? '', placeholder: '−∞', 'aria-label': `spec ${r.id} lower`, onchange: (e) => setSpec(r.id, 'lower', e.target.value) }),
      hi: h('input', { class: 'num', type: 'number', step: 'any', value: r.spec?.upper ?? '', placeholder: '∞', 'aria-label': `spec ${r.id} upper`, onchange: (e) => setSpec(r.id, 'upper', e.target.value) }) })));

  // ---------------------------------------------------------------- surrogates
  let sur;
  try { sur = fitSurrogates(study, { formulas }); } catch (e) { return h('section', { class: 'panel', id: 'yield' }, h('h2', {}, 'Yield and sensitivity'), h('div', { class: 'msg error' }, e.message)); }
  const ms = sur.models;
  const surTable = ms.length ? dataTable([{ key: 'id', label: 'surrogate' }, { key: 'formula', label: 'model' }, { key: 'n', label: 'runs', cls: 'n' }, { key: 'r2', label: 'R²', cls: 'n', fmt: (v) => num(v, 4) },
    { key: 'predR2', label: 'pred R²', cls: 'n', fmt: (v) => num(v, 4) }, { key: 'cvRmse', label: 'RMSE_cv', cls: 'n', fmt: (v) => num(v, 4) }], ms) : null;

  // ---------------------------------------------------------------- yield
  const specIds = study.responses.filter(r => r.spec).map(r => r.id);
  const key = JSON.stringify({ at, f: study.factors.map(f => f.tolerance), s: study.responses.map(r => r.spec), formulas, n: study.observations.length });
  const N = ui.yN ?? 20000;
  let yres = null, yerr = null;
  const hasTol = cont.some(f => tolOf(f)?.sd > 0);
  if (specIds.length && hasTol && ms.some(m => specIds.includes(m.id))) {
    try { yres = surrogateYield(study, ms.filter(m => specIds.includes(m.id)), { settings: at, N, seed: study.seed >>> 0, keep: true }); } catch (e) { yerr = e.message; }
  }
  const check = ui.yCheck?.key === key ? ui.yCheck : null;
  let yieldBody;
  if (!specIds.length || !hasTol) yieldBody = h('p', { class: 'muted small' }, 'Give at least one factor a tolerance and one response a spec limit to estimate the yield at the settings above.');
  else if (yerr) yieldBody = h('div', { class: 'msg error' }, yerr);
  else if (!yres) yieldBody = h('p', { class: 'muted small' }, 'No surrogate for the responses with spec limits yet.');
  else {
    const hist = specIds.filter(id => ms.some(m => m.id === id)).map(id => {
      const vals = yres.samples.map(s => s.values[id]), lo = Math.min(...vals), hi = Math.max(...vals), nb = 40, w = (hi - lo) / nb || 1;
      const counts = Array(nb).fill(0); for (const v of vals) counts[Math.min(nb - 1, Math.floor((v - lo) / w))]++;
      const sp = yres.specs.find(s => s.id === id);
      return h('figure', {}, h('figcaption', {}, `${id} at the settings above`), plot({ height: 180, width: 360, xLabel: id, yLabel: 'samples',
        series: [{ kind: 'line', points: counts.flatMap((c, i) => [{ x: lo + i * w, y: c }, { x: lo + (i + 1) * w, y: c }]) }],
        vlines: [sp.lower, sp.upper].filter(v => v !== undefined).map(x => ({ x, cls: 'lim' })) }));
    });
    yieldBody = h('div', { id: 'yield-result' },
      h('div', { class: 'row small' }, h('span', { class: 'stat' }, 'yield ', h('b', { 'data-yield': yres.yield }, `${num(100 * yres.yield, 4)} %`)),
        h('span', { class: 'stat' }, `95% CI ${num(100 * yres.lower, 4)} … ${num(100 * yres.upper, 4)} %`), h('span', { class: 'muted' }, `${N} samples of the surrogate`)),
      dataTable([{ key: 'id', label: 'response' }, { key: 'spec', label: 'spec' }, { key: 'nominal', label: 'at settings', cls: 'n', fmt: (v) => num(v) }, { key: 'margin', label: 'margin', cls: 'n', fmt: (v) => num(v) },
        { key: 'cvError', label: 'RMSE_cv', cls: 'n', fmt: (v) => num(v, 3) }, { key: 'below', label: '% below', cls: 'n', fmt: (v) => num(v, 3) }, { key: 'above', label: '% above', cls: 'n', fmt: (v) => num(v, 3) }],
        yres.margins.map((m, i) => ({ ...m, spec: `${yres.specs[i].lower ?? '−∞'} … ${yres.specs[i].upper ?? '∞'}`, below: 100 * yres.perResponse[i].below, above: 100 * yres.perResponse[i].above }))),
      yres.bounds ? h('p', { class: 'small' }, `With every limit moved in or out by 2 × RMSE_cv the yield would be ${num(100 * yres.bounds.strict, 4)} … ${num(100 * yres.bounds.loose, 4)} %.`) : null,
      yres.trust === 'fair' ? h('div', { class: 'msg', id: 'yield-trust', 'data-trust': 'fair' }, `The surrogate’s error, not the sampling, limits this estimate: it could lie anywhere in ${num(100 * yres.bounds.strict, 3)} … ${num(100 * yres.bounds.loose, 3)} %. Check it on the simulator, or add runs to the design to tighten it.`) : null,
      yres.trustworthy ? null : h('div', { class: 'msg warning', id: 'yield-trust', 'data-trust': 'poor' }, 'The surrogate’s cross-validated error is comparable to the margins to the spec limits: this yield reflects the surrogate more than the process. Check it on the simulator, add runs near the limits, narrow the factor ranges or fit a better model.'),
      h('div', { class: 'grid2' }, hist),
      study.simulator ? h('div', { class: 'row' }, h('button', { class: 'btn', id: 'yield-check', onclick: async (e) => {
        e.target.disabled = true; e.target.textContent = 'Simulating…';
        try {
          const ad = await studyAdapter(study);
          const d = await directYieldCheck(study, ms.filter(m => specIds.includes(m.id)), ad, { settings: at, M: ui.yM ?? 200, seed: (study.seed + 1) >>> 0 });
          set({ yCheck: { key, yield: d.yield, lower: d.lower, upper: d.upper, M: d.M, agree: d.agree, rmse: d.rmse } });
        } catch (err) { set({ yCheck: { key, error: err.message } }); }
      } }, 'Check on the simulator'),
        h('label', { class: 'inline' }, 'runs', h('input', { class: 'num', type: 'number', min: 10, value: ui.yM ?? 200, 'aria-label': 'check runs', onchange: (e) => set({ yM: Number(e.target.value) }) }))) : null,
      check ? (check.error ? h('div', { class: 'msg error' }, check.error) : h('div', { class: `msg ${check.lower <= yres.upper && yres.lower <= check.upper ? 'ok' : 'warning'}`, id: 'yield-check-result' },
        `Simulator: yield ${num(100 * check.yield, 4)} % (95% CI ${num(100 * check.lower, 4)} … ${num(100 * check.upper, 4)} %, ${check.M} runs); surrogate RMS error ${Object.entries(check.rmse).map(([k, v]) => `${k} ${num(v, 3)}`).join(', ')}; same pass/fail for ${num(100 * check.agree, 3)} % of the runs.`)) : null);
  }

  // ---------------------------------------------------------------- sensitivity
  const over = ui.sOver ?? 'range';
  let sens = null, serr = null;
  if (ms.length && (over === 'range' || hasTol)) { try { sens = surrogateSensitivity(study, ms, { over, settings: at, N: 8192, seed: study.seed >>> 0 }); } catch (e) { serr = e.message; } }
  const sensBody = h('div', { id: 'sensitivity' },
    h('div', { class: 'row small' }, h('label', { class: 'inline' }, 'vary', select([{ value: 'range', label: 'each factor over its range' }, { value: 'tolerance', label: 'each factor by its tolerance' }], over, (v) => set({ sOver: v }), { 'aria-label': 'sensitivity domain' }))),
    serr ? h('div', { class: 'msg error' }, serr) : null,
    !sens && over === 'tolerance' ? h('p', { class: 'muted small' }, 'No factor has a tolerance.') : null,
    sens ? h('div', { class: 'grid2' }, sens.map(r => h('div', {}, h('h3', {}, r.id),
      dataTable([{ key: 'f', label: 'factor' }, { key: 's', label: 'S', cls: 'n', fmt: (v) => num(v, 3) }, { key: 't', label: 'ST', cls: 'n', fmt: (v) => num(v, 3) }, { key: 'bar', label: '' }],
        r.factors.map((f, i) => ({ f, s: r.first[i].S, t: r.total[i].S, bar: h('span', { class: 'vbar', title: `S ${num(r.first[i].lower, 3)} … ${num(r.first[i].upper, 3)}; ST ${num(r.total[i].lower, 3)} … ${num(r.total[i].upper, 3)}` },
          h('span', { style: `width:${Math.max(0, Math.min(100, 100 * r.total[i].S)).toFixed(1)}%` })) })))))) : null,
    h('p', { class: 'muted small' }, 'Sobol indices of the surrogate: S is the share of the response’s variance due to the factor alone, ST its share including interactions with the others. Bars show ST. Over the ranges this says which factors matter anywhere in the design space; over the tolerances, which tolerances drive the variation at the settings above.'));

  return h('section', { class: 'panel', id: 'yield' }, h('h2', {}, 'Yield and sensitivity'),
    h('p', { class: 'small' }, 'Each factor’s actual value scatters about its setting by its tolerance; a unit passes when every response with spec limits is inside them. The yield is estimated by Monte Carlo on surrogate models (least squares, the Analyse step’s formulas), whose leave-one-out error RMSE_cv says how far to trust them.'),
    messages(sur.missing.map(m => `${m.id}: ${m.reason}`), 'warning'),
    h('div', { class: 'grid2' }, h('div', {}, h('h3', {}, 'Tolerances'), tolTable), h('div', {}, h('h3', {}, 'Spec limits'), specTable)),
    surTable, h('h3', {}, 'Yield'), yieldBody, h('h3', {}, 'Sensitivity'), sensBody);
}
