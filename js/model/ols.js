// Ordinary least squares fits, ANOVA, diagnostics, Box–Cox and Lenth's method
// (spec §6.2, issue #6).
//
//   fitOLS(mm, y)                 fit a model matrix (from formula.js) to a response vector
//   fitModel(study, formula, o)   formula + study data → fit (per-run responses, §4.2)
//   anova(fit, type)              type 1 (sequential), 2 or 3 table
//   lackOfFit(fit, groups)        pure-error and lack-of-fit test from replicated settings
//   boxCox(fit, lambdas)          profile log-likelihood of the Box–Cox power (MASS convention)
//   lenth(effects)                Lenth's PSE, ME and SME for unreplicated two-level designs
//   halfNormal(effects)           half-normal plot coordinates
//
// Numerics: Householder QR with R's limited pivoting (linalg.js), so rank, aliasing and the
// sequential sums of squares are those of R's lm() and anova().
import { qr, solveUpper } from '../linalg.js';
import { studentT, fDist, chi2, normal } from '../dist.js';
import { parseFormula, modelMatrix, containedIn } from './formula.js';

const sum = (a) => a.reduce((s, v) => s + v, 0);

/**
 * Fit y ≈ X β. mm = { X, columns, assign, model } from modelMatrix. Rows with a missing
 * (null/NaN) response must be removed beforehand (fitModel does this).
 */
export function fitOLS(mm, y, { names } = {}) {
  const { X, columns, assign, model } = mm;
  const n = X.length, p = columns.length;
  if (y.length !== n) throw new Error(`${y.length} responses for ${n} rows`);
  if (y.some(v => !Number.isFinite(v))) throw new Error('responses must be finite numbers (remove missing values first)');
  const f = qr(X);
  const rank = f.rank, dfRes = n - rank;
  const coef = f.coef(y);
  const fitted = f.fitted(y);
  const resid = y.map((v, i) => v - fitted[i]);
  const rss = sum(resid.map(e => e * e));
  const sigma2 = dfRes > 0 ? rss / dfRes : NaN;
  const cov = f.unscaledCov();
  const se = coef.map((b, j) => (Number.isNaN(b) ? NaN : Math.sqrt(cov[j][j] * sigma2)));
  const tval = coef.map((b, j) => b / se[j]);
  const pval = tval.map(t => (Number.isFinite(t) && dfRes > 0 ? 2 * studentT.sf(Math.abs(t), dfRes) : NaN));
  // leverage from the thin Q of the estimable columns
  const Q = f.Q();
  const h = Q.map(row => { let s = 0; for (let j = 0; j < rank; j++) s += row[j] * row[j]; return s; });
  const ybar = sum(y) / n;
  const tss = model.intercept ? sum(y.map(v => (v - ybar) ** 2)) : sum(y.map(v => v * v));
  const dfModel = rank - (model.intercept ? 1 : 0);
  const r2 = 1 - rss / tss;
  const adjR2 = 1 - (1 - r2) * (n - (model.intercept ? 1 : 0)) / dfRes;
  // PRESS is undefined when a point is fitted exactly (leverage 1)
  const press = h.some(v => Math.abs(1 - v) < 1e-10) ? NaN : sum(resid.map((e, i) => (e / (1 - h[i])) ** 2));
  const s = Math.sqrt(sigma2);
  const rstandard = resid.map((e, i) => e / (s * Math.sqrt(1 - h[i])));
  const rstudent = resid.map((e, i) => {
    const s2i = (rss - e * e / (1 - h[i])) / (dfRes - 1);
    return e / Math.sqrt(s2i * (1 - h[i]));
  });
  const cooks = resid.map((e, i) => e * e * h[i] / (rank * sigma2 * (1 - h[i]) ** 2));
  const effects = f.qty(y);                  // Qᵀy, in pivoted column order
  // R reports exactly-fitted points (h = 1) as NaN
  const tidy = (v, i) => (Math.abs(1 - h[i]) < 1e-10 ? NaN : v);
  return {
    model, columns, assign, n, rank, dfRes, dfModel,
    coef, se, t: tval, p: pval, cov: cov.map(r => r.map(v => v * sigma2)), covUnscaled: cov,
    aliased: f.aliased.map(j => columns[j]),
    fitted, residuals: resid, rss, sigma: s, sigma2, tss, r2, adjR2, press,
    predR2: 1 - press / tss,
    leverage: h, rstandard: rstandard.map(tidy), rstudent: rstudent.map(tidy), cooks: cooks.map(tidy),
    fStat: dfModel > 0 && dfRes > 0 ? ((tss - rss) / dfModel) / sigma2 : NaN,
    fP: dfModel > 0 && dfRes > 0 ? fDist.sf(((tss - rss) / dfModel) / sigma2, dfModel, dfRes) : NaN,
    _qr: f, _effects: effects, X, y, names,
  };
}

// ---------------------------------------------------------------- data from a study

/**
 * Per-run response table: [{ run, settings, y, n }] for runs with at least one observation.
 * aggregate 'mean' (default) averages multiple observations of a run (sites, wafers, repeats);
 * 'none' keeps one row per observation (only appropriate when observations are true replicates).
 */
export function responseTable(study, responseId, { aggregate = 'mean' } = {}) {
  if (!study.responses.some(r => r.id === responseId)) throw new Error(`no response "${responseId}" in the study`);
  const runs = new Map((study.design?.runs ?? []).map(r => [r.run, r]));
  const obs = study.observations.filter(o => o.response === responseId && o.value !== null);
  const meta = (r) => ({ order: r.order, kind: r.kind, ...(r.block !== undefined ? { block: r.block } : {}) });
  if (aggregate === 'none') return obs.map(o => ({ run: o.run, settings: runs.get(o.run).settings, y: o.value, n: 1, ...meta(runs.get(o.run)) }));
  const by = new Map();
  for (const o of obs) { if (!by.has(o.run)) by.set(o.run, []); by.get(o.run).push(o.value); }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([run, v]) => ({ run, settings: runs.get(run).settings, y: sum(v) / v.length, n: v.length, ...meta(runs.get(run)) }));
}

/** Id for the block pseudo-factor that does not clash with the study's ids. */
const blockId = (study) => { let id = 'Block'; const taken = new Set([...study.factors, ...study.responses].map(x => x.id)); while (taken.has(id)) id += '_'; return id; };

/**
 * Fit a formula to a study's data. opts: response (default: the formula's left side), aggregate,
 * rows, blocks ('auto' | false), includeConfirm.
 *
 * Blocks: when the runs used fall in more than one block (blocked designs, or stages added by
 * augmentation), a categorical Block term is added first in the model (effect coded, so
 * predictions are for the average block), unless blocks: false.
 * Confirmation runs (kind 'confirm') are left out unless includeConfirm, so they can be
 * checked against a model fitted without them.
 */
export function fitModel(study, formula, opts = {}) {
  const parsed = parseFormula(formula, study.factors);
  const response = opts.response ?? parsed.response;
  if (!response) throw new Error('name the response: "y ~ …" or { response }');
  let rows = opts.rows ?? responseTable(study, response, opts);
  if (!opts.includeConfirm) rows = rows.filter(r => r.kind !== 'confirm');
  if (!rows.length) throw new Error(`no results for ${response} yet`);
  const labels = [...new Set(rows.map(r => (r.block === undefined ? '' : String(r.block))))].sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b));
  let factors = study.factors, model = parsed;
  if (opts.blocks !== false && labels.length > 1) {
    const id = blockId(study);
    factors = [...study.factors, { id, name: 'Block', type: 'categorical', levels: labels, block: true }];
    model = { ...parsed, terms: [{ label: id, comps: [{ f: id }], degree: 1, block: true }, ...parsed.terms] };
    rows = rows.map(r => ({ ...r, settings: { ...r.settings, [id]: r.block === undefined ? '' : String(r.block) } }));
  }
  const mm = modelMatrix(model, factors, rows.map(r => r.settings));
  const fit = fitOLS(mm, rows.map(r => r.y));
  return { ...fit, response, rows, factors };
}

/**
 * Predictions with intervals at new settings (natural units): [{ fit, se, lower, upper,
 * predLower, predUpper }] — confidence interval for the mean and prediction interval for a
 * single new observation, at the given level (default 0.95). With a Block term, predictions are
 * for the average block. Aliased (NaN) coefficients contribute nothing, as in R's predict.lm.
 */
export function predict(fit, rows, { level = 0.95 } = {}) {
  const mm = modelMatrix(fit.model, fit.factors, rows);
  const t = fit.dfRes > 0 ? studentT.ppf(1 - (1 - level) / 2, fit.dfRes) : NaN;
  return mm.X.map(x => {
    let yhat = 0, v = 0;
    for (let i = 0; i < x.length; i++) {
      if (Number.isNaN(fit.coef[i])) continue;
      yhat += x[i] * fit.coef[i];
      for (let j = 0; j < x.length; j++) if (!Number.isNaN(fit.coef[j])) v += x[i] * fit.covUnscaled[i][j] * x[j];
    }
    const se = Math.sqrt(v * fit.sigma2), sp = Math.sqrt((v + 1) * fit.sigma2);
    return { fit: yhat, se, lower: yhat - t * se, upper: yhat + t * se, predLower: yhat - t * sp, predUpper: yhat + t * sp };
  });
}

// ---------------------------------------------------------------- ANOVA

const termCols = (fit, ti) => fit.assign.map((a, j) => (a === ti ? j : -1)).filter(j => j >= 0);

function rssOf(fit, keepCols) {
  if (!keepCols.length) return { rss: sum(fit.y.map(v => v * v)), rank: 0 };
  const f = qr(fit.X.map(r => keepCols.map(j => r[j])));
  const e = f.residuals(fit.y);
  return { rss: sum(e.map(v => v * v)), rank: f.rank };
}

/**
 * ANOVA table. type 1: sequential, in term order (R anova.lm). type 2: each term adjusted for
 * all terms that do not contain it (car::Anova type II). type 3: each term adjusted for all
 * others (car::Anova type III; meaningful with effect coding, which formula.js uses), with an
 * intercept row. Rows: { term, df, ss, ms, F, p }, then { term: 'Residuals', df, ss, ms }.
 * Terms with no estimable columns (completely aliased) are left out.
 */
export function anova(fit, type = 1) {
  const { model, dfRes, sigma2 } = fit;
  const rows = [];
  const push = (term, df, ss) => { if (df > 0) { const ms = ss / df, F = ms / sigma2; rows.push({ term, df, ss, ms, F, p: dfRes > 0 ? fDist.sf(F, df, dfRes) : NaN }); } };
  if (type === 1) {
    // sums of squares of the effects Qᵀy, grouped by term, in pivoted column order
    const ss = new Map(), df = new Map();
    for (let i = 0; i < fit.rank; i++) {
      const a = fit.assign[fit._qr.perm[i]];
      if (a < 0) continue;
      ss.set(a, (ss.get(a) || 0) + fit._effects[i] ** 2); df.set(a, (df.get(a) || 0) + 1);
    }
    model.terms.forEach((t, ti) => push(t.label, df.get(ti) || 0, ss.get(ti) || 0));
  } else if (type === 2 || type === 3) {
    const all = fit.columns.map((_, j) => j);
    if (type === 3 && model.intercept) {
      const without = all.filter(j => fit.assign[j] !== -1), r = rssOf(fit, without);
      push('(Intercept)', fit.rank - r.rank, r.rss - fit.rss);
    }
    model.terms.forEach((t, ti) => {
      let base;
      if (type === 2) {
        // all columns of terms that do not contain t (plus the intercept)
        base = all.filter(j => { const a = fit.assign[j]; return a === -1 || (a !== ti && !containedIn(t, model.terms[a])); });
      } else base = all.filter(j => fit.assign[j] !== ti);
      const withT = base.concat(termCols(fit, ti));
      const r0 = rssOf(fit, base), r1 = rssOf(fit, withT);
      push(t.label, r1.rank - r0.rank, r0.rss - r1.rss);
    });
  } else throw new Error(`ANOVA type must be 1, 2 or 3`);
  rows.push({ term: 'Residuals', df: dfRes, ss: fit.rss, ms: sigma2 });
  return rows;
}

/**
 * Lack-of-fit test. groups: a key per row identifying identical settings (default: the
 * settings of fit.rows). Returns { pureError: { df, ss }, lackOfFit: { df, ss, F, p } } or null
 * when there are no replicated settings.
 */
export function lackOfFit(fit, groups) {
  const keys = groups ?? fit.rows.map(r => JSON.stringify(Object.entries(r.settings).sort()));
  const by = new Map();
  keys.forEach((k, i) => { if (!by.has(k)) by.set(k, []); by.get(k).push(fit.y[i]); });
  let ssPE = 0, dfPE = 0;
  for (const v of by.values()) { const m = sum(v) / v.length; ssPE += sum(v.map(x => (x - m) ** 2)); dfPE += v.length - 1; }
  const dfLOF = fit.dfRes - dfPE, ssLOF = fit.rss - ssPE;
  if (dfPE === 0) return null;
  const out = { pureError: { df: dfPE, ss: ssPE, ms: ssPE / dfPE } };
  if (dfLOF > 0) {
    const F = (ssLOF / dfLOF) / (ssPE / dfPE);
    out.lackOfFit = { df: dfLOF, ss: ssLOF, ms: ssLOF / dfLOF, F, p: fDist.sf(F, dfLOF, dfPE) };
  }
  return out;
}

// ---------------------------------------------------------------- Box–Cox

/**
 * Box–Cox profile log-likelihood, as MASS::boxcox computes it: with u = y / ẏ (ẏ the geometric
 * mean), ℓ(λ) = −n/2 · ln RSS of the fit to z = (u^λ − 1)/λ (ln u at λ = 0). Returns
 * { lambda, loglik, best, ci } with best maximising ℓ (refined by golden section) and ci the 95%
 * interval { ℓ ≥ max − χ²₁(0.95)/2 }, within the grid's range.
 */
export function boxCox(fit, lambdas = range(-2, 2, 0.1)) {
  const y = fit.y;
  if (y.some(v => !(v > 0))) throw new Error('Box–Cox needs a positive response');
  const n = y.length, lgm = sum(y.map(Math.log)) / n;
  const logu = y.map(v => Math.log(v) - lgm);
  const f = fit._qr;
  const ll = (lam) => {
    // MASS uses a 4-term series for |λ| ≤ 1/50; it equals expm1(λ ln u)/λ to O(λ⁴ ln⁵u)
    const z = Math.abs(lam) <= 1 / 50
      ? logu.map(l => l * (1 + (lam * l) / 2 * (1 + (lam * l) / 3 * (1 + (lam * l) / 4))))
      : logu.map(l => Math.expm1(lam * l) / lam);
    const e = f.residuals(z);
    return -n / 2 * Math.log(sum(e.map(v => v * v)));
  };
  const loglik = lambdas.map(ll);
  let i = loglik.indexOf(Math.max(...loglik));
  let a = lambdas[Math.max(0, i - 1)], b = lambdas[Math.min(lambdas.length - 1, i + 1)];
  const gr = (Math.sqrt(5) - 1) / 2;
  let c = b - gr * (b - a), d = a + gr * (b - a), fc = ll(c), fd = ll(d);
  for (let it = 0; it < 100 && b - a > 1e-10; it++) {
    if (fc > fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = ll(c); }
    else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = ll(d); }
  }
  const best = (a + b) / 2, lmax = ll(best), cut = lmax - chi2.ppf(0.95, 1) / 2;
  const root = (lo, hi) => { for (let it = 0; it < 100; it++) { const m = (lo + hi) / 2; if ((ll(m) - cut) * (ll(lo) - cut) <= 0) hi = m; else lo = m; } return (lo + hi) / 2; };
  const L = lambdas[0], H = lambdas[lambdas.length - 1];
  const ci = [ll(L) < cut ? root(L, best) : L, ll(H) < cut ? root(best, H) : H];
  return { lambda: lambdas, loglik, best, loglikMax: lmax, ci };
}

const range = (a, b, step) => { const out = []; for (let i = 0; a + i * step <= b + 1e-12; i++) out.push(+(a + i * step).toFixed(10)); return out; };

// ---------------------------------------------------------------- Lenth, half-normal

/**
 * Lenth (1989) pseudo standard error for m effect estimates (contrasts) of an unreplicated
 * design: s0 = 1.5 · median|c|, PSE = 1.5 · median{ |c| : |c| < 2.5 s0 }, with d = m/3 degrees
 * of freedom. ME = t(0.975; d) · PSE; SME = t(γ; d) · PSE, γ = (1 + 0.95^(1/m)) / 2.
 */
export function lenth(effects, { alpha = 0.05 } = {}) {
  const a = effects.map(Math.abs).filter(Number.isFinite);
  const m = a.length;
  if (m < 2) throw new Error('Lenth needs at least 2 effects');
  const med = (v) => { const s = v.slice().sort((x, y) => x - y), k = s.length; return k % 2 ? s[(k - 1) / 2] : (s[k / 2 - 1] + s[k / 2]) / 2; };
  const s0 = 1.5 * med(a);
  const pse = 1.5 * med(a.filter(v => v < 2.5 * s0));
  const d = m / 3;
  const gamma = (1 + (1 - alpha) ** (1 / m)) / 2;
  const me = studentT.ppf(1 - alpha / 2, d) * pse, sme = studentT.ppf(gamma, d) * pse;
  return { s0, pse, df: d, me, sme, t: effects.map(e => e / pse), active: effects.map(e => Math.abs(e) > me), activeSME: effects.map(e => Math.abs(e) > sme) };
}

/**
 * Half-normal plot coordinates: |effects| sorted ascending against Φ⁻¹(0.5 + 0.5 (i − 0.5)/m).
 * Returns [{ index, abs, q }] (index into the input).
 */
export function halfNormal(effects) {
  const m = effects.length;
  return effects.map((e, i) => ({ index: i, abs: Math.abs(e) })).sort((x, y) => x.abs - y.abs)
    .map((v, i) => ({ ...v, q: normal.ppf(0.5 + 0.5 * (i + 0.5) / m) }));
}

/**
 * Effects of a two-level model (coded ±1): 2 × coefficient for every column except the
 * intercept, with names. For use with lenth() and halfNormal().
 */
export function twoLevelEffects(fit) {
  // factor effects only: not the intercept, not the block term
  return fit.columns.map((c, j) => ({ name: c, effect: 2 * fit.coef[j] }))
    .filter((e, j) => fit.assign[j] !== -1 && !fit.model.terms[fit.assign[j]].block && Number.isFinite(e.effect));
}
