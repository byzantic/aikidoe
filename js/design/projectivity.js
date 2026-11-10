// Projection properties of screening designs (issue #79): what a design can still do once only a
// few of its factors turn out to matter.
//
//   projectivity(X)            two-level designs: P, the largest number such that every set of P
//                              factors contains a full 2^P factorial (Box & Tyssedal 1996). A
//                              regular fraction of resolution R has P = R − 1; Plackett–Burman
//                              designs of 12 … 48 runs (not 16) have P = 3 (Lin & Draper 1992).
//                              Also the share of (P + 1)-factor projections that are full.
//   generalisedResolution(X)   Deng & Tang (1999): r + 1 − max |J_r|/N, r the smallest order
//                              with a non-zero J-characteristic J_r(S) = |Σ_runs Π_{j∈S} x_j|; for a
//                              regular fraction its resolution, for PB12 3 + 1 − 4/12 = 3.67 —
//                              between III and IV: main effects only partially aliased with 2fis.
//   estimableProjections(X, s, { model })   the share of the s-factor projections in which a
//                              model in those factors can be estimated: '2fi' (PB12 … 28: every
//                              4-factor projection supports main effects and all 2fis) or
//                              'quadratic' (definitive screening: any 3 factors from k ≥ 5).
// Rows that are not entirely ±1 (centre points, axial runs) are left out of the two-level measures.
import { qr } from '../linalg.js';
import { lenth } from '../model/ols.js';
import { fitModel } from '../model/fit.js';

/** Each k-subset of 0 … n − 1, in lexicographic order, passed to f (stops when f returns false). */
function eachSubset(n, k, f) {
  if (k > n) return true;
  const s = [...Array(k).keys()];
  for (;;) {
    if (f(s) === false) return false;
    let i = k - 1;
    while (i >= 0 && s[i] === n - k + i) i--;
    if (i < 0) return true;
    s[i]++;
    for (let j = i + 1; j < k; j++) s[j] = s[j - 1] + 1;
  }
}

const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r); };

/** The two-level runs of X (rows entirely ±1). */
const twoLevelRows = (X) => X.filter(r => r.every(v => v === 1 || v === -1));

/** Does the projection of the two-level rows R onto columns S contain every one of the 2^|S| sign combinations? */
function fullIn(R, S) {
  const need = 1 << S.length, seen = new Set();
  for (const r of R) {
    let key = 0;
    for (let a = 0; a < S.length; a++) if (r[S[a]] > 0) key |= 1 << a;
    seen.add(key);
    if (seen.size === need) return true;
  }
  return false;
}

/**
 * Projectivity of a two-level design (columns coded ±1; other rows ignored). opts.max caps the
 * search (default 5). Returns { P, max, capped, next: { size, full, total, share } | null } —
 * P = k for a full factorial; capped: every max-factor projection is full (P is at least max).
 * null when the design has no two-level runs, or a column is not two-level.
 */
export function projectivity(X, { max = 5 } = {}) {
  const R = twoLevelRows(X);
  if (!R.length) return null;
  const k = R[0].length;
  for (let j = 0; j < k; j++) if (!(R.some(r => r[j] === 1) && R.some(r => r[j] === -1))) return { P: 0, max, capped: false, next: null };
  let P = 1;
  for (let s = 2; s <= Math.min(k, max); s++) {
    let full = 0;
    eachSubset(k, s, (S) => { if (fullIn(R, S)) full++; });
    const total = binom(k, s);
    if (full < total) return { P, max, capped: false, next: { size: s, full, total, share: full / total } };
    P = s;
  }
  return { P, max, capped: P < k, next: null };
}

/**
 * Generalised resolution (Deng & Tang 1999) of a two-level design (±1 rows; others ignored).
 * Returns { resolution, order: r, maxJ: max |J_r| / N, regular: maxJ === 1 } — resolution Infinity
 * when no J-characteristic up to opts.max (default 5, or k) is non-zero (then capped is true unless
 * every order was checked).
 */
export function generalisedResolution(X, { max = 5 } = {}) {
  const R = twoLevelRows(X);
  if (!R.length) return null;
  const n = R.length, k = R[0].length, top = Math.min(k, max);
  for (let s = 1; s <= top; s++) {
    let mx = 0;
    eachSubset(k, s, (S) => {
      let sum = 0;
      for (const r of R) { let p = 1; for (const j of S) p *= r[j]; sum += p; }
      const J = Math.abs(sum) / n;
      if (J > mx + 1e-12) mx = J;
      return mx < 1 - 1e-12;                       // a full alias: nothing larger to find
    });
    if (mx > 1e-12) return { resolution: s + 1 - mx, order: s, maxJ: mx, regular: Math.abs(mx - 1) < 1e-12 };
  }
  return { resolution: Infinity, order: null, maxJ: 0, regular: true, capped: top < k };
}

/**
 * The s-factor projections of a design (coded columns, three levels allowed) in which a model in
 * those s factors is estimable: model 'quadratic' (intercept, main effects, squares and 2fis) or
 * '2fi' (intercept, main effects and 2fis). opts.columns restricts to some columns (e.g. the
 * continuous ones). Returns { size, model, estimable, total, share }.
 */
export function estimableProjections(X, s, { model = 'quadratic', columns } = {}) {
  const cols = columns ?? [...Array(X[0].length).keys()];
  let ok = 0, total = 0;
  eachSubset(cols.length, s, (idx) => {
    const S = idx.map(i => cols[i]);
    const M = X.map(r => {
      const row = [1, ...S.map(j => r[j]), ...(model === 'quadratic' ? S.map(j => r[j] * r[j]) : [])];
      for (let a = 0; a < S.length; a++) for (let b = a + 1; b < S.length; b++) row.push(r[S[a]] * r[S[b]]);
      return row;
    });
    total++;
    if (M.length >= M[0].length && qr(M, { tol: 1e-9 }).aliased.length === 0) ok++;
  });
  return { size: s, model, estimable: ok, total, share: total ? ok / total : NaN };
}
export const quadraticProjections = (X, s, o = {}) => estimableProjections(X, s, { ...o, model: 'quadratic' });

export const _eachSubset = eachSubset;

/**
 * After a screening fit (issue #79): when only a few factors look active, can the same runs fit
 * those factors with their interactions (definitive screening: their full quadratic)? fit: a
 * least-squares fit of a main-effects model (fitModel) to a two-level or definitive screening
 * design of 4 or more factors. Active factors: main effects with p < alpha, or (no residual df)
 * beyond Lenth's ME. With 2 … 4 of them, the model in them is tried on the same runs; returned when
 * it is estimable with at least one residual df: { active: [ids], formula, kind: '2fi' |
 * 'quadratic', dfRes, full (the active factors' runs form a full 2^m) } — else null.
 */
export function activeProjection(study, fit, { alpha = 0.05, refit = (f) => fitModel(study, f) } = {}) {
  if (fit.distribution || !fit.model || !study.design) return null;
  const k = study.factors.length;
  const kind = study.design.kind;
  if (k < 4 || !['fractional-factorial', 'plackett-burman', 'definitive-screening', 'optimal'].includes(kind)) return null;
  const terms = fit.model.terms.filter(t => !t.block);
  if (!terms.every(t => t.comps.length === 1 && !t.comps[0].I && !t.comps[0].pow)) return null;       // main effects only
  const main = fit.columns.map((c, j) => ({ j, a: fit.assign[j] })).filter(x => x.a >= 0 && !fit.model.terms[x.a].block);
  let flagged;
  if (fit.dfRes >= 1) flagged = main.filter(x => fit.p[x.j] < alpha);
  else {
    const eff = main.map(x => 2 * fit.coef[x.j]);
    if (eff.length < 3) return null;
    const L = lenth(eff, { alpha });
    flagged = main.filter((_, i) => L.active[i]);
  }
  const active = [...new Set(flagged.map(x => fit.model.terms[x.a].label))];
  if (active.length < 2 || active.length > 4) return null;
  const facs = active.map(id => study.factors.find(f => f.id === id));
  if (facs.some(f => !f || (f.type === 'categorical' && f.levels.length > 2))) return null;
  const quad = kind === 'definitive-screening';
  const squares = quad ? facs.filter(f => f.type === 'continuous').map(f => `I(${f.id}^2)`) : [];
  const formula = `${fit.response} ~ (${active.join(' + ')})^2${squares.length ? ` + ${squares.join(' + ')}` : ''}`;
  let g;
  try { g = refit(formula); } catch { return null; }
  if (g.aliased.length || !(g.dfRes >= 1)) return null;
  const cols = active.map(id => study.factors.findIndex(f => f.id === id));
  const X = study.design.runs.filter(r => r.kind !== 'confirm').map(r => cols.map(j => { const f = study.factors[j]; return f.type === 'categorical' ? (r.settings[f.id] === f.levels[0] ? -1 : 1) : (r.settings[f.id] === f.low ? -1 : r.settings[f.id] === f.high ? 1 : 0); }));
  const two = X.filter(r => r.every(v => v === 1 || v === -1));
  return { active, formula, kind: quad ? 'quadratic' : '2fi', dfRes: g.dfRes, full: !quad && two.length > 0 && fullIn(two, active.map((_, a) => a)) };
}
