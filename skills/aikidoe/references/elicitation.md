# Elicitation checklist

Ask these before designing anything. Short questions, one topic at a time; summarise back what you
heard. Unknowns are fine — say how the design will cope with them.

## Objective

- What decision will the experiment inform? Which of:
  - **screen** — which of many factors matter;
  - **model** — how the important factors act, including interactions;
  - **optimise** — the best settings (needs curvature: a response surface);
  - **robustness** — settings that are insensitive to noise (ambient conditions, lots, tolerances);
  - **measurement** — is the measurement good enough (gauge R&R first)?
- What would count as success (a target, a limit, an improvement of how much)?

## Responses

- What is measured, in what units, and what is good (bigger, smaller, on target, in a range)?
- **How is it measured?** Once per run; several wafers per run; several sites per wafer; repeat
  readings. (These are not replicates; they set the analysis.)
- How precise is the measurement? A gauge study, or the tool's repeatability. If unknown and the
  effects of interest are small, suggest a gauge study first (`doe gauge`).
- Several responses? Which trade-offs are acceptable (desirability goals and importance)?

## Factors

- Every factor that might matter, with **units and a range** wide enough to see an effect but safe
  and feasible. Ask about equipment and safety limits explicitly — the user decides the ranges.
- Continuous or categorical (levels)? Does a factor act multiplicatively (time, dose, flow → log
  scale)?
- **Which are hard to change** (a furnace temperature, a chamber condition, a raw-material lot)?
  These make the design a split-plot.
- Combinations that are **impossible or dangerous** (constraints such as `T + 2*t <= 1050`)?

## Budget and logistics

- How many runs, in what time? Runs per day or per batch?
- Can the runs be done in a random order? If not, why not (that is usually a hard-to-change factor)?
- Nuisance: days, tools, operators, lots, chambers — anything that might shift results between
  groups of runs (blocks).
- What varies from run to run that **cannot be set but can be measured** before or at each run
  (room temperature, a starting weight or cell density, the age of a reagent, incoming film
  thickness)? Record it as a covariate (`doe covariate`); it must not be something the factors
  change.

## What is known

- Run-to-run noise (σ) from experience or earlier data; the smallest effect worth detecting. Both
  set the power: `doe power STUDY --sigma σ --delta Δ`.
- Expected interactions or curvature; earlier experiments (they may be augmented rather than
  repeated).
