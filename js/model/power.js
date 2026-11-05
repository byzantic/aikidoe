// Power of a design for the terms of a model (spec §6.4, issue #12).
//
// Each column of the model matrix X is given an anticipated coefficient b = Δ/2 (Δ: the change
// in the response from the low to the high setting, the "effect"; per term or for all), and σ is
// the run-to-run standard deviation. With V = (XᵀX)⁻¹ and S the columns of a term,
//
//   λ = bₛᵀ (V_SS)⁻¹ bₛ / σ²,   power = P(F'(|S|, N − rank, λ) > F_{1−α}(|S|, N − rank))
//
// for the term's F test ("effect power"), and the same with S = {j} for each coefficient's
// t test ("parameter power"; the two-sided t test with non-centrality b/(σ√V_jj) is exactly
// the F test with df1 = 1). This is the convention of skpr (effectsize = Δ/σ, default 2) and,
// for a single two-level factor, of the two-sample t test. Categorical factors use the effect
// coding of formula.js; b = Δ/2 on each of their columns.
//
// σ: give the process σ (from earlier data, or a measurement-system study when #17 lands);
// Δ and σ enter only through Δ/σ.
import { qr } from '../linalg.js';
import { fDist, ncf } from '../dist.js';
import { parseFormula, modelMatrix } from './formula.js';
import { decode } from '../study.js';

/**
 * Power from a model matrix mm = { X, columns, assign, model } (formula.js).
 * opts: delta (number, or { termLabel: Δ } with default 2), sigma (1), alpha (0.05),
 * coef (optional anticipated coefficient per column, overriding Δ/2).
 * Returns { n, rank, dfRes, terms: [{ term, df, lambda, power }], parameters: [{ name, term, lambda, power }] }.
 * Terms that are not estimable, nuisance (block) terms and, with dfRes = 0, everything get power NaN.
 */
export function powerFromMatrix(mm, { delta = 2, sigma = 1, alpha = 0.05, coef } = {}) {
  const { X, columns, assign, model } = mm;
  if (!(sigma > 0)) throw new Error('σ must be positive');
  if (!(alpha > 0 && alpha < 1)) throw new Error('α must be between 0 and 1');
  const n = X.length, f = qr(X), rank = f.rank, dfRes = n - rank;
  const V = f.unscaledCov();
  const aliased = new Set(f.aliased);
  const deltaOf = (label) => (typeof delta === 'number' ? delta : delta[label] ?? delta.default ?? 2);
  const b = columns.map((_, j) => (coef ? coef[j] : assign[j] < 0 ? 0 : deltaOf(model.terms[assign[j]].label) / 2) / sigma);
  const pw = (S) => {
    if (dfRes < 1 || S.some(j => aliased.has(j))) return { lambda: NaN, power: NaN };
    const bs = S.map(j => b[j]);
    // λ = bᵀ (V_SS)⁻¹ b via a small solve
    const A = S.map(i => S.map(j => V[i][j]));
    const x = solveSym(A, bs);
    const lambda = bs.reduce((s, v, i) => s + v * x[i], 0);
    const crit = fDist.isf(alpha, S.length, dfRes);
    return { lambda, power: ncf.sf(crit, S.length, dfRes, lambda) };
  };
  const terms = model.terms.map((t, ti) => {
    const S = columns.map((_, j) => j).filter(j => assign[j] === ti);
    return { term: t.label, df: S.length, delta: deltaOf(t.label), ...(t.block ? { lambda: NaN, power: NaN, block: true } : pw(S)) };
  });
  // coefficients other than the intercept (whose "power" against zero means nothing here)
  const parameters = columns.map((name, j) => ({ j, name })).filter(c => assign[c.j] >= 0)
    .map(({ j, name }) => ({ name, term: model.terms[assign[j]].label, ...(model.terms[assign[j]].block ? { lambda: NaN, power: NaN } : pw([j])) }));
  return { n, rank, dfRes, alpha, sigma, terms, parameters };
}

// small symmetric positive definite solve (Gaussian elimination with partial pivoting)
function solveSym(A, b) {
  const m = A.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < m; c++) {
    let p = c; for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < m; r++) { const k = M[r][c] / M[c][c]; for (let q = c; q <= m; q++) M[r][q] -= k * M[c][q]; }
  }
  const x = new Array(m).fill(0);
  for (let r = m - 1; r >= 0; r--) { let s = M[r][m]; for (let q = r + 1; q < m; q++) s -= M[r][q] * x[q]; x[r] = s / M[r][r]; }
  return x;
}

/**
 * Natural settings for coded rows (factorial.js convention: coded values for continuous factors,
 * ±1 for a two-level categorical factor, level index otherwise).
 */
export function codedToSettings(factors, X) {
  return X.map(r => Object.fromEntries(factors.map((f, j) => [f.id,
    f.type === 'categorical' ? (f.levels.length === 2 && (r[j] === -1 || r[j] === 1) ? f.levels[r[j] < 0 ? 0 : 1] : f.levels[r[j]]) : decode(f, r[j])])));
}

// model with a Block pseudo-factor first when there are several blocks (as fitModel does)
function withBlocks(model, factors, settings, block) {
  const labels = block ? [...new Set(block.map(String))].sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b)) : [];
  if (labels.length < 2) return { model, factors, settings };
  const id = factors.some(f => f.id === 'Block') ? '.block' : 'Block';
  return {
    model: { ...model, terms: [{ label: id, comps: [{ f: id }], degree: 1, block: true }, ...model.terms] },
    factors: [...factors, { id, name: 'Block', type: 'categorical', levels: labels, block: true }],
    settings: settings.map((s, i) => ({ ...s, [id]: String(block[i]) })),
  };
}

/**
 * Power of a design given in coded units (X as factorial.js returns it, optional block per row)
 * for a model formula over the study's factors. opts as powerFromMatrix, plus model ('main').
 */
export function designPower(study, X, { model = 'main', block, ...opts } = {}) {
  const parsed = parseFormula(model, study.factors);
  const m = withBlocks(parsed, study.factors, codedToSettings(study.factors, X), block);
  return { model: parsed, ...powerFromMatrix(modelMatrix(m.model, m.factors, m.settings), opts) };
}

/** Power of the study's design (confirmation runs excluded; blocks fitted as fixed effects). */
export function studyPower(study, { model = 'main', ...opts } = {}) {
  if (!study.design) throw new Error('the study has no design yet');
  const runs = study.design.runs.filter(r => r.kind !== 'confirm');
  const parsed = parseFormula(model, study.factors);
  const m = withBlocks(parsed, study.factors, runs.map(r => r.settings), runs.some(r => r.block !== undefined) ? runs.map(r => r.block ?? '') : null);
  return { model: parsed, ...powerFromMatrix(modelMatrix(m.model, m.factors, m.settings), opts) };
}

/**
 * Smallest effect Δ detectable with the given power, for each term of a power result (from
 * powerFromMatrix, designPower or studyPower), in the response's units (σ as in that result).
 * λ scales with Δ², so Δ = Δ_used · √(λ_needed / λ_used). Returns [{ term, delta, ratio }],
 * ratio = Δ/σ.
 */
export function detectableEffect(result, { power = 0.8 } = {}) {
  if (!(power > result.alpha && power < 1)) throw new Error(`target power must be between α (${result.alpha}) and 1`);
  return result.terms.filter(t => !t.block).map(t => {
    if (!Number.isFinite(t.lambda) || !(t.lambda > 0)) return { term: t.term, delta: NaN, ratio: NaN };
    const crit = fDist.isf(result.alpha, t.df, result.dfRes), f = (lam) => ncf.sf(crit, t.df, result.dfRes, lam);
    let lo = 0, hi = 1;
    while (f(hi) < power && hi < 1e8) { lo = hi; hi *= 2; }
    for (let k = 0; k < 200 && hi - lo > 1e-13 * hi; k++) { const mid = (lo + hi) / 2; if (f(mid) < power) lo = mid; else hi = mid; }
    const delta = t.delta * Math.sqrt(((lo + hi) / 2) / t.lambda);
    return { term: t.term, delta, ratio: delta / result.sigma };
  });
}
