// Equivalence and non-inferiority (issue #84): is the new supplier, method, site or process as good
// as the old one? A non-significant difference does not say so; these tests do, against a margin
// set in advance.
//
//   equivalence(fit, factorId, opts)    each level (or the one given) against a reference
//   logResponse(study, responseId)      the study with the response's results on the log scale,
//                                       for a ratio of means of a continuous response
//
// Equivalence (two one-sided tests, TOST; Schuirmann 1987): the difference d (test − reference)
// lies within the margins [lower, upper] when both H0: d ≤ lower and H0: d ≥ upper are rejected
// at α; p = the larger of the two one-sided p values. The same as the 1 − 2α (90 %) interval lying
// inside the margins. Non-inferiority: one test, H0: d ≤ lower (higher is better) or d ≥ upper
// (lower is better); the same as the one-sided bound of that interval beyond the margin.
//
// Scales: a difference of means (normal response; or of proportions or rates, by the delta method
// on the response scale, as emmeans' regrid); a ratio of means (continuous response on the log
// scale: logResponse, as TOSTER::log_TOST; or a rate ratio or odds ratio from a GLM's link scale),
// its margins given as ratios. The comparisons use the factor's adjusted means (adjusted.js), so a
// factor in a larger model, blocks (paired data are blocks of two) and mixed models are handled as
// for comparing treatments; mixed models use each comparison's Kenward–Roger df. Several levels
// against one reference are each tested on their own (no adjustment: each is its own question).

import { studentT, normal, chi2, nct } from '../dist.js';
import { levelSystem } from './adjusted.js';
import { fitModel } from './fit.js';
import { hashNormal } from '../learn/process.js';

const sf = (t, df) => (Number.isFinite(df) ? studentT.sf(t, df) : normal.sf(t));
const isf = (a, df) => (Number.isFinite(df) ? studentT.isf(a, df) : normal.isf(a));

/**
 * Margins as [lower, upper] on the scale of the comparison: margin m gives [−m, m] (difference)
 * or [1/m, m] (ratio, m > 1; m < 1 is read as 1/m); or explicit lower and upper.
 */
export function marginsOf({ margin, lower, upper }, ratio) {
  let lo = lower, hi = upper;
  if (margin !== undefined) {
    if (!(Number(margin) > 0)) throw new Error('the margin must be a positive number');
    if (ratio) { const m = margin < 1 ? 1 / margin : margin; if (m === 1) throw new Error('a ratio margin of 1 leaves no room: give e.g. 1.25 (0.8 … 1.25)'); lo ??= 1 / m; hi ??= m; }
    else { lo ??= -margin; hi ??= margin; }
  }
  if (lo === undefined && hi === undefined) throw new Error('give the margin (how big a difference still counts as the same)');
  if (ratio && ((lo !== undefined && !(lo > 0)) || (hi !== undefined && !(hi > 0)))) throw new Error('ratio margins must be positive (e.g. 0.8 and 1.25)');
  if (lo !== undefined && hi !== undefined && !(lo < hi)) throw new Error('the lower margin must be below the upper one');
  return [lo, hi];
}

/**
 * Equivalence or non-inferiority of the levels of a factor against a reference.
 * opts: reference (a level; default the first), test (a level; default every other level),
 * margin / lower / upper (on the comparison's scale: response units for a difference, a ratio
 * for a ratio), type ('equivalence' | 'noninferiority'), better ('higher' | 'lower'; which side
 * matters for non-inferiority, default higher), scale ('difference' | 'ratio'; default: ratio for
 * counts and proportions with a log or logit link and for a log-transformed response, else the
 * difference), logged (the fit is of the log of the response: logResponse), alpha (0.05), at.
 * Returns { factor, reference, type, scale, comparison, alpha, level (1 − 2α), margins: [lo, hi],
 * comparisons: [{ test, reference, estimate, se, df, lower, upper (the 1 − 2α interval), pLower,
 * pUpper, p, equivalent | noninferior, verdict, different: { p, lower, upper } (the ordinary
 * two-sided test and 1 − α interval) }] }.
 */
export function equivalence(fit, factorId, { reference, test, margin, lower, upper, type = 'equivalence', better = 'higher', scale, logged = false, alpha = 0.05, at = {} } = {}) {
  if (!['equivalence', 'noninferiority'].includes(type)) throw new Error('type: equivalence or noninferiority');
  if (!['higher', 'lower'].includes(better)) throw new Error('better: higher or lower');
  if (!(alpha > 0 && alpha < 0.5)) throw new Error('alpha must be between 0 and 0.5');
  const { kind, g, L, lin, cov, link } = levelSystem(fit, factorId, { at });
  const labels = g.levels.map(l => l.label);
  if (labels.length < 2) throw new Error(`${factorId} has one level`);
  const ri = labels.indexOf(String(reference ?? labels[0]));
  if (ri < 0) throw new Error(`no level "${reference}" of ${factorId} (the levels: ${labels.join(', ')})`);
  const tests = test !== undefined ? [String(test)] : labels.filter((_, i) => i !== ri);
  for (const t of tests) if (!labels.includes(t)) throw new Error(`no level "${t}" of ${factorId} (the levels: ${labels.join(', ')})`);
  if (tests.includes(labels[ri])) throw new Error('the test level is the reference');
  const glm = !!link, logLink = glm && (link.name === 'log' || link.name === 'logit');
  scale ??= logged || logLink ? 'ratio' : 'difference';
  if (scale === 'ratio' && !logged && !logLink) throw new Error('a ratio of means needs the response on the log scale (logResponse; doe equivalence --ratio) or counts or proportions with a log or logit link');
  if (scale === 'difference' && logged) throw new Error('the fit is of the log of the response: its comparisons are ratios');
  const ratio = scale === 'ratio';
  const comparison = ratio ? (glm ? (link.name === 'logit' ? 'odds ratio' : 'ratio') : 'ratio of means') : (glm ? (link.name === 'logit' || link.name === 'probit' || link.name === 'cloglog' ? 'difference of proportions' : 'difference of means') : 'difference');
  const [mLo, mHi] = marginsOf({ margin, lower, upper }, ratio);
  if (type === 'noninferiority' && (better === 'higher' ? mLo : mHi) === undefined) throw new Error(`non-inferiority with ${better} better needs the ${better === 'higher' ? 'lower' : 'upper'} margin`);
  if (type === 'equivalence' && (mLo === undefined || mHi === undefined)) throw new Error('equivalence needs both margins');
  // the margins on the scale the test is made on (log for ratios)
  const tr = ratio ? Math.log : (x) => x, back = ratio ? Math.exp : (x) => x;
  const bLo = mLo === undefined ? undefined : tr(mLo), bHi = mHi === undefined ? undefined : tr(mHi);
  const row = (w) => L[0].map((_, col) => w.reduce((s, x, lv) => s + x * L[lv][col], 0));
  const comparisons = tests.map(t => {
    const ti = labels.indexOf(t);
    let est, se, df;
    if (glm && !ratio) {
      // a difference on the response scale by the delta method (emmeans' regrid)
      const [a, b] = lin([L[ti], L[ri]]), V = cov([L[ti], L[ri]]);
      const ga = link.deriv(a.est), gb = -link.deriv(b.est);
      est = link.inv(a.est) - link.inv(b.est); se = Math.sqrt(ga * ga * V[0][0] + 2 * ga * gb * V[0][1] + gb * gb * V[1][1]); df = Math.min(a.df, b.df);
    } else {
      const d = lin([row(labels.map((_, j) => (j === ti ? 1 : j === ri ? -1 : 0)))])[0];
      est = d.est; se = d.se; df = d.df;
    }
    if (!(se > 0) || !Number.isFinite(est)) throw new Error(`${t} − ${labels[ri]} cannot be estimated (no data, or aliased)`);
    const q = isf(alpha, df), q2 = isf(alpha / 2, df);
    const pLower = bLo === undefined ? undefined : sf((est - bLo) / se, df);      // H0: d ≤ lower
    const pUpper = bHi === undefined ? undefined : sf((bHi - est) / se, df);      // H0: d ≥ upper
    const p = type === 'equivalence' ? Math.max(pLower, pUpper) : better === 'higher' ? pLower : pUpper;
    const lo = est - q * se, hi = est + q * se;
    const pDiff = 2 * sf(Math.abs(est) / se, df);
    const out = { test: t, reference: labels[ri], estimate: back(est), se: ratio ? back(est) * se : se, df, lower: back(lo), upper: back(hi),
      ...(pLower !== undefined ? { pLower } : {}), ...(pUpper !== undefined ? { pUpper } : {}), p,
      different: { p: pDiff, lower: back(est - q2 * se), upper: back(est + q2 * se) }, ...(ratio ? { log: { estimate: est, se } } : {}) };
    const ok = p < alpha;
    if (type === 'equivalence') out.equivalent = ok; else out.noninferior = ok;
    out.verdict = verdictOf(out, { type, better, ok, lo: mLo, hi: mHi, alpha });
    return out;
  });
  return { factor: factorId, kind, reference: labels[ri], type, ...(type === 'noninferiority' ? { better } : {}), scale, comparison, alpha, level: 1 - 2 * alpha,
    margins: [mLo, mHi], comparisons, held: { ...g.fixed }, averagedOver: g.averagedOver };
}

const fmt = (x) => (Math.abs(x) >= 1e4 || (Math.abs(x) < 1e-3 && x !== 0) ? x.toExponential(3) : String(+x.toPrecision(4)));

function verdictOf(c, { type, better, ok, lo, hi, alpha }) {
  const pct = `${Math.round(100 * (1 - 2 * alpha))} %`, iv = `the ${pct} interval ${fmt(c.lower)} … ${fmt(c.upper)}`;
  const diff = c.different.p < alpha;
  if (type === 'equivalence') {
    if (ok) return `equivalent: ${iv} lies within the margins ${fmt(lo)} … ${fmt(hi)}${diff ? ` (a difference is also detected, but it is smaller than the margin)` : ''}`;
    if (c.lower >= hi || c.upper <= lo) return `different by more than the margin: ${iv} lies wholly ${c.lower >= hi ? `above ${fmt(hi)}` : `below ${fmt(lo)}`}`;
    const out = [c.lower <= lo ? `below ${fmt(lo)}` : null, c.upper >= hi ? `above ${fmt(hi)}` : null].filter(Boolean).join(' and ');
    return `not shown to be equivalent: ${iv} reaches ${out}${!diff ? '. No difference is detected either: there are too few runs to tell' : ''}`;
  }
  const bound = better === 'higher' ? lo : hi, end = better === 'higher' ? c.lower : c.upper;
  if (ok) return `non-inferior: the ${better === 'higher' ? 'lower' : 'upper'} end of the ${pct} interval, ${fmt(end)}, is ${better === 'higher' ? 'above' : 'below'} the margin ${fmt(bound)}`;
  if (better === 'higher' ? c.upper <= bound : c.lower >= bound) return `inferior by more than the margin: ${iv} lies wholly ${better === 'higher' ? 'below' : 'above'} ${fmt(bound)}`;
  return `not shown to be non-inferior: the ${better === 'higher' ? 'lower' : 'upper'} end of the ${pct} interval, ${fmt(end)}, is ${better === 'higher' ? 'below' : 'above'} the margin ${fmt(bound)}`;
}

/**
 * The study with a response's results replaced by their natural logs, for a ratio of means of a
 * continuous response (as TOSTER::log_TOST): every result must be positive.
 */
export function logResponse(study, responseId) {
  const r = study.responses.find(x => x.id === responseId);
  if (!r) throw new Error(`no response "${responseId}"`);
  if (r.distribution && r.distribution !== 'normal') throw new Error('a ratio for counts and proportions comes from their model (no log needed)');
  const obs = study.observations.map(o => {
    if (o.response !== responseId || o.value === null) return o;
    if (!(o.value > 0)) throw new Error(`a ratio of means needs positive results: run ${o.run} has ${o.value}`);
    return { ...o, value: Math.log(o.value) };
  });
  return { ...study, observations: obs };
}

// ---------------------------------------------------------------- power and sample size (phase 2)
//
//   tostPower({ k, df, sigma, delta, lower, upper, alpha, type, better })
//                              the power of TOST (or non-inferiority) when the estimate's standard
//                              error is k σ on df degrees of freedom and the true difference delta
//   equivalencePower(study, opts)
//                              the same for each level against the reference in the study's
//                              design (k and df from the design and the model; no results needed)
//   equivalenceRuns(study, opts)
//                              how many times the design must be repeated to reach a target power
//
// Exact TOST power (as PowerTOST's method "exact", Owen's Q): with s the estimate of σ on df
// degrees of freedom (s² ~ σ² χ²_df / df) and d ~ N(δ, (kσ)²), both one-sided tests reject when
// lower + q k s < d < upper − q k s, q = t(1 − α, df); so power = E_s[Φ((upper − q k s − δ)/(kσ)) −
// Φ((lower + q k s − δ)/(kσ))]⁺, integrated over s up to (upper − lower)/(2 q k) by Gauss–Legendre
// panels. Non-inferiority: P(non-central t > q), the non-centrality (δ − lower)/(kσ) (higher is
// better) or (upper − δ)/(kσ). Ratios: on the log scale, σ the log-scale σ (from a CV:
// √ln(1 + CV²)), margins and the true ratio logged.


// 32-point Gauss–Legendre nodes and weights on [−1, 1] (Newton on the Legendre polynomial)
const GL = (() => {
  const n = 32, x = [], w = [];
  for (let i = 1; i <= n; i++) {
    let z = Math.cos(Math.PI * (i - 0.25) / (n + 0.5)), pp = 0;
    for (let it = 0; it < 100; it++) {
      let p1 = 1, p2 = 0;
      for (let j = 1; j <= n; j++) { const p3 = p2; p2 = p1; p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j; }
      pp = n * (z * p1 - p2) / (z * z - 1);
      const z1 = z; z = z1 - p1 / pp;
      if (Math.abs(z - z1) < 1e-15) break;
    }
    x.push(z); w.push(2 / ((1 - z * z) * pp * pp));
  }
  return { x, w };
})();

/** The log-scale σ for a coefficient of variation (a ratio of means): √ln(1 + CV²). */
export const sigmaOfCv = (cv) => Math.sqrt(Math.log1p(cv * cv));

/**
 * The power of TOST (type 'equivalence') or of a non-inferiority test, when the estimated
 * difference has standard error k σ on df degrees of freedom and the true difference is delta;
 * lower and upper are the margins (on the scale of the test: logs for ratios).
 */
export function tostPower({ k, df, sigma = 1, delta = 0, lower, upper, alpha = 0.05, type = 'equivalence', better = 'higher' }) {
  if (!(k > 0) || !(df > 0) || !(sigma > 0)) throw new Error('power needs a standard error and degrees of freedom');
  const q = studentT.isf(alpha, df), se = k * sigma;
  if (type === 'noninferiority') {
    return better === 'higher' ? nct.sf(q, df, (delta - lower) / se) : nct.sf(q, df, (upper - delta) / se);
  }
  if (!(lower < upper)) throw new Error('the lower margin must be below the upper one');
  // v = s / σ: density of √(χ²_df / df); integrate up to where the two rejection limits meet
  const vmax = (upper - lower) / (2 * q * se);
  // the integral runs over where s / σ has any mass (its 1e−17 quantiles: for large df a narrow spike)
  const a = Math.sqrt(chi2.ppf(1e-17, df) / df), b = Math.min(vmax, Math.sqrt(chi2.isf(1e-17, df) / df));
  if (!(b > a)) return 0;
  const dens = (v) => (v <= 0 ? (df === 1 ? Math.sqrt(2 / Math.PI) : 0) : 2 * df * v * chi2.pdf(df * v * v, df));
  const f = (v) => {
    const hi = normal.cdf((upper - q * se * v - delta) / se), lo = normal.cdf((lower + q * se * v - delta) / se);
    return Math.max(0, hi - lo) * dens(v);
  };
  // panels: finer near 0 (the density's shape for small df) and near the cut-off
  const P = 24;
  let total = 0;
  for (let i = 0; i < P; i++) {
    const a0 = a + (b - a) * (i / P), a1 = a + (b - a) * ((i + 1) / P), h2 = (a1 - a0) / 2, m = (a1 + a0) / 2;
    for (let j = 0; j < GL.x.length; j++) total += GL.w[j] * h2 * f(m + h2 * GL.x[j]);
  }
  return Math.min(1, Math.max(0, total));
}

/**
 * The standard-error factor k (SE of each comparison = k σ) and the error df of a study's design
 * for a model, from a fit to placeholder results (any non-constant values: k and df do not depend
 * on them). Blocks, blocking variables and other factors are in the model as the analysis has them.
 */
function designSE(study, factorId, { formula, reference, test, at = {} }) {
  const r = study.responses.find(x => !x.derived && (!x.distribution || x.distribution === 'normal')) ?? study.responses[0];
  const runs = study.design.runs.filter(x => x.kind !== 'confirm');
  const obs = runs.map(x => ({ run: x.run, response: r.id, value: hashNormal(7, x.run) }));
  const st = { ...study, responses: study.responses.map(x => (x.id === r.id ? { id: x.id, name: x.name } : x)), observations: obs, covariates: undefined };
  const fit = fitModel(st, formula ?? `${r.id} ~ main`);
  if (!(fit.dfRes > 0)) throw new Error('the design leaves no degrees of freedom for the error: add runs');
  const eq = equivalence(fit, factorId, { reference, test, margin: 1, at });
  return { fit, comparisons: eq.comparisons.map(c => ({ test: c.test, reference: c.reference, k: c.se / fit.sigma, df: c.df })), reference: eq.reference };
}

/**
 * Power of equivalence (or non-inferiority) tests in a study's design, before any results.
 * opts: factor, reference, test, formula (default the response's main effects), margin | lower,
 * upper (response units; ratios with ratio: true), type, better, sigma (the run-to-run σ; for a
 * ratio, the log-scale σ — or cv), delta (the true difference; for a ratio, the true ratio:
 * default 0, or 1), alpha.
 * Returns { reference, type, scale, margins, comparisons: [{ test, k, df, se, power }], power (the smallest) }.
 */
export function equivalencePower(study, { factor, reference, test, formula, margin, lower, upper, type = 'equivalence', better = 'higher', sigma, cv, ratio = false, delta, alpha = 0.05, at } = {}) {
  if (!study.design?.runs?.length) throw new Error('the study has no design yet');
  const f = study.factors.find(x => x.id === factor) ?? study.factors.find(x => x.type === 'categorical');
  if (!f || f.type !== 'categorical') throw new Error('equivalence compares the levels of a categorical factor');
  const s = ratio ? (cv !== undefined ? sigmaOfCv(cv) : sigma) : sigma;
  if (!(s > 0)) throw new Error(ratio ? 'give the coefficient of variation (or the log-scale σ)' : 'give σ, the run-to-run standard deviation');
  const [lo, hi] = marginsOf({ margin, lower, upper }, ratio);
  const tr = ratio ? Math.log : (x) => x;
  const d = tr(delta ?? (ratio ? 1 : 0));
  const { comparisons, reference: ref } = designSE(study, f.id, { formula, reference, test, at });
  const out = comparisons.map(c => ({ ...c, se: c.k * s, power: tostPower({ k: c.k, df: c.df, sigma: s, delta: d, lower: lo === undefined ? undefined : tr(lo), upper: hi === undefined ? undefined : tr(hi), alpha, type, better }) }));
  return { factor: f.id, reference: ref, type, ...(type === 'noninferiority' ? { better } : {}), scale: ratio ? 'ratio' : 'difference', margins: [lo, hi], sigma: s, delta: delta ?? (ratio ? 1 : 0), alpha,
    comparisons: out, power: Math.min(...out.map(c => c.power)), runs: study.design.runs.filter(x => x.kind !== 'confirm').length };
}

/**
 * The design repeated m times (blocks, whole plots and blocking labels kept apart per copy), for
 * finding how many runs a target power needs.
 */
export function repeatDesign(study, m) {
  const runs = study.design.runs.filter(x => x.kind !== 'confirm');
  const n = runs.length, out = [];
  for (let c = 0; c < m; c++) for (const [i, r] of runs.entries()) {
    out.push({ ...r, run: c * n + i + 1, order: c * n + (r.order ?? i + 1),
      ...(r.block !== undefined ? { block: m > 1 ? `${c + 1}.${r.block}` : r.block } : {}),
      ...(r.wholePlot !== undefined ? { wholePlot: m > 1 ? `${c + 1}.${r.wholePlot}` : r.wholePlot } : {}),
      // a crossover's subjects are new subjects in each copy; its periods (and a Latin square's
      // columns) are the same periods
      ...(r.blocks ? { blocks: Object.fromEntries(Object.entries(r.blocks).map(([k, v]) => { const role = study.design.blocking?.find(b => b.id === k)?.role; return [k, m > 1 && (role === 'subject' || role === 'row') ? `${c + 1}.${v}` : v]; })) } : {}) });
  }
  const blocking = study.design.blocking?.map(b => (b.levels && m > 1 && (b.role === 'subject' || b.role === 'row') ? (({ levels, ...x }) => x)(b) : b));
  return { ...study, design: { ...study.design, ...(blocking ? { blocking } : {}), runs: out }, observations: [] };
}

/**
 * How many copies of the design reach the target power (default 0.8) for equivalence or
 * non-inferiority; opts as equivalencePower, plus target and max (copies, default 50).
 * Returns { copies, runs, power, reached }.
 */
export function equivalenceRuns(study, { target = 0.8, max = 50, ...opts } = {}) {
  let last = null;
  for (let m = 1; m <= max; m++) {
    let p;
    try { p = equivalencePower(repeatDesign(study, m), opts); } catch (e) { if (/no degrees of freedom/.test(e.message)) continue; throw e; }
    last = { copies: m, runs: p.runs, power: p.power, reached: p.power >= target };
    if (p.power >= target) return last;
  }
  return last ?? { copies: max, runs: NaN, power: NaN, reached: false };
}
