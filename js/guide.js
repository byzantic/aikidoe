// The Guide (issue #60): a questionnaire that leads a beginner from what they want to find out to
// a staged plan and a design family, with the reasons, warnings, lessons and manual sections. Pure
// logic, shared by the Guide step (ui/guide.js) and the tests; the ranked designs themselves come
// from the recommender (js/design/recommend.js) on the study guideStudy() builds.
//
//   QUESTIONS                 [{ id, text, why, help: [page, anchor], type, options?, when? }]
//   nextQuestion(answers)     → the first question asked but not answered, or null when done
//   asked(answers)            → the questions that apply to these answers, in order
//   advise(answers)           → { goal, delta, budget, family, headline, runs, plan, notes, warnings,
//                                 lessons, manual, optimal }
//   guideStudy(answers)       → a study object (placeholder factors) for the Define step
import { createStudy, FORMAT_VERSION } from './study.js';
import { ccd, boxBehnken } from './design/rsm.js';
import { definitiveScreening } from './design/dsd.js';

const PHYSICAL = (a) => a.aim && a.aim !== 'measure' && a.aim !== 'simulate';
const FACTORIAL = (a) => PHYSICAL(a) && a.aim !== 'dose';            // the questions about factors and models

export const QUESTIONS = [
  { id: 'aim', type: 'choice', text: 'What do you want to find out?',
    why: 'The question decides the design. Finding the few factors that matter among many (screening) needs far fewer runs per factor than describing how a few factors act together, and finding an optimum needs curvature, which two-level designs cannot see.',
    help: ['concepts', 'sequential-experimentation'],
    options: [
      { value: 'screen', label: 'Which of many possible factors matter', hint: 'five or more candidates, most probably unimportant' },
      { value: 'understand', label: 'How a few factors affect the result, and whether they interact', hint: 'two to eight factors you already believe matter' },
      { value: 'optimise', label: 'The best settings', hint: 'a maximum, minimum or target' },
      { value: 'robust', label: 'Settings that make the result insensitive to variation I cannot control', hint: 'e.g. incoming material, ambient conditions' },
      { value: 'dose', label: 'How the result depends on a dose or concentration', hint: 'an EC50, a relative potency, a standard curve' },
      { value: 'measure', label: 'Whether my measurement is good enough', hint: 'before any experiment' },
      { value: 'simulate', label: 'How a simulation model behaves', hint: 'a simulator, not a physical process' },
    ] },
  { id: 'operators', type: 'choice', when: (a) => a.aim === 'measure', text: 'Do several people, tools or fixtures make the measurement?',
    why: 'A gauge study separates repeatability (the same operator measuring the same part again) from reproducibility (different operators). With one operator only repeatability can be estimated.',
    help: ['process', 'gauge-rr'],
    options: [{ value: 'several', label: 'Yes, several' }, { value: 'one', label: 'No, one' }] },
  { id: 'measurement', type: 'choice', when: PHYSICAL, text: 'How well do you know your measurement?',
    why: 'Measurement error is part of the noise every effect is compared with. If measuring the same thing twice gives noticeably different answers, small effects disappear in it, and more runs will not fix a gauge that cannot tell parts apart.',
    help: ['concepts', 'responses-and-measurement'],
    options: [
      { value: 'good', label: 'Repeat measurements agree well; the gauge has been checked' },
      { value: 'unsure', label: 'I am not sure' },
      { value: 'poor', label: 'Repeat measurements vary noticeably' },
    ] },
  { id: 'curves', type: 'number', min: 1, max: 24, when: (a) => a.aim === 'dose', text: 'How many curves — compounds, samples or batches — will you compare?',
    why: 'Each compound or sample gets its own curve. With two or more, the usual question is relative potency: how many times less of one gives the same effect as the other — which is one number only if the curves have the same shape. One curve can be a standard curve, for reading unknown samples off it.',
    help: ['dose-response', 'relative-potency'] },
  { id: 'factors', type: 'number', min: 1, max: 30, when: (a) => a.aim && a.aim !== 'measure' && a.aim !== 'dose', text: 'How many factors — things you can set — will you vary?',
    why: 'Count every setting you might change, including ones you suspect do not matter: a factor left out cannot be found, and one held fixed is part of the conditions the result applies to. In a robust-design study, count the noise factors you can set deliberately in the experiment too.',
    help: ['concepts', 'factors-and-coded-units'] },
  { id: 'names', type: 'text', optional: true, when: (a) => a.aim && a.aim !== 'measure' && a.aim !== 'dose', text: 'Their names (optional, separated by commas)',
    why: 'Only to label the study the guide creates; you can rename the factors and set their ranges on the Define step.',
    help: ['concepts', 'factors-and-coded-units'] },
  { id: 'types', type: 'choice', when: FACTORIAL, text: 'What kind of factors are they?',
    why: 'A continuous factor has a range (temperature 900–1000 °C) and can be set between its ends, so curvature can be studied. A categorical factor is a choice (supplier A or B). Two-level choices fit the standard factorial designs; three or more choices usually need an optimal design.',
    help: ['concepts', 'factors-and-coded-units'],
    options: [
      { value: 'continuous', label: 'All continuous (a setting with a range)' },
      { value: 'two-level', label: 'Some are choices between two options' },
      { value: 'multi', label: 'Some are choices among three or more options' },
    ] },
  { id: 'categorical', type: 'number', min: 1, max: 30, when: (a) => FACTORIAL(a) && (a.types === 'two-level' || a.types === 'multi'), text: 'How many of them are choices (categorical)?',
    why: 'Only to set up the study; you can change any factor\'s type on the Define step.',
    help: ['concepts', 'factors-and-coded-units'] },
  { id: 'htc', type: 'number', min: 0, max: 30, when: FACTORIAL, text: 'How many factors are hard, slow or expensive to change between runs? (0 if none)',
    why: 'A furnace temperature that takes hours to settle, or a fixture that has to be rebuilt, tempts you to run all the low settings first and then all the high ones. That confounds the factor with everything that drifts over time. A split-plot design changes the hard factor a limited number of times on purpose, and its analysis tests that factor against the right, larger error.',
    help: ['designs-split-plot', ''] },
  { id: 'groups', type: 'choice', when: PHYSICAL, text: 'Will the runs be done in groups that may differ — several days, batches of material, chambers?',
    why: 'Groups that differ add a shift to every run in them. If the design is arranged in blocks, one per group, the shifts are removed in the analysis instead of inflating the noise or masquerading as effects.',
    help: ['concepts', 'randomisation-and-blocking'],
    options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No — all in one session, from one batch' }] },
  { id: 'groupSize', type: 'number', min: 2, max: 1000, when: (a) => PHYSICAL(a) && a.groups === 'yes', text: 'How many runs fit in one group?',
    why: 'The block size: e.g. the number of runs one day or one batch allows.',
    help: ['concepts', 'randomisation-and-blocking'] },
  { id: 'plates', type: 'choice', when: PHYSICAL, text: 'Are the runs wells on microplates (96-well, 384-well …)?',
    why: 'Wells are not all alike: the outer ring evaporates and warms faster, pipettes and readers leave row and column differences, and plates differ. Filling a plate the tidy way (each condition in a row, controls in one column) puts those differences into the effects; a balanced layout spreads them, and the analysis takes out the plate, edge and gradients.',
    help: ['plates', ''],
    options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
  { id: 'curvature', type: 'choice', when: (a) => FACTORIAL(a) && a.aim !== 'optimise', text: 'Could the response peak, dip or level off inside the ranges you will use?',
    why: 'Two-level designs fit straight lines between the low and high settings and cannot see curvature. Centre points test for it cheaply; designs with three levels can estimate it.',
    help: ['designs-rsm', ''],
    options: [{ value: 'no', label: 'Unlikely — roughly linear over the ranges' }, { value: 'unsure', label: 'Not sure' }, { value: 'yes', label: 'Likely' }] },
  { id: 'constraints', type: 'choice', when: FACTORIAL, text: 'Can every combination of settings be run?',
    why: 'Standard designs put runs at the corners of the region — every factor at an extreme at once. If those are unsafe, a design without corner runs helps; if some combinations are impossible, an optimal design can be searched within what is allowed.',
    help: ['designs-optimal', 'constraints'],
    options: [
      { value: 'none', label: 'Yes, any combination within the ranges' },
      { value: 'corners', label: 'All extremes at once would be unsafe or impractical' },
      { value: 'combos', label: 'Some combinations are impossible (e.g. high temperature with long time)' },
    ] },
  { id: 'effect', type: 'choice', when: (a) => FACTORIAL(a), text: 'How big a change in the result matters, compared with its run-to-run scatter?',
    why: 'This is what decides the number of runs. The scatter (σ) is the standard deviation of repeated runs at the same settings, measurement included. To have an 80 % chance of detecting an effect Δ in a two-level design takes roughly N ≈ 32 / (Δ/σ)² runs, plus a few for the error estimate: about 8 runs for 2σ, 32 for 1σ, 128 for σ/2.',
    help: ['concepts', 'power'],
    options: [
      { value: 'large', label: 'Large — at least three times the scatter' },
      { value: 'medium', label: 'About twice the scatter' },
      { value: 'small', label: 'About the size of the scatter, or smaller' },
      { value: 'unknown', label: 'I do not know the scatter' },
    ] },
  { id: 'budget', type: 'number', min: 1, max: 10000, optional: true, when: (a) => a.aim && a.aim !== 'measure', text: 'How many runs can you afford in total? (leave empty if not sure)',
    why: 'The budget for the whole investigation, follow-up and confirmation runs included. The guide warns when the plan does not fit, and the recommender ranks designs within it.',
    help: ['concepts', 'sequential-experimentation'] },
  { id: 'stages', type: 'choice', when: PHYSICAL, text: 'Can you run in stages, looking at the results in between?',
    why: 'Experimenting in stages is usually cheaper: the first experiment tells you where to spend the rest. A common rule is to spend no more than a quarter to a half of the budget on the first one.',
    help: ['designs-sequential', ''],
    options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No — everything must be planned and run at once' }] },
];

const Q = Object.fromEntries(QUESTIONS.map(q => [q.id, q]));
export const questionById = (id) => Q[id];

/** The questions that apply to these answers, in order. */
export const asked = (answers) => QUESTIONS.filter(q => !q.when || q.when(answers));
const answered = (q, a) => a[q.id] !== undefined && a[q.id] !== null && a[q.id] !== '';
/** The first applicable question not yet answered (optional ones count once skipped: answer null). */
export const nextQuestion = (answers) => asked(answers).find(q => !(q.id in answers) || (!q.optional && !answered(q, answers))) ?? null;

/** Check a number answer: an error message or null. */
export function checkAnswer(q, v, answers = {}) {
  if (q.type !== 'number') return null;
  if (v === null || v === '' || v === undefined) return q.optional ? null : 'an answer is needed';
  if (!Number.isInteger(v)) return 'a whole number, please';
  const max = q.id === 'htc' || q.id === 'categorical' ? answers.factors ?? q.max : q.max;
  if (v < q.min || v > max) return `between ${q.min} and ${max}`;
  return null;
}

const DELTA = { large: 3, medium: 2, small: 1, unknown: 2 };
const pow2 = (k) => 2 ** Math.ceil(Math.log2(k + 1));
const resIIIruns = (k) => pow2(k);                                       // 8 for 4–7, 16 for 8–15
const resIVruns = (k) => (k <= 4 ? 8 : k <= 8 ? 16 : k <= 16 ? 32 : 64);
const resVruns = (k) => (k <= 4 ? 2 ** k : k === 5 ? 16 : k === 6 ? 32 : k <= 8 ? 64 : 128);
// the app's own designs, so the run counts agree with the Design step
const dsdRuns = (k, cats = 0) => definitiveScreening(k, { categorical: Array.from({ length: cats }, (_, j) => k - 1 - j) }).X.length;
const ccdRuns = (k) => ccd(k, { cubeRuns: { 5: 16, 6: 32, 7: 64, 8: 64 }[k] ?? 2 ** k }).X.length;
const bbdRuns = (k) => boxBehnken(k).X.length;
const quad = (k) => (k + 1) * (k + 2) / 2;
const twofi = (k) => 1 + k + k * (k - 1) / 2;

const M = (page, anchor, label) => ({ page, anchor, label });

/**
 * The plan for the answers given so far (complete when nextQuestion(answers) is null).
 */
export function advise(a) {
  const plan = [], notes = [], warnings = [], lessons = [], manual = [];
  const out = { goal: null, delta: DELTA[a.effect] ?? 2, budget: Number.isInteger(a.budget) ? a.budget : null, family: null, headline: '', runs: null, plan, notes, warnings, lessons, manual, optimal: false };
  const lesson = (...ids) => { for (const id of ids) if (!lessons.includes(id)) lessons.push(id); };
  const read = (...ms) => { for (const m of ms) if (!manual.some(x => x.page === m.page && x.anchor === m.anchor)) manual.push(m); };

  if (a.aim === 'measure') {
    const several = a.operators !== 'one';
    Object.assign(out, { family: 'gauge', headline: `Gauge R&R study: 10 parts × ${several ? '3 operators × 2' : '1 operator × 3'} repeat measurements`, runs: several ? 60 : 30 });
    plan.push({ title: 'Gauge R&R', text: `Choose 10 parts that span the range you expect in the experiment (not 10 good ones). ${several ? 'Each of 3 operators measures every part twice' : 'Measure every part 3 times'}, in random order, without seeing earlier results. Enter the readings in the response's gauge panel (the “gauge…” button on the Define step) or analyse them with \`doe gauge\`.` });
    notes.push('Read the result as: gauge variation as a percentage of the total (below 10 % good, 10–30 % acceptable for some purposes, above 30 % not good enough) and the number of distinct categories (5 or more).');
    if (!several) notes.push('With one operator, reproducibility is not estimated: if other people or tools will measure in the experiment, include them.');
    lesson('gauge'); read(M('process', 'gauge-rr', 'Gauge R&R'), M('example-gauge', '', 'worked example: gauge R&R'));
    return out;
  }
  if (a.aim === 'simulate') {
    const k = a.factors ?? 1, n = Math.max(10 * k, quad(k) + 5);
    Object.assign(out, { goal: 'model', family: 'lhs', headline: `Latin hypercube of about ${n} runs, then a surrogate model`, runs: n });
    plan.push({ title: 'Space-filling design', text: `A maximin Latin hypercube of about ${n} runs (10 per factor) spreads the runs over the whole region; a simulator has no noise, so replication and randomisation do not apply.` });
    plan.push({ title: 'Surrogate, sensitivity, yield', text: 'Fit a surrogate (check its cross-validated error before trusting it), find which inputs drive the output with Sobol indices, and estimate yield against specifications.' });
    if (a.constraints === 'combos') warnings.push('Infeasible regions: the simulator should report failed runs (NA) rather than nonsense values.');
    lesson('simulation'); read(M('designs-space-filling', 'latin-hypercube', 'Latin hypercube'), M('simulation', 'surrogates', 'surrogates'), M('simulation', 'yield', 'yield'));
    budgetCheck(out, warnings);
    return out;
  }

  const k = a.factors ?? 0, htc = a.htc ?? 0, cats = a.types === 'continuous' ? 0 : (a.categorical ?? 0);
  const cont = k - cats, multi = a.types === 'multi', combos = a.constraints === 'combos', corners = a.constraints === 'corners';
  const stages = a.stages !== 'no', curv = a.curvature;

  // stage 0: the measurement
  if (a.measurement === 'poor' || a.measurement === 'unsure') {
    plan.push({ title: 'Check the measurement first', text: 'A small gauge study (10 parts, 2–3 repeats each) tells you how much of the scatter is the measurement. If it is a large part, improve the measurement before experimenting: more runs only average it down slowly.' });
    (a.measurement === 'poor' ? warnings : notes).push(a.measurement === 'poor' ? 'Repeat measurements vary noticeably: effects smaller than that variation will be hard to see whatever the design.' : 'Measurement unknown: a short gauge study first is cheap insurance.');
    lesson('gauge'); read(M('process', 'gauge-rr', 'Gauge R&R'));
  }

  let aim = a.aim;
  if (aim === 'dose') {
    const nc = a.curves ?? 1, perCurve = 1 + 6 + 16;          // range-finding (zero and 6 doses), then 8 doses × 2
    Object.assign(out, { family: 'dose', runs: nc * 7, headline: `Dose–response: a range-finding series, then doses around the EC50${nc > 1 ? `, for ${nc} curves` : ''}` });
    plan.push({ title: 'Range-finding', text: `Zero and six doses a decade apart (or a 1:10 dilution series) from the highest dose you can use, once ${nc > 1 ? 'for each compound or sample' : ''}: where does the response start to move, and where does it level off?`.replace('once :', 'once:') });
    plan.push({ title: 'Around the EC50', text: 'Eight or so doses log-spaced over two to three decades around the EC50 the first stage suggests, two or three replicates each (Design step: dose–response design, "Add these doses as a new stage"). Doses on the slope are what fix the EC50; doses on the flat ends fix the asymptotes.' });
    plan.push({ title: 'Fit', text: `A four-parameter log-logistic curve${nc > 1 ? ' per compound; for relative potency, parallel curves (same slope and asymptotes), checked for parallelism' : ''} — the EC50 with an interval on the log scale${nc === 1 ? ', and doses for unknown samples read off the curve (a standard curve) with LOD and LOQ' : ''}.` });
    notes.push('Space doses on a log scale (a dilution series), never evenly on a linear one: evenly spaced doses mostly land on the flat top of the curve. Include untreated (zero-dose) wells, and if the variance grows with the response, weight the fit (variance ∝ mean^θ).');
    if (out.budget !== null && out.budget < nc * perCurve) warnings.push(`The budget (${out.budget} runs) is below the ${nc * perCurve} this plan uses (${perCurve} per curve): fewer doses in the second stage, or fewer replicates.`);
    if (a.plates === 'yes') notes.push('On plates: lay the dilution series out with the balanced layout, so no dose sits only on the edge or in one row.');
    if (a.stages === 'no') notes.push('One experiment only: use a design that is good over the range of EC50s you think possible (Design step: optimal for a guess, robust ×/÷ 10).');
    lesson('dose'); read(M('dose-response', '', 'dose–response'), M('dose-response', 'choosing-doses', 'choosing doses'), M('dose-response', 'fitting-curves', 'fitting curves'));
    return out;
  }
  if (aim === 'robust') {
    notes.push('Robust design: include the noise factors — the ones that vary in production — as factors you set deliberately in the experiment, and mark them as noise on the Define step (with their production spread). The interactions between control and noise factors are what make a process robust, so the design must estimate them.');
    lesson('robust'); read(M('optimisation', 'robust-design', 'robust design'));
    aim = k > 8 ? 'screen' : 'understand';
  }
  if (aim === 'screen' && k <= 4) { notes.push(`With ${k} factor${k === 1 ? '' : 's'}, screening is not needed: a full factorial costs only ${2 ** k} runs and answers more.`); aim = 'understand'; }

  const stagesFirst = (title, text) => plan.push({ title, text });
  const htcText = htc ? ` Factor${htc > 1 ? 's' : ''} hard to change: set ${htc > 1 ? 'them' : 'it'} once per whole plot and vary the others within; the analysis is a mixed model, and the power for the hard-to-change factor${htc > 1 ? 's' : ''} depends on the number of whole plots, not the number of runs.` : '';
  if (htc) { lesson('split-plot'); read(M('designs-split-plot', '', 'split-plot designs'), M('analysis', 'mixed-models', 'mixed models')); }
  if (htc && htc === k) warnings.push('Every factor is hard to change: a split-plot needs some easy-to-change factors to vary within the whole plots. Either reset the factors for every run (completely randomised, slower) or accept fewer, larger groups.');

  if (aim === 'screen') {
    out.goal = 'screen';
    if (multi || combos) {
      Object.assign(out, { family: htc ? 'sp-optimal' : 'optimal', optimal: true, runs: Math.max(k + 1 + 4, 12), headline: `${htc ? 'Optimal split-plot' : 'Optimal (D-optimal)'} screening design for main effects` });
      stagesFirst('Screen', `${multi ? 'Choices among three or more options do not fit the standard two-level designs' : 'Impossible combinations rule out the standard designs'}: a D-optimal design for the main effects, with a few runs to spare for the error estimate (about ${out.runs}).${htcText}`);
      lesson('optimal'); read(M('designs-optimal', combos ? 'constraints' : 'criteria', 'optimal designs'));
    } else if (cont >= 3 && curv !== 'no' && !htc && k <= 14) {
      Object.assign(out, { family: 'dsd', runs: dsdRuns(k, cats), headline: `Definitive screening design (${dsdRuns(k, cats)} runs)` });
      stagesFirst('Screen', `A definitive screening design has three levels: main effects are clear of two-factor interactions and of curvature, and a few active factors can be modelled with curvature from the same runs (${dsdRuns(k, cats)} runs for ${k} factors).`);
      read(M('designs-screening', 'definitive-screening', 'definitive screening'));
    } else {
      const small = out.budget !== null && out.budget < resIVruns(k);
      if (small) {
        Object.assign(out, { family: htc ? 'sp-frac' : 'fraction', runs: resIIIruns(k), headline: `${htc ? 'Split-plot ' : ''}resolution III fraction (${resIIIruns(k)} runs), fold-over planned` });
        stagesFirst('Screen', `A resolution III fraction of ${resIIIruns(k)} runs (or a Plackett–Burman design of 12, 20 … runs) estimates main effects, but each is aliased with two-factor interactions. Plan a fold-over (another ${resIIIruns(k)} runs) if the results are ambiguous.${htcText}`);
        lesson('fraction');
      } else {
        Object.assign(out, { family: htc ? 'sp-frac' : 'fraction', runs: resIVruns(k), headline: `${htc ? 'Split-plot ' : ''}resolution IV fraction (${resIVruns(k)} runs)` });
        stagesFirst('Screen', `A resolution IV fraction of ${resIVruns(k)} runs: every main effect is clear of two-factor interactions, which are aliased with each other in pairs.${htcText}`);
      }
      if (cont && curv !== 'no') notes.push('Add 3–4 centre points (continuous factors at mid-range) to check for curvature without spending a level on it.');
      read(M('designs-factorial', 'fractional-factorial', 'fractional factorials'), M('concepts', 'aliasing-and-resolution', 'aliasing and resolution'));
    }
    lesson('screening'); read(M('analysis', 'effects-and-lenths-method', "effects and Lenth's method"));
    if (stages) plan.push({ title: 'Then', text: `With the few active factors found (usually two to four), continue with ${a.aim === 'optimise' ? 'a response-surface design to find the optimum' : 'a full factorial or response surface on just those'}; a fold-over separates aliased effects if needed.` });
  } else if (aim === 'understand') {
    out.goal = 'model';
    if (k > 8) {
      const opt = multi || combos;
      Object.assign(out, { goal: 'screen', family: opt ? (htc ? 'sp-optimal' : 'optimal') : htc ? 'sp-frac' : 'fraction', optimal: opt, runs: opt ? k + 5 : resIVruns(k), headline: `Screen first: ${k} factors are too many to model all interactions` });
      stagesFirst('Screen', `With ${k} factors, the two-factor interactions alone are ${k * (k - 1) / 2} terms. Screen first with ${opt ? `a D-optimal design for the main effects (about ${out.runs} runs)` : `a resolution IV fraction of ${out.runs} runs`}.${htcText}`);
      plan.push({ title: 'Then', text: 'Model the active factors and their interactions with a full factorial or resolution V fraction.' });
      lesson('screening');
    } else if (multi || combos) {
      Object.assign(out, { family: htc ? 'sp-optimal' : 'optimal', optimal: true, runs: twofi(k) + 6, headline: `${htc ? 'Optimal split-plot' : 'D-optimal'} design for main effects and two-factor interactions` });
      stagesFirst('Model', `${multi ? 'Choices among three or more options' : 'Impossible combinations'} rule out the standard designs: a D-optimal design for main effects and two-factor interactions (${twofi(k)} terms; about ${twofi(k) + 6} runs leaves 6 for the error).${htcText}`);
      lesson('optimal'); read(M('designs-optimal', combos ? 'constraints' : 'criteria', 'optimal designs'));
    } else if (k <= 4) {
      const reps = 2 ** k <= 8 ? 2 : 1;
      Object.assign(out, { family: htc ? 'sp-full' : 'full', runs: 2 ** k * reps, headline: `${htc ? 'Split-plot full' : 'Full'} factorial 2${sup(k)}${reps > 1 ? `, ${reps} replicates` : ''} (${2 ** k * reps} runs)` });
      stagesFirst('Model', `A full factorial runs every combination of the ${k} factors at two levels, so every main effect and interaction can be estimated${reps > 1 ? '; replicating it gives an error estimate and the power for medium effects' : ''}.${htcText}`);
      lesson('why', 'factorial'); read(M('designs-factorial', 'full-factorial', 'full factorials'));
    } else {
      Object.assign(out, { family: htc ? 'sp-frac' : 'fraction', runs: resVruns(k), headline: `${htc ? 'Split-plot ' : ''}resolution V fraction (${resVruns(k)} runs)` });
      stagesFirst('Model', `A resolution V fraction of ${resVruns(k)} runs estimates every main effect and two-factor interaction clear of each other.${htcText}`);
      if (k >= 7) notes.push(`For ${k} factors resolution V needs ${resVruns(k)} runs; if that is too many, screen with ${resIVruns(k)} runs first, or use an optimal design for the interactions you expect.`);
      lesson('factorial'); read(M('designs-factorial', 'fractional-factorial', 'fractional factorials'));
    }
    if (cont && curv !== 'no' && k <= 8) notes.push(`Add 3–5 centre points to test for curvature${curv === 'yes' && stages ? '; if it is there, add axial points to make a central composite design' : ''}.`);
    if (curv === 'yes' && cont && !stages) notes.push('Curvature likely and only one experiment: consider the optimise route (a response-surface design) instead.');
  } else if (aim === 'optimise') {
    out.goal = 'optimise';
    if (k > 5) {
      const opt = multi || combos;
      Object.assign(out, { goal: 'screen', optimal: opt, family: opt ? (htc ? 'sp-optimal' : 'optimal') : htc ? 'sp-frac' : cont >= 3 && k <= 14 ? 'dsd' : 'fraction', headline: `Screen first, then a response surface on the active factors` });
      out.runs = out.family === 'dsd' ? dsdRuns(k, cats) : opt ? k + 5 : resIVruns(k);
      stagesFirst('Screen', `${k} factors: a full quadratic would need ${quad(k)} terms. Screen first with ${out.family === 'dsd' ? `a definitive screening design (${out.runs} runs), which also shows strong curvature` : opt ? `a D-optimal design for the main effects (about ${out.runs} runs)` : `a resolution IV fraction (${out.runs} runs)`}.${htcText}`);
      plan.push({ title: 'Then optimise', text: 'A central composite or Box–Behnken design on the two to four active factors, then confirmation runs at the predicted best settings.' });
      if (!stages) warnings.push('Optimising this many factors in one experiment, without screening first, takes a large design; running in stages is strongly recommended.');
      lesson('screening', 'rsm');
    } else if (cats || combos || htc) {
      const p = quad(cont) + cats + cont * cats;              // quadratic in the continuous factors, plus the choices and their interactions with them
      Object.assign(out, { family: htc ? 'sp-optimal' : 'optimal', optimal: true, runs: p + 6, headline: `${htc ? 'Optimal split-plot' : 'I-optimal'} response-surface design` });
      stagesFirst('Optimise', `${htc ? 'A hard-to-change factor rules' : cats ? 'Choice (categorical) factors rule' : 'Impossible combinations rule'} out the classical response-surface designs: an optimal design for a quadratic model (about ${p} terms; about ${p + 6} runs).${htcText}`);
      lesson('optimal'); read(M('designs-optimal', htc ? 'split-plot' : combos ? 'constraints' : 'criteria', 'optimal designs'));
    } else if (k === 1) {
      Object.assign(out, { family: 'full', runs: 5, headline: 'One factor: five or more levels, replicated' });
      stagesFirst('Optimise', 'With one factor, run five or more evenly spaced levels (some replicated) and fit a quadratic.');
    } else if (corners && k >= 3) {
      Object.assign(out, { family: 'bbd', runs: bbdRuns(k), headline: `Box–Behnken design (${bbdRuns(k)} runs)` });
      stagesFirst('Optimise', `A Box–Behnken design has three levels and no run with every factor at an extreme, and fits a full quadratic (${bbdRuns(k)} runs for ${k} factors).`);
      read(M('designs-rsm', 'boxbehnken', 'Box–Behnken'));
    } else if (stages) {
      Object.assign(out, { family: 'ccd', runs: ccdRuns(k), headline: `Central composite design, in two stages (${ccdRuns(k)} runs)` });
      stagesFirst('Stage 1: factorial and centre points', `A 2${sup(k)}${k === 5 ? '⁻¹' : ''} factorial with 4 centre points: the slopes and interactions, and a test for curvature. If there is no curvature, the optimum is probably outside the ranges: move the ranges in the direction of improvement.`);
      plan.push({ title: 'Stage 2: axial points', text: `If there is curvature, add axial points and 2 more centre points — together a central composite design${corners || k === 2 ? ' (face-centred if the ranges are hard limits)' : ''} — and fit the full quadratic.` });
      read(M('designs-sequential', 'axial-points', 'axial points'));
    } else {
      Object.assign(out, { family: 'ccd', runs: ccdRuns(k), headline: `Central composite design (${ccdRuns(k)} runs)` });
      stagesFirst('Optimise', `A central composite design: a two-level factorial, axial points and centre points, for the full quadratic (${ccdRuns(k)} runs for ${k} factors). Face-centred if the ranges are hard limits.`);
    }
    if (k <= 5) { lesson('rsm'); read(M('designs-rsm', 'central-composite', 'central composite designs'), M('optimisation', 'best-settings', 'best settings')); }
    plan.push({ title: 'Confirm', text: 'Run 3–4 confirmation runs at the predicted best settings and check they fall within the prediction interval before acting on the model.' });
    read(M('designs-sequential', 'confirmation-runs', 'confirmation runs'));
  }

  // microplates
  if (a.plates === 'yes') {
    notes.push('Runs in wells: lay the design out on the plates with the balanced layout (Design step → plate layout, or `doe plate`), with positive and negative controls spread over every plate. Each plate is a block; the analysis adds the edge and row and column gradients, and the controls give Z′ for the assay window.');
    lesson('plate'); read(M('plates', '', 'microplates'), M('plates', 'layouts', 'plate layouts'));
  }
  // groups → blocks
  if (a.groups === 'yes') {
    const g = a.groupSize ?? 0;
    notes.push(`Arrange the design in blocks of up to ${g || 'one group\'s'} runs (Design step: blocks), one block per ${'day or batch'}, and keep the block term in the analysis.${out.runs && g && out.runs > g ? ` About ${Math.ceil(out.runs / g)} blocks for ${out.runs} runs.` : ''}`);
    lesson('blocking'); read(M('concepts', 'randomisation-and-blocking', 'randomisation and blocking'));
  }
  if (corners && out.family !== 'bbd') notes.push('Extremes unsafe: shrink the ranges so that every corner is safe, use a face-centred design, or define constraints and use an optimal design.');

  // effect size → runs
  const need = Math.ceil(32 / out.delta ** 2) + 6;
  if (a.effect === 'small') {
    warnings.push(`Effects about the size of the scatter need roughly ${need} runs or more for 80 % power. Widen the factor ranges (effects grow with them), reduce the scatter, or accept that small effects may be missed. Check the power of the actual design on the Design step.`);
    lesson('power'); read(M('concepts', 'power', 'power'));
  } else if (a.effect === 'unknown') notes.push('Scatter unknown: the guide assumes effects of twice the scatter. Replicates or centre points give an estimate of it from this experiment; check the power on the Design step.');
  budgetCheck(out, warnings, stages);

  notes.push('When running: follow the randomised run order, record anything unusual, write NA for a failed run rather than guessing, and do not adjust settings between runs.');
  read(M('analysis', 'diagnostics', 'checking a fit'));
  return out;
}

function budgetCheck(out, warnings, stages = false) {
  if (out.budget === null || !out.runs) return;
  if (out.budget < out.runs) warnings.push(`The budget (${out.budget} runs) is below what this plan's first experiment needs (about ${out.runs}). Fewer factors, wider ranges or a smaller design (screening first) are the options; the recommender shows what fits.`);
  else if (stages && out.runs > out.budget / 2) warnings.push(`The first experiment (about ${out.runs} runs) uses more than half the budget (${out.budget}): little is left for follow-up and confirmation.`);
}

const sup = (k) => String(k).split('').map(d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]).join('');

/** A study for the answers: placeholder factors (coded ranges −1…1) to edit on the Define step. */
export function guideStudy(a, { name = 'Study from the guide' } = {}) {
  if (a.aim === 'dose') {
    const nc = Math.max(1, a.curves ?? 1), adv = advise(a);
    const factors = [{ id: 'dose', name: 'Dose', low: 0, high: 100 }, ...(nc > 1 ? [{ id: 'sample', name: 'Sample', levels: Array.from({ length: nc }, (_, i) => (i === 0 ? 'reference' : nc === 2 ? 'test' : `test${i}`)) }] : [])];
    const description = [`Planned with the guide: ${adv.headline}.`, ...adv.plan.map((p, i) => `${i + 1}. ${p.title}: ${p.text}`)].join('\n');
    return createStudy({ aikidoe: FORMAT_VERSION, name, description, factors, responses: [{ id: 'y', name: 'Response' }] });
  }
  const k = a.factors ?? 2, cats = a.types && a.types !== 'continuous' ? Math.min(a.categorical ?? 1, k) : 0, htc = Math.min(a.htc ?? 0, k);
  const names = String(a.names ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const used = new Set();
  const idOf = (nm, j) => {
    let id = (nm.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f$1') || String.fromCharCode(65 + (j % 26)) + (j >= 26 ? Math.floor(j / 26) : ''));
    while (used.has(id)) id += '_';
    used.add(id); return id;
  };
  const factors = Array.from({ length: k }, (_, j) => {
    const nm = names[j] ?? `Factor ${j < 26 ? String.fromCharCode(65 + j) : j + 1}`;
    const id = idOf(names[j] ?? (j < 26 ? String.fromCharCode(65 + j) : `X${j + 1}`), j);
    const cat = j >= k - cats;
    const f = cat ? { id, name: nm, type: 'categorical', levels: a.types === 'multi' ? ['a', 'b', 'c'] : ['a', 'b'] } : { id, name: nm, low: -1, high: 1 };
    if (j < htc) f.htc = true;
    return f;
  });
  const adv = advise(a);
  const description = [`Planned with the guide: ${adv.headline}.`, ...adv.plan.map((p, i) => `${i + 1}. ${p.title}: ${p.text}`)].join('\n');
  return createStudy({ aikidoe: FORMAT_VERSION, name, description, factors, responses: [{ id: 'y', name: 'Response' }] });
}
