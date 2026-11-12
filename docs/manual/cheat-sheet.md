# Cheat sheet

The questions to answer before an experiment, the design they lead to, and checklists for running
and analysing. The [Guide](../../index.html#guide) in the app asks the same questions one at a time
and ranks the designs that fit.

## Before you design

1. **What do you want to find out?** Which of many factors matter (*screen*); how a few act and
   interact (*understand*); the best settings (*optimise*); settings insensitive to uncontrolled
   variation (*robust*); whether the measurement is good enough (*gauge study*).
2. **Is the measurement good enough?** If repeat measurements of the same thing differ noticeably,
   run a [gauge study](process.md#gauge-rr) first: more runs average measurement error down only
   slowly.
3. **Which factors, over what ranges?** List every setting you might change. Ranges as wide as is
   safe and practical: effects grow with the range, noise does not.
4. **Which are hard to change?** Then a [split-plot](designs-split-plot.md) — never "all low
   settings first, then all high".
5. **Will runs be done in groups** (days, batches, chambers)? Then [block](concepts.md#randomisation-and-blocking).
   Runs in the wells of microplates? Then a [balanced plate layout](plates.md#layouts), controls
   spread over every plate, and position terms in the analysis.
6. **Can the response curve** inside the ranges? Then centre points, or a three-level design.
7. **Is every combination possible?** If not, constraints and an [optimal design](designs-optimal.md#constraints).
8. **How big an effect matters**, compared with the run-to-run scatter σ? This sets the run count
   ([power](concepts.md#power)).
9. **How many runs can you afford, and can you work in stages?** Spend a quarter to half of the
   budget on the first experiment; keep some for follow-up and confirmation.

## Choosing a design

| situation | design | runs |
|---|---|---|
| a few treatments of one factor: media, suppliers, protocols | randomised complete blocks; a Latin square for two groupings; incomplete blocks; a crossover ([designs](designs-comparative.md)); compare by Tukey or Dunnett | t × (4–8) |
| 2–4 factors, interactions matter | full factorial 2ᵏ, replicated or with centre points | 8–32 |
| 5–8 factors, all interactions wanted | resolution V fraction | 16 (5), 32 (6), 64 (7–8) |
| 6–16 factors, screening | resolution IV fraction | 16 (≤ 8), 32 (≤ 16) |
| many factors, very few runs | resolution III fraction or Plackett–Burman, fold-over planned | 8, 12, 16, 20 … |
| 3–14 continuous factors, curvature possible | definitive screening | 2k + 1 (k even), 2k + 3 (k odd) |
| 2–5 factors, optimum | central composite: factorial + centre points, then axial points | 13 (2), 20 (3), 31 (4) |
| 3–7 factors, optimum, extremes unsafe | Box–Behnken | 15 (3), 27 (4), 43 (5) |
| hard-to-change factors | split-plot factorial or optimal split-plot | enough whole plots |
| impossible combinations, three-level choices | optimal design for the model you need | terms + 4–6 |
| ingredients adding up to a total: a recipe, formulation, composition | simplex lattice or centroid (lower limits only); extreme vertices or an optimal mixture design (upper limits) — [mixture designs](designs-mixture.md) | quadratic: q(q+1)/2 + 4–6 |
| a dose or concentration: EC50, potency, a standard curve | a log-spaced dilution series: range-finding, then doses around the EC50 ([dose–response](dose-response.md)) | 7, then about 16 per curve |
| a simulator | Latin hypercube, then a surrogate | about 10 per factor |
| is the measurement good enough? | gauge R&R | 10 parts × 3 operators × 2 |

Then, as results come in ([sequential experimentation](designs-sequential.md)): the path of steepest
ascent when the optimum lies outside the ranges (a strong first-order fit, no curvature), a fold-over when
aliased effects are ambiguous, axial points when centre points show curvature, confirmation runs
before acting.

## How many runs

- To detect an effect Δ with 80 % power in a two-level design takes roughly
  N ≈ 32 / (Δ/σ)² runs, plus 4–6 for the error estimate: about 8 + 6 for Δ = 2σ, 32 + 6 for
  Δ = σ. Halving the effect needs four times the runs.
- Check the power of the actual design on the Design step, or with `doe power`.
- With hard-to-change factors, the power for their effects depends on the number of whole
  plots, not the number of runs.
- Replicates are new runs (set up again from scratch), not repeat measurements of one run.
- Counts and proportions: power depends on the size of the counts (or the number of trials) and
  the ratio that matters; give a baseline and a rate or odds ratio (`doe power --response …
  --baseline … --ratio …`). Small counts carry little information: plate more, count more.

## Running

- Follow the randomised run order; it protects against drift you do not know about.
- On plates, follow the plate map: never "tidy" the layout into rows of conditions.
- Keep everything not in the design as constant as you can, and write down what you could not.
  What you can measure but not hold — room temperature, a starting weight, the lot's age —
  record at each run as a [covariate](analysis.md#covariates). Known before the runs (a starting
  weight)? Allocate the units so that it is balanced against the factors.
- Record the result for each run straight away, with anything unusual in the note.
- A failed run is `NA`, not a guess and not a quiet repeat.
- Do not adjust settings between runs to "help" the process.

## Analysing

- Look at the data first: a plot of the response against run order shows drift and outliers.
- Fit the model the design was chosen for; then simplify it, keeping hierarchy.
- Counts (colonies, cells, defects) and percentages (germinated, viable, pass/fail) are not
  measurements: set the response's kind so it is fitted as counts or proportions
  ([counts and proportions](analysis.md#counts-and-proportions)), and check for overdispersion
  and separation.
- A covariate you recorded goes in the model by name; judge the terms by type II tests, and the
  factors' effects are then at the average covariate. Compare levels by their adjusted means, and
  check the slope is the same at every setting.
- Comparing a few treatments: don't run a t test for every pair. Use Tukey for all pairs, Dunnett
  against a control, or contrasts planned before the runs
  ([comparing treatments](analysis.md#comparing-treatments)). Group the runs as they fall: complete
  blocks, a Latin square for two groupings, incomplete blocks, or a crossover
  ([designs](designs-comparative.md)).
- "As good as the old one?" is an equivalence question: set a margin first, then check that the
  90 % interval lies inside it ([equivalence](analysis.md#equivalence-and-non-inferiority)). No
  significant difference is not evidence of equivalence.
- Check the residuals: against fitted values, run order, and a normal plot.
- State aliasing with every conclusion from a fraction.
- Report effects with confidence intervals, not only p-values; choosing the model from the same data
  makes intervals optimistic.
- Confirm with new runs at the settings you will use before acting on a prediction.
