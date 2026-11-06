# Getting started

This page walks through a complete study in the app: define the factors and responses, choose a
design, run it, analyse the results and act on them. The example is real data — the reactor
experiment of Box, Hunter and Hunter — and the same steps on the command line are in
[the worked example](example-screening.md).

[Open the example in the app](../../index.html#example=reactor-bhh), or start a **New** study
and follow along with your own.

Not sure what kind of experiment you need? The app's [Guide](../../index.html#guide) asks a few
questions and suggests a plan and a design; the [cheat sheet](cheat-sheet.md) has the same
questions on one page.

## The steps

The app has one tab per step. Each works on the same study, which is saved in the browser as you
go; **Save** writes it to a file (`NAME.aikidoe.json`), **Open…** reads one back, **Link** puts the
whole study into a link you can send, and **Report** downloads a self-contained HTML report.

## Define

List the **factors** — what you will change — with their ranges, and the **responses** — what
you will measure.

- A continuous factor has a low and a high setting (temperature 140 … 180 °C). Mark it *log* if
  it acts multiplicatively (time, dose, flow).
- A categorical factor has levels (gas: N₂, O₂).
- Tick *hard to change* for a factor that cannot be reset between runs (a furnace temperature):
  aikidoe will then offer [split-plot designs](designs-split-plot.md).
- For each response say how it is measured: once per run, per wafer, per site
  ([wafers and sites](process.md#wafers-and-sites)).
- Add constraints if some combinations must be avoided (`T + 2*t <= 1050`).

See [concepts](concepts.md#factors-and-coded-units) for coded units.

## Choosing a design

The Design step lists the designs available for your factors, with run counts and resolution.
**Recommend** ranks them for a goal — *screen* (which factors matter), *model* (main effects and
interactions) or *optimise* (a full quadratic) — and a budget in runs, with the reasons: what each
design can estimate, its resolution, efficiency and the power to detect an effect of 2σ.

Click a design to see its details: aliasing (which effects cannot be told apart), the power of
each term, prediction variance for response-surface designs. Change the options (centre points,
replicates, blocks), then **Create this design**. The runs are randomised with the study's seed, so the
same seed gives the same run sheet.

For the reactor, the 16-run 2⁵⁻¹ half fraction (resolution V) estimates all main effects and
two-factor interactions.

## Run

The Run step is the run sheet, in the randomised order. Type results into it, or download it as
CSV, fill it in, and **Import results…**: the import checks run numbers, factor settings and
numbers, and shows what it will do before changing anything. A blank cell is not measured; *NA*
means the measurement failed. The progress bar shows how many runs have results.

Run the experiment in the order shown: randomisation protects the analysis from drift and other
things that change over time.

## Analyse

The Analyse step fits a model — by default the one the design was built for — and shows:

- coefficients with standard errors and p-values, R², adjusted and predicted R²;
- the ANOVA table, with lack of fit when there are replicates;
- for two-level designs, the effects with Lenth's method and a half-normal plot;
- diagnostics: residuals against fitted values and in run order (drift), a normal plot of the
  studentised residuals, and the Box–Cox likelihood for a positive response;
- the reduce buttons propose a smaller model by backward elimination (by p-value or by AICc),
  keeping the model hierarchical.

Edit the formula to try another model (`yield ~ cat*temp + temp:conc + conc`); see
[formula syntax](reference-formulas.md). Split-plot and wafer/site data get a mixed model
automatically ([mixed models](analysis.md#mixed-models)).

## Optimise

Give each response a goal — maximise, minimise, a target, a range — and the Optimise step finds
the settings with the best overall desirability, with a prediction profiler and an overlay plot.
Robust design (noise factors, tolerances) and yield are here too
([optimisation](optimisation.md), [simulation and yield](simulation.md)).

## Next stage

Experiments are sequential: a screening fraction is followed by a fold-over to separate aliased
effects, axial points to fit curvature, or optimal augmentation; and a model is confirmed by
running its best settings. The Design step's **Next stage** panel (once the study has a design) adds these as new blocks of
the same study ([sequential experiments](designs-sequential.md)).
