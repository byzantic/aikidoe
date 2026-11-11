// Dose–response in the app (issue #65): the dose-design panel (Design step) and the dose–response
// analysis (Analyse step): curves on a log-dose axis, parameters, effective doses, relative potency
// and parallelism, doses for sample responses, LOD and LOQ.
import { h, select, dataTable, help, toast } from './dom.js';
import { plot } from './plot.js';
import { num, pval } from '../js/format.js';
import { createStudy, covariatesWithoutValues } from '../js/study.js';
import { platesWithoutWells } from '../js/plate.js';
import { doseDesign, addDoseStage, doseData, doseRoles } from '../js/design/dose-design.js';
import { MODELS, fitDose, effectiveDose, relativePotency, parallelism, inversePredict, detectionLimits, predictDose,
  dilutionSeries, optimalDoses, doseDesignQuality, guessScenarios, potencyPower } from '../js/model/dose.js';

const numIn = (value, onchange, attrs = {}) => h('input', { class: 'num', type: 'number', step: 'any', value: value ?? '', onchange: (e) => onchange(e.target.value === '' ? undefined : Number(e.target.value)), ...attrs });
const list = (s) => String(s ?? '').split(/[,\s]+/).filter(Boolean).map(Number);

// ---------------------------------------------------------------- Design step

/** The dose-design panel: a dilution series, listed doses, or optimal doses for a guess. */
export function doseDesignPanel(ctx) {
  const { state, setDoc, setUI } = ctx;
  const study = state.study, ui = state.ui.dose ??= {};
  const set = (patch) => setUI({ dose: { ...ui, ...patch } });
  const cont = study.factors.filter(f => f.type === 'continuous'), cats = study.factors.filter(f => f.type === 'categorical');
  const isDose = study.design?.kind === 'dose-response';
  if (!cont.length) return null;
  const open = ui.open ?? isDose;
  if (!open) return h('section', { class: 'panel', id: 'dose-design' }, h('div', { class: 'row' },
    h('span', { class: 'small' }, 'Is this a dose–response (concentration–response) experiment — an EC50, a potency, a standard curve?'),
    h('button', { class: 'btn', id: 'dose-open', onclick: () => set({ open: true }) }, 'Plan doses…'), help('dose-response', '')));

  const roles = isDose ? doseRoles(study) : { dose: cont[0].id, curve: cats.length === 1 ? cats[0].id : null };
  const dose = ui.dose ?? roles.dose, curve = ui.curve === undefined ? roles.curve : ui.curve;
  const method = ui.method ?? 'series';
  const reps = ui.replicates ?? 2, zeros = ui.zeros ?? (study.factors.find(f => f.id === dose)?.transform === 'log' ? 0 : 1);
  const guess = { b: ui.gb ?? 1, c: ui.gc ?? 0, d: ui.gd ?? 100, e: ui.ge ?? 1, f: 1 };
  const sig = (ui.sigma ?? 0.05 * Math.abs(guess.d - guess.c)) || 1;
  const nCurves = curve ? study.factors.find(f => f.id === curve).levels.length : 1;
  let doses = null, err = null, note = null;
  try {
    if (method === 'series') doses = dilutionSeries({ top: ui.top ?? 100, dilution: ui.dilution ?? 3, doses: ui.n ?? 8, zeros });
    else if (method === 'listed') { doses = list(ui.listed ?? '0, 0.1, 1, 10, 100'); if (doses.some(x => !(x >= 0))) throw new Error('doses must be numbers ≥ 0'); }
    else {
      const runs = ui.optRuns ?? 12, g = ui.robust > 1 ? guessScenarios(guess, { factor: ui.robust }) : guess;
      const o = optimalDoses({ guess: g, runs, range: [ui.lo ?? 0.01, ui.hi ?? 100], criterion: ui.criterion ?? 'D', zero: false });
      doses = [...Array(zeros).fill(0), ...o.doses];
      note = `${ui.criterion ?? 'D'}-optimal for the guess${ui.robust > 1 ? `, robust over EC50 ×/÷ ${ui.robust}` : ''}`;
    }
  } catch (e) { err = e.message; }
  const perCurve = doses ? (method === 'optimal' ? doses : doses.flatMap(d => Array(reps).fill(d))) : [];
  const nRuns = perCurve.length * nCurves;
  let quality = null;
  if (doses && ui.showQuality !== false && Number.isFinite(guess.e) && guess.e > 0) {
    try {
      const q = doseDesignQuality(perCurve, { guess, sigma: sig });
      quality = `at the guess: se(log EC50) = ${num(q.seLogE, 3)} — the EC50 to within ×/÷ ${num(Math.exp(1.96 * q.seLogE), 3)} (95 %)`;
      if (nCurves >= 2) { const pw = potencyPower(perCurve, { guess, sigma: sig, ratio: ui.ratio ?? 2 }); quality += `; power for a ${ui.ratio ?? 2}-fold potency difference ${num(pw.power, 2)}`; }
    } catch { /* singular for these doses */ }
  }
  const make = (asStage) => {
    try {
      const opts = { dose, curve, doses: method === 'optimal' ? [...new Set(doses)] : doses, replicates: method === 'optimal' ? 1 : reps, seed: study.seed,
        params: { method: method === 'series' ? 'dilution series' : method === 'listed' ? 'listed' : note } };
      if (method === 'optimal') { opts.doses = perCurve; opts.replicates = 1; }
      let next;
      if (asStage) next = addDoseStage(study, opts);
      else { const design = doseDesign(study, opts); next = createStudy({ ...study, design, observations: [], ...platesWithoutWells(study), ...covariatesWithoutValues(study), history: [{ stage: 'design', runs: design.runs.map(r => r.run), note: `dose–response, ${design.runs.length} runs` }] }); }
      state.ui.dose = { ...ui, open: true };
      if (!asStage) state.step = 'run';
      setDoc(structuredClone(next));
      toast(asStage ? `${nRuns} runs added as a new stage` : `Dose–response design: ${nRuns} runs`);
    } catch (e) { set({ error: e.message }); }
  };
  const nObs = study.observations.length;
  const guessRow = h('div', { class: 'row small' }, 'Guess:', h('label', { class: 'inline', title: 'slope (b > 0 decreasing, b < 0 increasing)' }, 'b', numIn(guess.b, (v) => set({ gb: v }), { 'aria-label': 'guess b' })),
    h('label', { class: 'inline' }, 'c', numIn(guess.c, (v) => set({ gc: v }), { 'aria-label': 'guess c' })), h('label', { class: 'inline' }, 'd', numIn(guess.d, (v) => set({ gd: v }), { 'aria-label': 'guess d' })),
    h('label', { class: 'inline', title: 'EC50' }, 'EC50', numIn(guess.e, (v) => set({ ge: v }), { 'aria-label': 'guess e' })),
    h('label', { class: 'inline', title: 'run-to-run standard deviation, in the response’s units' }, 'σ', numIn(ui.sigma, (v) => set({ sigma: v }), { 'aria-label': 'guess sigma', placeholder: num(sig, 3), title: 'default: 5 % of |d − c|' })),
    nCurves >= 2 ? h('label', { class: 'inline' }, 'potency ratio', numIn(ui.ratio ?? 2, (v) => set({ ratio: v }), { 'aria-label': 'potency ratio' })) : null);
  return h('section', { class: 'panel', id: 'dose-design' }, h('h2', {}, 'Dose–response design', help('dose-response', 'choosing-doses')),
    h('div', { class: 'row' },
      h('label', { class: 'inline' }, 'dose', select(cont.map(f => f.id), dose, (v) => set({ dose: v }), { 'aria-label': 'dose factor' })),
      cats.length ? h('label', { class: 'inline' }, 'one curve per', select([{ value: '', label: '— (one curve)' }, ...cats.map(f => ({ value: f.id, label: `${f.id} (${f.levels.join(', ')})` }))], curve ?? '', (v) => set({ curve: v || null }), { 'aria-label': 'curve factor' })) : null,
      h('label', { class: 'inline' }, 'doses', select([{ value: 'series', label: 'dilution series' }, { value: 'listed', label: 'listed' }, { value: 'optimal', label: 'optimal for a guess' }], method, (v) => set({ method: v }), { 'aria-label': 'dose method' }))),
    method === 'series' ? h('div', { class: 'row' },
      h('label', { class: 'inline' }, 'top dose', numIn(ui.top ?? 100, (v) => set({ top: v }), { 'aria-label': 'top dose' })),
      h('label', { class: 'inline' }, 'dilution factor', numIn(ui.dilution ?? 3, (v) => set({ dilution: v }), { 'aria-label': 'dilution' })),
      h('label', { class: 'inline' }, 'doses', numIn(ui.n ?? 8, (v) => set({ n: v }), { 'aria-label': 'number of doses' }))) : null,
    method === 'listed' ? h('div', { class: 'row' }, h('label', { class: 'inline' }, 'doses', h('input', { type: 'text', style: 'width:24em', value: ui.listed ?? '0, 0.1, 1, 10, 100', 'aria-label': 'listed doses', onchange: (e) => set({ listed: e.target.value }) }))) : null,
    method === 'optimal' ? h('div', { class: 'row' },
      h('label', { class: 'inline' }, 'range', numIn(ui.lo ?? 0.01, (v) => set({ lo: v }), { 'aria-label': 'range low' }), '…', numIn(ui.hi ?? 100, (v) => set({ hi: v }), { 'aria-label': 'range high' })),
      h('label', { class: 'inline' }, 'runs per curve', numIn(ui.optRuns ?? 12, (v) => set({ optRuns: v }), { 'aria-label': 'optimal runs' })),
      h('label', { class: 'inline' }, 'criterion', select([{ value: 'D', label: 'D (the whole curve)' }, { value: 'EC50', label: 'EC50 (its precision)' }], ui.criterion ?? 'D', (v) => set({ criterion: v }), { 'aria-label': 'dose criterion' })),
      h('label', { class: 'inline', title: 'robust: good for EC50s within this factor of the guess (and slopes ×/÷ 1.5)' }, 'robust ×/÷', numIn(ui.robust, (v) => set({ robust: v }), { 'aria-label': 'robust factor', placeholder: '—' }))) : null,
    h('div', { class: 'row' },
      h('label', { class: 'inline', title: 'untreated wells: the zero-dose asymptote' }, 'zero doses', numIn(zeros, (v) => set({ zeros: v ?? 0 }), { 'aria-label': 'zero doses', min: 0 })),
      method !== 'optimal' ? h('label', { class: 'inline' }, 'replicates', numIn(reps, (v) => set({ replicates: v ?? 1 }), { 'aria-label': 'dose replicates', min: 1 })) : null),
    guessRow,
    err ? h('div', { class: 'msg error' }, err) : doses ? h('p', { class: 'small', id: 'dose-preview' }, h('b', {}, `${nRuns} runs`), `${nCurves > 1 ? ` (${perCurve.length} per curve)` : ''}: ${[...new Set(perCurve)].map(d => `${num(d, 3)}${perCurve.filter(x => x === d).length > 1 ? ` ×${perCurve.filter(x => x === d).length}` : ''}`).join(', ')}.`,
      quality ? h('span', { class: 'muted' }, ` ${quality}.`) : null) : null,
    h('p', { class: 'muted small' }, 'Space doses on a log scale, from where nothing happens to where the effect is complete, with several doses on the slope; a guess of the EC50 and slope lets you compare designs before running anything. Not sure of the EC50? Run a wide range-finding series first and add doses around it as a second stage.'),
    ui.error ? h('div', { class: 'msg error' }, ui.error) : null,
    h('div', { class: 'row' },
      h('button', { class: `btn ${study.design && nObs ? 'danger' : 'primary'}`, id: 'dose-create', disabled: !doses, onclick: () => make(false) }, study.design ? (nObs ? `Replace the design and delete ${nObs} results` : 'Replace the design') : `Create this design (${nRuns} runs)`),
      isDose ? h('button', { class: 'btn', id: 'dose-stage', disabled: !doses, onclick: () => make(true) }, `Add these doses as a new stage (${nRuns} runs)`) : null));
}

// ---------------------------------------------------------------- Analyse step

const TRACE = ['', 't2', 't3', 't4', 't5', 't6'], LINE = ['', 's2', 's2', 's2', 's2', 's2'];

/** The dose–response analysis for a study with a dose design. */
export function doseAnalysis(ctx) {
  const { state, setUI } = ctx;
  const study = state.study, ui = state.ui.analyse ??= {};
  const set = (patch) => setUI({ analyse: { ...ui, ...patch } });
  const d = ui.dose ?? {}, setD = (patch) => set({ dose: { ...d, ...patch } });
  let data, fit, err = null;
  try {
    data = doseData(study, { response: ui.response });
    if (data.x.length < MODELS[d.model ?? 'LL.4'].params.length + 1) throw new Error(`${data.x.length} results so far: too few to fit a ${d.model ?? 'LL.4'} curve`);
    fit = fitDose(data, { model: d.model ?? 'LL.4', separate: d.parallel ? 'parallel' : undefined, ...(d.varPower ? { varPower: d.varPower } : {}) });
  } catch (e) { err = e.message; }
  const responses = study.responses.map(r => r.id);
  const head = h('div', { class: 'row' },
    responses.length > 1 ? h('label', { class: 'inline' }, 'response', select(responses, data?.response ?? responses[0], (v) => set({ response: v }), { 'aria-label': 'dose response' })) : null,
    h('label', { class: 'inline' }, 'model', select(Object.entries(MODELS).map(([k, m]) => ({ value: k, label: `${k} — ${m.name}` })), d.model ?? 'LL.4', (v) => setD({ model: v }), { 'aria-label': 'dose model' })),
    fit && fit.curves.length > 1 ? h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: !!d.parallel, 'aria-label': 'parallel curves', onchange: (e) => setD({ parallel: e.target.checked }) }), 'parallel (only EC50 differs)') : null,
    h('label', { class: 'inline', title: 'variance ∝ mean^θ (0: constant variance; 2: constant CV)' }, 'variance ∝ mean^', numIn(d.varPower ?? 0, (v) => setD({ varPower: v || 0 }), { 'aria-label': 'variance power', style: 'width:4em' })),
    h('button', { class: 'btn small', id: 'linear-analysis', onclick: () => set({ linear: true }) }, 'linear-model analysis instead'));
  if (err) return h('section', { class: 'panel', id: 'dose-analysis' }, h('h2', {}, 'Dose–response', help('dose-response', 'fitting-curves')), head, h('div', { class: 'msg warning' }, err));

  // the plot: log dose; zero doses drawn one decade below the smallest dose
  const pos = data.x.filter(v => v > 0), lmin = Math.log10(Math.min(...pos)), lmax = Math.log10(Math.max(...pos));
  const zeroAt = Math.floor(lmin) - 1, lx = (v) => (v > 0 ? Math.log10(v) : zeroAt);
  const grid = Array.from({ length: 80 }, (_, i) => 10 ** (lmin - 0.2 + (lmax - lmin + 0.4) * i / 79));
  const series = [];
  fit.curves.forEach((c, k) => {
    const cv = fit.curves.length > 1 ? c : undefined;
    const band = predictDose(fit, grid, { curve: cv });
    series.push({ kind: 'ribbon', points: band.map(b => ({ x: Math.log10(b.x), lo: b.lower, hi: b.upper })) });
    series.push({ kind: 'line', cls: LINE[k % 6], points: band.map(b => ({ x: Math.log10(b.x), y: b.fit })) });
    series.push({ cls: TRACE[k % 6], points: data.x.map((x, i) => ({ x: lx(x), y: data.y[i], title: `run ${data.runs[i]}: dose ${num(x, 4)}, ${num(data.y[i], 4)}` })).filter((_, i) => (data.curve ? data.curve[i] === c : true)) });
  });
  const xTicks = [...(data.x.some(v => v === 0) ? [{ x: zeroAt, label: '0' }] : []), ...Array.from({ length: Math.ceil(lmax + 0.2) - Math.floor(lmin - 0.2) + 1 }, (_, i) => Math.floor(lmin - 0.2) + i).filter(v => v > zeroAt).map(v => ({ x: v, label: num(10 ** v, 3) }))];
  const how = d.interval ?? 'log';
  const ps = list(d.eds ?? '50');
  const eds = fit.curves.flatMap(c => ps.map(p => { try { return effectiveDose(fit, p, { curve: fit.curves.length > 1 ? c : undefined, interval: how }); } catch (e) { return { curve: c, p, estimate: NaN, note: e.message }; } }));
  // two curves: potency and parallelism
  let pot = null;
  if (fit.curves.length === 2) {
    const ref = d.reference ?? fit.curves[0], test = fit.curves.find(c => c !== ref);
    try {
      const pa = parallelism(data, { model: d.model ?? 'LL.4', test, reference: ref, ...(d.varPower ? { varPower: d.varPower } : {}) });
      const rp = relativePotency(pa.parallel, { test, reference: ref, interval: 'log' });
      pot = h('div', { id: 'dose-potency' }, h('h3', {}, 'Relative potency'),
        h('div', { class: 'row small' }, 'reference', select(fit.curves, ref, (v) => setD({ reference: v }), { 'aria-label': 'reference curve' })),
        h('p', { class: 'small', 'data-potency': rp.estimate.toFixed(6) }, h('b', {}, `${test} is ${num(rp.estimate, 3)} × as potent as ${ref}`), ` (95 % ${num(rp.lower, 3)} … ${num(rp.upper, 3)}): ED50 ${ref} ÷ ED50 ${test}, from the parallel fit.`),
        h('p', { class: 'small' }, `Parallelism: separate curves against parallel ones, F = ${num(pa.F.F, 3)} on ${pa.F.df1} and ${pa.F.df2} df, p = ${pval(pa.F.p)}; slope ratio ${num(pa.slopeRatio.estimate, 3)} (90 % ${num(pa.slopeRatio.lower, 3)} … ${num(pa.slopeRatio.upper, 3)}), `,
          h('span', { class: pa.slopeRatio.equivalent ? '' : 'low-power' }, pa.slopeRatio.equivalent ? 'within 0.8 … 1.25: parallel enough to report a single potency' : 'not shown to be within 0.8 … 1.25: the potency depends on the response level')),
        h('p', { class: 'muted small' }, 'A relative potency means one number only if the curves are parallel — the same shape shifted along the dose axis. A non-significant F test is not evidence of parallelism; the slope-ratio interval inside a margin is (equivalence, as USP ⟨1032⟩).'));
    } catch (e) { pot = h('div', { class: 'msg warning' }, `Relative potency: ${e.message}`); }
  }
  // standard curve: doses for responses, limits
  const ys = list(d.inverse ?? '');
  const inv = ys.length ? ys.map(y0 => inversePredict(fit, y0, { m: d.readings ?? 1, curve: fit.curves.length > 1 ? (d.reference ?? fit.curves[0]) : undefined })) : [];
  let lim = null; try { lim = detectionLimits(fit, { curve: fit.curves.length > 1 ? (d.reference ?? fit.curves[0]) : undefined }); } catch { /* none */ }

  return h('section', { class: 'panel', id: 'dose-analysis' }, h('h2', {}, 'Dose–response', help('dose-response', 'fitting-curves')), head,
    h('p', { class: 'small' }, `${MODELS[fit.model].name}, ${fit.n} results${fit.curves.length > 1 ? `, ${fit.curves.length} curves (${data.curve ? doseRoles(study).curve : ''})` : ''}; σ = ${num(fit.sigma, 4)}, ${fit.df} residual df${fit.converged ? '' : ' — the fit did not converge: try another model'}.`),
    h('div', { class: 'grid2' },
      h('figure', {}, h('figcaption', {}, `${data.response} against ${data.dose} (log scale), with 95 % confidence bands`),
        plot({ xLabel: `${data.dose}${data.x.some(v => v === 0) ? ' (0 at the left)' : ''}`, yLabel: data.response, height: 280, width: 460, xTicks, series })),
      h('div', {},
        fit.curves.length > 1 ? h('div', { class: 'legend' }, fit.curves.map((c, k) => h('span', {}, h('i', { style: `background: var(--trace-${(k % 6) + 1})` }), c))) : null,
        dataTable([{ key: 'name', label: 'parameter' }, { key: 'estimate', label: 'estimate', cls: 'n', fmt: (v) => num(v, 4) }, { key: 'se', label: 'std. error', cls: 'n', fmt: (v) => num(v, 3) }, { key: 'p', label: 'p', cls: 'n', fmt: pval }], fit.estimates),
        h('p', { class: 'muted small' }, 'b: slope (b > 0 decreasing, b < 0 increasing); c, d: the two asymptotes (d at zero dose when b > 0); e: the EC50 (LL.4, LL.3).'))),
    h('h3', {}, 'Effective doses'),
    h('div', { class: 'row small' }, h('label', { class: 'inline' }, 'ED', h('input', { type: 'text', value: d.eds ?? '50', style: 'width:8em', 'aria-label': 'effective doses', onchange: (e) => setD({ eds: e.target.value }) })),
      h('label', { class: 'inline' }, 'interval', select([{ value: 'log', label: 'symmetric on log dose' }, { value: 'delta', label: 'delta method' }], how, (v) => setD({ interval: v }), { 'aria-label': 'ed interval' }))),
    dataTable([...(fit.curves.length > 1 ? [{ key: 'curve', label: 'curve' }] : []), { key: 'p', label: 'ED', fmt: (v) => `ED${v}` }, { key: 'estimate', label: 'dose', cls: 'n', fmt: (v) => num(v, 4) },
      { key: 'lower', label: '95 % interval', cls: 'n', fmt: (v, r) => (Number.isFinite(r.lower) ? `${num(r.lower, 4)} … ${num(r.upper, 4)}` : r.note ?? '') }], eds, { rowAttrs: (r) => ({ 'data-ed': `${r.curve}:${r.p}` }) }),
    pot,
    h('h3', {}, 'Standard curve'),
    h('div', { class: 'row small' }, h('label', { class: 'inline' }, 'doses for responses', h('input', { type: 'text', value: d.inverse ?? '', placeholder: 'e.g. 0.8, 1.5', style: 'width:12em', 'aria-label': 'inverse responses', onchange: (e) => setD({ inverse: e.target.value }) })),
      h('label', { class: 'inline' }, 'readings each', numIn(d.readings ?? 1, (v) => setD({ readings: v ?? 1 }), { 'aria-label': 'readings', min: 1 }))),
    inv.length ? dataTable([{ key: 'y0', label: 'response', cls: 'n' }, { key: 'estimate', label: 'dose', cls: 'n', fmt: (v) => (Number.isFinite(v) ? num(v, 4) : '—') },
      { key: 'lower', label: '95 % interval', cls: 'n', fmt: (v, r) => (Number.isFinite(v) ? `${num(r.lower, 4)} … ${num(r.upper, 4)}` : r.note ?? '') }], inv) : null,
    lim ? h('p', { class: 'small', id: 'dose-limits' }, `Zero-dose response ${num(lim.blank, 4)}, residual σ ${num(lim.sigma, 3)}: LOD (3σ) ${Number.isFinite(lim.lod) ? num(lim.lod, 4) : '—'}, LOQ (10σ) ${Number.isFinite(lim.loq) ? num(lim.loq, 4) : '—'}.`) : null);
}
