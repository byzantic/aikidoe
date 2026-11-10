// Design candidates and the recommender (spec §12, §16.3; issue #37). Shared by the UI's Design
// step and `doe recommend`.
//
// candidates(study) lists the designs available for the study's factors; recommend() builds each,
// measures it against the goal's model — estimability, run count against the budget, resolution,
// D-efficiency, and the power of every term at an effect of Δ = 2σ — and ranks them with reasons.
import { num } from '../format.js';
import { code } from '../study.js';
import { fullFactorial, fractionalFactorial, toStudyDesign } from './factorial.js';
import { plackettBurman, PB_RUNS } from './pb.js';
import { ccd, boxBehnken } from './rsm.js';
import { CATALOGUE } from './catalogue.js';
import { definitiveScreening, dsdOrder } from './dsd.js';
import { projectivity, generalisedResolution, estimableProjections } from './projectivity.js';
import { optimalDesign, diagnoseCoded, compileModel } from './optimal.js';
import { splitPlotFraction, splitPlotFull, optimalSplitPlot } from './splitplot.js';
import { lhsDesign } from '../sim/surrogate.js';
import { studyPower } from '../model/power.js';
import { parseFormula } from '../model/formula.js';

/** Whole-plot choices for a split-plot fraction of N runs: 2^q1 plots with room for the factors. */
export function wholePlotChoices(k1, k2, N) {
  const out = [];
  for (let W = 2; W < N; W *= 2) if (k1 <= W - 1 && k2 <= N - W) out.push(W);
  return out;
}
export const defaultWholePlots = (k1, k2, N) => { const c = wholePlotChoices(k1, k2, N); return c.find(W => W >= 2 ** k1) ?? c[c.length - 1]; };

const levelsOf = (f) => f.map(x => (x.type === 'categorical' ? x.levels.length : x.levels ? x.levels.length : 2));

/**
 * The Plackett–Burman sizes worth offering for k factors (issue #79): every N > k up to the budget,
 * or the next two without one (at least the smallest). Not 16 (projectivity 2, no better than the
 * regular 16-run fraction) nor the stored 40 for 39 factors (its 39th column brings P down to 2:
 * 44 runs instead).
 */
export function pbSizes(k, { budget } = {}) {
  const ok = PB_RUNS.filter(N => N > k && N !== 16 && !(N === 40 && k === 39));
  if (!ok.length) return [];
  return budget !== undefined ? [ok[0], ...ok.slice(1).filter(N => N <= budget)] : ok.slice(0, 2);
}

/** Candidate designs for a study's factors: [{ id, kind, label, runs, note, res, gres?, opts }]. opts.budget: PB sizes up to it. */
export function candidates(study, { budget } = {}) {
  const f = study.factors, k = f.length;
  const allCont = f.every(x => x.type === 'continuous');
  const twoLevel = f.every(x => x.type === 'continuous' || x.levels.length === 2);
  const levels = levelsOf(f);
  const out = [];
  const full = levels.reduce((a, b) => a * b, 1);
  if (full <= 4096) out.push({ id: 'full', kind: 'full', label: 'Full factorial', runs: full, note: levels.every(m => m === 2) ? 'all effects estimable' : `mixed-level ${levels.join('×')}`, res: Infinity });
  if (twoLevel && k >= 3) for (let q = Math.ceil(Math.log2(k + 1)); q < k && q <= 7; q++) {
    const e = CATALOGUE[`${k}-${k - q}`];
    if (e) out.push({ id: `frac-${1 << q}`, kind: 'fraction', label: `2^(${k}−${k - q}) fraction`, runs: 1 << q, res: e.resolution,
      note: e.resolution >= 5 ? 'main effects and 2fis clear' : e.resolution === 4 ? 'main effects clear of 2fis; 2fis aliased in pairs' : 'main effects aliased with 2fis (screening)', opts: { runs: 1 << q } });
  }
  if (twoLevel && k >= 2) for (const N of pbSizes(k, { budget })) {
    const gr = generalisedResolution(plackettBurman(k, { runs: N }).X, { max: 4 });
    out.push({ id: `pb-${N}`, kind: 'pb', label: `Plackett–Burman ${N}`, runs: N, res: null, gres: Number.isFinite(gr.resolution) ? gr.resolution : null, note: 'main effects; 2fis partially aliased (spread out, not confounded); any 3 factors form a full 2³', opts: { runs: N } });
  }
  if (allCont && k >= 2 && k <= 8) {
    const cube = { 5: 16, 6: 32, 7: 64, 8: 64 }[k] ?? 2 ** k;
    const d = ccd(k, { cubeRuns: cube });
    out.push({ id: 'ccd', kind: 'ccd', label: 'Central composite', runs: d.X.length, note: `rotatable, α = ${num(d.params.alpha, 4)}; full quadratic`, opts: { cubeRuns: cube } });
  }
  if (allCont && k >= 3 && k <= 7) out.push({ id: 'bbd', kind: 'bbd', label: 'Box–Behnken', runs: boxBehnken(k).X.length, note: 'three levels, no corner points; full quadratic' });
  if (twoLevel && k >= 3 && dsdOrder(k) && f.some(x => x.type === 'continuous')) {
    const cats = f.map((x, j) => (x.type === 'categorical' ? j : -1)).filter(j => j >= 0);
    out.push({ id: 'dsd', kind: 'dsd', label: 'Definitive screening', runs: definitiveScreening(k, { categorical: cats }).X.length, note: 'three levels; main effects clear of 2fis and curvature' });
  }
  const sorted = out.sort((a, b) => a.runs - b.runs);
  // computer experiments (§10): a space-filling design for a simulator, listed first when the study has one
  if (allCont) { const lhs = { id: 'lhs', kind: 'lhs', label: 'Latin hypercube (space-filling)', runs: Math.max(10 * k, (k + 1) * (k + 2) / 2 + 5), note: 'for a simulator: maximin; surrogate model fitted afterwards' }; if (study.simulator) sorted.unshift(lhs); else sorted.push(lhs); }
  sorted.push({ id: 'optimal', kind: 'optimal', label: 'Optimal (custom)', runs: null, note: 'D-, I- or A-optimal for a model you choose; respects constraints' });
  const htc = f.map(x => !!x.htc), k1 = htc.filter(Boolean).length;
  if (!k1 || k1 === k) return sorted;
  // hard-to-change factors: factorial designs become split-plots; the others ignore the restriction
  const sp = [];
  for (const c of sorted) {
    if (c.kind === 'full') sp.push({ ...c, id: 'sp-full', kind: 'sp-full', label: 'Split-plot full factorial', note: `${new Set(fullFactorial(levels).X.map(r => r.filter((_, j) => htc[j]).join())).size} whole plots; ${c.note}` });
    else if (c.kind === 'fraction') {
      const W = defaultWholePlots(k1, k - k1, c.runs);
      if (!W) continue;
      let res = null; try { res = splitPlotFraction(htc, { runs: c.runs, wholePlots: W }).params.resolution; } catch { continue; }
      sp.push({ ...c, id: `sp-frac-${c.runs}`, kind: 'sp-frac', label: `Split-plot 2^(${k}−${k - Math.log2(c.runs)}) fraction`, res, note: `${W} whole plots by default; whole-plot factors constant within each` });
    } else if (c.kind === 'optimal') sp.push({ id: 'sp-optimal', kind: 'sp-optimal', label: 'Optimal split-plot', runs: null, note: 'D-optimal for your model, number of whole plots and assumed variance ratio η' });
    else sp.push({ ...c, note: `${c.note}; ignores hard-to-change factors (completely randomised)`, ignoresHtc: true });
  }
  return sp;
}

/**
 * The design object for a candidate and options (the UI's option names). Optimal designs are
 * searched here only when opts.search is set (the UI runs them in a worker): { runs, model,
 * criterion, restarts, wholePlots, eta }.
 */
export function buildCandidate(study, cand, o = {}) {
  const cont = study.factors.map(x => x.type === 'continuous');
  const common = { centre: o.centre || 0, replicates: o.replicates || 1, continuous: cont, ...(o.blocks > 1 ? { blocks: o.blocks } : {}) };
  switch (cand.kind) {
    case 'full': return fullFactorial(levelsOf(study.factors), common);
    case 'fraction': return fractionalFactorial(study.factors.length, { runs: cand.opts.runs, ...common });
    case 'pb': return plackettBurman(study.factors.length, { runs: cand.opts.runs });
    case 'ccd': return ccd(study.factors.length, { cubeRuns: cand.opts.cubeRuns, alpha: o.alpha === 'number' ? Number(o.alphaValue) : o.alpha || undefined,
      inscribed: !!o.inscribed, ...(o.rsmBlocks ? { blocks: true } : {}), ...(o.centre !== '' && o.centre !== undefined ? { centre: o.rsmBlocks ? [Number(o.centre), Number(o.centreAxial ?? o.centre)] : Number(o.centre) } : {}) });
    case 'bbd': return boxBehnken(study.factors.length, { centre: o.centre === '' || o.centre === undefined ? 3 : Number(o.centre), blocks: !!o.rsmBlocks });
    case 'dsd': return definitiveScreening(study.factors.length, { ...(o.fake !== undefined ? { fake: o.fake } : {}), centre: o.centre === '' || o.centre === undefined ? 1 : Number(o.centre),
      categorical: study.factors.map((x, j) => (x.type === 'categorical' ? j : -1)).filter(j => j >= 0) });
    case 'sp-full': return splitPlotFull(levelsOf(study.factors), study.factors.map(x => !!x.htc), { replicates: o.replicates || 1 });
    case 'sp-frac': {
      const htc = study.factors.map(x => !!x.htc), k1 = htc.filter(Boolean).length;
      return splitPlotFraction(htc, { runs: cand.opts.runs, wholePlots: o.wholePlots ?? defaultWholePlots(k1, htc.length - k1, cand.opts.runs), replicates: o.replicates || 1, names: study.factors.map(x => x.id) });
    }
    case 'lhs': return lhsDesign(study, { runs: o.lhsRuns ?? cand.runs, seed: (o.seed ?? study.seed) >>> 0 });
    case 'optimal':
      if (!o.search) return null;
      return optimalDesign(study, { runs: o.search.runs, model: o.search.model, criterion: o.search.criterion ?? 'D', restarts: o.search.restarts ?? 8, seed: o.seed ?? study.seed });
    case 'sp-optimal':
      if (!o.search) return null;
      return optimalSplitPlot(study, { runs: o.search.runs, wholePlots: o.search.wholePlots, model: o.search.model, eta: o.search.eta ?? 1, restarts: o.search.restarts ?? 8, seed: o.seed ?? study.seed });
  }
  throw new Error(`unknown design ${cand.kind}`);
}

/** The model a design is meant for (a starting point for its power table). */
export function intendedModel(study, d) {
  if (d.kind === 'optimal' || d.kind === 'optimal-split-plot') return d.params.model;
  if (d.kind === 'ccd' || d.kind === 'box-behnken' || d.kind === 'lhs') return 'quadratic';
  if (d.params.resolution >= 5) return '2fi';
  if (d.kind === 'full-factorial' || d.kind === 'split-plot-full') {
    const k = study.factors.length;
    return d.X.length > 1 + k + k * (k - 1) / 2 ? '2fi' : 'main';
  }
  return 'main';
}

export const GOALS = {
  screen: { model: 'main', what: 'find the active factors (main effects)' },
  model: { model: '2fi', what: 'estimate main effects and two-factor interactions' },
  optimise: { model: 'quadratic', what: 'fit a full quadratic to find an optimum' },
};

/** The model for a goal, given the factors (no quadratic terms for categorical-only studies). */
export function goalModel(study, goal) {
  if (goal === 'optimise' && !study.factors.some(f => f.type === 'continuous')) return '2fi';
  return GOALS[goal].model;
}

/**
 * Ranked design options for the study. opts: goal ('screen' | 'model' | 'optimise'; default:
 * screen for ≥ 5 factors, else model), budget (max runs), delta (effect in σ, default 2), alpha,
 * eta (whole-plot variance ratio for split-plots, default 1), optimal (search an optimal design
 * for the goal's model, default true; its run count: the budget, else p + 6), restarts (8).
 * Returns { goal, model, budget, options: [{ rank, id, kind, label, runs, wholePlots?, resolution,
 *   dEfficiency, minPower, estimable, withinBudget, reasons: [..], warnings: [..], note }] }.
 */
export function recommend(study, { goal, budget, delta = 2, alpha = 0.05, eta = 1, optimal = true, restarts = 8, counts } = {}) {
  const k = study.factors.length;
  goal ??= k >= 5 ? 'screen' : 'model';
  if (!GOALS[goal]) throw new Error(`goal must be screen, model or optimise, not "${goal}"`);
  if (budget !== undefined && !(Number.isInteger(budget) && budget > 0)) throw new Error('the budget must be a positive whole number of runs');
  const model = goalModel(study, goal);
  const p = compileModel(parseFormula(model, study.factors), study.factors).p;
  const options = [];
  for (const c of candidates(study, { budget })) {
    if (c.kind === 'lhs' && !study.simulator) continue;                       // physical experiments: not space-filling
    let d;
    try {
      if (c.kind === 'optimal' || c.kind === 'sp-optimal') {
        if (!optimal) continue;
        const runs = budget ?? p + 6;
        if (runs < p) { options.push(entry(c, null, { runs, estimable: false, reasons: [], warnings: [`${runs} runs cannot estimate the ${p} terms of ${model}`] })); continue; }
        const htc = study.factors.filter(f => f.htc).length;
        const W = c.kind === 'sp-optimal' ? Math.max(htc + 2, Math.min(Math.floor(runs / 2), 2 ** htc + 2)) : undefined;
        d = buildCandidate(study, c, { search: { runs: c.kind === 'sp-optimal' ? W * Math.max(2, Math.floor(runs / W)) : runs, model, restarts, wholePlots: W, eta } });
      } else if (c.kind === 'sp-full') {
        // whole plots need replicating for a whole-plot error: as many replicates as the budget allows
        const reps = budget ? Math.max(1, Math.floor(budget / c.runs)) : 2;
        d = buildCandidate(study, c, { replicates: reps });
      } else d = buildCandidate(study, c, {});
    } catch (e) { options.push(entry(c, null, { runs: c.runs, estimable: false, reasons: [], warnings: [e.message] })); continue; }
    options.push(assess(study, c, d, { model, goal, budget, delta, alpha, eta, p, counts }));
  }
  // rank: estimable and within budget first (designs that ignore hard-to-change factors after those
  // that respect them); then adequate power (fewest runs first; below 0.8, most
  // power first);
  // then projectivity (issue #79: more of the design left when few factors turn out active), then efficiency
  const score = (o) => { const ok = o.minPower >= 0.8; return [o.estimable && o.withinBudget ? (o.ignoresHtc ? 1 : 0) : o.estimable ? 2 : 3, ok ? 0 : o.minPower === null ? 2 : 1, !o.estimable ? 0 : ok ? o.runs : -(o.minPower ?? 0), -(o.projectivity ?? 0), -(o.dEfficiency ?? 0)]; };
  options.sort((a, b) => { const x = score(a), y = score(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; });
  options.forEach((o, i) => { o.rank = o.estimable ? i + 1 : null; });
  return { goal, goalText: GOALS[goal].what, model, terms: p, budget: budget ?? null, delta, alpha, ...(counts ? { counts } : {}), options };
}

function entry(c, d, extra) {
  return { id: c.id, kind: c.kind, label: c.label, runs: d ? d.X.length : c.runs, note: c.note, resolution: Number.isFinite(c.res) ? c.res : null, ...(c.gres !== undefined ? { generalisedResolution: c.gres } : {}),
    dEfficiency: null, minPower: null, estimable: false, withinBudget: false, ...extra };
}

function assess(study, c, d, { model, goal, budget, delta, alpha, eta, p, counts }) {
  const n = d.X.length, k = study.factors.length;
  const tmp = { ...study, design: toStudyDesign(study, d, { seed: 1, randomise: 'none' }), observations: [] };
  const wholePlots = d.wholePlot ? new Set(d.wholePlot).size : null;
  const reasons = [], warnings = [];
  let pw = null, estimable = n >= p, minPower = null;
  try {
    pw = studyPower(tmp, counts ? { model, alpha, ...counts } : { model, delta, alpha, eta });
    const terms = pw.terms.filter(t => !t.block), cols = pw.parameters.length + 1;
    estimable = pw.rank === cols;
    const tested = terms.filter(t => Number.isFinite(t.power));
    minPower = estimable && tested.length === terms.length ? Math.min(...tested.map(t => t.power)) : null;
    if (!estimable) warnings.push(`cannot estimate ${model}: the runs support ${pw.rank} of its ${cols} coefficients`);
    else if (tested.length < terms.length) {
      const untested = terms.filter(t => !Number.isFinite(t.power)).map(t => t.term);
      warnings.push(pw.dfRes === 0 ? 'saturated: no residual degrees of freedom, so no test without pooling, Lenth or replication'
        : `no degrees of freedom to test ${untested.slice(0, 4).join(', ')}${untested.length > 4 ? ' …' : ''} (too few whole plots)`);
    }
  } catch (e) { estimable = false; warnings.push(e.message); }
  // D-efficiency for the goal's model, from the coded runs
  let dEff = null;
  if (estimable) {
    try {
      const X = tmp.design.runs.map(r => study.factors.map(f => (f.type === 'categorical' ? (f.levels.length === 2 ? (r.settings[f.id] === f.levels[0] ? -1 : 1) : f.levels.indexOf(r.settings[f.id])) : code(f, r.settings[f.id]))));
      dEff = diagnoseCoded(study, X, { model }).dEfficiency;
    } catch { /* not available for this model */ }
  }
  const res = d.params?.resolution ?? (Number.isFinite(c.res) ? c.res : null);
  const within = budget === undefined || n <= budget;
  // projection (issue #79): two-level designs, P; definitive screening, the quadratic in any 3 factors
  const twoLevel = study.factors.every(f => f.type === 'continuous' || f.levels.length === 2);
  // (a full factorial: k; a regular fraction: R − 1, from its resolution; otherwise measured, up to 4)
  const fullF = c.kind === 'full' || c.kind === 'sp-full', regular = (c.kind === 'fraction' || c.kind === 'sp-frac') && Number.isFinite(res);
  const proj = twoLevel && !fullF && !regular && ['pb', 'optimal', 'sp-optimal'].includes(c.kind) ? projectivity(d.X, { max: 4 }) : null;
  const P = !twoLevel ? null : fullF ? k : regular ? Math.min(k, res - 1) : proj?.P ?? null;
  const contCols = study.factors.map((f, j) => (f.type === 'continuous' ? j : -1)).filter(j => j >= 0);
  const q3 = c.kind === 'dsd' && contCols.length >= 3 ? estimableProjections(d.X, 3, { model: 'quadratic', columns: contCols }) : null;
  if (estimable) {
    reasons.push(`estimates ${model === 'main' ? 'every main effect' : model === '2fi' ? 'main effects and all two-factor interactions' : 'the full quadratic'} (${p} terms) in ${n} runs`);
    if (res && res !== Infinity) reasons.push(res >= 5 ? 'resolution V: main effects and 2fis clear of each other' : res === 4 ? 'resolution IV: main effects clear of 2fis, 2fis aliased in pairs' : 'resolution III: main effects aliased with 2fis — a screening design; follow up with a fold-over');
    if (c.kind === 'pb' && c.gres !== null) reasons.push(`2fis partially aliased with main effects (spread out, not confounded; generalised resolution ${num(c.gres, 3)})`);
    if (P !== null && P >= 2 && P < k) reasons.push(`projectivity ${P}${proj?.capped ? ' or more' : ''}: any ${P} factors form a full 2${P === 2 ? '²' : P === 3 ? '³' : '⁴'}${P === 3 && c.kind === 'pb' ? ' (and any 4 support main effects and their 2fis)' : ''} — if only that many matter, their interactions come from these runs`);
    if (c.kind === 'dsd') {
      reasons.push('main effects clear of 2fis and quadratic terms');
      if (q3) (q3.share === 1 ? reasons : warnings).push(q3.share === 1 ? 'the full quadratic in any 3 factors can be fitted from these runs' : `the full quadratic in ${q3.estimable ? `only ${q3.estimable} of ${q3.total}` : 'none'} of the 3-factor sets can be fitted${k <= 4 ? `: ${6 - k} fake factors (13 runs, the default) make it all of them` : ''}`);
    }
    if (c.kind === 'ccd' || c.kind === 'bbd') reasons.push(c.kind === 'ccd' ? 'rotatable: equal precision at equal distance from the centre' : 'three levels and no corner runs (avoids extreme combinations)');
    const at = counts ? `a ${String(counts.distribution).includes('binomial') || counts.distribution === 'bernoulli' ? 'odds' : 'rate'} ratio of ${counts.ratio} (baseline ${counts.baseline})` : `Δ = ${delta}σ`;
    if (minPower !== null) (minPower >= 0.8 ? reasons : warnings).push(`power ${minPower >= 0.8 ? '≥' : '<'} 0.8 for ${minPower >= 0.8 ? 'every term' : 'some terms'} at ${at} (smallest ${num(minPower, 2)})`);
    if (wholePlots) reasons.push(`${wholePlots} whole plots: hard-to-change factors reset ${wholePlots} times (power assumes η = σ²_wp/σ² = ${eta})`);
    if (c.ignoresHtc) warnings.push('ignores the hard-to-change factors: they must be reset for every run');
    if (pw && pw.dfRes > 0 && pw.dfRes < 3 && !wholePlots && !(counts && !String(counts.distribution).startsWith('quasi'))) warnings.push(`only ${pw.dfRes} residual df: replicate or add centre points for a better σ estimate`);
  }
  if (budget !== undefined && estimable) (within ? reasons : warnings).push(within ? `fits the budget (${n} of ${budget} runs)` : `over budget: ${n} runs, budget ${budget}`);
  if (goal === 'screen' && (c.kind === 'ccd' || c.kind === 'bbd')) warnings.push('a response-surface design: more than screening needs');
  if (c.kind === 'full' && n > 64 && goal !== 'optimise') warnings.push('large: a fraction would answer the same question in fewer runs');
  return { id: c.id, kind: c.kind, label: c.label, runs: n, ...(wholePlots ? { wholePlots } : {}), ...(c.ignoresHtc ? { ignoresHtc: true } : {}), note: c.note, resolution: res === Infinity ? null : res,
    ...(c.gres !== undefined ? { generalisedResolution: c.gres } : {}), projectivity: P, ...(proj?.capped ? { projectivityCapped: true } : {}), ...(proj?.next ? { projectivityNext: { size: proj.next.size, share: proj.next.share } } : {}), ...(q3 ? { quadratic3: q3.share } : {}),
    dEfficiency: dEff, minPower, estimable, withinBudget: within, reasons, warnings };
}
