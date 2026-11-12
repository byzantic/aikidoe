// Exercises (spec §16.2, issue #38): generateExercise → a scenario, a study without a design, a
// run budget, questions and a sealed truth; reference and one-factor-at-a-time strategies; the
// grader. Every exercise is reproducible from (topic, difficulty, seed).
import { createStudy, decode, code, FORMAT_VERSION } from '../study.js';
import { rng } from '../design/rng.js';
import { fullFactorial, fractionalFactorial, toStudyDesign } from '../design/factorial.js';
import { splitPlotFull } from '../design/splitplot.js';
import { ccd } from '../design/rsm.js';
import { appendStage } from '../design/augment.js';
import { layoutPlates } from '../design/plate-layout.js';
import { doseDesign, addDoseStage, doseData } from '../design/dose-design.js';
import { mixtureDesign, optimiseMixture, randomBlend, coxBlend, coxRange, referenceBlend, mixtureCandidates } from '../design/mixture.js';
import { fitDose, effectiveDose, relativePotency, dilutionSeries, potencyPower, MODELS as DOSE } from '../model/dose.js';
import { foldover } from '../design/augment.js';
import { fitModel, predict } from '../model/fit.js';
import { glmConfint } from '../model/glm.js';
import { fitMixedModel } from '../model/mixed.js';
import { studentT, nct } from '../dist.js';
import { completeBlocks } from '../design/comparative.js';
import { pathStage, pathResults, nextStudy } from '../model/path.js';
import { compareLevels } from '../model/compare.js';
import { qmvtBox } from '../mvt.js';
import { solve as solveLin } from '../linalg.js';
import { studyPower, studyGlmPower } from '../model/power.js';
import { SCENARIOS } from './scenarios.js';
import { runVirtual, trueMean, hashNormal as hn } from './process.js';

export const EXERCISE_FORMAT = 'aikidoe-exercise/1';
export const DIFFICULTIES = { easy: 4, medium: 3, hard: 2.4 };   // smallest active effect, in σ (low → high)
// counts topic: the range the active factors' ratios (low → high) are drawn from, and the
// variation beyond Poisson or binomial (θ of the negative binomial; σ on the logit scale)
// (proportions: odds ratios, larger, so that some conditions come close to 0 or 100 %)
export const COUNT_DIFFICULTIES = {
  easy: { ratio: [1.8, 2.6], odds: [3, 6], theta: null, sigma: 0 },
  medium: { ratio: [1.5, 2.2], odds: [2.5, 5], theta: [20, 50], sigma: 0.2 },
  hard: { ratio: [1.4, 1.9], odds: [2, 4], theta: [12, 30], sigma: 0.3 },
};
const isProportion = (d) => d === 'binomial' || d === 'quasibinomial' || d === 'bernoulli';

/**
 * Topics: factors, budget, which factors are active, nuisance, questions, and the reference
 * strategy's design. k may depend on difficulty.
 */
export const TOPICS = {
  factorial: { title: 'Full factorial: effects and interactions', lesson: 2, k: () => 3, budget: 16, active: () => 2, interaction: 0.7,
    questions: ['active', 'effects', 'best'] },
  fraction: { title: 'Fractional factorial and fold-over', lesson: 4, k: () => 5, budget: 16, active: (g) => 2 + g.int(2), interaction: 0.6,
    questions: ['active', 'effects'] },
  screening: { title: 'Screening many factors', lesson: 5, k: (d) => (d === 'easy' ? 6 : 7), budget: 16, active: (g) => 2 + g.int(2), interaction: 0.6,
    questions: ['active', 'effects'] },
  blocking: { title: 'Blocking: day-to-day shifts', lesson: 6, k: () => 4, budget: 16, active: () => 2, interaction: 0.5,
    nuisance: (sigma) => ({ day: { runs: 8, sd: 3 * sigma } }), questions: ['active', 'effects'] },
  rsm: { title: 'Response surface: finding an optimum', lesson: 7, k: (d) => (d === 'easy' ? 2 : 3), budget: (k) => (k === 2 ? 16 : 24), curvature: true,
    questions: ['active', 'best', 'prediction'] },
  'split-plot': { title: 'A hard-to-change factor', lesson: 10, k: () => 3, budget: 24, active: () => 2, htc: true, interaction: 0.5,
    nuisance: (sigma) => ({ reset: 0.8 * sigma }), questions: ['active', 'effects'] },
  // runs in the wells of a 96-well plate (issue #63): the outer ring and corners read low, a bow and
  // a gradient across the columns, and each row has its own offset (a multichannel pipette)
  // dose–response (issue #65): two curves, a reference and a test; the EC50 of the test and its
  // potency relative to the reference
  // mixtures (issue #62): three components adding up to a total, with bounds; the best blend and a
  // prediction at a check blend
  mixture: { title: 'Mixtures: the best blend', lesson: 16, mixture: true, k: () => 3, budget: 14, questions: ['best', 'prediction'] },
  dose: { title: 'Dose–response: EC50 and relative potency', lesson: 15, dose: true, k: () => 2, budget: 48, questions: ['ec50', 'potency'] },
  // counts and proportions (issue #64): colonies per plate (Poisson or negative binomial, with the
  // volume plated as the exposure) or seeds germinated out of 50 (binomial, extra-binomial
  // variation when harder); the active factors and their rate or odds ratios
  counts: { title: 'Counts and percentages', lesson: 17, counts: true, k: (d) => (d === 'easy' ? 3 : 4), budget: (k) => (k === 3 ? 16 : 32), active: (g) => 2 + g.int(2), interaction: 0.5,
    questions: ['active', 'ratios'] },
  // moving to a better region (issue #81): two factors around today's settings, the optimum well
  // outside their ranges but within the operating limits; first design, the path of steepest
  // ascent, then a response surface where the path peaked; the best settings within the limits
  ascent: { title: 'Moving to a better region', lesson: 19, ascent: true, k: () => 2, budget: 32, questions: ['best'] },
  // comparing a few treatments (issue #80): one factor, a control and five others, one or two of
  // them better; six runs a day, and days differ; which beat the control, and by how much
  compare: { title: 'Comparing a few treatments', lesson: 18, compare: true, k: () => 1, budget: 30,
    nuisance: (sigma) => ({ day: { runs: 6, sd: 2 * sigma } }), questions: ['better', 'differences'] },
  plate: { title: 'Plates: where a sample sits matters', lesson: 14, k: (d) => (d === 'easy' ? 3 : 4), budget: 48, active: (g) => 2 + g.int(2), interaction: 0.5,
    plate: true, nuisance: (sigma) => ({ plate: { edge: -2 * sigma, corner: -1 * sigma, col: 0.6 * sigma, colQuad: 1.2 * sigma, rowSd: 0.8 * sigma } }),
    questions: ['active', 'effects'] },
};

// ---------------------------------------------------------------- generation

const pick = (g, list, n) => g.shuffle(list.slice()).slice(0, n);

function makeTruth(topic, difficulty, g, factors, response) {
  const T = TOPICS[topic], m = DIFFICULTIES[difficulty], sigma = response.sigma;
  const size = () => (m + (0.5 * m) * g.random()) * sigma / 2;     // a coefficient: half the effect
  const sign = () => (g.random() < 0.5 ? -1 : 1);
  const terms = {};
  const cont = factors.filter(f => f.type !== 'categorical');
  if (T.curvature) {
    // a maximum inside the region: f = −Σ cᵢ (xᵢ − x*ᵢ)² + small interaction
    for (const f of cont) {
      const c = size() * 0.8, xs = (g.random() * 1.2 - 0.6);
      terms[f.id] = 2 * c * xs; terms[`I(${f.id}^2)`] = -c;
    }
    if (cont.length >= 2) terms[`${cont[0].id}:${cont[1].id}`] = sign() * size() * 0.3;
    // and an effect large enough to see: the linear part stays as set by the optimum
  } else {
    const nA = T.active(g);
    // split-plot: the hard-to-change factor is active (a whole-plot effect to test), plus others
    let act = T.htc ? [factors.find(f => f.htc), ...pick(g, factors.filter(f => !f.htc), nA - 1)] : pick(g, factors, nA);
    for (const f of act) terms[f.id] = sign() * size() * (f.htc ? 1.6 : 1);
    if (T.interaction && act.length >= 2 && g.random() < T.interaction) terms[`${act[0].id}:${act[1].id}`] = sign() * size() * 0.9;
  }
  return { intercept: response.base, terms };
}

/** The exercise for (topic, difficulty, seed). */
export function generateExercise({ topic = 'factorial', difficulty = 'medium', seed = 1, scenario } = {}) {
  const T = TOPICS[topic];
  if (!T) throw new Error(`unknown topic "${topic}" (${Object.keys(TOPICS).join(', ')})`);
  if (!DIFFICULTIES[difficulty]) throw new Error(`difficulty must be ${Object.keys(DIFFICULTIES).join(', ')}`);
  seed = seed >>> 0;
  const g0 = rng(seed ^ 0x5eed);
  // plate scenarios belong to the plate topic (and only they have plates), so the other topics'
  // choice of scenario — and their exercises for a given seed — are as before
  const kindOf = (x) => (x.mixture ? 'mixture' : x.dose ? 'dose' : x.plate ? 'plate' : x.counts ? 'counts' : x.compare ? 'compare' : null);
  const pool0 = Object.keys(SCENARIOS).filter(id => kindOf(SCENARIOS[id]) === kindOf(T));
  const scId = scenario ?? pool0[g0.int(pool0.length)];
  const sc = SCENARIOS[scId];
  if (!sc) throw new Error(`unknown scenario "${scId}"`);
  if (kindOf(sc) !== kindOf(T)) throw new Error(kindOf(T) ? `the ${topic} topic needs a ${kindOf(T)} scenario (${pool0.join(', ')})` : `scenario "${scId}" belongs to the ${kindOf(sc)} topic`);
  const k = T.k(difficulty);
  // factors: the hard-to-change one when the topic needs it; continuous for response surfaces
  let pool = sc.factors.filter(f => !f.levels && !f.htc);
  if (topic !== 'rsm' && topic !== 'split-plot' && !T.dose && g0.random() < 0.5) pool = [...pool, sc.factors.find(f => f.levels)];
  let chosen = T.dose || T.mixture || T.compare ? sc.factors : T.ascent ? pick(g0, sc.factors.filter(f => !f.levels && !f.htc), k) : pick(g0, pool, k - (T.htc ? 1 : 0));
  if (T.htc) chosen = [sc.factors.find(f => f.htc), ...chosen];
  const mixture = T.mixture ? { components: chosen.map(f => f.id), total: sc.mixture.total } : undefined;
  const factors = createStudy({ name: 'x', factors: (T.ascent ? ascentFactors(chosen, g0) : chosen).map(f => ({ ...f, htc: !!(T.htc && f.htc) })), ...(mixture ? { mixture } : {}) }).factors;
  const response = { ...sc.response };
  const budget = typeof T.budget === 'function' ? T.budget(k) : T.budget;
  const id = `${topic}-${difficulty}-${seed}`;
  // truths are drawn until the reference strategy, within the budget, resolves one with adequate
  // power and full marks (the solvability check); the attempts are recorded
  let last = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const g = rng((seed * 2654435761 + attempt * 97 + 13) >>> 0);
    const truth = T.ascent ? ascentTruth(difficulty, g, factors, response) : T.compare ? compareTruth(difficulty, g, factors, response, sc.compare.control) : T.dose ? { intercept: 0, terms: {} } : T.mixture ? mixtureTruth(difficulty, g, factors, response, mixture) : T.counts ? countsTruth(topic, difficulty, g, factors, response) : makeTruth(topic, difficulty, g, factors, response);
    const curve = T.dose ? doseTruth(sc.dose, factors, g, difficulty) : null;
    const counted = T.counts ? countNoise(difficulty, g, response) : null;
    const proc = { seed: (seed * 31 + attempt) >>> 0, factors, responses: [{ id: response.id, ...(counted ?? { sigma: response.sigma }), truth, decimals: response.decimals, ...(curve ? { curve } : {}) }],
      nuisance: T.nuisance ? T.nuisance(response.sigma) : {}, ...(sc.plate ? { controls: sc.plate.truth } : {}) };
    const questions = makeQuestions(T.dose ? { ...T, refLabel: factors[1].levels[0], testLabel: factors[1].levels[1] } : T.compare ? { ...T, control: sc.compare.control } : T, factors, response, g, mixture);
    if (T.counts && isProportion(response.distribution)) questions.push(percentQuestion(proc, factors, response));
    const ex = assemble({ id, topic, difficulty, seed, scenario: scId, sc, factors, response, budget, questions, process: proc, attempt, mixture });
    const ref = referenceStrategy(ex, ex.truth);
    const grade = gradeAnswers(ex, ex.truth, ref.answers, { runs: (ref.study.exercise?.previousRuns ?? 0) + ref.study.design.runs.length });
    const power = referencePower(ex, ex.truth, ref.study);
    last = { ex, ref, grade, power };
    if (grade.score === 100 && power >= 0.8) {
      ex.truth.modelAnswer = { strategy: ref.strategy, steps: ref.steps, answers: ref.answers, power };
      return seal(ex);
    }
  }
  throw new Error(`could not generate a solvable ${topic} exercise for seed ${seed} (last: score ${last.grade.score}, power ${last.power.toFixed(2)})`);
}

/**
 * The factors of an ascent exercise: today's ranges narrowed to a fifth of the scenario's (a small
 * window around the centre, as a first experiment around current conditions usually is) and
 * operating limits at the scenario's ranges widened by half their width (not below 0 for a factor
 * whose range starts at or above 0; positive for a log factor).
 */
function ascentFactors(chosen, g) {
  return chosen.map(f => {
    const log = f.transform === 'log', lo0 = f.low, hi0 = f.high;
    const c = log ? Math.sqrt(lo0 * hi0) : (lo0 + hi0) / 2;
    const r = (x) => +x.toPrecision(4);
    if (log) { const w = Math.sqrt(hi0 / lo0) ** 0.2; return { ...f, low: r(c / w), high: r(c * w), limits: { lower: r(lo0 / Math.sqrt(hi0 / lo0) ** 0.5), upper: r(hi0 * Math.sqrt(hi0 / lo0) ** 0.5) } }; }
    const h = (hi0 - lo0) / 10, wide = (hi0 - lo0) / 4;
    return { ...f, low: r(c - h), high: r(c + h), limits: { lower: r(lo0 >= 0 ? Math.max(0, lo0 - wide) : lo0 - wide), upper: r(hi0 + wide) } };
  });
}

/**
 * The true surface of an ascent exercise, in the coded units of today's ranges: a maximum (or a
 * minimum for a response to minimise) at x* = 3 … 5 coded units from the centre in each factor,
 * within the operating limits; curvature c with the slope at the centre, 2c|x*ᵢ|, giving a change
 * of the difficulty's effect size (in σ) over each factor's range; a mild interaction.
 */
function ascentTruth(difficulty, g, factors, response) {
  const m = DIFFICULTIES[difficulty], dir = response.goal === 'minimize' ? -1 : 1;
  const xs = factors.map(f => {
    const lo = code(f, f.limits.lower), hi = code(f, f.limits.upper);
    const room = [hi > 4 ? 1 : null, lo < -4 ? -1 : null].filter(Boolean);
    const sgn = room.length ? room[g.int(room.length)] : (hi >= -lo ? 1 : -1);
    const span = sgn > 0 ? hi : -lo;
    return sgn * Math.min(span * 0.8, 3 + 2 * g.random());
  });
  // slope at the centre: the effect over the range (2 coded units) is m σ, so 2·(2c|x*|) = m σ
  const c = Math.min(...xs.map(x => (m * response.sigma) / (4 * Math.abs(x))));
  const terms = {};
  factors.forEach((f, i) => { terms[f.id] = dir * 2 * c * xs[i]; terms[`I(${f.id}^2)`] = -dir * c; });
  terms[`${factors[0].id}:${factors[1].id}`] = dir * 0.1 * c * (g.random() < 0.5 ? -1 : 1);
  return { intercept: response.base - dir * c * xs.reduce((a, x) => a + x * x, 0), terms, optimum: xs };
}

/**
 * The true means of a compare exercise: the control at the scenario's base, one or two of the
 * others better by the difficulty's effect size (and up to half as much again), the rest the same
 * as the control. Terms: an indicator per better level.
 */
function compareTruth(difficulty, g, factors, response, control) {
  const f = factors[0], m = DIFFICULTIES[difficulty], dir = response.goal === 'minimize' ? -1 : 1;
  const better = pick(g, f.levels.filter(l => String(l) !== String(control)), 1 + g.int(2));
  return { intercept: response.base, terms: Object.fromEntries(better.map(l => [`${f.id}.${l}`, dir * (m + 0.5 * m * g.random()) * response.sigma])) };
}

/**
 * The true model of a counts exercise, on the link scale (log of the mean count per unit exposure,
 * or logit of the proportion): two or three active factors, each with a ratio (low → high) drawn
 * from the difficulty's range, more or less, and perhaps an interaction between two of them.
 */
function countsTruth(topic, difficulty, g, factors, response) {
  const T = TOPICS[topic], [lo, hi] = COUNT_DIFFICULTIES[difficulty][isProportion(response.distribution) ? 'odds' : 'ratio'];
  const size = () => Math.log(lo + (hi - lo) * g.random()) / 2;     // a coefficient: half the log ratio
  const sign = () => (g.random() < 0.5 ? -1 : 1);
  const terms = {}, act = pick(g, factors, T.active(g));
  for (const f of act) terms[f.id] = sign() * size();
  if (T.interaction && act.length >= 2 && g.random() < T.interaction) terms[`${act[0].id}:${act[1].id}`] = sign() * size() * 0.9;
  // a proportion's centre is drawn around the scenario's, so that some conditions come close to 0 or 100 %
  const intercept = isProportion(response.distribution) ? Math.log(response.base / (1 - response.base)) + (g.random() - 0.5) * 1.2 : Math.log(response.base);
  return { intercept, terms };
}

/**
 * Proportions (counts topic): the germination at the corner of the design whose true proportion is
 * nearest 0 or 100 % — where least squares on percentages predicts impossible values.
 */
function percentQuestion(proc, factors, response) {
  const corners = factors.reduce((acc, f) => acc.flatMap(s => (f.type === 'categorical' ? f.levels : [f.low, f.high]).map(v => ({ ...s, [f.id]: v }))), [{}]);
  const p = (s) => trueMean({ ...proc, factors }, response.id, s), edge = (s) => Math.min(p(s), 1 - p(s));
  const at = corners.reduce((a, b) => (edge(b) < edge(a) ? b : a));
  return { id: 'percent', kind: 'percent', settings: at,
    text: `What percentage of ${response.percentOf ?? `the trials succeed`} at ${Object.entries(at).map(([k, v]) => `${k} = ${v}`).join(', ')}, on average? Give a 95 % interval.` };
}

/** The process's count or proportion noise for a counts exercise: distribution, θ or σ, trials, exposure. */
function countNoise(difficulty, g, response) {
  const D = COUNT_DIFFICULTIES[difficulty], between = ([a, b]) => a + (b - a) * g.random();
  if (isProportion(response.distribution)) return { distribution: 'binomial', trials: response.trials, sigma: D.sigma };
  return D.theta ? { distribution: 'negbin', theta: +between(D.theta).toPrecision(3), exposure: response.exposure } : { distribution: 'poisson', exposure: response.exposure };
}

/** The true curves of a dose exercise: reference EC50 and slope drawn from the scenario's ranges, the
 * test's potency 1.5–3.5 × (more or less potent; harder: closer to 1). */
function doseTruth(D, factors, g, difficulty) {
  const lu = ([a, b]) => Math.exp(Math.log(a) + g.random() * (Math.log(b) - Math.log(a)));
  const levels = factors.find(f => f.id === D.curve).levels;
  const lo = { easy: 2, medium: 1.6, hard: 1.35 }[difficulty] ?? 1.6;
  const ratio = lu([lo, 3.5]) ** (g.random() < 0.5 ? 1 : -1);
  const e = lu(D.ec50), b = D.slope[0] + g.random() * (D.slope[1] - D.slope[0]);
  return { model: 'LL.4', dose: D.factor, by: D.curve, params: { b, c: D.c, d: D.d, e }, levels: { [levels[0]]: { e }, [levels[1]]: { e: e / ratio } } };
}

/**
 * The true blending of a mixture exercise: a Scheffé quadratic in pseudo-components — the pure
 * blends spread by about the difficulty's effect size, and one or two pairs blending non-linearly
 * (synergy or antagonism), strong enough that the best blend is usually not a vertex.
 */
function mixtureTruth(difficulty, g, factors, response, mixture) {
  const m = DIFFICULTIES[difficulty], s = response.sigma, terms = {};
  // sizes relative to the region: a pseudo-component may only reach part of 0 … 1 there
  const st = createStudy({ name: 'r', seed: 1, factors, mixture });
  const pts = mixtureCandidates(st).map(x => factors.map((f, i) => (x[i] - f.mix.low) / f.mix.scale));
  const span = (i) => Math.max(...pts.map(z => z[i])) - Math.min(...pts.map(z => z[i]));
  factors.forEach((f, i) => { terms[f.id] = response.base + (g.random() - 0.5) * m * s / Math.max(span(i), 0.2); });
  const pairs = factors.flatMap((a, i) => factors.slice(i + 1).map((b, j) => [a.id, b.id, i, i + 1 + j]));
  const nP = 1 + g.int(2);
  // a pair's blending is only visible as far as z_i·z_j is not linear in the components over the
  // region: its range after removing the linear part
  const allPairs = factors.flatMap((_, i) => factors.slice(i + 1).map((__, j) => [i, i + 1 + j]));
  const curv = (i, j) => {
    // … and of the other pairs' blending: what this pair alone adds over the region
    const X = pts.map(z => [...z, ...allPairs.filter(([a2, b2]) => !(a2 === i && b2 === j)).map(([a2, b2]) => z[a2] * z[b2])]), y = pts.map(z => z[i] * z[j]), q = X[0].length;
    const XtX = Array.from({ length: q }, (_, a2) => Array.from({ length: q }, (__, b2) => X.reduce((t, r) => t + r[a2] * r[b2], 0)));
    const Xty = Array.from({ length: q }, (_, a2) => X.reduce((t, r, k) => t + r[a2] * y[k], 0));
    let beta; try { beta = solveLin(XtX, Xty); } catch { return 0.05; }
    const res = y.map((v, k) => v - X[k].reduce((t, xv, a2) => t + xv * beta[a2], 0));
    return Math.max(...res) - Math.min(...res);
  };
  for (const [a, b, i, j] of pick(g, pairs, nP)) {
    const reach = curv(i, j);
    terms[`${a}:${b}`] = (g.random() < 0.85 ? 1 : -1) * (1.2 + 0.8 * g.random()) * m * s / Math.max(reach, 0.0005);
  }
  return { intercept: 0, terms };
}

function makeQuestions(T, factors, response, g, mixture) {
  const goal = response.goal === 'minimize' ? 'minimise' : 'maximise';
  const qs = [];
  for (const q of T.questions) {
    if (q === 'active') qs.push({ id: 'active', kind: 'active', text: `Which factors affect ${response.name.toLowerCase()} (alone or through an interaction)?` });
    if (q === 'ec50') qs.push({ id: 'ec50', kind: 'ec50', text: `What is the EC50 of the ${T.testLabel ?? 'test'} (the dose giving half the full effect), with a 95 % interval?` });
    if (q === 'potency') qs.push({ id: 'potency', kind: 'potency', text: `How potent is the ${T.testLabel ?? 'test'} relative to the ${T.refLabel ?? 'reference'} (EC50 of the ${T.refLabel ?? 'reference'} ÷ EC50 of the ${T.testLabel ?? 'test'}), with a 95 % interval?` });
    if (q === 'ratios') {
      const prop = isProportion(response.distribution), per = response.exposureUnits ? ` per ${response.exposureUnits.replace(/ plated$/, '')}` : '';
      qs.push({ id: 'ratios', kind: 'ratios', ratio: prop ? 'odds' : 'rate', text: prop
        ? `For each factor that matters, estimate its odds ratio (the odds of ${response.oddsOf ?? response.name.toLowerCase()} at its high setting ÷ at its low setting), with a 95 % interval.`
        : `For each factor that matters, estimate its rate ratio (the mean ${response.name.toLowerCase()}${per} at its high setting ÷ at its low setting), with a 95 % interval.` });
    }
    if (q === 'better') qs.push({ id: 'better', kind: 'better', control: T.control, text: `Which ${factors[0].name.toLowerCase()}s give ${response.goal === 'minimize' ? 'less' : 'more'} ${response.name.toLowerCase()} than the ${T.control}?` });
    if (q === 'differences') qs.push({ id: 'differences', kind: 'differences', control: T.control, text: `For each that does, how much ${response.goal === 'minimize' ? 'less' : 'more'} (${factors[0].name.toLowerCase()} − ${T.control}), with a 95 % interval?` });
    if (q === 'effects') qs.push({ id: 'effects', kind: 'effects', text: `For each factor that matters, estimate its effect (low → high) on ${response.name.toLowerCase()}, with a 95 % interval.` });
    if (q === 'best') qs.push({ id: 'best', kind: 'best', goal: response.goal, text: T.ascent ? `Which settings ${goal} ${response.name.toLowerCase()}, within the operating limits? (Today's ranges are only a start: the best settings may lie well outside them.)` : `Which settings ${goal} ${response.name.toLowerCase()}, within the ranges?` });
    if (q === 'prediction') {
      const at = mixture ? (() => { const st = createStudy({ name: 'q', seed: 1, factors, mixture }); const b = randomBlend(st, g); const r = Object.fromEntries(Object.entries(b).map(([k, v]) => [k, +v.toPrecision(4)])); const last = mixture.components.at(-1); r[last] = +(mixture.total - mixture.components.slice(0, -1).reduce((a, k) => a + r[k], 0)).toPrecision(6); return r; })()
        : Object.fromEntries(factors.map(f => [f.id, f.type === 'categorical' ? f.levels[0] : +decode(f, Math.round((g.random() * 1.2 - 0.6) * 20) / 20).toPrecision(6)]));
      qs.push({ id: 'prediction', kind: 'prediction', settings: at, text: `Predict ${response.name.toLowerCase()} at ${Object.entries(at).map(([k, v]) => `${k} = ${v}`).join(', ')}.` });
    }
  }
  qs.push({ id: 'budget', kind: 'budget', text: 'Stay within the run budget.' });
  return qs;
}

function assemble({ id, topic, difficulty, seed, scenario, sc, factors, response, budget, questions, process, attempt, mixture }) {
  const study = createStudy({ aikidoe: FORMAT_VERSION, name: `${sc.title} (${TOPICS[topic].title.toLowerCase()})`, seed, ...(mixture ? { mixture } : {}),
    description: `${sc.text} Budget: ${budget} runs.`,
    factors, responses: [{ id: response.id, name: response.name, units: response.units, ...(response.distribution ? { distribution: response.distribution } : {}), ...(Number.isInteger(response.trials) ? { trials: response.trials } : {}),
      ...(questions.some(q => q.kind === 'best') ? { goal: response.goal } : {}) }],
    // the plates, with their controls; the runs are laid out by the student
    ...(sc.plate ? { plates: { rows: 8, cols: 12, controls: sc.plate.controls, layout: 'balanced' } } : {}) });
  return { format: EXERCISE_FORMAT, id, topic, difficulty, seed, scenario, title: TOPICS[topic].title, text: sc.text, budget, questions,
    study, truth: { process, attempt } };
}

// ---------------------------------------------------------------- sealing (self-study)

const keystream = (id, n) => { const g = rng((id.split('').reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)) >>> 0); return Array.from({ length: n }, () => g.int(256)); };
const b64 = (bytes) => (typeof Buffer !== 'undefined' ? Buffer.from(bytes).toString('base64') : btoa(String.fromCharCode(...bytes)));
const unb64 = (s) => (typeof Buffer !== 'undefined' ? [...Buffer.from(s, 'base64')] : [...atob(s)].map(c => c.charCodeAt(0)));

/** Seal the truth inside the exercise (encoded, to avoid spoilers — not a secret). */
export function seal(ex) {
  const bytes = [...new TextEncoder().encode(JSON.stringify(ex.truth))], ks = keystream(ex.id, bytes.length);
  const { truth, ...rest } = ex;
  return { ...rest, sealed: b64(bytes.map((b, i) => b ^ ks[i])) };
}
/** The truth of an exercise: from a key (truth in the clear) or a sealed exercise. */
export function truthOf(ex) {
  if (ex.truth) return ex.truth;
  if (!ex.sealed) throw new Error('this exercise has no truth: it is a class exercise (ask the instructor for results), or the key is needed');
  const bytes = unb64(ex.sealed), ks = keystream(ex.id, bytes.length);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes.map((b, i) => b ^ ks[i]))));
}
/** The key (truth in the clear) and the students' version (no truth) of an exercise. */
export const keyOf = (ex) => { const { sealed, ...rest } = ex; return { ...rest, truth: truthOf(ex) }; };
export const studentOf = (ex) => { const { sealed, truth, ...rest } = ex; return rest; };

// ---------------------------------------------------------------- running

/** The study with results for its runs, from the exercise's truth. */
export function runExercise(ex, study, opts = {}) {
  const t = truthOf(ex);
  if (t.process.nuisance?.plate) {
    const inWell = new Set((study.plates?.wells ?? []).filter(w => w.run !== undefined).map(w => w.run));
    const loose = (study.design?.runs ?? []).filter(r => !inWell.has(r.run));
    if (loose.length) throw new Error(`lay the runs out on the plates first (Design step → plate layout, or doe plate): run${loose.length > 1 ? 's' : ''} ${loose.slice(0, 6).map(r => r.run).join(', ')}${loose.length > 6 ? ' …' : ''} ${loose.length > 1 ? 'are' : 'is'} not in a well`);
  }
  // an ascent exercise's truth is in the coded units of the first study's ranges, which a next
  // study centred elsewhere does not share: the process keeps its own factors
  const proc = { ...t.process, factors: TOPICS[ex.topic]?.ascent ? t.process.factors : study.factors };
  return createStudy(runVirtual(proc, study, { ...opts, offset: nuisanceOffsets(proc, study) }));
}

/**
 * Day shifts and resets of hard-to-change factors depend on how the runs were actually done:
 * day = position in the run order ÷ runs per day; a reset happens at every run of a design without
 * whole plots, and at every new whole plot of a split-plot. Returns (run, response) → offset.
 */
function nuisanceOffsets(proc, study) {
  const n = proc.nuisance ?? {};
  if (!n.day && !n.reset) return null;
  const runs = study.design.runs.slice().sort((a, b) => (a.order ?? a.run) - (b.order ?? b.run));
  let reset = 0, prev;
  const where = new Map();
  for (const [i, r] of runs.entries()) {
    if (r.wholePlot === undefined || r.wholePlot !== prev) reset++;
    prev = r.wholePlot;
    where.set(r.run, { day: Math.floor(i / (n.day?.runs ?? 1)), reset });
  }
  return (run, resp) => {
    const w = where.get(run);
    return (n.day ? n.day.sd * hn(proc.seed, resp, 'day', w.day) : 0) + (n.reset ? n.reset * hn(proc.seed, resp, 'reset', w.reset) : 0);
  };
}

// ---------------------------------------------------------------- strategies

const MAX = 'maximize';

/** Answers from a study's data by the standard analysis for the topic. */
export function deriveAnswers(ex, study, { alpha = 0.05 } = {}) {
  const T = TOPICS[ex.topic], r = study.responses[0].id;
  if (T.dose) return doseAnswers(ex, study);
  if (T.counts) return countAnswers(ex, study, { alpha });
  if (T.compare) return compareAnswers(ex, study, { alpha });
  if (T.ascent) return ascentAnswers(ex, study);
  const formula = T.mixture ? `${r} ~ mixquadratic` : T.curvature ? `${r} ~ quadratic` : (ex.topic === 'screening' || ex.topic === 'fraction') ? `${r} ~ main` : `${r} ~ 2fi`;
  const mixed = study.design.runs.some(x => x.wholePlot !== undefined);
  const fit = mixed ? fitMixedModel(study, formula) : fitModel(study, formula);
  const terms = mixed
    ? fit.terms.filter(t => t.df > 0).map(t => ({ term: t.term, p: t.pKR }))
    : fit.columns.map((c, j) => ({ term: c, p: fit.p[j] })).filter(t => t.term !== '(Intercept)' && !/^block/.test(t.term));
  const sig = terms.filter(t => t.p < alpha && !/^block/.test(t.term)).map(t => t.term);
  const active = [...new Set(sig.flatMap(t => t.replace(/I\((\w+)\^2\)/g, '$1').split(':')))].filter(id => study.factors.some(f => f.id === id));
  const coef = (term) => { const j = fit.columns.indexOf(term); return j < 0 ? null : { b: fit.coef[j], se: mixed ? fit.seKR[j] : fit.se[j], df: mixed ? fit.dfKR[j] : fit.dfRes }; };
  const effects = {};
  for (const id of active) {
    const f = study.factors.find(x => x.id === id), c = coef(f.type === 'categorical' ? fit.columns.find(x => x.startsWith(id) && !x.includes(':')) : id);
    if (!c || !Number.isFinite(c.b)) continue;
    const t = studentT.ppf(0.975, Math.max(1, c.df));
    effects[id] = { estimate: 2 * c.b, lower: 2 * (c.b - t * c.se), upper: 2 * (c.b + t * c.se) };
  }
  const ans = { active, effects, runs: study.design.runs.length, formula };
  const pred = (s) => (mixed ? null : predict(fit, [s])[0].fit);
  if (ex.questions.some(q => q.kind === 'best')) ans.best = bestSettings(study, (s) => (mixed ? NaN : pred(s)), study.responses[0].goal ?? MAX);
  const pq = ex.questions.find(q => q.kind === 'prediction');
  if (pq) ans.prediction = { value: pred(pq.settings) };
  return ans;
}

/** Settings maximising (or minimising) f over the cube: corners and a grid, then polished. */
export function bestSettings(study, f, goal = MAX) {
  const fs = study.factors, sgn = goal === 'minimize' ? -1 : 1;
  if (study.mixture) {
    const r = optimiseMixture(study, (s) => sgn * f(s), { starts: 12, seed: 7 });
    return Object.fromEntries(Object.entries(r.settings).map(([k, v]) => [k, typeof v === 'number' ? +v.toPrecision(8) : v]));
  }
  const cont = fs.filter(x => x.type !== 'categorical'), cat = fs.filter(x => x.type === 'categorical');
  const n = cont.length <= 2 ? 21 : cont.length === 3 ? 11 : 3;
  const grid = (k) => (k === 0 ? [[]] : grid(k - 1).flatMap(r => Array.from({ length: n }, (_, i) => [...r, -1 + 2 * i / (n - 1)])));
  const cats = cat.reduce((acc, c) => acc.flatMap(a => c.levels.map(l => ({ ...a, [c.id]: l }))), [{}]);
  const S = (x, c) => ({ ...c, ...Object.fromEntries(cont.map((ff, j) => [ff.id, decode(ff, x[j])])) });
  let best = null;
  for (const c of cats) for (const x of grid(cont.length)) { const v = sgn * f(S(x, c)); if (!best || v > best.v) best = { v, x, c }; }
  // coordinate polish
  let { x } = best; const c = best.c;
  for (let st = 0.05; st > 1e-4; st /= 2) for (let pass = 0; pass < 3; pass++) for (let j = 0; j < x.length; j++) for (const d of [st, -st]) {
    const y = x.slice(); y[j] = Math.max(-1, Math.min(1, y[j] + d)); const v = sgn * f(S(y, c)); if (v > best.v) { best = { v, x: y, c }; x = y; }
  }
  return Object.fromEntries(Object.entries(S(best.x, best.c)).map(([k, v]) => [k, typeof v === 'number' ? +v.toPrecision(6) : v]));
}

/** The reference strategy for the topic (the model answer's path). */
export function referenceStrategy(ex, truth = truthOf(ex)) {
  const T = TOPICS[ex.topic], k = ex.study.factors.length, base = ex.study;
  const cont = base.factors.map(f => f.type === 'continuous');
  const levels = base.factors.map(f => (f.type === 'categorical' ? f.levels.length : 2));
  const steps = [];
  let design, st;
  const make = (d, note) => { steps.push(note); return createStudy({ ...base, design: toStudyDesign(base, d, { seed: ex.seed }) }); };
  switch (ex.topic) {
    case 'factorial': st = make(fullFactorial(levels, { replicates: 2, continuous: cont }), `2^${k} full factorial, 2 replicates (${2 ** (k + 1)} runs); fit main effects and two-factor interactions`); break;
    case 'blocking': st = make(fullFactorial(levels, { blocks: 2, continuous: cont }), `2^${k} full factorial in 2 blocks of 8 (one per day); fit with a block term`); break;
    case 'screening': st = make(fractionalFactorial(k, { runs: 16 }), `16-run resolution IV fraction; fit main effects`); break;
    case 'fraction': {
      st = make(fractionalFactorial(k, { runs: 8 }), '8-run resolution III fraction');
      st = createStudy(runExercise({ ...ex, truth }, st));
      st = createStudy(appendStage(st, foldover(st, {})));
      steps.push('full fold-over (8 more runs, a second block): main effects clear of two-factor interactions; fit main effects');
      break;
    }
    case 'rsm': st = make(ccd(k), `rotatable central composite design (${ccd(k).X.length} runs); fit the full quadratic; maximise within the ranges`); break;
    case 'dose': return doseReference(ex, truth);
    case 'mixture': {
      const d = mixtureDesign(base, { kind: 'optimal', runs: ex.budget, model: 'mixquadratic', criterion: 'I', seed: ex.seed });
      st = createStudy({ ...base, design: d });
      steps.push(`an I-optimal design for the Scheffé quadratic, ${ex.budget} runs from the vertices, edge centroids, overall centroid and axial blends of the constrained region; fit the Scheffé quadratic (pseudo-components); the best blend by searching the region`);
      break;
    }
    case 'plate': {
      const reps = ex.budget / 2 ** k;
      st = make(fullFactorial(levels, { replicates: reps, continuous: cont }), `2^${k} full factorial, ${reps} replicates (${ex.budget} runs)`);
      st = createStudy(layoutPlates(st, { layout: 'balanced', seed: ex.seed }).study);
      steps.push('laid out on the plate with the balanced layout: controls spread over the plate, the runs placed so that the effects are not entangled with the edge or the row and column gradients; fit main effects and two-factor interactions with the position terms (Edge, Row, Col)');
      break;
    }
    case 'counts': {
      const reps = ex.budget / 2 ** k, prop = isProportion(base.responses[0].distribution);
      st = make(fullFactorial(levels, { replicates: reps, continuous: cont }), `2^${k} full factorial, ${reps} replicates (${ex.budget} runs)`);
      st = createStudy(runExercise({ ...ex, truth }, st));
      const a = countAnswers(ex, st);
      steps.push(`a ${prop ? 'binomial' : 'Poisson'} model (${prop ? 'logit' : 'log'} link${prop ? '' : ', the volume plated as the exposure'}) with main effects and two-factor interactions; ${a.analysis === 'as declared' ? 'no overdispersion' : `${a.analysis}`}; ${prop ? 'odds' : 'rate'} ratios from the coefficients, with ${/Firth/.test(a.analysis) ? 'Wald' : 'profile-likelihood'} intervals`);
      return { strategy: 'reference', steps, study: st, answers: a };
    }
    case 'ascent': return ascentReference(ex, truth);
    case 'compare': {
      const f = base.factors[0], t = f.levels.length, b = Math.floor(ex.budget / t);
      st = make(completeBlocks(t, b), `randomised complete blocks: ${b} blocks of ${t}, one a day, each ${f.name.toLowerCase()} once per day (${b * t} runs); fit with the day as a block; compare each with the ${controlOf(ex)} by Dunnett's method`);
      break;
    }
    case 'split-plot': st = make(splitPlotFull(levels, base.factors.map(f => !!f.htc), { replicates: 3 }), `split-plot full factorial, hard-to-change ${base.factors.find(f => f.htc).id} reset for 6 whole plots (3 per level); mixed model, Kenward–Roger tests`); break;
    default: throw new Error(`no reference strategy for ${ex.topic}`);
  }
  st = createStudy(runExercise({ ...ex, truth }, st));
  return { strategy: 'reference', steps, study: st, answers: deriveAnswers(ex, st) };
}

/** One factor at a time: a baseline at the low settings and each factor raised alone, repeated. */
export function ofatStrategy(ex, truth = truthOf(ex)) {
  const base = ex.study, fs = base.factors, k = fs.length;
  const reps = Math.max(1, Math.floor(ex.budget / (k + 1)));
  const low = Object.fromEntries(fs.map(f => [f.id, f.type === 'categorical' ? f.levels[0] : f.low]));
  const runs = [];
  for (let r = 0; r < reps; r++) for (let j = -1; j < k; j++) {
    const s = { ...low };
    if (j >= 0) s[fs[j].id] = fs[j].type === 'categorical' ? fs[j].levels[1] : fs[j].high;
    runs.push({ run: runs.length + 1, order: runs.length + 1, kind: 'other', settings: s });
  }
  let st = createStudy({ ...base, design: { kind: 'custom', params: { strategy: 'one factor at a time' }, randomisation: 'none', runs } });
  if (st.plates) st = createStudy(layoutPlates(st, { layout: 'ordered', seed: ex.seed }).study);
  st = createStudy(runExercise({ ...ex, truth }, st));
  const r = base.responses[0].id, y = (run) => st.observations.find(o => o.run === run && o.response === r).value;
  const groups = Array.from({ length: k + 1 }, (_, j) => runs.filter((_, i) => i % (k + 1) === j).map(x => y(x.run)));
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const pooled = reps > 1 ? Math.sqrt(groups.reduce((s, a) => s + a.reduce((t, v) => t + (v - mean(a)) ** 2, 0), 0) / ((k + 1) * (reps - 1))) : NaN;
  const tq = reps > 1 ? studentT.ppf(0.975, (k + 1) * (reps - 1)) : NaN;
  const effects = {}, active = [];
  fs.forEach((f, j) => {
    const e = mean(groups[j + 1]) - mean(groups[0]), se = pooled * Math.sqrt(2 / reps);
    effects[f.id] = { estimate: e, lower: e - tq * se, upper: e + tq * se };
    if (Math.abs(e) > tq * se) active.push(f.id);
  });
  for (const id of Object.keys(effects)) if (!active.includes(id)) delete effects[id];
  const ans = { active, effects, runs: runs.length };
  const additive = (s) => mean(groups[0]) + fs.reduce((a, f, j) => a + (f.type === 'categorical' ? (s[f.id] === f.levels[1] ? 1 : 0) : (code(f, s[f.id]) + 1) / 2) * (mean(groups[j + 1]) - mean(groups[0])), 0);
  if (ex.questions.some(q => q.kind === 'best')) ans.best = bestSettings(st, additive, base.responses[0].goal ?? MAX);
  const pq = ex.questions.find(q => q.kind === 'prediction');
  if (pq) ans.prediction = { value: additive(pq.settings) };
  return { strategy: 'one factor at a time', steps: [`baseline at the low settings and each factor raised alone, ${reps} times (${runs.length} runs, in order)`], study: st, answers: ans };
}

// ---------------------------------------------------------------- dose–response exercises

const doseRolesOf = (ex) => { const fs = ex.study.factors; return { dose: fs.find(f => f.type === 'continuous'), curve: fs.find(f => f.type === 'categorical') }; };

/** The standard dose–response analysis: parallel LL.4 curves, EC50 of the test and its potency (log-scale intervals). */
export function doseAnswers(ex, study) {
  const { curve } = doseRolesOf(ex), [ref, test] = curve.levels.map(String);
  const data = doseData(study, { dose: doseRolesOf(ex).dose.id, curve: curve.id });
  const fit = fitDose(data, { separate: 'parallel' });
  const e = effectiveDose(fit, 50, { curve: test, interval: 'log' }), p = relativePotency(fit, { test, reference: ref, interval: 'log' });
  return { active: [], effects: {}, ec50: { estimate: e.estimate, lower: e.lower, upper: e.upper }, potency: { estimate: p.estimate, lower: p.lower, upper: p.upper }, runs: study.design.runs.length, formula: 'parallel LL.4' };
}

/**
 * The reference path for a dose exercise: a range-finding stage (zero and six doses a decade apart
 * from the top, once per curve), then eight log-spaced doses over 2.5 decades around the EC50s it
 * found, twice per curve; parallel LL.4 curves.
 */
function doseReference(ex, truth) {
  const { dose, curve } = doseRolesOf(ex), top = dose.high;
  let st = createStudy({ ...ex.study, design: doseDesign(ex.study, { dose: dose.id, curve: curve.id, doses: dilutionSeries({ top, dilution: 10, doses: 6, zeros: 1 }), replicates: 1, seed: ex.seed, params: { method: 'range-finding' } }) });
  st = createStudy(runExercise({ ...ex, truth }, st));
  let centre = top / 100;
  try { const f = fitDose(doseData(st, { dose: dose.id, curve: curve.id }), { separate: 'parallel' }); const es = f.P.map(P => P.e); const m = Math.exp(es.reduce((a, v) => a + Math.log(v), 0) / es.length); if (m > 0 && Number.isFinite(m)) centre = m; } catch { /* keep the middle */ }
  const ds = Array.from({ length: 8 }, (_, i) => +Math.min(top, centre * 10 ** (-1.25 + 2.5 * i / 7)).toPrecision(4));
  st = addDoseStage(st, { doses: [...new Set(ds)], replicates: 2, seed: ex.seed, params: { method: 'around the EC50' } });
  st = createStudy(runExercise({ ...ex, truth }, st));
  const steps = [`range-finding: zero and 6 doses a decade apart from ${top} ${dose.units ?? ''}, once per ${curve.id} (14 runs)`.replace(/ +/g, ' '),
    `8 doses log-spaced over 2.5 decades around the EC50s found (${ds[0].toPrecision(2)} … ${ds.at(-1).toPrecision(2)}), twice per ${curve.id} (32 runs)`,
    'parallel four-parameter log-logistic curves (only the EC50 differs); EC50 and relative potency with intervals on the log scale'];
  return { strategy: 'reference', steps, study: st, answers: doseAnswers(ex, st) };
}

/** Doses spaced evenly on a linear scale, 0 … top, 8 doses × 3 per curve: the slope is usually missed. */
export function linearDoseStrategy(ex, truth = truthOf(ex)) {
  const { dose, curve } = doseRolesOf(ex);
  const ds = Array.from({ length: 8 }, (_, i) => +(dose.high * i / 7).toPrecision(6));
  let st = createStudy({ ...ex.study, design: doseDesign(ex.study, { dose: dose.id, curve: curve.id, doses: ds, replicates: 3, seed: ex.seed, params: { method: 'linear spacing' } }) });
  st = createStudy(runExercise({ ...ex, truth }, st));
  let answers;
  try { answers = doseAnswers(ex, st); } catch { answers = { active: [], effects: {}, runs: st.design.runs.length }; }
  return { strategy: 'evenly spaced doses', steps: ['8 doses evenly spaced from 0 to the top dose, 3 per curve (48 runs)'], study: st, answers };
}

/**
 * One component at a time (mixture topic): from the centroid of the region, each component moved
 * to the ends of its Cox direction (the others keeping their proportions), twice over; a linear
 * blending model, which cannot see non-linear blending.
 */
export function coxStrategy(ex, truth = truthOf(ex)) {
  const base = ex.study, M = base.mixture, ref = referenceBlend(base);
  const pts = [ref];
  for (const id of M.components) { const [a, b] = coxRange(base, ref, id); pts.push(coxBlend(base, ref, id, a), coxBlend(base, ref, id, b)); }
  const all = [...pts, ...pts].slice(0, ex.budget);
  const runs = all.map((s, i) => ({ run: i + 1, order: i + 1, kind: 'other', settings: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, +v.toPrecision(12)])) }));
  let st = createStudy({ ...base, design: { kind: 'custom', params: { strategy: 'one component at a time' }, randomisation: 'none', runs } });
  st = createStudy(runExercise({ ...ex, truth }, st));
  const fit = fitModel(st, `${base.responses[0].id} ~ mixlinear`);
  const pred = (s) => predict(fit, [s])[0].fit;
  // the best blend tried (what is usually done with these data)
  const r = base.responses[0].id, sg = (base.responses[0].goal ?? MAX) === 'minimize' ? -1 : 1;
  const tried = runs.map(x => ({ s: x.settings, y: st.observations.find(o => o.run === x.run && o.response === r).value })).sort((a, b) => sg * (b.y - a.y));
  const ans = { active: [], effects: {}, runs: runs.length, best: tried[0].s };
  const pq = ex.questions.find(q => q.kind === 'prediction');
  if (pq) ans.prediction = { value: pred(pq.settings) };
  return { strategy: 'one component at a time', steps: ['from the centroid, each component to the ends of its Cox direction, twice; a linear blending model'], study: st, answers: ans };
}

/** The strategy a lesson compares with: one factor at a time, the tidy plate layout, or evenly spaced doses. */
export function comparisonStrategy(ex, truth = truthOf(ex)) {
  const T = TOPICS[ex.topic];
  if (T.ascent) return inTheBoxStrategy(ex, truth);
  if (T.compare) return tTestStrategy(ex, truth);
  if (T.dose) return linearDoseStrategy(ex, truth);
  if (T.mixture) return coxStrategy(ex, truth);
  if (T.plate) return tidyPlateStrategy(ex, truth);
  if (T.counts) return leastSquaresCountStrategy(ex, truth);
  return ofatStrategy(ex, truth);
}

// ---------------------------------------------------------------- moving to a better region (#81)

/**
 * The standard analysis of an ascent exercise, by where the work has got to: in a next study
 * (centred where the path peaked) the quadratic (main effects if it cannot be fitted) and its best
 * settings within that study's ranges; with results along a path, the best point on it; else the
 * best corner of the first-order fit.
 */
export function ascentAnswers(ex, study) {
  const r = study.responses[0], goal = r.goal ?? MAX;
  const runs = (study.exercise?.previousRuns ?? 0) + (study.design?.runs.length ?? 0);
  if (study.exercise?.previousRuns) {
    let fit;
    try { fit = fitModel(study, `${r.id} ~ quadratic`); if (fit.coef.some(c => !Number.isFinite(c))) throw new Error('aliased'); } catch { fit = fitModel(study, `${r.id} ~ main`); }
    return { best: bestSettings(study, (s) => predict(fit, [s])[0].fit, goal), runs, formula: fit.formula ?? `${r.id} ~ quadratic` };
  }
  const res = pathResults(study);
  if (res?.best) return { best: res.best.settings, runs, formula: 'the best run along the path' };
  const fit = fitModel(study, `${r.id} ~ main`);
  return { best: bestSettings(study, (s) => predict(fit, [s])[0].fit, goal), runs, formula: `${r.id} ~ main` };
}

/**
 * The reference for an ascent exercise: a 2² factorial, replicated, with 2 centre points each, around
 * today's settings; the main-effects fit and 8 steps along the path of steepest ascent; a new
 * study centred at the path's best step with a central composite design (4 centre points); the
 * quadratic there and its best settings.
 */
function ascentReference(ex, truth) {
  const base = ex.study, steps = [];
  let st = createStudy({ ...base, design: toStudyDesign(base, fullFactorial([2, 2], { continuous: [true, true], replicates: 2, centre: 2 }), { seed: ex.seed }) });
  const first = st.design;
  st = createStudy(runExercise({ ...ex, truth }, st));
  steps.push(`a 2² factorial, replicated, with 2 centre points in each replicate, around today's settings (${first.runs.length} runs); main effects: a strong slope, no curvature`);
  const fit = fitModel(st, `${base.responses[0].id} ~ main`);
  st = createStudy(appendStage(st, pathStage(st, fit, { steps: 8 })));
  st = createStudy(runExercise({ ...ex, truth }, st));
  const res = pathResults(st);
  steps.push(`8 runs along the path of steepest ${res.goal}; the response peaked at step ${res.best.step}`);
  let next = nextStudy({ ...st, exercise: { id: ex.id, first } }, res.best.settings, { design: 'ccd' });
  next = createStudy(runExercise({ ...ex, truth }, next));
  steps.push(`a new study centred there, a central composite design (${next.design.runs.length} runs); the quadratic and its best settings within its ranges`);
  return { strategy: 'reference', steps, study: next, answers: ascentAnswers(ex, next) };
}

/** Staying in the box: the first design with axial points (a central composite in today's ranges), the quadratic, its best settings there. */
function inTheBoxStrategy(ex, truth) {
  const base = ex.study;
  let st = createStudy({ ...base, design: toStudyDesign(base, ccd(2, { centre: 5 }), { seed: ex.seed }) });
  st = createStudy(runExercise({ ...ex, truth }, st));
  const fit = fitModel(st, `${base.responses[0].id} ~ quadratic`);
  return { strategy: 'staying in today\'s ranges', steps: ['a central composite design in today\'s ranges; the quadratic and its best settings there'], study: st,
    answers: { best: bestSettings(st, (s) => predict(fit, [s])[0].fit, base.responses[0].goal ?? MAX), runs: st.design.runs.length } };
}

// ---------------------------------------------------------------- comparing treatments

const controlOf = (ex) => ex.questions.find(q => q.control !== undefined)?.control;

/**
 * The compare topic's analysis: the one-factor model (with the block term when the design has
 * blocks), each level against the control by Dunnett's method; the levels better than the control
 * (in the response's goal) at α, with their simultaneous intervals.
 */
export function compareAnswers(ex, study, { alpha = 0.05 } = {}) {
  const f = study.factors[0], r = study.responses[0], dir = r.goal === 'minimize' ? -1 : 1;
  const fit = fitModel(study, `${r.id} ~ ${f.id}`);
  const cmp = compareLevels(fit, f.id, { control: controlOf(ex), method: 'dunnett' });
  const better = cmp.comparisons.filter(c => c.p < alpha && Math.sign(c.estimate) === dir).map(c => c.a);
  const differences = Object.fromEntries(cmp.comparisons.filter(c => better.includes(c.a)).map(c => [c.a, { estimate: c.estimate, lower: c.lower, upper: c.upper }]));
  return { better, differences, runs: study.design.runs.length, formula: fit.formula ?? `${r.id} ~ ${f.id}` };
}

/**
 * A t test for each level against the control, as often done by hand: every level the same number
 * of times in a completely random order (no blocks), each test on its own two groups, at 5 %
 * without adjustment, its interval the plain t interval. For comparison with the reference.
 */
export function tTestStrategy(ex, truth = truthOf(ex)) {
  const base = ex.study, f = base.factors[0], t = f.levels.length, reps = Math.floor(ex.budget / t), ctrl = controlOf(ex);
  const dir = base.responses[0].goal === 'minimize' ? -1 : 1;
  let st = createStudy({ ...base, design: toStudyDesign(base, fullFactorial([t], { replicates: reps }), { seed: ex.seed }) });
  st = createStudy(runExercise({ ...ex, truth }, st));
  const r = base.responses[0].id, y = (lv) => st.design.runs.filter(x => String(x.settings[f.id]) === String(lv)).map(x => st.observations.find(o => o.run === x.run && o.response === r).value);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length, ss = (a) => a.reduce((s, v) => s + (v - mean(a)) ** 2, 0);
  const yc = y(ctrl), better = [], differences = {};
  for (const lv of f.levels.filter(l => String(l) !== String(ctrl))) {
    const ya = y(lv), df = ya.length + yc.length - 2, sp = Math.sqrt((ss(ya) + ss(yc)) / df), se = sp * Math.sqrt(1 / ya.length + 1 / yc.length);
    const d = mean(ya) - mean(yc), tq = studentT.ppf(0.975, df);
    if (Math.abs(d) > tq * se && Math.sign(d) === dir) { better.push(lv); differences[lv] = { estimate: d, lower: d - tq * se, upper: d + tq * se }; }
  }
  return { strategy: 'a t test for each, no blocks', steps: [`every ${f.name.toLowerCase()} ${reps} times in a random order, no blocks; a two-sample t test of each against the ${ctrl} at 5 %, unadjusted`], study: st, answers: { better, differences, runs: st.design.runs.length } };
}

/**
 * The tidy plate layout (plate topic): the reference design, but laid out the way plates are often
 * filled by hand — conditions in standard order, replicates side by side, row by row — and
 * analysed the same way. For comparison with the reference strategy.
 */
export function tidyPlateStrategy(ex, truth = truthOf(ex)) {
  const ref = referenceStrategy(ex, truth);
  let st = createStudy({ ...ref.study, observations: [], plates: { ...ref.study.plates, wells: [], readings: [] } });
  st = createStudy(layoutPlates(st, { layout: 'ordered', relayout: true }).study);
  st = createStudy(runExercise({ ...ex, truth }, st));
  return { strategy: 'tidy plate layout', steps: ['the same design, laid out by hand: conditions in standard order, replicates side by side, row by row'], study: st, answers: deriveAnswers(ex, st) };
}

/**
 * The counts topic's analysis: a GLM of the declared distribution with main effects and two-factor
 * interactions; the negative binomial (counts) or quasi-binomial (proportions) when it shows
 * overdispersion, Firth's penalised likelihood when proportions are separated. Active factors by
 * the coefficients' tests at α; each active factor's rate or odds ratio low → high, exp(2β), with
 * the profile-likelihood interval (Wald for Firth's). leastSquares: least squares on the raw
 * counts or successes instead (the comparison), the ratio being of the fitted means at the high
 * and low settings, its interval that of the coefficient carried through.
 */
export function countAnswers(ex, study, { alpha = 0.05, leastSquares = false } = {}) {
  const resp = study.responses[0], r = resp.id, formula = `${r} ~ 2fi`, prop = isProportion(resp.distribution);
  let fit, analysis = 'as declared';
  if (leastSquares) {
    // counts: the raw counts; proportions: the percentages (each dish the same weight, whatever was sown)
    const st = prop ? { ...study, responses: study.responses.map(x => (x.id === r ? { id: r } : x)),
      observations: study.observations.map(o => (o.response === r && o.value !== null ? { run: o.run, response: r, value: 100 * o.value / (o.trials ?? resp.trials) } : o)) } : study;
    fit = fitModel(st, formula, { noise: 'normal' }); analysis = `least squares on the raw ${prop ? 'percentages' : 'counts'}`;
  }
  else {
    fit = fitModel(study, formula);
    if (fit.separation) { fit = fitModel(study, formula, { firth: true }); analysis = 'the proportions are separated: Firth’s penalised likelihood'; }
    else if (fit.overdispersion?.detected) {
      const ratio = fit.overdispersion.ratio;
      fit = fitModel(study, formula, { noise: prop ? 'quasibinomial' : 'negbin' });
      analysis = `overdispersed (Pearson χ²/df ${ratio.toFixed(2)}): ${prop ? 'the quasi-binomial model' : 'the negative binomial model'}`;
    }
  }
  const terms = fit.columns.map((c, j) => ({ term: c, p: fit.p[j] })).filter(t => t.term !== '(Intercept)');
  const sig = terms.filter(t => t.p < alpha).map(t => t.term);
  const active = [...new Set(sig.flatMap(t => t.split(':')))].filter(id => study.factors.some(f => f.id === id));
  const colOf = (id) => { const f = study.factors.find(x => x.id === id); return f.type === 'categorical' ? fit.columns.find(x => x.startsWith(id) && !x.includes(':')) : id; };
  const ratios = {};
  if (leastSquares) {
    // the fitted means at the high and low settings, the others at the centre
    const b0 = fit.coef[fit.columns.indexOf('(Intercept)')], m = prop ? 100 : 1;
    const conv = (b) => { const hi = (b0 + b) / m, lo = (b0 - b) / m; if (!(hi > 0 && lo > 0) || (prop && !(hi < 1 && lo < 1))) return NaN; return prop ? (hi / (1 - hi)) / (lo / (1 - lo)) : hi / lo; };
    for (const id of active) {
      const j = fit.columns.indexOf(colOf(id)); if (j < 0) continue;
      const t = studentT.ppf(0.975, Math.max(1, fit.dfRes)), b = fit.coef[j], se = fit.se[j];
      ratios[id] = { estimate: conv(b), lower: conv(b - t * se), upper: conv(b + t * se) };
    }
  } else {
    const ci = glmConfint(fit, { names: active.map(colOf) });
    for (const id of active) {
      const c = ci.find(x => x.name === colOf(id)); if (!c) continue;
      ratios[id] = { estimate: Math.exp(2 * c.estimate), lower: Math.exp(2 * c.lower), upper: Math.exp(2 * c.upper) };
    }
  }
  const pq = ex.questions.find(q => q.kind === 'percent'), percent = {};
  if (pq) {
    // the mean percentage at the question's settings with its 95 % interval: from the GLM (on the logit
    // scale, transformed back), or from least squares on the percentages (symmetric, unbounded)
    const p = predict(fit, [pq.settings])[0], k = leastSquares ? 1 : 100;
    Object.assign(percent, { estimate: k * p.fit, lower: k * p.lower, upper: k * p.upper });
  }
  return { active, ratios, ...(pq ? { percent } : {}), runs: study.design.runs.length, formula, analysis, distribution: leastSquares ? 'normal' : fit.distribution };
}

/**
 * Least squares on the raw counts (counts topic): the reference design, analysed as if the counts
 * were measurements with constant noise — the volume plated left out, the intervals symmetric and
 * equally wide everywhere. For comparison with the reference strategy.
 */
export function leastSquaresCountStrategy(ex, truth = truthOf(ex)) {
  const ref = referenceStrategy(ex, truth);
  const prop = isProportion(ex.study.responses[0].distribution);
  return { strategy: `least squares on the raw ${prop ? 'percentages' : 'counts'}`, steps: [`the same design, analysed by least squares on the raw ${prop ? 'percentages germinated' : 'counts'}; ratios of the fitted means`], study: ref.study, answers: countAnswers(ex, ref.study, { leastSquares: true }) };
}

export function referencePower(ex, truth, study) {
  if (TOPICS[ex.topic].counts) return countPower(ex, truth, study);
  if (TOPICS[ex.topic].ascent) {
    // the first design's power for each factor's slope at the centre (the path rests on them)
    const resp = truth.process.responses[0], first = study.exercise?.first;
    const st = first ? createStudy({ ...ex.study, design: first }) : study;
    let min = 1;
    for (const f of ex.study.factors) {
      const p = studyPower({ ...st, observations: [] }, { model: 'main', delta: Math.abs(2 * resp.truth.terms[f.id]) / resp.sigma });
      const pt = p.terms.find(x => x.term === f.id);
      if (pt && Number.isFinite(pt.power)) min = Math.min(min, pt.power);
    }
    return min;
  }
  if (TOPICS[ex.topic].compare) {
    // each better level against the control by Dunnett's method (balanced: correlation ½), with
    // the error df of the blocked one-way model: the smallest power
    const resp = truth.process.responses[0], f = study.factors[0], t = f.levels.length;
    const n = study.design.runs.length / t, blocks = new Set(study.design.runs.map(r => r.block)).size;
    const df = study.design.runs.length - t - (blocks > 1 ? blocks - 1 : 0);
    const R = Array.from({ length: t - 1 }, (_, i) => Array.from({ length: t - 1 }, (_, j) => (i === j ? 1 : 0.5)));
    const c = qmvtBox(0.95, R, df);
    let min = 1;
    for (const b of Object.values(resp.truth.terms)) min = Math.min(min, nct.sf(c, df, Math.abs(b) / (resp.sigma * Math.sqrt(2 / n))));
    return min;
  }
  if (TOPICS[ex.topic].dose) {
    // the potency question: the power of the reference's last stage for the true ratio
    const resp = truth.process.responses[0], c = resp.curve, [ref, test] = Object.keys(c.levels);
    const D = study.factors.find(f => f.id === c.dose), lv = study.factors.find(f => f.id === c.by).levels[0];
    const doses = study.design.runs.filter(x => String(x.settings[c.by]) === String(lv)).map(x => x.settings[D.id]);
    try { return potencyPower(doses, { guess: { ...c.params, e: c.levels[ref].e }, sigma: resp.sigma, ratio: c.levels[ref].e / c.levels[test].e }).power; } catch { return 0; }
  }
  // each true term the questions are about, at its own size against the run-to-run σ, in the
  // reference design and model: the smallest power. Response surfaces: the curvature terms (the
  // optimum's location rests on them); otherwise the main effects and interactions.
  const resp = truth.process.responses[0], sigma = resp.sigma, curv = !!TOPICS[ex.topic].curvature;
  // mixtures: the blending terms (a test that a pure blend's response is 0 means nothing)
  const terms = Object.entries(resp.truth.terms).filter(([t]) => (TOPICS[ex.topic].mixture ? t.includes(':') : curv ? t.startsWith('I(') : !t.startsWith('I(')));
  if (!terms.length) return 1;
  const model = TOPICS[ex.topic].mixture ? 'mixquadratic' : curv ? 'quadratic' : (ex.topic === 'screening' || ex.topic === 'fraction') ? 'main' : '2fi';
  const eta = ex.topic === 'split-plot' ? (truth.process.nuisance.reset / sigma) ** 2 : 1;
  let min = 1;
  for (const [t, b] of terms) {
    // an interaction outside a main-effects model is not tested: it is not a question there
    try {
      const p = studyPower({ ...study, observations: [] }, { model, delta: Math.abs(2 * b) / sigma, eta });
      const pt = p.terms.find(x => x.term === t);
      if (pt && Number.isFinite(pt.power)) min = Math.min(min, pt.power);
    } catch { return 0; }
  }
  return min;
}

/**
 * The counts topic: the smallest power, in the reference design and model (main effects and
 * two-factor interactions), of the true terms at their true ratios, by the Wald approximation at
 * the means the model expects (each term alone, the others at the centre), with the runs' actual
 * exposures, θ, or the dispersion that the extra-binomial variation σ gives at the centre,
 * 1 + n p(1 − p) σ².
 */
function countPower(ex, truth, study) {
  const resp = truth.process.responses[0], prop = resp.distribution === 'binomial';
  const centre = prop ? 1 / (1 + Math.exp(-resp.truth.intercept)) : Math.exp(resp.truth.intercept);
  const runs = study.design.runs.filter(r => r.kind !== 'confirm');
  const exposure = runs.map(r => study.observations.find(o => o.run === r.run)?.exposure ?? 1);
  const order = (t) => t.split(':').sort((a, b) => study.factors.findIndex(f => f.id === a) - study.factors.findIndex(f => f.id === b)).join(':');
  const terms = Object.entries(resp.truth.terms).map(([t, b]) => [order(t), b]);
  if (!terms.length) return 1;
  // trials: each run's (the seeds sown), or the process's fixed number
  const trials = Array.isArray(resp.trials) ? runs.map(r => study.observations.find(o => o.run === r.run)?.trials ?? resp.trials[0]) : runs.map(() => resp.trials);
  const nbar = trials.reduce((a, b) => a + b, 0) / trials.length;
  const opts = prop ? { distribution: (resp.sigma ?? 0) > 0 ? 'quasibinomial' : 'binomial', trials, dispersion: 1 + nbar * centre * (1 - centre) * (resp.sigma ?? 0) ** 2 }
    : { distribution: resp.distribution, exposure, ...(resp.theta ? { theta: resp.theta } : {}) };
  let min = 1;
  try {
    for (const [t, b] of terms) {
      const p = studyGlmPower({ ...study, observations: [] }, { model: '2fi', baseline: centre, ratio: { [t]: Math.exp(2 * Math.abs(b)), default: 1 }, ...opts });
      const pt = p.terms.find(x => x.term === t);
      if (pt && Number.isFinite(pt.power)) min = Math.min(min, pt.power);
    }
  } catch { return 0; }
  return min;
}

// ---------------------------------------------------------------- grading

/** The true active factors, effects (low → high) and optimum of an exercise. */
export function trueFacts(ex, truth = truthOf(ex)) {
  const resp = truth.process.responses[0], proc = { ...truth.process, factors: TOPICS[ex.topic]?.ascent ? truth.process.factors : ex.study.factors };
  if (TOPICS[ex.topic]?.ascent) {
    // the best settings within the operating limits (the region the question asks about)
    const region = createStudy({ name: 'limits', factors: truth.process.factors.map(f => ({ ...f, low: f.limits.lower, high: f.limits.upper, limits: undefined })) });
    const mu = (s) => trueMean(proc, resp.id, s), goal = ex.study.responses[0].goal ?? MAX;
    // regret is measured against the gain available from today's settings (the first study's centre),
    // not the whole region's range: staying near today's settings scores little
    const opt = bestSettings(region, mu, goal), today = Object.fromEntries(truth.process.factors.map(f => [f.id, decode(f, 0)]));
    return { active: [], effects: {}, best: opt, bestValue: mu(opt), worstValue: mu(today), mu, sigma: resp.sigma, goal };
  }
  if (resp.curve) {
    const [ref, test] = Object.keys(resp.curve.levels);
    return { active: [], effects: {}, sigma: resp.sigma, ec50: resp.curve.levels[test].e, potency: resp.curve.levels[ref].e / resp.curve.levels[test].e, reference: ref, test };
  }
  if (TOPICS[ex.topic].compare) {
    const f = ex.study.factors[0], diff = (l) => resp.truth.terms[`${f.id}.${l}`] ?? 0, dir = (ex.study.responses[0].goal ?? MAX) === 'minimize' ? -1 : 1;
    const others = f.levels.filter(l => String(l) !== String(controlOf(ex)));
    return { active: [], effects: {}, better: others.filter(l => dir * diff(l) > 0), differences: Object.fromEntries(others.map(l => [l, diff(l)])), sigma: resp.sigma, control: controlOf(ex) };
  }
  const active = [...new Set(Object.keys(resp.truth.terms).flatMap(t => t.replace(/I\((\w+)\^2\)/g, '$1').split(':')))];
  const effects = Object.fromEntries(ex.study.factors.filter(f => resp.truth.terms[f.id] !== undefined).map(f => [f.id, 2 * resp.truth.terms[f.id]]));
  if (resp.distribution) {
    // counts and proportions: the effects are ratios low → high, exp(2β) (rate or odds ratios)
    const ratios = Object.fromEntries(Object.entries(effects).map(([k, v]) => [k, Math.exp(v)]));
    const pq = ex.questions.find(q => q.kind === 'percent');
    return { active, effects: {}, ratios, ratio: resp.distribution === 'binomial' ? 'odds' : 'rate', mu: (s) => trueMean(proc, resp.id, s), sigma: NaN,
      ...(pq ? { percent: 100 * trueMean(proc, resp.id, pq.settings) } : {}) };
  }
  const mu = (s) => trueMean(proc, resp.id, s);
  const goal = ex.study.responses[0].goal ?? MAX;
  const opt = bestSettings(ex.study, mu, goal);
  const worst = bestSettings(ex.study, mu, goal === 'minimize' ? MAX : 'minimize');
  return { active, effects, best: opt, bestValue: mu(opt), worstValue: mu(worst), mu, sigma: resp.sigma, goal };
}

/**
 * Grade answers: { active: [ids], effects: { id: { estimate, lower, upper } }, ratios (rate or odds
 * ratios low → high, as effects), best: settings, prediction: { value }, ec50, potency } and runs
 * used. Ratios are judged on the log scale: the side of 1 they fall on, and whether the interval
 * holds the true ratio. Returns { score (0–100), parts: [{ id, score, max, note }],
 * truth facts for feedback }.
 */
export function gradeAnswers(ex, truth, answers, { runs } = {}) {
  const F = trueFacts(ex, truth), parts = [];
  const W = { active: 40, effects: 25, ratios: 25, percent: 20, best: 25, prediction: 10, ec50: 50, potency: 50, better: 50, differences: 50 };
  const qs = ex.questions.filter(q => W[q.kind]);
  const total = qs.reduce((a, q) => a + W[q.kind], 0);
  for (const q of qs) {
    const max = W[q.kind] * 100 / total;
    if (q.kind === 'active') {
      const said = new Set(answers.active ?? []), real = new Set(F.active);
      const tp = [...said].filter(x => real.has(x)).length, prec = said.size ? tp / said.size : 0, rec = real.size ? tp / real.size : 1;
      const f1 = prec + rec ? 2 * prec * rec / (prec + rec) : 0;
      const missed = [...real].filter(x => !said.has(x)), extra = [...said].filter(x => !real.has(x));
      parts.push({ id: 'active', max, score: max * f1, note: `precision ${(100 * prec).toFixed(0)} %, recall ${(100 * rec).toFixed(0)} %${missed.length ? `; missed ${missed.join(', ')}` : ''}${extra.length ? `; not active: ${extra.join(', ')}` : ''}` });
    } else if (q.kind === 'better') {
      // as the active factors: precision and recall of the levels said to beat the control
      const said = new Set((answers.better ?? []).map(String)), real = new Set(F.better.map(String));
      const tp = [...said].filter(x => real.has(x)).length, prec = said.size ? tp / said.size : real.size ? 0 : 1, rec = real.size ? tp / real.size : 1;
      const f1 = prec + rec ? 2 * prec * rec / (prec + rec) : 0;
      const missed = [...real].filter(x => !said.has(x)), extra = [...said].filter(x => !real.has(x));
      parts.push({ id: 'better', max, score: max * f1, note: `${missed.length ? `missed ${missed.join(', ')}` : 'none missed'}${extra.length ? `; no better than the ${F.control}: ${extra.join(', ')} (a false alarm)` : ''}` });
    } else if (q.kind === 'differences') {
      // for each level truly better: the sign and whether the interval holds the true difference
      const ids = F.better.map(String);
      let s = 0; const notes = [];
      for (const id of ids) {
        const a = answers.differences?.[id], t = F.differences[id];
        if (!a || !Number.isFinite(a.estimate)) { notes.push(`${id}: no estimate`); continue; }
        const signOk = Math.sign(a.estimate) === Math.sign(t), inside = a.lower <= t && t <= a.upper;
        s += (signOk ? 0.5 : 0) + (inside ? 0.5 : 0);
        if (!signOk || !inside) notes.push(`${id}: true difference ${t.toPrecision(3)}, yours ${a.estimate.toPrecision(3)} [${(a.lower ?? NaN).toPrecision(3)}, ${(a.upper ?? NaN).toPrecision(3)}]`);
      }
      parts.push({ id: 'differences', max, score: ids.length ? max * s / ids.length : max, note: notes.join('; ') || 'every true difference is inside your interval' });
    } else if (q.kind === 'effects') {
      const ids = Object.keys(F.effects);
      let s = 0; const notes = [];
      for (const id of ids) {
        const a = answers.effects?.[id], t = F.effects[id];
        if (!a) { notes.push(`${id}: no estimate`); continue; }
        const signOk = Math.sign(a.estimate) === Math.sign(t), inside = a.lower <= t && t <= a.upper;
        s += (signOk ? 0.5 : 0) + (inside ? 0.5 : 0);
        if (!signOk || !inside) notes.push(`${id}: true effect ${t.toPrecision(3)}, yours ${a.estimate.toPrecision(3)} [${a.lower.toPrecision(3)}, ${a.upper.toPrecision(3)}]`);
      }
      parts.push({ id: 'effects', max, score: ids.length ? max * s / ids.length : max, note: notes.join('; ') || 'every true effect has the right sign and is inside your interval' });
    } else if (q.kind === 'ratios') {
      // as effects, on the log scale: the sign of the log ratio, and whether the interval holds the truth
      const ids = Object.keys(F.ratios), what = `${F.ratio} ratio`;
      let s = 0; const notes = [];
      for (const id of ids) {
        const a = answers.ratios?.[id], t = F.ratios[id];
        if (!a || !(a.estimate > 0)) { notes.push(`${id}: no estimate`); continue; }
        const signOk = Math.sign(Math.log(a.estimate)) === Math.sign(Math.log(t)), inside = a.lower <= t && t <= a.upper;
        s += (signOk ? 0.5 : 0) + (inside ? 0.5 : 0);
        if (!signOk || !inside) notes.push(`${id}: true ${what} ${t.toPrecision(3)}, yours ${a.estimate.toPrecision(3)} [${(a.lower ?? NaN).toPrecision(3)}, ${(a.upper ?? NaN).toPrecision(3)}]`);
      }
      parts.push({ id: 'ratios', max, score: ids.length ? max * s / ids.length : max, note: notes.join('; ') || `every true ${what} is on the right side of 1 and inside your interval` });
    } else if (q.kind === 'percent') {
      // half for an interval that holds the true mean percentage, half for one that stays within 0–100 %
      const a = answers.percent, t = F.percent;
      if (!a || ![a.estimate, a.lower, a.upper].every(Number.isFinite)) { parts.push({ id: 'percent', max, score: 0, note: 'no percentage given' }); continue; }
      const inside = a.lower <= t && t <= a.upper, possible = a.lower >= 0 && a.upper <= 100 && a.estimate >= 0 && a.estimate <= 100;
      const why = [inside ? null : `the interval misses the true ${t.toPrecision(3)} %`, possible ? null : 'the estimate or interval goes outside 0–100 %'].filter(Boolean);
      parts.push({ id: 'percent', max, score: max * ((inside ? 0.5 : 0) + (possible ? 0.5 : 0)),
        note: why.length ? `yours ${a.estimate.toPrecision(3)} % [${a.lower.toPrecision(3)}, ${a.upper.toPrecision(3)}]: ${why.join('; ')}` : `true ${t.toPrecision(3)} %, inside your interval [${a.lower.toPrecision(3)}, ${a.upper.toPrecision(3)}]` });
    } else if (q.kind === 'best') {
      if (!answers.best) { parts.push({ id: 'best', max, score: 0, note: 'no settings given' }); continue; }
      const v = F.mu(answers.best), span = Math.abs(F.bestValue - F.worstValue) || 1;
      const regret = Math.abs(F.bestValue - v) / span;
      const sc = regret <= 0.05 ? 1 : regret >= 0.5 ? 0 : 1 - (regret - 0.05) / 0.45;
      parts.push({ id: 'best', max, score: max * sc, note: `true value there ${v.toPrecision(4)}, true optimum ${F.bestValue.toPrecision(4)} (regret ${(100 * regret).toFixed(1)} % of the range)` });
    } else if (q.kind === 'ec50' || q.kind === 'potency') {
      // half for an interval covering the truth, half for accuracy: within ×/÷ 1.25 full, ×/÷ 2 none
      const t = F[q.kind], a = answers[q.kind];
      if (!a || !Number.isFinite(a.estimate)) { parts.push({ id: q.kind, max, score: 0, note: 'no estimate given' }); continue; }
      const inside = a.lower <= t && t <= a.upper, err = Math.abs(Math.log(a.estimate / t));
      const acc = err <= Math.log(1.25) ? 1 : err >= Math.log(2) ? 0 : 1 - (err - Math.log(1.25)) / (Math.log(2) - Math.log(1.25));
      parts.push({ id: q.kind, max, score: max * (0.5 * (inside ? 1 : 0) + 0.5 * acc), note: `true ${q.kind === 'ec50' ? 'EC50' : 'potency'} ${t.toPrecision(3)}, yours ${a.estimate.toPrecision(3)} [${(a.lower ?? NaN).toPrecision(3)}, ${(a.upper ?? NaN).toPrecision(3)}]${inside ? '' : ' — the interval misses it'}` });
    } else if (q.kind === 'prediction') {
      const t = F.mu(q.settings), a = answers.prediction?.value;
      if (!Number.isFinite(a)) { parts.push({ id: 'prediction', max, score: 0, note: 'no prediction given' }); continue; }
      const err = Math.abs(a - t) / F.sigma, sc = err <= 1.5 ? 1 : err >= 4 ? 0 : 1 - (err - 1.5) / 2.5;
      parts.push({ id: 'prediction', max, score: max * sc, note: `true mean ${t.toPrecision(4)}, yours ${a.toPrecision(4)} (${err.toFixed(1)} σ away)` });
    }
  }
  let score = parts.reduce((a, p) => a + p.score, 0);
  const used = runs ?? answers.runs;
  if (used !== undefined) {
    const over = used > ex.budget;
    parts.push({ id: 'budget', max: 0, score: over ? -20 : 0, note: `${used} of ${ex.budget} runs${over ? ': over budget (−20)' : ''}` });
    if (over) score -= 20;
  }
  score = Math.max(0, Math.round(score * 10) / 10);
  return { score, parts, truth: { active: F.active, effects: F.effects, best: F.best, bestValue: F.bestValue, ...(F.better ? { better: F.better, differences: F.differences, control: F.control } : {}), ...(F.ec50 !== undefined ? { ec50: F.ec50, potency: F.potency } : {}), ...(F.ratios ? { ratios: F.ratios, ratio: F.ratio } : {}), ...(F.percent !== undefined ? { percent: F.percent } : {}) } };
}

/** Grade a study: its exercise answers if given, else answers derived by the standard analysis. */
export function gradeStudy(ex, study, truth = truthOf(ex)) {
  const given = study.exercise?.answers;
  const derived = !given;
  const answers = given ?? deriveAnswers(ex, study);
  // a next study (Learn, moving to a better region) counts the runs of the studies before it
  return { ...gradeAnswers(ex, truth, answers, { runs: (study.exercise?.previousRuns ?? 0) + (study.design?.runs.length ?? 0) }), answers, derived, modelAnswer: truth.modelAnswer };
}
