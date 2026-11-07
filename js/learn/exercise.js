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
import { fitDose, effectiveDose, relativePotency, dilutionSeries, potencyPower, MODELS as DOSE } from '../model/dose.js';
import { foldover } from '../design/augment.js';
import { fitModel, predict } from '../model/ols.js';
import { fitMixedModel } from '../model/mixed.js';
import { studentT } from '../dist.js';
import { studyPower } from '../model/power.js';
import { SCENARIOS } from './scenarios.js';
import { runVirtual, trueMean, hashNormal as hn } from './process.js';

export const EXERCISE_FORMAT = 'aikidoe-exercise/1';
export const DIFFICULTIES = { easy: 4, medium: 3, hard: 2.4 };   // smallest active effect, in σ (low → high)

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
  dose: { title: 'Dose–response: EC50 and relative potency', lesson: 15, dose: true, k: () => 2, budget: 48, questions: ['ec50', 'potency'] },
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
  const kindOf = (x) => (x.dose ? 'dose' : x.plate ? 'plate' : null);
  const pool0 = Object.keys(SCENARIOS).filter(id => kindOf(SCENARIOS[id]) === kindOf(T));
  const scId = scenario ?? pool0[g0.int(pool0.length)];
  const sc = SCENARIOS[scId];
  if (!sc) throw new Error(`unknown scenario "${scId}"`);
  if (kindOf(sc) !== kindOf(T)) throw new Error(kindOf(T) ? `the ${topic} topic needs a ${kindOf(T)} scenario (${pool0.join(', ')})` : `scenario "${scId}" belongs to the ${kindOf(sc)} topic`);
  const k = T.k(difficulty);
  // factors: the hard-to-change one when the topic needs it; continuous for response surfaces
  let pool = sc.factors.filter(f => !f.levels && !f.htc);
  if (topic !== 'rsm' && topic !== 'split-plot' && !T.dose && g0.random() < 0.5) pool = [...pool, sc.factors.find(f => f.levels)];
  let chosen = T.dose ? sc.factors : pick(g0, pool, k - (T.htc ? 1 : 0));
  if (T.htc) chosen = [sc.factors.find(f => f.htc), ...chosen];
  const factors = createStudy({ name: 'x', factors: chosen.map(f => ({ ...f, htc: !!(T.htc && f.htc) })) }).factors;
  const response = { ...sc.response };
  const budget = typeof T.budget === 'function' ? T.budget(k) : T.budget;
  const id = `${topic}-${difficulty}-${seed}`;
  // truths are drawn until the reference strategy, within the budget, resolves one with adequate
  // power and full marks (the solvability check); the attempts are recorded
  let last = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const g = rng((seed * 2654435761 + attempt * 97 + 13) >>> 0);
    const truth = T.dose ? { intercept: 0, terms: {} } : makeTruth(topic, difficulty, g, factors, response);
    const curve = T.dose ? doseTruth(sc.dose, factors, g, difficulty) : null;
    const proc = { seed: (seed * 31 + attempt) >>> 0, factors, responses: [{ id: response.id, sigma: response.sigma, truth, decimals: response.decimals, ...(curve ? { curve } : {}) }],
      nuisance: T.nuisance ? T.nuisance(response.sigma) : {}, ...(sc.plate ? { controls: sc.plate.truth } : {}) };
    const questions = makeQuestions(T.dose ? { ...T, refLabel: factors[1].levels[0], testLabel: factors[1].levels[1] } : T, factors, response, g);
    const ex = assemble({ id, topic, difficulty, seed, scenario: scId, sc, factors, response, budget, questions, process: proc, attempt });
    const ref = referenceStrategy(ex, ex.truth);
    const grade = gradeAnswers(ex, ex.truth, ref.answers, { runs: ref.study.design.runs.length });
    const power = referencePower(ex, ex.truth, ref.study);
    last = { ex, ref, grade, power };
    if (grade.score === 100 && power >= 0.8) {
      ex.truth.modelAnswer = { strategy: ref.strategy, steps: ref.steps, answers: ref.answers, power };
      return seal(ex);
    }
  }
  throw new Error(`could not generate a solvable ${topic} exercise for seed ${seed} (last: score ${last.grade.score}, power ${last.power.toFixed(2)})`);
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

function makeQuestions(T, factors, response, g) {
  const goal = response.goal === 'minimize' ? 'minimise' : 'maximise';
  const qs = [];
  for (const q of T.questions) {
    if (q === 'active') qs.push({ id: 'active', kind: 'active', text: `Which factors affect ${response.name.toLowerCase()} (alone or through an interaction)?` });
    if (q === 'ec50') qs.push({ id: 'ec50', kind: 'ec50', text: `What is the EC50 of the ${T.testLabel ?? 'test'} (the dose giving half the full effect), with a 95 % interval?` });
    if (q === 'potency') qs.push({ id: 'potency', kind: 'potency', text: `How potent is the ${T.testLabel ?? 'test'} relative to the ${T.refLabel ?? 'reference'} (EC50 of the ${T.refLabel ?? 'reference'} ÷ EC50 of the ${T.testLabel ?? 'test'}), with a 95 % interval?` });
    if (q === 'effects') qs.push({ id: 'effects', kind: 'effects', text: `For each factor that matters, estimate its effect (low → high) on ${response.name.toLowerCase()}, with a 95 % interval.` });
    if (q === 'best') qs.push({ id: 'best', kind: 'best', goal: response.goal, text: `Which settings ${goal} ${response.name.toLowerCase()}, within the ranges?` });
    if (q === 'prediction') {
      const at = Object.fromEntries(factors.map(f => [f.id, f.type === 'categorical' ? f.levels[0] : +decode(f, Math.round((g.random() * 1.2 - 0.6) * 20) / 20).toPrecision(6)]));
      qs.push({ id: 'prediction', kind: 'prediction', settings: at, text: `Predict ${response.name.toLowerCase()} at ${Object.entries(at).map(([k, v]) => `${k} = ${v}`).join(', ')}.` });
    }
  }
  qs.push({ id: 'budget', kind: 'budget', text: 'Stay within the run budget.' });
  return qs;
}

function assemble({ id, topic, difficulty, seed, scenario, sc, factors, response, budget, questions, process, attempt }) {
  const study = createStudy({ aikidoe: FORMAT_VERSION, name: `${sc.title} (${TOPICS[topic].title.toLowerCase()})`, seed,
    description: `${sc.text} Budget: ${budget} runs.`,
    factors, responses: [{ id: response.id, name: response.name, units: response.units, ...(questions.some(q => q.kind === 'best') ? { goal: response.goal } : {}) }],
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
  const proc = { ...t.process, factors: study.factors };
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
  const formula = T.curvature ? `${r} ~ quadratic` : (ex.topic === 'screening' || ex.topic === 'fraction') ? `${r} ~ main` : `${r} ~ 2fi`;
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
    case 'plate': {
      const reps = ex.budget / 2 ** k;
      st = make(fullFactorial(levels, { replicates: reps, continuous: cont }), `2^${k} full factorial, ${reps} replicates (${ex.budget} runs)`);
      st = createStudy(layoutPlates(st, { layout: 'balanced', seed: ex.seed }).study);
      steps.push('laid out on the plate with the balanced layout: controls spread over the plate, the runs placed so that the effects are not entangled with the edge or the row and column gradients; fit main effects and two-factor interactions with the position terms (Edge, Row, Col)');
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

/** The strategy a lesson compares with: one factor at a time, the tidy plate layout, or evenly spaced doses. */
export function comparisonStrategy(ex, truth = truthOf(ex)) {
  const T = TOPICS[ex.topic];
  if (T.dose) return linearDoseStrategy(ex, truth);
  if (T.plate) return tidyPlateStrategy(ex, truth);
  return ofatStrategy(ex, truth);
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

function referencePower(ex, truth, study) {
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
  const terms = Object.entries(resp.truth.terms).filter(([t]) => (curv ? t.startsWith('I(') : !t.startsWith('I(')));
  if (!terms.length) return 1;
  const model = curv ? 'quadratic' : (ex.topic === 'screening' || ex.topic === 'fraction') ? 'main' : '2fi';
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

// ---------------------------------------------------------------- grading

/** The true active factors, effects (low → high) and optimum of an exercise. */
export function trueFacts(ex, truth = truthOf(ex)) {
  const resp = truth.process.responses[0], proc = { ...truth.process, factors: ex.study.factors };
  if (resp.curve) {
    const [ref, test] = Object.keys(resp.curve.levels);
    return { active: [], effects: {}, sigma: resp.sigma, ec50: resp.curve.levels[test].e, potency: resp.curve.levels[ref].e / resp.curve.levels[test].e, reference: ref, test };
  }
  const active = [...new Set(Object.keys(resp.truth.terms).flatMap(t => t.replace(/I\((\w+)\^2\)/g, '$1').split(':')))];
  const effects = Object.fromEntries(ex.study.factors.filter(f => resp.truth.terms[f.id] !== undefined).map(f => [f.id, 2 * resp.truth.terms[f.id]]));
  const mu = (s) => trueMean(proc, resp.id, s);
  const goal = ex.study.responses[0].goal ?? MAX;
  const opt = bestSettings(ex.study, mu, goal);
  const worst = bestSettings(ex.study, mu, goal === 'minimize' ? MAX : 'minimize');
  return { active, effects, best: opt, bestValue: mu(opt), worstValue: mu(worst), mu, sigma: resp.sigma, goal };
}

/**
 * Grade answers: { active: [ids], effects: { id: { estimate, lower, upper } }, best: settings,
 * prediction: { value } } and runs used. Returns { score (0–100), parts: [{ id, score, max, note }],
 * truth facts for feedback }.
 */
export function gradeAnswers(ex, truth, answers, { runs } = {}) {
  const F = trueFacts(ex, truth), parts = [];
  const W = { active: 40, effects: 25, best: 25, prediction: 10, ec50: 50, potency: 50 };
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
  return { score, parts, truth: { active: F.active, effects: F.effects, best: F.best, bestValue: F.bestValue, ...(F.ec50 !== undefined ? { ec50: F.ec50, potency: F.potency } : {}) } };
}

/** Grade a study: its exercise answers if given, else answers derived by the standard analysis. */
export function gradeStudy(ex, study, truth = truthOf(ex)) {
  const given = study.exercise?.answers;
  const derived = !given;
  const answers = given ?? deriveAnswers(ex, study);
  return { ...gradeAnswers(ex, truth, answers, { runs: study.design?.runs.length ?? 0 }), answers, derived, modelAnswer: truth.modelAnswer };
}
