// Fitting a model to a study's data (spec §6.2, issues #6 and #64): the response table, the
// nuisance terms (blocks, plate positions), and fitting, testing and prediction through the
// response's noise model (noise.js; normal least squares in ols.js).
//
//   responseTable(study, id, o)   per-run responses
//   fitModel(study, formula, o)   formula + study data → fit
//   predict(fit, rows, o)         predictions with intervals at settings (natural units)
//   anova(fit, type)              the tests of the model's terms (type 1, 2 or 3 for normal noise)
//   withBlockTerm(study, m, rows) the model with the nuisance terms first
import { observationsOf } from './sites.js';
import { parseFormula, modelMatrix } from './formula.js';
import { runPositions } from '../plate.js';
import { noiseModel, noiseModelOf, noiseOf } from './noise.js';
import { withCovariates } from './covariates.js';
import { qr } from '../linalg.js';

const sum = (a) => a.reduce((s, v) => s + v, 0);

/**
 * Per-run response table: [{ run, settings, y, n }] for runs with at least one observation.
 * A count or proportion response (a distribution other than normal) has one row per observation,
 * with trials and exposure.
 * aggregate 'mean' (default) averages multiple observations of a run (sites, wafers, repeats);
 * 'none' keeps one row per observation (only appropriate when observations are true replicates).
 */
export function responseTable(study, responseId, { aggregate = 'mean', perObservation = false } = {}) {
  const resp = study.responses.find(r => r.id === responseId);
  if (!resp) throw new Error(`no response "${responseId}" in the study`);
  const runs = new Map((study.design?.runs ?? []).map(r => [r.run, r]));
  const obs = observationsOf(study, responseId).filter(o => o.value !== null);
  const meta = (r) => ({ order: r.order, kind: r.kind, ...(r.block !== undefined ? { block: r.block } : {}), ...(r.blocks ? { blocks: r.blocks } : {}) });
  // counts and proportions (issue #64): one row per observation, never averaged, with its trials
  // (binomial) and exposure (counts)
  if (resp.distribution || perObservation) return obs.map(o => ({ run: o.run, settings: runs.get(o.run).settings, y: o.value, n: 1,
    ...(o.trials ?? resp.trials ? { trials: o.trials ?? resp.trials } : {}), ...(o.exposure !== undefined ? { exposure: o.exposure } : {}), ...meta(runs.get(o.run)) }));
  if (aggregate === 'none') return obs.map(o => ({ run: o.run, settings: runs.get(o.run).settings, y: o.value, n: 1, ...meta(runs.get(o.run)) }));
  const by = new Map();
  for (const o of obs) { if (!by.has(o.run)) by.set(o.run, []); by.get(o.run).push(o.value); }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([run, v]) => ({ run, settings: runs.get(run).settings, y: sum(v) / v.length, n: v.length, ...meta(runs.get(run)) }));
}

/**
 * Fit a formula to a study's data. opts: response (default: the formula's left side), aggregate,
 * rows, blocks ('auto' | false), includeConfirm, noise (a noise model id; default: the response's
 * distribution), link, firth (Firth's penalised likelihood, for separated binomial data).
 *
 * Covariates (issue #82): a covariate of the study named in the formula is a term like a factor
 * (covariates.js): centred at its mean over the rows used, scaled by half its range. Rows with no
 * value for it are left out. The fit then has covariates: [{ id, mean, min, max, halfRange, n }]
 * and dropped: [{ run, covariate }].
 *
 * Blocks: when the runs used fall in more than one block (blocked designs, or stages added by
 * augmentation), a categorical Block term is added first in the model (effect coded, so
 * predictions are for the average block), unless blocks: false.
 * Confirmation runs (kind 'confirm') are left out unless includeConfirm, so they can be
 * checked against a model fitted without them.
 */
export function fitModel(study, formula, opts = {}) {
  // the response is read before the formula is parsed: the covariates in it (issue #82) are known
  // only with the rows
  const lhs = String(formula).includes('~') ? String(formula).slice(0, String(formula).indexOf('~')).trim() || null : null;
  const response = opts.response ?? lhs;
  if (!response) { parseFormula(formula, study.factors); throw new Error('name the response: "y ~ …" or { response }'); }
  const noise = opts.noise ? noiseModel(opts.noise, { link: opts.link }) : noiseModelOf(study, response);
  let rows = opts.rows ?? responseTable(study, response, { ...opts, perObservation: noise.id !== 'normal' });
  if (!opts.includeConfirm) rows = rows.filter(r => r.kind !== 'confirm');
  const cov = rows.length ? withCovariates(study, formula, rows) : { factors: study.factors, rows, used: [], dropped: [] };
  let parsed;
  try { parsed = parseFormula(formula, cov.factors); } catch (e) {
    const m = /unknown factor "(radius2|edge|waferX|waferY|slot|slotZone)"/.exec(e.message);
    if (m) throw new Error(`${m[1]} is a position term: it varies within runs, so it needs a model of the individual readings (the mixed model), not of run means`);
    throw e;
  }
  if (!rows.length) throw new Error(`no results for ${response} yet`);
  const b = withBlockTerm({ ...study, factors: cov.factors }, parsed, cov.rows, opts);
  const mm = modelMatrix(b.model, b.factors, b.rows.map(r => r.settings));
  const data = noise.prepare(b.rows);
  const fit = noise.fit(mm, data.y, { ...data, firth: opts.firth });
  return { ...fit, noise: noise.id, response, rows: b.rows, factors: b.factors, ...(b.carryoverDropped ? { carryoverDropped: true } : {}), ...(cov.used.length ? { covariates: cov.used, dropped: cov.dropped } : {}) };
}

/**
 * The model with nuisance terms first: a fixed Block term when the rows fall in more than one
 * block (unless opts.blocks === false), and for runs laid out on microplates (study.plates) the
 * position terms Edge (outer ring vs inner wells) and Row and Col (linear gradients across the
 * plate), each when it varies among the rows (unless opts.position === false). Returns
 * { model, factors, rows } with the nuisance values in each row's settings; nuisance terms are
 * flagged block: true (left out of effects, power and model reduction; predictions are for the
 * average block, an average well).
 */
export function withBlockTerm(study, parsed, rows, opts = {}) {
  const taken = new Set([...study.factors, ...study.responses].map(x => x.id));
  const free = (id) => { while (taken.has(id)) id += '_'; taken.add(id); return id; };
  const factors = [...study.factors], terms = [], extra = rows.map(() => ({}));
  const labels = [...new Set(rows.map(r => (r.block === undefined ? '' : String(r.block))))].sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b));
  const randomIds = Array.isArray(opts.random) ? opts.random : [];
  if (opts.blocks !== false && !randomIds.includes('block') && labels.length > 1) {
    const id = free('Block');
    factors.push({ id, name: 'Block', type: 'categorical', levels: labels, block: true });
    terms.push({ label: id, comps: [{ f: id }], degree: 1, block: true });
    rows.forEach((r, i) => { extra[i][id] = r.block === undefined ? '' : String(r.block); });
  }
  // named blocking variables (issue #80: a Latin square's rows and columns, a crossover's subjects
  // and periods), each a fixed term unless it is a random effect (opts.random lists it)
  for (const bv of study.design?.blocking ?? []) {
    if (opts.blocks === false || randomIds.includes(bv.id)) continue;
    const vals = rows.map(r => (r.blocks?.[bv.id] === undefined ? '' : String(r.blocks[bv.id])));
    const levels = blockingLevels(bv, vals);
    if (levels.length < 2) continue;
    const id = free(bv.id);
    factors.push({ id, name: bv.name ?? bv.id, type: 'categorical', levels, block: true, blocking: bv.id });
    terms.push({ label: id, comps: [{ f: id }], degree: 1, block: true });
    vals.forEach((v, i) => { extra[i][id] = v; });
  }
  // carry-over (crossover designs): the treatment the same subject had in the period before; none
  // in the first period (all its columns 0), so the treatments' effects are adjusted for it
  if (study.design?.carryover && opts.carryover !== false) {
    const prev = carryoverOf(study);
    const f0 = study.factors[0], levels = (f0.type === 'categorical' ? f0.levels : [...new Set(study.design.runs.map(r => r.settings[f0.id]))].sort((a, b) => a - b)).map(String);
    const id = free('Carry');
    factors.push({ id, name: `Carry-over of ${f0.name ?? f0.id}`, type: 'categorical', levels, block: true, carryover: true });
    terms.push({ label: id, comps: [{ f: id }], degree: 1, block: true, carryover: true });
    rows.forEach((r, i) => { const v = prev.get(r.run); if (v !== undefined) extra[i][id] = String(v); });
  }
  if (study.plates && opts.position !== false) {
    const pos = runPositions(study);
    const at = rows.map(r => pos.get(r.run));
    if (at.every(Boolean)) {
      const add = (name, f, value) => {
        const vals = at.map(value);
        if (new Set(vals.map(String)).size < 2) return;
        const id = free(name);
        factors.push({ ...f, id, name: f.name, block: true, position: true });
        terms.push({ label: id, comps: [{ f: id }], degree: 1, block: true, position: true });
        vals.forEach((v, i) => { extra[i][id] = v; });
      };
      add('Edge', { name: 'Plate edge', type: 'categorical', levels: ['inner', 'edge'] }, (p) => (p.edge ? 'edge' : 'inner'));
      add('Row', { name: 'Row gradient', type: 'continuous', low: -1, high: 1, transform: 'none' }, (p) => p.row);
      add('Col', { name: 'Column gradient', type: 'continuous', low: -1, high: 1, transform: 'none' }, (p) => p.col);
    }
  }
  if (!terms.length) return { model: parsed, factors: study.factors, rows };
  const out = {
    factors,
    model: { ...parsed, terms: [...terms, ...parsed.terms] },
    rows: rows.map((r, i) => ({ ...r, settings: { ...r.settings, ...extra[i] } })),
  };
  // carry-over that cannot be told apart from the other terms (AB/BA with subjects fixed: it is
  // the sequence, and within subjects the treatment) is left out, so the treatment keeps its estimate
  const ci = out.model.terms.findIndex(t => t.carryover);
  if (ci >= 0) {
    const rank = (model) => qr(modelMatrix(model, out.factors, out.rows.map(r => r.settings)).X).rank;
    const without = { ...out.model, terms: out.model.terms.filter((_, j) => j !== ci) };
    const df = out.factors.find(f => f.carryover).levels.length - 1;
    if (rank(out.model) < rank(without) + df) return { ...out, model: without, factors: out.factors.filter(f => !f.carryover), carryoverDropped: true };
  }
  return out;
}


/** The labels of a blocking variable, in its listed order, else numeric then alphabetical. */
export function blockingLevels(bv, vals) {
  const seen = [...new Set(vals.map(String))];
  if (bv.levels) return bv.levels.map(String).filter(l => seen.includes(l));
  return seen.sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b));
}

/**
 * For a crossover design: run → the treatment (the factor's setting) of the same subject's run in
 * the period before, for every run that has one.
 */
export function carryoverOf(study) {
  const d = study.design, subj = d.blocking.find(b => b.role === 'subject').id, per = d.blocking.find(b => b.role === 'period');
  const f0 = study.factors[0].id;
  const runs = d.runs.filter(r => r.kind !== 'confirm');
  const periods = blockingLevels(per, runs.map(r => r.blocks[per.id]));
  const rank = new Map(periods.map((p, i) => [p, i]));
  const bySubject = new Map();
  for (const r of runs) { const k = String(r.blocks[subj]); if (!bySubject.has(k)) bySubject.set(k, []); bySubject.get(k).push(r); }
  const out = new Map();
  for (const list of bySubject.values()) {
    list.sort((a, b) => rank.get(String(a.blocks[per.id])) - rank.get(String(b.blocks[per.id])));
    for (let i = 1; i < list.length; i++) if (rank.get(String(list[i].blocks[per.id])) === rank.get(String(list[i - 1].blocks[per.id])) + 1) out.set(list[i].run, list[i - 1].settings[f0]);
  }
  return out;
}

/**
 * Predictions with intervals at new settings (natural units): [{ fit, se, lower, upper,
 * predLower, predUpper }] — confidence interval for the mean and prediction interval for a
 * single new observation, at the given level (default 0.95), on the response scale. With a Block
 * term, predictions are for the average block.
 */
export function predict(fit, rows, opts = {}) {
  const mm = modelMatrix(fit.model, fit.factors, rows);
  return noiseOf(fit).predict(fit, mm.X, opts);
}

/**
 * The tests of a fit's terms. For normal noise, the ANOVA table: type 1 sequential (R anova.lm),
 * type 2 or 3 (car::Anova); rows { term, df, ss, ms, F, p } and then the residuals.
 */
export function anova(fit, type = 1) {
  return noiseOf(fit).tests(fit, type);
}
