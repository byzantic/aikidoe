// Dose–response designs in a study (issue #65): a dose factor at chosen doses (a dilution series or
// an optimal set), for each level of an optional curve factor (compound, sample, cell line), with
// replicates, in random order; later stages add doses (a range-finding run, then doses around the
// EC50). The analysis is model/dose.js on doseData().
import { rng } from './rng.js';
import { createStudy } from '../study.js';
import { responseTable } from '../model/ols.js';

/** The dose and curve factors of a study's dose design (from its params, or given). */
export function doseRoles(study, { dose, curve } = {}) {
  const p = study.design?.params ?? {};
  const d = dose ?? p.dose ?? study.factors.find(f => f.type === 'continuous')?.id;
  const c = curve === undefined ? p.curve ?? null : curve;
  const df = study.factors.find(f => f.id === d);
  if (!df || df.type !== 'continuous') throw new Error(`the dose must be a continuous factor${d ? ` ("${d}" is not)` : ''}`);
  if (c !== null && study.factors.find(f => f.id === c)?.type !== 'categorical') throw new Error(`the curve factor must be categorical ("${c}" is not)`);
  return { dose: d, curve: c };
}

/** Runs for doses × curve levels × replicates (settings of other factors fixed). */
function runsFor(study, { dose, curve, doses, replicates = 1, fixed = {}, levels }) {
  const others = study.factors.filter(f => f.id !== dose && f.id !== curve);
  const base = Object.fromEntries(others.map(f => [f.id, fixed[f.id] ?? (f.type === 'categorical' ? f.levels[0] : (f.low + f.high) / 2)]));
  const cf = curve ? study.factors.find(f => f.id === curve) : null;
  const lv = levels ?? (cf ? cf.levels : [null]);
  const out = [];
  for (const l of lv) for (const x of doses) for (let r = 0; r < replicates; r++) out.push({ ...base, [dose]: x, ...(cf ? { [curve]: l } : {}) });
  return out;
}

/**
 * A dose–response design for the study. opts: dose (factor id; default the first continuous),
 * curve (categorical factor id or null), doses (list), replicates, levels (curve levels to run;
 * default all), fixed (settings of any other factors), seed, params (recorded: how the doses were
 * chosen). Returns the study's design object (kind 'dose-response'), runs in random order.
 */
export function doseDesign(study, opts) {
  const { dose, curve } = doseRoles(study, { dose: opts.dose, curve: opts.curve ?? null });
  const df = study.factors.find(f => f.id === dose);
  if (!opts.doses?.length || opts.doses.some(x => !(x >= 0))) throw new Error('doses: a list of doses ≥ 0');
  if (df.transform === 'log' && opts.doses.some(x => x === 0)) throw new Error(`${dose} is on a log scale, so it cannot be 0: drop the zero doses, or make ${dose} linear (the dose–response analysis works on the log dose either way)`);
  const settings = runsFor(study, { ...opts, dose, curve });
  const g = rng((opts.seed ?? study.seed) >>> 0);
  const order = g.shuffle(settings.map((_, i) => i));
  const runs = settings.map((s, i) => ({ run: i + 1, order: order.indexOf(i) + 1, kind: 'other', settings: s }));
  return { kind: 'dose-response', params: { dose, curve, doses: [...new Set(opts.doses)].sort((a, b) => a - b), replicates: opts.replicates ?? 1, seed: opts.seed ?? study.seed, ...(opts.params ?? {}) },
    randomisation: 'complete', runs };
}

/**
 * Add a stage of doses to a dose design (e.g. around the EC50 found by a range-finding stage):
 * the new runs are a new block, in random order after the existing ones. Returns the study.
 */
export function addDoseStage(study, opts) {
  const d = study.design;
  if (d?.kind !== 'dose-response') throw new Error('the study has no dose–response design to add to');
  const { dose, curve } = doseRoles(study);
  const df = study.factors.find(f => f.id === dose);
  if (df.transform === 'log' && opts.doses.some(x => x === 0)) throw new Error(`${dose} is on a log scale, so it cannot be 0`);
  const settings = runsFor(study, { ...opts, dose, curve });
  const stage = Math.max(1, ...d.runs.map(r => (Number.isFinite(Number(r.block)) ? Number(r.block) : 1))) + 1;
  const g = rng(((opts.seed ?? study.seed) + stage * 7919) >>> 0);
  const n0 = d.runs.length, o0 = Math.max(0, ...d.runs.map(r => r.order));
  const order = g.shuffle(settings.map((_, i) => i));
  const added = settings.map((s, i) => ({ run: n0 + i + 1, order: o0 + order.indexOf(i) + 1, kind: 'other', block: stage, settings: s }));
  const runs = [...d.runs.map(r => (r.block === undefined ? { ...r, block: 1 } : r)), ...added];
  const stages = [...(d.params.stages ?? [{ doses: d.params.doses, replicates: d.params.replicates }]), { doses: [...new Set(opts.doses)].sort((a, b) => a - b), replicates: opts.replicates ?? 1, ...(opts.params ?? {}) }];
  return createStudy({ ...study, design: { ...d, params: { ...d.params, stages }, runs },
    history: [...(study.history ?? []), { stage: `doses ${stage}`, runs: added.map(r => r.run), note: `${added.length} runs at ${stages.at(-1).doses.length} doses` }] });
}

/** The data for a dose–response fit: { x, y, curve, runs } from a response's results (run means). */
export function doseData(study, { response, dose, curve } = {}) {
  const roles = doseRoles(study, { dose, curve });
  const resp = response ?? study.responses[0]?.id;
  const rows = responseTable(study, resp).filter(r => r.kind !== 'confirm');
  return {
    response: resp, ...roles,
    x: rows.map(r => r.settings[roles.dose]), y: rows.map(r => r.y),
    ...(roles.curve ? { curve: rows.map(r => String(r.settings[roles.curve])) } : {}),
    runs: rows.map(r => r.run),
  };
}
