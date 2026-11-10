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

For counts and proportions the p-value is the likelihood-ratio (deviance) test of dropping the
term, and AICc comes from the model's likelihood; with a random whole-plot or block effect, each
candidate is refitted with σ re-estimated, and a term that changes only between whole plots is
judged by an F on the whole-plot degrees of freedom, as in its
[tests](#random-effects-for-counts-and-proportions). Mixed models for measurements use
Kenward–Roger p-values, or AICc of maximum-likelihood fits ([mixed models](#mixed-models)).

The result is a suggestion: every step is shown, and any term can be kept (`--keep`) or put back.
`doe fit … --reduce p` or `--reduce aicc`; the Analyse step's reduce buttons.

## Prediction and confirmation

`doe predict` and the Analyse step give, at chosen settings, the predicted mean with a 95 %
**confidence interval** (for the mean response) and a 95 % **prediction interval** (for one new
run — wider, as it includes the run-to-run noise). Before acting on a prediction, confirm it:
[confirmation runs](designs-sequential.md#confirmation-runs).

## Counts and proportions

Many results are not measurements with constant noise but **counts** (colonies, cells, plaques,
defects) or **proportions** (germinated seeds out of those sown, positive cells out of those
counted, a run that passes or fails). Their variance depends on their mean — a count of 400 varies
more than a count of 4 — and a proportion cannot go below 0 % or above 100 %. Least squares on the
raw values gives wrong intervals and can predict impossible values; a log or logit transform helps
only partly, and breaks down at zero counts and at 0 % or 100 %. The right tool is a **generalised
linear model** (GLM): a linear model for the log of the mean count, or the log-odds of the
proportion, with the noise the data actually have. Lesson 17 in the app's Learn tab practises this
on generated colony counts and germination tests ([exercises](exercises.md)).

Set the response's **kind** on the Define step (or `distribution` in the study file; `doe init …
--response count@poisson`):

| kind | distribution | link (default first) | the data |
|---|---|---|---|
| count | `poisson` | log, identity, sqrt | a whole number ≥ 0 per run; optionally an **exposure** |
| count, overdispersed | `negbin`, `quasipoisson` | log, identity, sqrt | as above, more variable than Poisson |
| successes out of n | `binomial`, `quasibinomial` | logit, probit, cloglog | successes and **trials** per run |
| pass / fail | `bernoulli` | logit, probit, cloglog | 0 or 1 per run |

The **exposure** is what the count is out of — the volume plated, the area scanned, the cells
examined — and enters as an offset (the log of it), so the model is for the **rate** per unit
exposure. The **trials** are fixed for the response (`trials` in the study file, n on the Define
step) or given per run (a `germ.trials` column). The run sheet has columns for both.

```console
$ doe init counts.aikidoe.json --factor A:-1:1 --factor B:-1:1 --factor C:-1:1 --response colonies@poisson --response germ@binomial --seed 3
created counts.aikidoe.json: 3 factors, 2 responses, seed 3
$ doe design counts.aikidoe.json --full --replicates 2
counts.aikidoe.json: full-factorial, 16 runs, randomisation complete, seed 3
```

```file counts.csv
run,colonies,colonies.exposure,germ,germ.trials
1,5,0.5,14,20
2,16,1,18,25
3,1,2,6,20
4,16,1,13,25
5,2,0.5,4,20
6,16,1,22,25
7,1,2,4,20
8,8,1,16,25
9,2,0.5,15,20
10,12,1,23,25
11,1,2,6,20
12,10,1,12,25
13,7,0.5,6,20
14,13,1,22,25
15,10,2,1,20
16,13,1,17,25
```

```console
$ doe import counts.aikidoe.json counts.csv
32 value(s) read (wide format)
counts.aikidoe.json: 32 observation(s)
$ doe fit counts.aikidoe.json "colonies ~ (A + B + C)^2"
colonies ~ A + B + C + A:B + A:C + B:C
Poisson counts, log link
16 observations, 7 estimable coefficients, 9 residual df; exposure as an offset (rates per unit exposure)

term         estimate  std. error       z         p       rate ratio  95% profile interval
-----------  --------  ----------  ------  --------  ---  ----------  --------------------
(Intercept)     1.882      0.1123   16.76   <0.0001  ***       6.566  5.195 … 8.088
A              0.6777      0.1123   6.036   <0.0001  ***       1.969  1.596 … 2.487
B             -0.4491      0.1067   -4.21   <0.0001  ***      0.6382  0.516 … 0.7862
C              0.1818      0.1121   1.622     0.105            1.199  0.9685 … 1.509
A:B            0.3531      0.1072   3.295  0.000984  ***       1.424  1.154 … 1.762
A:C            -0.219      0.1117   -1.96      0.05  *        0.8034  0.6388 … 0.994
B:C           0.01376      0.0886  0.1553     0.877            1.014  0.852 … 1.207
coded units: each continuous factor runs from −1 (low) to +1 (high); a rate ratio is the factor of change per coded unit (squared for low → high)

deviance = 19.5 on 9 df (null 105.6 on 15 df; 81.5% explained)   AIC = 91.3
Pearson χ²/df = 2.171 (p = 0.0209)
warning: overdispersion: Pearson χ²/df = 2.17 (p = 0.0209); a quasi-Poisson or negative binomial model gives honest standard errors

analysis of deviance (type I, sequential; likelihood-ratio χ² tests)
source     df  deviance       χ²         p
---------  --  --------  -------  --------
A           1     63.27    63.27   <0.0001
B           1     7.492    7.492    0.0062
C           1    0.3686   0.3686     0.544
A:B         1     10.88    10.88  0.000971
A:C         1     4.064    4.064    0.0438
B:C         1   0.02412  0.02412     0.877
Residuals   9      19.5
```

The colony counts vary about twice as much as the Poisson allows (the warning). The
quasi-Poisson estimates by how much (the dispersion) and widens the standard errors to match:

```console
$ doe fit counts.aikidoe.json "colonies ~ A + B + C + A:B + A:C" --distribution quasipoisson
colonies ~ A + B + C + A:B + A:C
quasi-Poisson counts (overdispersed), log link
16 observations, 6 estimable coefficients, 10 residual df; exposure as an offset (rates per unit exposure)

term         estimate  std. error       t        p       rate ratio  95% profile interval
-----------  --------  ----------  ------  -------  ---  ----------  --------------------
(Intercept)     1.882      0.1573   11.96  <0.0001  ***       6.568  4.687 … 8.746
A              0.6774      0.1573   4.306  0.00155  **        1.969  1.474 … 2.754
B             -0.4467       0.148  -3.019   0.0129  *        0.6397  0.4749 … 0.8551
C              0.1804      0.1566   1.152    0.276            1.198  0.8902 … 1.664
A:B            0.3503       0.148   2.367   0.0395  *         1.419  1.061 … 1.911
A:C           -0.2189      0.1566  -1.398    0.192           0.8034  0.5781 … 1.081
coded units: each continuous factor runs from −1 (low) to +1 (high); a rate ratio is the factor of change per coded unit (squared for low → high)

deviance = 19.53 on 10 df (null 105.6 on 15 df; 81.5% explained)   dispersion = 1.966

analysis of deviance (type I, sequential; F tests with the estimated dispersion)
source     df  deviance       F         p
---------  --  --------  ------  --------
A           1     63.27   32.19  0.000206
B           1     7.492   3.812    0.0794
C           1    0.3686  0.1875     0.674
A:B         1     10.88   5.537    0.0404
A:C         1     4.064   2.068     0.181
Residuals  10     19.53
```

(`--distribution` tries another kind than the response's; set it on the Define step, or in the
study file, to keep it.)

A prediction, with the interval for one new run that plates twice the volume:

```console
$ doe predict counts.aikidoe.json "colonies ~ A + B + C + A:B + A:C" --at "A=1,B=-1,C=0" --exposure 2
settings        rate (per unit exposure)  95% CI (mean)  95% PI (one run, exposure 2)
--------------  ------------------------  -------------  ----------------------------
A=1, B=-1, C=0                     14.24  10.98 … 18.46  8.5 … 21.5
Poisson counts: the mean's interval is computed on the log scale and transformed back; the prediction interval is for what a new run would give (count / exposure), allowing for the uncertainty in the fit
```

What the fit gives:

- **Coefficients** on the link scale, with z tests (t tests when the dispersion is estimated).
  With the log link, e^b is a **rate ratio**: the factor by which the mean count changes per coded
  unit (square it for a factor's low → high); with the logit link, an **odds ratio**. Their
  intervals come from the **profile likelihood** (as R's `confint`), which is better than ±1.96
  standard errors when counts are small.
- The **deviance** (how far the model is from fitting every run exactly), the null deviance
  (the intercept-only model) and the share explained; the **AIC**.
- The **analysis of deviance**: the deviance each term explains, a likelihood-ratio χ² on its df
  (sequential, type I, as R's `anova`; or type II and III, as `car::Anova`). Model reduction
  uses the same tests, or AICc.
- **Residuals**: standardised deviance residuals, in a **half-normal plot with a simulated
  envelope**: 99 data sets are simulated from the fitted model and refitted, and the band holds
  95 % of their residuals at each rank. Points above it are larger than the model expects —
  overdispersion, an outlier or a missing term. Simulation makes the check fair for small counts
  and few trials, where deviance residuals are far from normal.
- **Predictions** (the Optimise step, `doe predict`) on the response scale — a rate, a
  proportion — with a confidence interval for the mean transformed from the link scale, so it
  never leaves the possible range, and a **prediction interval** for what one new run would give:
  the quantiles of the count (Poisson, negative binomial) or of the successes out of the run's
  trials (binomial), averaged over the uncertainty in the fit (and in θ). `--exposure` and
  `--trials` set the new run's; confirmation runs are checked against the interval for the mean
  of the runs actually done. Counts are whole numbers, so the interval covers at least 95 %; with
  the negative binomial and few runs, θ is estimated too large and the interval is a little short.
- The Optimise step's **robustness** panel adds the count's own variation at the predicted mean
  (μ for the Poisson, μ + μ²/θ for the negative binomial, μ(1 − μ)/n for a proportion) to what the
  factors' tolerances transmit. Yield and surrogates are for continuous outputs only.

Two checks come with every fit:

- **Overdispersion.** Real counts often vary more than the Poisson allows (clumped cells,
  plate-to-plate variation); then its standard errors are too small. The fit reports Pearson
  χ²/df and flags it when clearly above 1. The remedy: the **negative binomial** (variance
  μ + μ²/θ, θ estimated by maximum likelihood, as `MASS::glm.nb`) or the **quasi-Poisson**
  (variance φμ, φ estimated; F tests). For proportions, the quasi-binomial.
- **Separation.** When a factor setting gives only passes (or only failures), the odds there are
  estimated as infinite: the estimate runs off and its standard error is meaningless. The fit
  flags it; **Firth's penalised likelihood** (`doe fit … --firth`; the Analyse step's button)
  gives finite estimates with Wald tests and intervals (as `brglm2` and `logistf`).

Power for counts and proportions is in [power](concepts.md#power).

### Random effects for counts and proportions

In a split-plot, the runs of one whole plot share its setting of the hard-to-change factors and
whatever else that whole plot did differently — a fresh batch of medium, an incubator that ran a
little warm. Colony counts from the same whole plot go up or down together, and a model that
treats every run as independent judges the hard-to-change factors against the run-to-run noise,
which is far too small for them. The same holds for blocks (days, batches) when there are enough
of them to be treated as a sample.

aikidoe then fits a **generalised linear mixed model** (GLMM): the Poisson or binomial model with
a **random intercept** per whole plot (or block) — a shift on the log or logit scale, drawn from
a normal distribution with standard deviation σ. It does so automatically for a split-plot with a
Poisson, binomial or pass/fail response; blocks are random when asked (`--random block`, or the
Analyse step's *random effect* choice), and `--random none` fits the ordinary model.

```text
doe fit STUDY "colonies ~ T + M + D"              # a split-plot: a random whole-plot intercept
doe fit STUDY "germinated ~ A + B" --random block
doe predict STUDY "colonies ~ T + M + D" --at "T=37,M=SOC,D=10" --exposure 100
```

- **The fit**: maximum likelihood, the integral over each whole plot's shift by **adaptive
  Gauss–Hermite quadrature** with 25 nodes (`--nagq`; `--nagq 1` is the Laplace approximation).
  Checked against R's `lme4::glmer` for Poisson counts with an exposure, binomial proportions
  (logit and probit) and pass/fail results, and for a fit where σ comes out as 0.
- **σ** is reported on the link scale, with the likelihood-ratio test of σ = 0 (referred to
  ½χ²₀ + ½χ²₁, since σ cannot be negative). σ estimated as 0 means no variation between whole
  plots beyond the counts' own; the fit is then the ordinary one.
- **Coefficients** with rate or odds ratios. Those that change only between whole plots — the
  hard-to-change factors, and the intercept — are judged against the variation from one whole plot
  to the next, and with few whole plots σ is uncertain and estimated too small. aikidoe therefore
  gives them **t tests and intervals on m − q degrees of freedom** (m whole plots, q such
  coefficients) and widens their standard errors by √(m/(m − q)), as REML does for measurements.
  This is not in `lme4`, whose Wald z intervals for a hard-to-change factor covered the truth in
  only 82–89 % of simulated split-plots with 8–12 whole plots; with the correction, 92–95 %.
  Coefficients that change within whole plots keep the z tests.
- **Tests** of the terms are likelihood ratios, σ re-estimated with and without the term (types
  I, II and III); for a term that changes only between whole plots, as F = χ²/df on m − q df.
- **Predictions** are for a *typical* whole plot (its shift 0) and, because the link scale is
  not linear, also **averaged over whole plots** (larger, for counts); the prediction interval for
  one new run allows for a new whole plot's shift.
- **Model reduction** works on this model too ([model reduction](#model-reduction)): each
  candidate term is dropped and the model refitted (σ re-estimated), and judged by the same
  likelihood-ratio test as in the table, an F for terms that change only between whole plots.
  Each step refits the model several times, so on the Analyse step it runs in the background.
- Not available with a random effect: the negative binomial and quasi models (the random effect
  already takes up the extra variation between whole plots) and Firth's method.
  Power for a split-plot with counts or proportions takes the whole-plot σ
  ([power](concepts.md#power)); without it, power treats the runs as independent and overstates
  it for hard-to-change factors.

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
