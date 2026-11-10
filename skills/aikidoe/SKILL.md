---
name: aikidoe
description: Plan and analyse designed experiments (DOE) with the aikidoe command line — screening, factorials, response surfaces, split-plot and wafer/site process experiments, gauge R&R, robust design and simulator yield. Use when a user wants to find which factors affect a process, model or optimise it, choose a design and run sheet, analyse experimental results, or decide the next experiment.
---

# aikidoe: designed experiments with a user

aikidoe is a design-of-experiments tool: a browser app and a command line (`doe`) over the same
library. With it you can help a user turn a vague question ("why is the etch rate low?") into an
experiment, a run sheet, an analysis and a decision — with the numbers checked.

You drive the command line; the user runs the experiment and supplies the results. The study file
(`NAME.aikidoe.json`) is the record of every step: factors, design, run order, results, stages.

## When to use it

Use it when the user has a process, product or simulator whose response depends on factors they
can set, and wants to know which factors matter, how much, how they interact, where the optimum is,
or how robust a setting is — and can run experiments (or a simulator) to find out.

What it does: two-level and mixed-level factorials, fractions, Plackett–Burman, definitive
screening, central composite and Box–Behnken designs, optimal designs (with constraints),
split-plot designs for hard-to-change factors, sequential augmentation (fold-over, axial points,
optimal augmentation, confirmation runs); least squares with ANOVA, Lenth's method, diagnostics,
Box–Cox, model reduction; mixed models (REML, Kenward–Roger) for whole plots, wafers and sites;
microplate layouts (runs in wells, controls, Z′, edge and row/column position terms);
dose–response curves (log-logistic and Weibull fits, EC50s, relative potency and parallelism,
standard curves, dilution-series and optimal dose designs: `doe design --dose`, `doe dose`);
mixture designs (components adding up to a total: simplex lattice and centroid, extreme vertices,
D/I-optimal; process factors crossed; Scheffé models in pseudo-components, Cox traces:
`doe init --mixture`, `doe design --mixture`, fit with `mixquadratic`);
counts and proportions (Poisson, negative binomial, quasi-Poisson, binomial, pass/fail GLMs with
exposure offsets and trials; rate and odds ratios with profile intervals, analysis of deviance,
overdispersion and separation checks, Firth: `doe init --response count@poisson`, `doe fit
[--distribution …] [--firth]`; in a split-plot (or with `--random block`) a GLMM with a random
whole-plot or block intercept (`--reduce` by its likelihood-ratio tests); power for a rate or odds ratio: `doe power --response R --baseline b
--ratio r [--simulate N]`, in a split-plot with `--sigma-wp σ` for the whole-plot shift);
power; desirability optimisation, propagation of error and dual response; gauge R&R; surrogate
models, Sobol sensitivity and Monte Carlo yield for simulators.

What it does not do: time series or process control charts, Bayesian analysis, more than one
random effect for counts and proportions, or causal claims from observational data. Say so
when a question needs them.

## Setup

Node ≥ 20 and a clone of https://github.com/byzantic/aikidoe; run `node tools/doe.mjs <command>`
(written `doe` below). No dependencies. Add `--json` to any command for one JSON object on stdout:
`{ "schema": "aikidoe-cli/1", "command", "ok", …results, "text": [notes] }`, or
`{ "ok": false, "error": { "message" } }` with a non-zero exit. Parse that rather than the tables.

## Workflow

1. **Elicit** the problem with the user — [references/elicitation.md](references/elicitation.md).
   Do not design before you know the objective, the responses and how they are measured, the
   factors and their ranges, what is hard to change, the constraints and the budget.
2. **Define** the study: `doe init` (factors `id:low:high:units`, `!` for hard to change,
   `id=a,b` for categorical; responses), `doe goal`, `doe spec`, constraints in the file.
3. **Recommend** designs: `doe recommend STUDY --goal screen|model|optimise --budget N --json`.
   Present two or three options to the user with run counts, what each can estimate, what is
   aliased, and power — [references/decisions.md](references/decisions.md). Agree one.
4. **Design** and hand over the **run sheet**: `doe design …`, `doe alias`, `doe power`,
   `doe sheet STUDY --csv sheet.csv` (or `--html`). Tell the user to run it in the given order.
   Runs in the wells of microplates: `doe plate STUDY --control id:role:n … --pipetting FILE.csv`
   (balanced layout, controls spread) — never let the conditions be lined up in rows.
5. **Import** the results the user sends: `doe import STUDY results.csv` (check the report before
   accepting it).
6. **Analyse**: `doe fit STUDY "y ~ …" --json` (mixed models are automatic for whole plots,
   wafers and sites; plate position terms are automatic for runs in wells), Lenth's method for
   saturated designs, diagnostics, `--reduce p|aicc`.
7. **Decide the next stage** with the user: fold-over, axial points, optimal augmentation, or
   confirmation runs at the chosen settings (`doe augment`); optimise (`doe optimise`, `doe
   robust`); then confirm.
8. **Report**: `doe report STUDY` writes a self-contained HTML report.

Recipes for each path, with real outputs: [references/recipes.md](references/recipes.md).

## Rules

- **Never invent or "fill in" results.** Results come from the user — or from a virtual process
  or simulator that is clearly labelled as simulation (`doe exercise`, `doe simulate`). If results
  are missing, ask for them; if some failed, record them as missing (`NA`), not guessed.
- **Keep the randomisation.** Hand over the run order as `doe sheet` gives it. If the user cannot
  randomise a factor, it is hard to change: use a split-plot design, do not just sort the sheet.
- **Check before recommending:** that the design can estimate the model the user needs
  (`doe recommend`, `doe alias`), and its power for the effect sizes that matter (`doe power
  --delta …`, with σ from the user's experience or a gauge study). Say when power is low.
- **Say what is aliased** in plain words: "in this design the effect of A cannot be told apart
  from the B × C interaction".
- **Prefer sequential experimentation:** a smaller first stage, then fold-over, axial points or
  augmentation, rather than one large design that spends the whole budget on guesses.
- **Give intervals, not just point estimates:** effects and predictions with their 95 % intervals;
  predictions at new settings with the prediction interval for one run.
- **Separate replicates from repeated measurements.** Several sites or wafers from one run are not
  replicates; let the mixed model handle them.
- **Hand decisions with cost or safety implications back to the user:** ranges near equipment or
  safety limits, the run budget, whether to act on a model, whether a confirmation failed enough to
  stop. Recommend; do not decide.
- **Keep the study file** as the record: every change through `doe`, never hand-edited results.

## References

- [references/elicitation.md](references/elicitation.md) — what to ask before designing
- [references/decisions.md](references/decisions.md) — from situation to design, mirroring
  `doe recommend`
- [references/recipes.md](references/recipes.md) — command sequences for the common paths, tested
- [references/cli.md](references/cli.md) — every command and its JSON output (generated)
- [references/study-format.md](references/study-format.md) — the study file (generated)
- The manual: https://byzantic.github.io/aikidoe/docs/manual/ (in the repository: `docs/manual/`)
