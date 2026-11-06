# Analysis

## Formulas

Models are written as formulas in R's notation over the factor ids:
`yield ~ cat + temp + conc + cat:temp`. The shortcuts `main`, `2fi` and `quadratic` stand for the
main effects, main effects plus all two-factor interactions, and the full quadratic; `(A+B+C)^2`
expands to the main effects and their two-factor interactions, `A*B` to `A + B + A:B`, and
`I(T^2)` is a squared term. The full syntax is in [formula syntax](reference-formulas.md).

The default model is what the design was built for: main effects for a resolution III or IV
fraction and for Plackett–Burman, two-factor interactions for resolution V, the full quadratic for
central composite, Box–Behnken and Latin hypercube designs. After a fold-over or axial stage, the
largest standard model the combined runs support.

Coefficients are in [coded units](concepts.md#factors-and-coded-units): each continuous factor runs
from −1 to +1, so the coefficients are comparable, and an effect (low → high) is twice the
coefficient.

## Least-squares fits

Runs with one result each are fitted by ordinary least squares (as R's `lm`). Repeated readings
of a run (several sites, wafers or repeats) are averaged per run for a least-squares fit — or,
better, analysed as they are by a [mixed model](#mixed-models). If the runs fall in several blocks
(stages of a sequential experiment), a block term is fitted first.

Reported: the coefficients with standard errors, t and p; σ (the residual standard deviation),
R², adjusted R², **predicted R²** (from PRESS, the leave-one-out prediction error: a model that
fits the data but predicts poorly has a low predicted R²) and the overall F test. Coefficients
that cannot be estimated (aliased in the design) are listed.

## ANOVA

Three types, as R gives them:

- **type I** (sequential): each term adjusted for the terms before it — depends on the order;
- **type II**: each term adjusted for every term that does not contain it (R's `car::Anova`);
- **type III**: each term adjusted for all others.

For a balanced two-level design they agree. When the design has replicates (including centre
points), the residual splits into **lack of fit** and **pure error**: a significant lack of fit
says the model is missing something — curvature, an interaction, a transformation.

## Effects and Lenth's method

For two-level designs the **effects** (twice the coefficients) can be compared directly. With no
residual degrees of freedom — a saturated model, typical in screening — **Lenth's method**
(Lenth 1989) estimates the noise from the effects themselves: the pseudo standard error PSE is
1.5 × the median of the small effects, and two limits are drawn — the **margin of error** ME
(each effect individually, α = 0.05) and the **simultaneous margin of error** SME (all effects
together). The half-normal plot of |effects| shows the same picture: inactive effects lie on a
line through the origin, active ones stand off it.

See the [worked example](example-screening.md#which-effects-are-active) for Lenth's method on real
data.

## Diagnostics

Residual plots check the model's assumptions: residuals against fitted values (a funnel suggests
a transformation; a curve, a missing term), residuals in run order (a trend means drift — what
randomisation protects against), and a normal plot of the studentised residuals (outliers stand
off the line; a studentised residual beyond ±3 is flagged). For a positive response the
**Box–Cox** profile likelihood suggests a power transformation: an interval containing 1 needs no
transformation, one containing 0 suggests the log.

## Model reduction

Backward elimination, always keeping the model hierarchical (A stays while A:B or I(A²) is in it):

- **by p-value**: drop the term with the largest partial-F p while p > 0.10;
- **by AICc**: drop the term whose removal lowers the corrected Akaike criterion most, while it
  does.

The result is a suggestion: every step is shown, and any term can be kept (`--keep`) or put back.
`doe fit … --reduce p` or `--reduce aicc`; the Analyse step's reduce buttons.

## Prediction and confirmation

`doe predict` and the Analyse step give, at chosen settings, the predicted mean with a 95 %
**confidence interval** (for the mean response) and a 95 % **prediction interval** (for one new
run — wider, as it includes the run-to-run noise). Before acting on a prediction, confirm it:
[confirmation runs](designs-sequential.md#confirmation-runs).

## Mixed models

When readings are nested — several sites on a wafer, wafers in a run, runs in a whole plot — the
readings are not independent, and an analysis that treats them as such overstates every effect.
aikidoe detects the structure from the observations and fits a **linear mixed model**: fixed
effects for the model terms, random effects for whole plots, runs and wafers, by **REML**
(restricted maximum likelihood, as R's `lme4`).

- **Variance components** with 95 % intervals (Satterthwaite) — how much of the variation is
  whole plot to whole plot, run to run, wafer to wafer, within wafer. A component estimated at 0
  is on the boundary: the data show no variation at that level beyond what the levels below
  explain.
- **Fixed effects** with Kenward–Roger standard errors and degrees of freedom (as R's
  `pbkrtest`), and **tests** of each term in its stratum: a whole-plot factor is tested against
  the whole-plot variation, a site-level term against the within-wafer variation. Containment
  degrees of freedom are available too (`--df containment`).
- `--compare` adds the p-values an analysis that ignored the structure would have given.

Position terms (`radius2`, `edge`, `slot`, …) model within-wafer patterns
([wafers and sites](process.md#wafers-and-sites)); per-wafer summaries (mean, standard deviation)
can be analysed as responses of their own.

## Reports

**Report** in the app, or `doe report STUDY`, writes a self-contained HTML page: the factors,
responses and design, the run sheet with results, and for each response its fitted model —
coefficients, ANOVA or variance components, plots — with the study file embedded, so the report
can be opened in aikidoe again (**Open…** accepts it).

```console
$ doe init rep.aikidoe.json --factor A:0:1 --factor B:0:1 --factor C:0:1 --factor D:0:1 --response y --seed 8
created rep.aikidoe.json: 4 factors, 1 responses, seed 8
$ doe design rep.aikidoe.json --full
rep.aikidoe.json: full-factorial, 16 runs, randomisation complete, seed 8
$ doe report rep.aikidoe.json --date 2026-01-01
wrote rep.html (9 kB, self-contained; the study is embedded)
```
