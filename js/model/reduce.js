// Model reduction (spec §6.3, issue #12): backward elimination by p-value or AICc, keeping the
// model hierarchical. The result is a suggestion: the steps are returned so a user can see why
// each term went, and any term can be kept or put back.
//
// At each step the candidates are the terms whose removal leaves no term without a parent
// (A stays while A:B or I(A^2) is in the model; with hierarchy: false every term is a
// candidate), excluding block terms and terms in `keep`. For each candidate the model is refitted
// without it:
//   p-value: the test of dropping the term, from the fit's noise model (noise.js): for normal
//            noise the partial F test (as R's drop1(test = "F")); the candidate with the largest p
//            is dropped if p > alphaOut (default 0.10).
//   AICc:    AIC = −2 log L + 2k, from the noise model's log-likelihood; for normal noise
//            n log(2π) + n log(RSS/n) + n + 2k with k = rank + 1 (σ counts, as R's AIC);
//            AICc = AIC + 2k(k+1)/(n − k − 1). The candidate giving the lowest AICc is dropped
//            if that is lower than the current model's.
import { fitModel } from './fit.js';
import { fitMixedModel, fitMixedML } from './mixed.js';
import { hierarchyViolations } from './formula.js';
import { noiseOf } from './noise.js';

/** AICc of a fit (Infinity when n − k − 1 ≤ 0). */
export function aicc(fit) {
  const n = fit.n, { loglik, k } = noiseOf(fit).loglik(fit);
  if (loglik === Infinity) return -Infinity;
  if (Number.isNaN(loglik)) return NaN;           // quasi-likelihood: no AIC
  const aic = -2 * loglik + 2 * k;
  return n - k - 1 > 0 ? aic + 2 * k * (k + 1) / (n - k - 1) : Infinity;
}

const formulaOf = (response, model, labels) => `${response} ~ ${labels.length ? labels.join(' + ') : '1'}${model.intercept ? '' : ' - 1'}`;

/**
 * Reduce a model. opts: method ('p' | 'aicc'), alphaOut (0.10), keep ([term labels]),
 * hierarchy (true), and fitModel options (aggregate, …).
 * Returns { formula, fit, steps: [{ drop, p?, F?, aicc?, formula }], start: { formula, aicc } }.
 */
export function reduceModel(study, formula, { method = 'p', alphaOut = 0.10, keep = [], hierarchy = true, ...fitOpts } = {}) {
  if (method !== 'p' && method !== 'aicc') throw new Error(`method must be "p" or "aicc", not "${method}"`);
  let fit = fitModel(study, formula, fitOpts);
  const response = fit.response;
  const own = (f) => f.model.terms.filter(t => !t.block);
  if (method === 'p' && fit.dfRes < 1 && !(fit.distribution && !fit.dispersionEstimated)) throw new Error('the model leaves no residual degrees of freedom, so there are no p-values: start from a smaller model, or judge the effects with Lenth’s method');
  if (method === 'aicc' && Number.isNaN(aicc(fit))) throw new Error(`a ${noiseOf(fit).label} model has a quasi-likelihood, with no AIC: reduce it by p-values`);
  const start = { formula: formulaOf(response, fit.model, own(fit).map(t => t.label)), aicc: aicc(fit) };
  const steps = [];
  for (;;) {
    const labels = own(fit).map(t => t.label);
    const before = new Set(hierarchyViolations({ terms: own(fit) }).map(v => v.term));
    const cands = labels.filter(l => !keep.includes(l)).filter(l => {
      if (!hierarchy) return true;
      const rest = own(fit).filter(t => t.label !== l);
      return hierarchyViolations({ terms: rest }).every(v => before.has(v.term));
    });
    if (!cands.length) break;
    const trials = cands.map(l => {
      const g = fitModel(study, formulaOf(response, fit.model, labels.filter(x => x !== l)), fitOpts);
      return { drop: l, fit: g, ...noiseOf(fit).compare(fit, g), aicc: aicc(g) };
    });
    let pick;
    if (method === 'p') {
      // a term with no estimable columns (df 0) adds nothing: drop it first
      pick = trials.reduce((a, c) => (c.p > a.p ? c : a));
      if (!(pick.p > alphaOut)) break;
    } else {
      pick = trials.reduce((a, c) => (c.aicc < a.aicc ? c : a));
      if (!(pick.aicc < aicc(fit))) break;
    }
    fit = pick.fit;
    steps.push({ drop: pick.drop, df: pick.df, F: pick.F, ...(Number.isFinite(pick.chi2) ? { chi2: pick.chi2 } : {}), p: pick.p, aicc: pick.aicc, formula: formulaOf(response, fit.model, own(fit).map(t => t.label)) });
  }
  return { method, start, steps, formula: formulaOf(response, fit.model, own(fit).map(t => t.label)), fit };
}

/**
 * Backward elimination for a mixed model (split-plot or nested readings), hierarchy kept.
 *   p:    the candidate with the largest Kenward–Roger p is dropped while p > alphaOut (each term's
 *         KR test given all the others: for a term no other term contains, this is the test of
 *         dropping it);
 *   aicc: by AICc of maximum-likelihood fits (REML criteria cannot compare models with
 *         different fixed effects), k = fixed coefficients + variance components.
 * The random effects stay as chosen for the starting model. Returns as reduceModel, with fit the
 * REML fit of the final model.
 */
export function reduceMixed(study, formula, { method = 'p', alphaOut = 0.10, keep = [], hierarchy = true, ...opts } = {}) {
  if (method !== 'p' && method !== 'aicc') throw new Error(`method must be "p" or "aicc", not "${method}"`);
  let fit = fitMixedModel(study, formula, opts);
  const random = fit.random.map(r => r.id), fo = { ...opts, random };
  const own = (f) => f.model.terms.filter(t => !t.block);
  const mlAicc = (form) => { const m = fitMixedML(study, form, fo); const k = m.k, n = m.n; return m.deviance + 2 * k + (n - k - 1 > 0 ? 2 * k * (k + 1) / (n - k - 1) : Infinity); };
  let curFormula = formulaOf(fit.response, fit.model, own(fit).map(t => t.label));
  let curAicc = method === 'aicc' ? mlAicc(curFormula) : NaN;
  const start = { formula: curFormula, ...(method === 'aicc' ? { aicc: curAicc } : {}) };
  const steps = [];
  for (;;) {
    const labels = own(fit).map(t => t.label);
    const before = new Set(hierarchyViolations({ terms: own(fit) }).map(v => v.term));
    const cands = labels.filter(l => !keep.includes(l)).filter(l => !hierarchy || hierarchyViolations({ terms: own(fit).filter(t => t.label !== l) }).every(v => before.has(v.term)));
    if (!cands.length) break;
    let pick;
    if (method === 'p') {
      const tests = cands.map(l => ({ drop: l, ...(fit.terms.find(t => t.term === l) ?? {}) })).map(t => ({ ...t, p: t.df ? t.pKR : 1 }));
      pick = tests.reduce((a, c) => (c.p > a.p ? c : a));
      if (!(pick.p > alphaOut)) break;
      pick = { drop: pick.drop, F: pick.FKR, ddf: pick.ddfKR, p: pick.p };
    } else {
      const trials = cands.map(l => { const form = formulaOf(fit.response, fit.model, labels.filter(x => x !== l)); return { drop: l, form, aicc: mlAicc(form) }; });
      pick = trials.reduce((a, c) => (c.aicc < a.aicc ? c : a));
      if (!(pick.aicc < curAicc)) break;
      curAicc = pick.aicc;
    }
    curFormula = formulaOf(fit.response, fit.model, labels.filter(x => x !== pick.drop));
    fit = fitMixedModel(study, curFormula, fo);
    steps.push({ ...pick, formula: curFormula });
  }
  return { method, mixed: true, start, steps, formula: curFormula, fit };
}
