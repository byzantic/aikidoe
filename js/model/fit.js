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
  const meta = (r) => ({ order: r.order, kind: r.kind, ...(r.block !== undefined ? { block: r.block } : {}) });
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
  return { ...fit, noise: noise.id, response, rows: b.rows, factors: b.factors, ...(cov.used.length ? { covariates: cov.used, dropped: cov.dropped } : {}) };
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
  if (opts.blocks !== false && labels.length > 1) {
    const id = free('Block');
    factors.push({ id, name: 'Block', type: 'categorical', levels: labels, block: true });
    terms.push({ label: id, comps: [{ f: id }], degree: 1, block: true });
    rows.forEach((r, i) => { extra[i][id] = r.block === undefined ? '' : String(r.block); });
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
  return {
    factors,
    model: { ...parsed, terms: [...terms, ...parsed.terms] },
    rows: rows.map((r, i) => ({ ...r, settings: { ...r.settings, ...extra[i] } })),
  };
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
