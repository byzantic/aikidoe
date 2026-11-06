# aikidoe manual

aikidoe plans and analyses designed experiments — screening, response surfaces, split-plot and
nested process experiments, gauge studies, and simulator yield studies — in the browser or from
the command line. Everything runs locally; a study is one file.

[Open the app](../../index.html) · [the command line](reference-cli.md) ·
[source on GitHub](https://github.com/byzantic/aikidoe)

## Start here

- [Getting started](getting-started.md) — a complete study in the app, from defining the factors
  to a confirmed model.
- [Concepts](concepts.md) — coded units, randomisation and blocking, aliasing and resolution,
  replication, power, hierarchy and sequential experimentation.

## Designs

One page per family: what it estimates, how many runs, its options and diagnostics.

- [Full and fractional factorials](designs-factorial.md)
- [Plackett–Burman and definitive screening](designs-screening.md)
- [Response surfaces: central composite and Box–Behnken](designs-rsm.md)
- [Optimal designs](designs-optimal.md), including constraints
- [Split-plot designs](designs-split-plot.md), for hard-to-change factors
- [Sequential experiments](designs-sequential.md): fold-over, axial points, augmentation,
  confirmation
- [Space-filling designs](designs-space-filling.md), for simulators

## Analysis

- [Analysis](analysis.md): formulas, least squares, ANOVA, Lenth's method, diagnostics, Box–Cox,
  model reduction, prediction, mixed models
- [Optimisation and robust design](optimisation.md): desirability, the profiler, propagation of
  error, dual response

## Process topics and simulation

- [Wafers, sites and gauges](process.md): split-plots in the fab, drop-in sites, boat slots,
  per-wafer summaries, gauge R&R
- [Simulation and yield](simulation.md): simulators, surrogates, sensitivity, Monte Carlo yield

## Learning

- [Exercises and virtual processes](exercises.md): generated exercises with a hidden truth, graded;
  self-study and class mode

## Worked examples

Each is executable: its commands are run by the test suite and the numbers checked.

- [A 2⁵⁻¹ screening experiment](example-screening.md) — textbook data (Box, Hunter & Hunter)
- [Furnace split-plot with drop-in sites](example-furnace.md)
- [Gauge R&R](example-gauge.md) — a published data set
- [Coupler yield with comb-over](example-coupler.md)

## Reference

- [Command line](reference-cli.md) and its JSON output
- [Study file format](reference-study-format.md)
- [Formula syntax](reference-formulas.md)
- [Glossary](glossary.md) and [bibliography](bibliography.md)

## For AI agents

An agent helping someone with an experiment should load the [aikidoe skill](../../skills/aikidoe/SKILL.md)
(Agent Skills format: when to use it, the workflow, what to ask, how to choose a design, rules such
as *never invent results*, and tested command recipes). Every `doe` command takes `--json`;
`tools/mcp.mjs` serves the same commands over MCP; [llms.txt](../../llms.txt) lists it all. How well
an agent does with only the skill is recorded in [the agent evaluation](../../docs/agent-eval.md).
