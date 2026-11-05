// Surrogate models of a simulator and the study-level yield / sensitivity analyses (spec §10).
//
// The surrogate is the ordinary least-squares model of the study's responses (by default the full
// quadratic for a Latin-hypercube design). Its honesty is the leave-one-out cross-validated error
// from PRESS, RMSE_cv = √(PRESS / n) — the size of a typical prediction error at a point not used
// in the fit — which the yield analysis compares with the margins to the specification limits.
import { decode, code } from '../study.js';
import { fitModel } from '../model/ols.js';
import { modelMatrix } from '../model/formula.js';
import { defaultFormula } from '../model/defaults.js';
import { maximinLHS, deviationSampler, toleranceSd } from './sample.js';
import { sobolIndices } from './sensitivity.js';
import { monteCarloYield, wilson } from './yield.js';
import { rng } from '../design/rng.js';

/**
 * A space-filling design for a computer experiment: a maximin LHS over the continuous factors
 * (categorical factors are not supported). Returns a design object for toStudyDesign.
 */
export function lhsDesign(study, { runs, seed = study.seed ?? 1 } = {}) {
  const cat = study.factors.find(f => f.type === 'categorical');
  if (cat) throw new Error(`a Latin hypercube needs continuous factors; ${cat.id} is categorical`);
  const k = study.factors.length;
  const n = runs ?? Math.max(10 * k, (k + 1) * (k + 2) / 2 + 5);
  const { X, minDist } = maximinLHS(n, k, { seed: seed >>> 0 });
  return { kind: 'lhs', params: { runs: n, criterion: 'maximin', minDist }, levels: study.factors.map(() => 2), coded: true, X, runKind: X.map(() => 'space-filling') };
}

/** Fit surrogates for the responses; each { id, formula, fit, predict, cvRmse, rmse, r2, predR2, n }. */
export function fitSurrogates(study, { formulas = {}, only = null } = {}) {
  const out = [], missing = [];
  for (const r of study.responses) {
    if (only && !only.includes(r.id)) continue;
    const formula = formulas[r.id] ?? defaultFormula(study, r.id);
    let fit;
    try { fit = fitModel(study, formula); } catch (e) { missing.push({ id: r.id, reason: e.message }); continue; }
    const predict = compiledPredictor(fit) ?? ((idx) => (st) => { const x = modelMatrix(fit.model, fit.factors, [st]).X[0]; return idx.reduce((a, j) => a + x[j] * fit.coef[j], 0); })(fit.coef.map((c, j) => (Number.isFinite(c) ? j : -1)).filter(j => j >= 0));
    const n = fit.rows.length;
    out.push({ id: r.id, formula, fit, predict, n, rmse: fit.sigma, r2: fit.r2, predR2: fit.predR2,
      cvRmse: Number.isFinite(fit.press) ? Math.sqrt(fit.press / n) : NaN });
  }
  return { models: out, missing };
}

/**
 * A fast predictor for a model in continuous factors only: each column a product of coded factor
 * values to powers (as modelMatrix builds it), evaluated without building the model matrix — the
 * Monte Carlo and Sobol loops call it 10⁵–10⁶ times. null when the model has a categorical factor.
 */
export function compiledPredictor(fit) {
  const byId = Object.fromEntries(fit.factors.map(f => [f.id, f]));
  const cols = [];
  if (fit.model.intercept) cols.push([]);
  for (const t of fit.model.terms) {
    const pw = {};
    for (const c of t.comps) {
      if (c.f !== undefined) { if (byId[c.f].type === 'categorical') return null; pw[c.f] = (pw[c.f] ?? 0) + 1; }
      else for (const [id, p] of Object.entries(c.I)) { if (byId[id].type === 'categorical') return null; pw[id] = (pw[id] ?? 0) + p; }
    }
    cols.push(Object.entries(pw));
  }
  if (cols.length !== fit.coef.length) return null;
  const terms = cols.map((c, j) => ({ c, b: fit.coef[j] })).filter(t => Number.isFinite(t.b));
  const ids = [...new Set(terms.flatMap(t => t.c.map(([id]) => id)))];
  const prog = terms.map(t => ({ b: t.b, f: t.c.map(([id, p]) => [ids.indexOf(id), p]) }));
  return (st) => {
    const x = ids.map(id => code(byId[id], st[id]));
    let y = 0;
    for (const t of prog) { let v = t.b; for (const [i, p] of t.f) v *= p === 1 ? x[i] : p === 2 ? x[i] * x[i] : x[i] ** p; y += v; }
    return y;
  };
}

const predictAll = (models) => (st) => Object.fromEntries(models.map(m => [m.id, m.predict(st)]));

/** Tolerances of the study's factors, with overrides { id: sd | { sd, dist, at } }. */
export function studyTolerances(study, extra = {}) {
  const t = {};
  for (const f of study.factors) { const v = extra[f.id] ?? f.tolerance ?? (f.noise ? f.noise.sd : undefined); if (v !== undefined) t[f.id] = v; }
  return t;
}

/** Nominal settings: given settings, else noise factors at their mean and the rest at the centre. */
export function nominalSettings(study, settings = {}) {
  return Object.fromEntries(study.factors.map(f => [f.id, settings[f.id] ?? (f.noise?.mean ?? decode(f, 0))]));
}

/**
 * Yield of the surrogate at nominal settings. models from fitSurrogates; specs from the responses'
 * spec limits unless given ({ id: { lower, upper } }). Returns monteCarloYield's result plus
 * { specs, tolerances, nominal, margins } (margins: per response, the distance of the nominal
 * prediction to the nearest limit in units of its CV error).
 */
export function surrogateYield(study, models, { settings = {}, tolerances = {}, specs = null, N = 20000, seed = 1, level = 0.95, keep = false } = {}) {
  const nominal = nominalSettings(study, settings), tol = studyTolerances(study, tolerances);
  if (!Object.keys(tol).length) throw new Error('no factor has a tolerance: give each varying factor one (its standard deviation about the setting)');
  const sp = [];
  for (const m of models) {
    const lim = specs?.[m.id] ?? study.responses.find(r => r.id === m.id)?.spec;
    if (lim) sp.push({ id: m.id, lower: lim.lower, upper: lim.upper, cvError: Number.isFinite(m.cvRmse) ? m.cvRmse : 0 });
  }
  const pred = predictAll(models);
  const y = monteCarloYield(pred, nominal, tol, sp, { N, seed, level, keep });
  const at = pred(nominal);
  const margins = sp.map(s => { const v = at[s.id], d = Math.min(s.lower !== undefined ? v - s.lower : Infinity, s.upper !== undefined ? s.upper - v : Infinity); return { id: s.id, nominal: v, margin: d, cvError: s.cvError, ratio: s.cvError > 0 ? d / s.cvError : Infinity }; });
  return { ...y, specs: sp, tolerances: tol, nominal, margins };
}

/**
 * Direct check of a yield estimate on the simulator: draw M samples about the nominal settings,
 * run them through the adapter (batched) and compare with the surrogate at the same points.
 * Returns { yield, lower, upper, M, rmse: { id: rms(simulated − predicted) }, agree (fraction with
 * the same pass/fail), points }.
 */
export async function directYieldCheck(study, models, adapter, { settings = {}, tolerances = {}, specs = null, M = 200, seed = 7, level = 0.95, batch = 50 } = {}) {
  const nominal = nominalSettings(study, settings), tol = studyTolerances(study, tolerances);
  const g = rng(seed), u = () => g.random() * (1 - 2 ** -52) + 2 ** -53;
  const samplers = Object.entries(tol).map(([id, t]) => [id, deviationSampler(t)]);
  const pts = Array.from({ length: M }, () => { const st = { ...nominal }; for (const [id, s] of samplers) st[id] = nominal[id] + s(u); return st; });
  const sim = [];
  for (let i = 0; i < M; i += batch) sim.push(...await adapter.run(pts.slice(i, i + batch)));
  const lims = models.map(m => ({ id: m.id, ...(specs?.[m.id] ?? study.responses.find(r => r.id === m.id)?.spec ?? {}) })).filter(l => l.lower !== undefined || l.upper !== undefined);
  const ok = (v) => lims.every(l => v[l.id] >= (l.lower ?? -Infinity) && v[l.id] <= (l.upper ?? Infinity));
  const pred = predictAll(models);
  let pass = 0, agree = 0; const se = Object.fromEntries(models.map(m => [m.id, 0]));
  const points = pts.map((st, i) => {
    const p = pred(st), s = sim[i], ps = ok(s), pp = ok(p);
    if (ps) pass++; if (ps === pp) agree++;
    for (const m of models) se[m.id] += (s[m.id] - p[m.id]) ** 2;
    return { settings: st, simulated: s, predicted: p, pass: ps };
  });
  return { yield: pass / M, ...wilson(pass, M, level), M, agree: agree / M, rmse: Object.fromEntries(Object.entries(se).map(([k, v]) => [k, Math.sqrt(v / M)])), points };
}

/**
 * Sobol indices of each surrogate. over: 'range' (each factor uniform over its range — which
 * factors matter across the design space) or 'tolerance' (each factor varying by its tolerance
 * about the nominal settings — which tolerances drive the variation, factors without one fixed).
 * Returns [{ id, factors: [ids], V, first, total }].
 */
export function surrogateSensitivity(study, models, { over = 'range', settings = {}, tolerances = {}, N = 16384, seed = 1, level = 0.95 } = {}) {
  const fs = study.factors.filter(f => f.type !== 'categorical');
  let inputs, samplers;
  const nominal = nominalSettings(study, settings);
  if (over === 'range') {
    inputs = fs;
    samplers = fs.map(f => (u) => decode(f, -1 + 2 * u()));
  } else if (over === 'tolerance') {
    const tol = studyTolerances(study, tolerances);
    inputs = fs.filter(f => tol[f.id] !== undefined && toleranceSd(tol[f.id]) > 0);
    if (!inputs.length) throw new Error('no factor has a tolerance to vary');
    samplers = inputs.map(f => { const d = deviationSampler(tol[f.id]); return (u) => nominal[f.id] + d(u); });
  } else throw new Error(`unknown sensitivity domain "${over}" (range, tolerance)`);
  return models.map(m => {
    const fn = (x) => m.predict({ ...nominal, ...Object.fromEntries(inputs.map((f, i) => [f.id, x[i]])) });
    const r = sobolIndices(fn, samplers, { N, seed, level });
    return { id: m.id, factors: inputs.map(f => f.id), over, ...r };
  });
}

export { code as _code };
