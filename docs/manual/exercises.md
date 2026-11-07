# Exercises and virtual processes

Designed experiments are learned by doing them, and doing them on a real process is slow and
expensive. aikidoe's **virtual processes** behave like real ones — noise, day-to-day shifts,
furnace resets, wafers and sites — but have a known truth, so every analysis can be checked.
**Exercises** wrap a virtual process in an engineering scenario with a run budget and questions,
and grade the answers against the truth.

## Learn mode

The app's **Learn** tab is a tutorial built on these exercises: seventeen lessons, from why
one-factor-at-a-time falls short to split-plots, plates, dose–response, mixtures and counts. Each lesson is a short explanation with links into
this manual and a task on a generated exercise. While you work, a banner over the four steps
shows the task, the budget and hints (a design over budget, days that are not blocked, a
hard-to-change factor reset every run, a fraction whose effects are aliased). **Get results** asks
the virtual process for the runs you designed; **Answer and grade** takes your answers — or grades
the standard analysis of your data — and shows the score, the truth and the model answer. Lesson 1
also shows what one-factor-at-a-time would have scored on the same process; the plate, dose,
mixture and counts lessons compare with the usual shortcut for their kind of experiment (a tidy
plate layout, evenly spaced doses, one component at a time, least squares on the raw counts).

Lessons whose exercises are not written yet (constraints, several responses, gauge studies,
robust design, simulation) are listed but locked; the features themselves are in the app. Progress
is kept in the browser. Every exercise has a link — `index.html#lesson=ID&difficulty=D&seed=S` — so
the same exercise can be shared, or set for a class.

## A virtual process

A virtual process has a true model in coded units — a few active factors (effect sparsity),
interactions mostly among them (heredity), curvature where the lesson needs it, effects sized in
multiples of the run-to-run σ — and switchable nuisance: noise, nested wafer and site variation,
whole-plot variance for hard-to-change factors, day-to-day shifts, drift in run order, occasional
outliers, a gauge bias. Every result is a deterministic function of the exercise's seed, the run's
settings and its replicate index (how many earlier runs had the same settings), so an exercise is
reproducible and a repeated run gives a fresh but repeatable draw. Shifts that depend on *how* the
runs were done — the day a run fell on, each reset of a hard-to-change factor — follow the run
order, so randomisation, blocking and split-plot structure matter exactly as they do in a fab.

A response can also be a **count** or a **proportion**. Its truth is then linear on the log scale
of the mean count per unit exposure, or on the logit scale of the proportion; each run's count is
drawn from a Poisson or negative binomial distribution (with the exposure the process gave it, such
as the volume plated, recorded with the result), or its successes from a binomial out of the
response's trials, with optional extra variation on the logit scale. Block and day shifts act on
the same scale, so they multiply a count.

The app's simulated examples are virtual processes too.

## Topics

| topic | lesson | the task |
|---|---|---|
| `factorial` | full factorials, effects, interactions | three factors: which matter, their effects, the best settings |
| `fraction` | fractions, aliasing, fold-over | five factors in 16 runs |
| `screening` | screening many factors | six or seven factors in 16 runs: find the few that matter |
| `blocking` | blocking and randomisation | runs spread over days that shift the response |
| `rsm` | response surfaces | find an optimum inside the region; predict at given settings |
| `split-plot` | hard-to-change factors | a factor that is costly to reset, and varies each time it is |
| `dose` | dose–response | a reference and a test compound, 48 runs: the EC50 of the test and its relative potency ([dose–response](dose-response.md)) |
| `mixture` | mixtures | three components adding up to 100, with limits, 14 runs: the best blend and a prediction ([mixture designs](designs-mixture.md)) |
| `counts` | counts and percentages | colonies per plate (with the volume plated) or seeds germinated out of 50, 16 or 32 runs: the active factors and their rate or odds ratios ([counts and proportions](analysis.md#counts-and-proportions)) |
| `plate` | microplates | 48 runs in a 96-well plate whose edge, rows and columns differ: lay the runs out, then analyse ([microplates](plates.md)) |

Each comes in three difficulties — *easy*, *medium*, *hard* — which set the smallest active effect
(4, 3 and 2.4 σ) and, for some topics, the number of factors. For counts they set the ratios
(rate ratios 1.8–2.6, 1.5–2.2 and 1.4–1.9 from low to high; odds ratios 3–6, 2.5–5 and 2–4) and
the variation beyond Poisson or binomial: none when easy, then a negative binomial θ of 20–50 or
12–30, or a logit-scale σ of 0.2 or 0.3. Scenarios (gate-oxide growth, plasma
etch, CVD deposition, reactor yield, coupler tuning; for the plate topic, an enzyme assay and a
cell-viability assay; for the dose topic, compound potency and an inhibitor batch; for the mixture topic, a
cell-culture supplement, a ceramic glaze and a bronze; for the counts topic, bacterial
transformation and seed germination) give the factors
names, units and ranges.

## Solvable by construction

The generator solves every exercise itself before handing it out, with a **reference strategy**
for the topic (for example: an 8-run fraction, then a fold-over, then a main-effects analysis). A
truth is kept only if that strategy, within the budget, has power of at least 0.8 for every effect
the questions ask about and earns full marks; otherwise another is drawn. The reference path is
kept as the **model answer**. One-factor-at-a-time experimenting, on the same budget, scores less:
it misses interactions, mistakes day shifts for effects, and estimates every effect from fewer
runs.

## Self-study

```console
$ doe exercise new cvd.aikidoe.json --topic screening --difficulty easy --seed 7
Screening many factors — easy (screening-easy-7)
A low-pressure CVD polysilicon deposition feeds several products. The tube is being requalified and the team wants a model of the deposition rate in terms of the recipe.
budget: 16 runs
  - Which factors affect deposition rate (alone or through an interaction)?
  - For each factor that matters, estimate its effect (low → high) on deposition rate, with a 95 % interval.
  - Stay within the run budget.

cvd.aikidoe.json: design it (doe recommend / doe design), then "doe exercise run cvd.aikidoe.json" for the results
```

Design the experiment however you like — `doe recommend`, `doe design` — then ask the process for
the results. The truth travels sealed inside the study (encoded, to avoid spoilers; it is not a
secret):

```console
$ doe design cvd.aikidoe.json --runs 16
cvd.aikidoe.json: fractional-factorial, 16 runs, randomisation complete, seed 7
resolution IV; generators N2 = SiH4:spacing:press, boat = SiH4:spacing:dopant  (see: alias cvd.aikidoe.json)
$ doe exercise run cvd.aikidoe.json
cvd.aikidoe.json: results for 16 runs (budget 16)
```

Analyse as usual, then either record your answers (`doe exercise answer cvd.aikidoe.json
--active … --effect "id=estimate:lower:upper" … --best "…" --prediction v`, and for counts
`--ratio "id=estimate:lower:upper"`) or let the grader
analyse your data the standard way:

```console
$ doe exercise grade cvd.aikidoe.json
Screening many factors — easy (screening-easy-7)
no answers given: graded on the standard analysis of your data (dep ~ main, terms with p < 0.05)
question  points
--------  -----------  ----------------------------------------------------------------
active    61.5 / 61.5  precision 100 %, recall 100 %
effects   38.5 / 38.5  every true effect has the right sign and is inside your interval
budget    0            16 of 16 runs
score: 100 / 100

truth: active dopant, press, spacing; effects spacing -0.8, press 0.6115, dopant -0.6002
model answer:
  - 16-run resolution IV fraction; fit main effects
  → active spacing, press, dopant; smallest power of the reference design 1
```

The grade has a part per question: the active factors by precision and recall; each true effect's
sign and whether your interval contains it; each true rate or odds ratio the same way on the log
scale (which side of 1 it is on, and whether your interval contains it); best settings by **regret** — how far the true response
there falls short of the true optimum, as a share of the true range; a prediction by its error in
σ; and 20 points off for exceeding the budget. Then the truth and the model answer.

## Class mode

An instructor generates a set of exercises and keeps the keys; students get studies without the
truth, send their run sheets, and receive results — as a real lab returns measurements:

```text
doe exercise new --set 20 --topic blocking --difficulty medium --seed 100 --out class
                                          # class/blocking-medium-100.key.json … (keep)
                                          # class/blocking-medium-100.aikidoe.json … (hand out)
doe exercise run class/blocking-medium-100.key.json sheet.csv --out results.csv
doe exercise grade class/blocking-medium-100.key.json submitted.aikidoe.json
```

Each time, send the whole run sheet (`doe sheet` writes every run, including those already done):
repeat runs at the same settings are told apart by how many came before them in the sheet, so
`exercise run` refuses a sheet that does not start at run 1, and the results for earlier runs come
back unchanged. The student imports `results.csv` with `doe import` (or the app's **Import results…**). The results
depend on the run order in the sheet, so a student who runs everything in one day and ignores the
blocks sees the shift.

## In code

`generateExercise({ topic, difficulty, seed })` in `js/learn/exercise.js` returns the exercise;
`runExercise`, `gradeStudy`, `referenceStrategy` and `ofatStrategy` do the rest, and
`js/learn/process.js` is the virtual process on its own (`observeRuns(process, study)`).
