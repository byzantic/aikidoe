// The tutorial's lessons (spec §16.2, issue #39): a short explanation linked to the manual, a task
// on a generated exercise (#38), hints while working, graded feedback. Lessons without an exercise
// topic yet are listed but locked.
import { TOPICS } from './exercise.js';

const M = (page, anchor, label) => `[${label}](docs/manual/index.html?p=${page}${anchor ? `#${anchor}` : ''})`;

export const LESSONS = [
  { id: 'why', n: 1, title: 'Why designed experiments', topic: 'factorial', difficulty: 'medium', compare: true,
    text: `Changing one factor at a time is how most of us start: hold everything else fixed, move one knob, see what happens. It misses interactions — the effect of one factor depending on another — and every effect is estimated from only a few of the runs.

A factorial design changes several factors together in a balanced pattern, so every run tells you about every factor, and interactions show up. On this exercise, run a full factorial within the budget, then compare your grade with what one-factor-at-a-time would have scored on the same process.`,
    manual: [M('concepts', 'replication-and-repeated-measurement', 'replication'), M('designs-factorial', 'full-factorial', 'full factorials')] },
  { id: 'factorial', n: 2, title: 'Full factorials, effects and interactions', topic: 'factorial', difficulty: 'medium',
    text: `A 2³ full factorial runs every combination of three factors at two levels. The **effect** of a factor is the change in the response from its low to its high setting, averaged over the others; an **interaction** A:B says the effect of A depends on B.

Choose a full factorial with replicates (the budget allows two), get the results, fit main effects and two-factor interactions on the Analyse step, and look at the interaction plot. Then answer: which factors matter, how much, and which settings are best.`,
    manual: [M('designs-factorial', 'full-factorial', 'full factorials'), M('analysis', 'least-squares-fits', 'least-squares fits'), M('concepts', 'factors-and-coded-units', 'coded units')] },
  { id: 'power', n: 3, title: 'Replication, noise and power', topic: 'factorial', difficulty: 'hard',
    text: `Here the effects are only a little larger than the noise. Before running anything, look at the **power** of each term on the Design step: the chance of detecting an effect of a given size. Replication is what buys it — each replicate halves the variance of an effect only when it is a genuinely new run.

Find a design within the budget whose power is adequate (0.8 or more) for effects of about 2.4σ, then run it and answer.`,
    manual: [M('concepts', 'power', 'power'), M('concepts', 'replication-and-repeated-measurement', 'replicates and repeated measurements')] },
  { id: 'fraction', n: 4, title: 'Fractions, aliasing and fold-over', topic: 'fraction', difficulty: 'medium',
    text: `Five factors need 32 runs for a full factorial; a fraction uses fewer, at the price of **aliasing**: some effects cannot be told apart. In an 8-run 2⁵⁻² fraction each main effect is aliased with two-factor interactions (resolution III).

Run the 8-run fraction, look at the alias chains, then add a **fold-over** (Design → Next stage): the 8 runs with every sign reversed. Together they separate the main effects from the interactions. Then answer.`,
    manual: [M('concepts', 'aliasing-and-resolution', 'aliasing and resolution'), M('designs-sequential', 'fold-over', 'fold-over')] },
  { id: 'screening', n: 5, title: 'Screening many factors', topic: 'screening', difficulty: 'medium',
    text: `With six or seven candidate factors, usually only a few matter (**effect sparsity**). A 16-run resolution IV fraction estimates every main effect clear of two-factor interactions; Plackett–Burman and definitive screening designs are the alternatives.

Use **Recommend** on the Design step (goal: screen, budget 16), run the design, and find the active factors.`,
    manual: [M('designs-screening', '', 'screening designs'), M('designs-factorial', 'fractional-factorial', 'fractional factorials')] },
  { id: 'blocking', n: 6, title: 'Blocking and randomisation', topic: 'blocking', difficulty: 'medium',
    text: `The tool can do 8 runs a day, and days differ — a different chamber condition, a new bottle of gas. If the high settings of a factor happen to fall on a good day, the day masquerades as an effect.

**Randomisation** spreads the days over the factors; **blocking** does better: arrange the design in two blocks of 8, one per day, so the day difference falls on an interaction you can spare and the analysis removes it.`,
    manual: [M('concepts', 'randomisation-and-blocking', 'randomisation and blocking')] },
  { id: 'rsm', n: 7, title: 'Response surfaces: finding an optimum', topic: 'rsm', difficulty: 'medium',
    text: `Near an optimum the response curves, and a two-level design cannot see curvature. A **central composite design** adds axial and centre points to a factorial, so a full quadratic can be fitted and its maximum found.

Run a central composite design, fit the quadratic, find the best settings on the Optimise step, and predict the response at the settings asked.`,
    manual: [M('designs-rsm', 'central-composite', 'central composite designs'), M('optimisation', 'best-settings', 'best settings')] },
  { id: 'optimal', n: 8, title: 'Constraints and optimal designs', topic: null,
    text: 'Coming later: when some factor combinations are impossible, an optimal design searches the feasible region.', manual: [M('designs-optimal', 'constraints', 'constraints')] },
  { id: 'desirability', n: 9, title: 'Several responses: desirability', topic: null,
    text: 'Coming later: trading off several responses with desirability functions.', manual: [M('optimisation', 'desirability', 'desirability')] },
  { id: 'split-plot', n: 10, title: 'Hard-to-change factors and split-plots', topic: 'split-plot', difficulty: 'medium',
    text: `One factor here is hard to change, and every time it is reset it lands a little differently. Resetting it for every run is expensive and adds that variation to every run; never resetting it confounds it with everything else.

A **split-plot** design sets the hard-to-change factor once per group of runs (a whole plot) and varies the others within. Choose a split-plot design with enough whole plots (the budget allows six), run it, and look at the mixed model on the Analyse step: the hard-to-change factor is tested against the whole-plot variation.`,
    manual: [M('designs-split-plot', '', 'split-plot designs'), M('analysis', 'mixed-models', 'mixed models')] },
  { id: 'plate', n: 14, title: 'Plates: where a sample sits matters', topic: 'plate', difficulty: 'medium',
    text: `In a 96-well plate not every well is the same. The outer ring evaporates and warms faster, so it reads differently; a multichannel pipette or the reader can leave each row or column a little off; plates differ from one another. Filling a plate the tidy way — each condition in its own row, replicates side by side, controls in the first column — puts those differences straight into the effects.

The design here is the easy part (a replicated full factorial). Lay it out on the plate (Design step → plate layout) with the **balanced** layout: the controls are spread over the plate and the runs placed so that the effects are not entangled with the edge or the row and column gradients. Then run it, and fit on the Analyse step: the model includes the position terms (Edge, Row, Col), and the plate view shows the residuals well by well. Answer, then compare with what the tidy layout would have given.`,
    manual: [M('plates', '', 'microplates'), M('plates', 'layouts', 'plate layouts'), M('concepts', 'randomisation-and-blocking', 'randomisation and blocking')] },
  { id: 'gauge', n: 11, title: 'Measurement systems: gauge R&R', topic: null,
    text: 'Coming later: is the measurement good enough for the experiment? A gauge study on a virtual gauge.', manual: [M('process', 'gauge-rr', 'gauge R&R')] },
  { id: 'robust', n: 12, title: 'Robust design', topic: null,
    text: 'Coming later: noise factors and propagation of error.', manual: [M('optimisation', 'robust-design', 'robust design')] },
  { id: 'simulation', n: 13, title: 'Simulation and yield', topic: null,
    text: 'Coming later: surrogates, sensitivity and yield on a simulator.', manual: [M('simulation', 'yield', 'yield')] },
];

/** Hints for the work so far (strings), from the exercise and the study as it stands. */
export function hints(lesson, ex, study) {
  const out = [], d = study.design, budget = ex.budget, T = TOPICS[ex.topic];
  const results = d && study.observations.some(o => o.value !== null);
  if (!d) {
    out.push(`Choose a design of at most ${budget} runs on the Design step${ex.topic === 'screening' ? ' — Recommend, with goal "screen" and the budget, ranks the options' : ''}.`);
    return out;
  }
  const n = d.runs.length;
  if (n > budget) out.push(`This design has ${n} runs and the budget is ${budget}: choose a smaller one (or fewer replicates).`);
  if (ex.topic === 'blocking' && !d.runs.some(r => r.block !== undefined)) out.push('The runs will take two days (8 a day), and days differ. Put the design in 2 blocks (Design step, blocks) so the day difference can be removed.');
  if (T.plate && !(study.plates?.wells ?? []).some(w => w.run !== undefined)) out.push('Lay the runs out on the plate before running them (Design step → plate layout): where each run sits on the plate changes its result.');
  else if (T.plate && study.plates.layout === 'ordered') out.push('The tidy layout lines the conditions up with the rows of the plate, so row-to-row differences end up in the effects. The balanced layout spreads them.');
  if (ex.topic === 'split-plot' && !d.runs.some(r => r.wholePlot !== undefined)) out.push(`${study.factors.find(f => f.htc)?.id} is hard to change, and varies each time it is reset. A split-plot design (several whole plots) lets the analysis separate that variation.`);
  if (T.curvature && !/ccd|box-behnken|optimal|central/i.test(d.kind)) out.push('To find an optimum inside the region the model needs curvature: a central composite design adds axial and centre points.');
  if (ex.topic === 'fraction' && results && d.params?.resolution === 3 && !(d.params?.stages?.length > 1)) out.push('In this 8-run fraction every main effect is aliased with two-factor interactions. A fold-over (Design → Next stage) separates them — can you tell which effects are real without it?');
  if (results && d.runs.some(r => !study.observations.some(o => o.run === r.run && o.value !== null))) out.push('Some runs have no results yet: get them before analysing.');
  if (results && !out.length) out.push('Analyse the results, then grade: by your own answers, or by the standard analysis of your data.');
  return out;
}

export const lessonById = (id) => LESSONS.find(l => l.id === id);
