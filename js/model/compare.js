// Comparing the levels of a factor (issue #80): which treatments differ, which beat the control.
//
//   compareLevels(fit, factorId, opts)   adjusted means of the levels and comparisons between them,
//                                        with simultaneous intervals and adjusted p values
//   parseContrast(text, labels)          "high - ctrl", "(a + b)/2 - ctrl" → weights by level
//   letters(labels, means, pairs, alpha) the compact letter display (Piepho 2004)
//
// The means are the factor's adjusted means (adjusted.js: emmeans' reference grid), so a factor in
// a model with others — or with blocks or a covariate — is compared at the same settings of the
// rest. Methods (the family is all pairs, each level against the control, or the contrasts given):
//
//   tukey       all pairs; the studentized range for k means (Tukey–Kramer when the standard
//               errors differ: emmeans' "tukey")
//   dunnett     each level against the control; single-step, from the multivariate t of the
//               comparisons (their correlations from the covariance; exact for the product form a
//               one-way or balanced layout gives: mvt.js)
//   single-step any contrasts, from the multivariate t of their correlations (multcomp's default)
//   holm        Holm's step-down adjustment of the unadjusted p values (intervals: Bonferroni's,
//               as emmeans gives them)
//   bonferroni  p × m; intervals at level 1 − α/m
//   none        unadjusted
//
// Degrees of freedom: the residual df (least squares); infinite for counts and proportions with a
// known dispersion; for mixed models each comparison's Kenward–Roger df — its p value on its own
// df (as emmeans), the shared critical value of the multivariate methods on the smallest. For counts and proportions the means are back-
// transformed and the comparisons are ratios (log link) or odds ratios (logit).

import { studentT, normal, tukey } from '../dist.js';
import { qmvtBox, pmvtBox } from '../mvt.js';
import { levelSystem, comparisonOf } from './adjusted.js';

const mean = (v) => v.reduce((a, x) => a + x, 0) / v.length;
const tSf2 = (t, df) => 2 * (Number.isFinite(df) ? studentT.sf(Math.abs(t), df) : normal.sf(Math.abs(t)));
const tIsf = (a, df) => (Number.isFinite(df) ? studentT.isf(a, df) : normal.isf(a));

/** Correlation from a covariance matrix. */
const corrOf = (V) => V.map((r, i) => r.map((v, j) => v / Math.sqrt(V[i][i] * V[j][j])));

/**
 * Weights over the levels from a linear expression of level labels: "high - ctrl",
 * "(a + b)/2 - ctrl", "a + b - 2*ctrl", "'low dose' - ctrl" (quote labels with spaces or + − * /).
 * Returns { weights, sum } (sum ≈ 0 for a contrast).
 */
export function parseContrast(text, labels) {
  const src = String(text), k = labels.length;
  let i = 0;
  const ws = () => { while (/\s/.test(src[i] ?? '')) i++; };
  const vec = (w = new Array(k).fill(0), c = 0) => ({ w, c });
  const add = (a, b, sgn = 1) => vec(a.w.map((x, j) => x + sgn * b.w[j]), a.c + sgn * b.c);
  const scale = (a, s) => vec(a.w.map(x => x * s), a.c * s);
  const isConst = (a) => a.w.every(x => x === 0);
  const sorted = labels.map((l, j) => ({ l: String(l), j })).sort((a, b) => b.l.length - a.l.length);
  function factor() {
    ws();
    const ch = src[i];
    if (ch === '-') { i++; return scale(factor(), -1); }
    if (ch === '+') { i++; return factor(); }
    if (ch === '(') { i++; const e = expr(); ws(); if (src[i] !== ')') throw new Error(`contrast "${src}": a ")" is missing`); i++; return e; }
    if (ch === "'" || ch === '"') {
      const end = src.indexOf(ch, i + 1);
      if (end < 0) throw new Error(`contrast "${src}": an unclosed quote`);
      const lab = src.slice(i + 1, end), j = labels.map(String).indexOf(lab);
      if (j < 0) throw new Error(`contrast "${src}": no level "${lab}" (the levels: ${labels.join(', ')})`);
      i = end + 1; const v = vec(); v.w[j] = 1; return v;
    }
    const m = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
    if (m) { i += m[0].length; return vec(undefined, Number(m[0])); }
    for (const { l, j } of sorted) {
      if (src.startsWith(l, i)) {
        const next = src[i + l.length];
        if (next !== undefined && /[A-Za-z0-9_.]/.test(next) && /[A-Za-z0-9_.]$/.test(l)) continue;
        i += l.length; const v = vec(); v.w[j] = 1; return v;
      }
    }
    throw new Error(`contrast "${src}": expected a level (${labels.join(', ')}), a number or "(" at "${src.slice(i)}"`);
  }
  function term() {
    let a = factor();
    for (;;) {
      ws();
      if (src[i] === '*') { i++; const b = factor(); if (!isConst(a) && !isConst(b)) throw new Error(`contrast "${src}": two levels multiplied`); a = isConst(a) ? scale(b, a.c) : scale(a, b.c); }
      else if (src[i] === '/') { i++; const b = factor(); if (!isConst(b) || b.c === 0) throw new Error(`contrast "${src}": divide by a number only`); a = scale(a, 1 / b.c); }
      else return a;
    }
  }
  function expr() {
    let a = term();
    for (;;) {
      ws();
      if (src[i] === '+') { i++; a = add(a, term()); }
      else if (src[i] === '-') { i++; a = add(a, term(), -1); }
      else return a;
    }
  }
  const e = expr(); ws();
  if (i < src.length) throw new Error(`contrast "${src}": unexpected "${src.slice(i)}"`);
  if (e.c !== 0) throw new Error(`contrast "${src}": a constant term (only levels and their weights)`);
  if (e.w.every(x => x === 0)) throw new Error(`contrast "${src}": no levels`);
  return { weights: e.w, sum: e.w.reduce((a, x) => a + x, 0) };
}

/**
 * The compact letter display: levels sharing a letter are not significantly different at alpha.
 * Piepho's insert-absorb on the significant pairs; letters given in order of the means, from the
 * largest ('a'). labels/means: per level; pairs: [{ i, j, p }]. Returns a string per level.
 */
export function letters(labels, means, pairs, alpha = 0.05) {
  const k = labels.length;
  let cols = [new Set(labels.map((_, i) => i))];
  for (const { i, j, p } of pairs) {
    if (!(p < alpha)) continue;
    const next = [];
    for (const c of cols) {
      if (c.has(i) && c.has(j)) { const a = new Set(c); a.delete(i); const b = new Set(c); b.delete(j); next.push(a, b); }
      else next.push(c);
    }
    // absorb: drop a column contained in another
    cols = next.filter((c, x) => !next.some((d, y) => y !== x && [...c].every(v => d.has(v)) && (d.size > c.size || y < x)));
  }
  const order = [...Array(k).keys()].sort((a, b) => means[b] - means[a]);
  const rank = new Map(order.map((v, r) => [v, r]));
  // a column's place: its best-ranked level, then its next
  cols.sort((c, d) => { const a = [...c].map(v => rank.get(v)).sort((x, y) => x - y), b = [...d].map(v => rank.get(v)).sort((x, y) => x - y); for (let t = 0; t < Math.min(a.length, b.length); t++) if (a[t] !== b[t]) return a[t] - b[t]; return a.length - b.length; });
  const abc = (n) => (n < 26 ? String.fromCharCode(97 + n) : abc(Math.floor(n / 26) - 1) + String.fromCharCode(97 + (n % 26)));
  return labels.map((_, i) => cols.map((c, x) => (c.has(i) ? abc(x) : '')).join(''));
}

/**
 * Compare a factor's levels. opts: method ('tukey' | 'dunnett' | 'holm' | 'bonferroni' | 'none';
 * with contrasts also 'single-step', the default there), control (a level, for 'dunnett', and to
 * compare every level with it under holm, bonferroni or none), contrasts ([text]), at, level
 * (0.95), alpha (0.05, for the letters).
 * Returns { factor, kind, method, family: 'pairs' | 'control' | 'contrasts', comparison, control?,
 * levels: [{ label, mean, se, lower, upper, raw, n, letters? }], comparisons: [{ label, a?, b?,
 * weights?, estimate, se, df, stat, p, pRaw, lower, upper }], critical, df, held, averagedOver }.
 */
export function compareLevels(fit, factorId, { method, control, contrasts, at = {}, level = 0.95, alpha = 0.05 } = {}) {
  const { kind, g, L, lin, cov, link } = levelSystem(fit, factorId, { at });
  const labels = g.levels.map(l => l.label), k = labels.length;
  if (k < 2) throw new Error(`${factorId} has one level`);
  const family = contrasts?.length ? 'contrasts' : method === 'dunnett' || control !== undefined ? 'control' : 'pairs';
  method ??= family === 'contrasts' ? 'single-step' : family === 'control' ? 'dunnett' : 'tukey';
  const allowed = { pairs: ['tukey', 'holm', 'bonferroni', 'none'], control: ['dunnett', 'holm', 'bonferroni', 'none'], contrasts: ['single-step', 'holm', 'bonferroni', 'none'] }[family];
  if (!allowed.includes(method)) throw new Error(`method "${method}" is for ${method === 'tukey' ? 'all pairs' : method === 'dunnett' ? 'comparisons with a control (give the control)' : 'contrasts'}; here: ${allowed.join(', ')}`);
  // the comparisons as weights over the levels
  let comps;
  let ci = -1;
  if (family === 'control') {
    ci = labels.indexOf(String(control ?? labels[0]));
    if (ci < 0) throw new Error(`no level "${control}" of ${factorId} (the levels: ${labels.join(', ')})`);
    comps = labels.map((l, i) => i).filter(i => i !== ci).map(i => ({ label: `${labels[i]} − ${labels[ci]}`, a: labels[i], b: labels[ci], weights: labels.map((_, j) => (j === i ? 1 : j === ci ? -1 : 0)) }));
  } else if (family === 'pairs') {
    comps = [];
    for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) comps.push({ label: `${labels[a]} − ${labels[b]}`, a: labels[a], b: labels[b], i: a, j: b, weights: labels.map((_, j) => (j === a ? 1 : j === b ? -1 : 0)) });
  } else {
    comps = contrasts.map(t => { const c = parseContrast(t, labels); return { label: String(t), weights: c.weights, sum: c.sum }; });
  }
  const rows = comps.map(c => L[0].map((_, col) => c.weights.reduce((s, w, lv) => s + w * L[lv][col], 0)));
  const D = lin(rows), m = comps.length;
  const dfs = D.map(d => d.df), dfMin = Math.min(...dfs);
  const comparison = family === 'contrasts' ? (link && link.name !== 'identity' ? `contrast (${link.name} scale)` : 'contrast') : comparisonOf(link);
  const ratio = comparison === 'ratio' || comparison === 'odds ratio';
  const back = ratio ? Math.exp : (x) => x;
  const stats = D.map(d => d.est / d.se);
  const pRaw = stats.map((t, i) => tSf2(t, dfs[i]));
  // adjusted p and the critical value of the intervals
  let p, crit;
  if (method === 'tukey') {
    p = stats.map((t, i) => (k > 2 ? tukey.sf(Math.abs(t) * Math.SQRT2, k, dfs[i]) : pRaw[i]));
    crit = dfs.map(df => (k > 2 ? tukey.isf(1 - level, k, df) / Math.SQRT2 : tIsf((1 - level) / 2, df)));
  } else if (method === 'dunnett' || method === 'single-step') {
    const R = corrOf(cov(rows));
    if (m === 1) { p = pRaw; crit = [tIsf((1 - level) / 2, dfs[0])]; }
    else {
      p = stats.map((t, i) => Math.min(1, Math.max(0, 1 - pmvtBox(Math.abs(t), R, dfs[i]).p)));
      const c = qmvtBox(level, R, dfMin); crit = dfs.map(() => c);
    }
  } else if (method === 'bonferroni' || method === 'holm') {
    p = method === 'bonferroni' ? pRaw.map(x => Math.min(1, x * m)) : holm(pRaw);
    crit = dfs.map(df => tIsf((1 - level) / (2 * m), df));
  } else { p = pRaw; crit = dfs.map(df => tIsf((1 - level) / 2, df)); }
  const comparisons = comps.map((c, i) => {
    const d = D[i], q = crit[i];
    return { label: c.label, ...(c.a !== undefined ? { a: c.a, b: c.b } : { weights: c.weights }), ...(c.sum !== undefined && Math.abs(c.sum) > 1e-12 ? { notContrast: true } : {}),
      estimate: back(d.est), se: ratio ? Math.exp(d.est) * d.se : d.se, df: d.df, stat: stats[i], p: p[i], pRaw: pRaw[i],
      lower: back(d.est - q * d.se), upper: back(d.est + q * d.se), ...(ratio ? { link: { estimate: d.est, se: d.se } } : {}) };
  });
  // the means
  const means = lin(L), z = (df) => tIsf((1 - level) / 2, df);
  const levels = g.levels.map((Lv, i) => {
    const mm = means[i], c = z(mm.df);
    const at0 = fit.rows.filter(r => (g.target.type === 'categorical' ? r.settings[factorId] === Lv.value || r.settings[factorId] === Lv.label : Math.abs(r.settings[factorId] - Lv.value) < 1e-9 * Math.max(1, Math.abs(Lv.value))));
    const raw = at0.length ? mean(at0.map(r => r.y)) : NaN;
    if (!link) return { label: Lv.label, mean: mm.est, se: mm.se, df: mm.df, lower: mm.est - c * mm.se, upper: mm.est + c * mm.se, raw, n: at0.length };
    return { label: Lv.label, mean: link.inv(mm.est), se: Math.abs(link.deriv(mm.est)) * mm.se, df: mm.df, lower: link.inv(mm.est - c * mm.se), upper: link.inv(mm.est + c * mm.se), raw, n: at0.length };
  });
  if (family === 'pairs') {
    const L2 = letters(labels, means.map(x => x.est), comps.map((c, i) => ({ i: c.i, j: c.j, p: p[i] })), alpha);
    levels.forEach((l, i) => { l.letters = L2[i]; });
  }
  return { factor: factorId, kind, method, family, comparison, ...(ci >= 0 ? { control: labels[ci] } : {}), level, alpha,
    levels, comparisons, critical: method === 'dunnett' || method === 'single-step' ? crit[0] : undefined, df: dfMin, held: { ...g.fixed }, averagedOver: g.averagedOver };
}

/** Holm's step-down adjusted p values. */
export function holm(p) {
  const m = p.length, idx = [...p.keys()].sort((a, b) => p[a] - p[b]), out = new Array(m);
  let run = 0;
  idx.forEach((i, r) => { run = Math.max(run, Math.min(1, (m - r) * p[i])); out[i] = run; });
  return out;
}
