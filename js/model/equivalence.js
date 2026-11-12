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

import { studentT, normal } from '../dist.js';
import { levelSystem } from './adjusted.js';

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
