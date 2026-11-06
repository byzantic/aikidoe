# Worked example: furnace split-plot with drop-in sites

An anneal: furnace temperature T (900 … 1000 °C) is set once per furnace run; anneal time t and
implant dose vary between the wafers in it. Each condition gets two wafers, placed in boat slots,
and the sheet resistance Rs is measured at nine drop-in sites on each. The data are **simulated**
by a virtual process with a known truth (furnace-to-furnace, run-to-run and wafer-to-wafer
variation, a bowl across the wafer that deepens with temperature, and a slot gradient), so the
analysis can be checked against it. The study is `examples/furnace-anneal.aikidoe.json`, and in the app:
[open it](../../index.html#example=anneal-results).

## The structure

```console
$ doe info examples/furnace-anneal.aikidoe.json
Furnace anneal  (seed 41)
factor  name                range / levels
------  ------------------  ----------------  --------------
T       Anneal temperature  900 … 1000 °C     hard to change
t       Anneal time         10 … 30 min
dose    Implant dose        1e15 … 5e15 cm-2  log
responses: Rs (Ω/sq)
sites: dropin-9, 9 positions, 200 mm wafer
design: split-plot-full, 24 runs, randomisation restricted; results for 24 of 24 runs
```

Six furnace runs (whole plots: T at two levels, three times each), four t × dose combinations in
each: 24 runs, 48 wafers, 432 readings. Temperature is a whole-plot factor: its effect can only be
judged against the variation between furnace runs, of which there are six.

## The mixed model

`doe fit` sees the whole plots, wafers and sites in the observations and fits a mixed model, with
random effects for the whole plot, the run and the wafer (the residual is the within-wafer
variation). `--compare` adds the p-values an analysis of the 432 readings as if they were
independent would give:

```console
$ doe fit examples/furnace-anneal.aikidoe.json "Rs ~ T*t*dose" --compare
Rs ~ T + t + dose + T:t + T:dose + t:dose + T:t:dose
mixed model (REML): 432 readings from 24 runs; random effects: Whole plot (6), Run (24), Wafer (48); residual = within wafer (sites, repeats)

variance components
source      variance  std. dev.  95% CI (variance)  % of total
----------  --------  ---------  -----------------  ----------
Whole plot     6.081      2.466  2.121 … 56.75      81.8
Run           0.8631     0.9291  0.4263 … 2.585     11.6
Wafer        0.07971     0.2823  0.03843 … 0.2532   1.07
Residual       0.413     0.6427  0.3603 … 0.4783    5.55

fixed effects (coded units; Kenward–Roger standard errors and df)
term         estimate  std. error  df        t        p
-----------  --------  ----------  --  -------  -------  ---
(Intercept)     61.08       1.026   4    59.55  <0.0001  ***
T              -2.729       1.026   4    -2.66   0.0564  .
t              -2.261      0.1964  12   -11.51  <0.0001  ***
dose           -6.017      0.1964  12   -30.63  <0.0001  ***
T:t            0.2359      0.1964  12    1.201    0.253
T:dose          1.147      0.1964  12    5.838  <0.0001  ***
t:dose       -0.04479      0.1964  12   -0.228    0.823
T:t:dose      -0.1857      0.1964  12  -0.9455    0.363

tests of model terms (Kenward–Roger)
term          F  ndf  ddf        p       tested in   p if independent
--------  -----  ---  ---  -------  ---  ----------  ----------------
T         7.077    1    4   0.0564  .    whole plot           <0.0001
t         132.5    1   12  <0.0001  ***  run                  <0.0001
dose      938.5    1   12  <0.0001  ***  run                  <0.0001
T:t       1.442    1   12    0.253       run                   0.0321
T:dose    34.09    1   12  <0.0001  ***  run                  <0.0001
t:dose    0.052    1   12    0.823       run                    0.683
T:t:dose  0.894    1   12    0.363       run                   0.0912
strata (containment df): whole plot 4, run 12, wafer 24, residual 384
"p if independent": least squares on the same 432 readings as if every reading were independent — what an analysis that ignores the whole plots, runs and wafers would claim
REML criterion 973.4597
```

Four fifths of the variation is between furnace runs. Every term is tested in its stratum:
T against the whole plots (4 degrees of freedom — six furnace runs, less the mean and T itself),
the subplot terms against the run-to-run variation (12). The naive analysis is wrong in the
dangerous direction: it counts 432 readings where there are 6 furnace runs and 24 runs, so every
p-value shrinks. It calls the temperature effect certain (p < 0.0001) when six furnace runs leave
it at p = 0.056, and it finds a time × temperature interaction (p = 0.03) that is not in the
process at all (the mixed model: p = 0.25). The temperature effect is real — the truth has
−4 Ω/sq per half-range — but with a furnace-to-furnace standard deviation estimated at about 2.5 Ω/sq (1.6 in the
simulation; six whole plots estimate it poorly), six
furnace runs are too few to establish it at 5 %: the design needs more whole plots, not more
wafers or sites.

## Within-wafer patterns

Add the position terms: `radius2` (ρ², a bowl), its interaction with temperature, and the boat
`slot`:

```console
$ doe fit examples/furnace-anneal.aikidoe.json "Rs ~ T*t*dose + radius2 + T:radius2 + slot"
Rs ~ T + t + dose + radius2 + slot + T:t + T:dose + t:dose + T:radius2 + T:t:dose
mixed model (REML): 432 readings from 24 runs; random effects: Whole plot (6), Run (24), Wafer (48); residual = within wafer (sites, repeats)

variance components
source      variance  std. dev.  95% CI (variance)  % of total
----------  --------  ---------  -----------------  ----------
Whole plot      6.21      2.492  2.202 … 54.03      92.4
Run           0.3396     0.5827  0.1521 … 1.311     5.05
Wafer         0.1326     0.3641  0.07928 … 0.2657   1.97
Residual     0.04064     0.2016  0.03544 … 0.04708  0.604

fixed effects (coded units; Kenward–Roger standard errors and df)
term         estimate  std. error     df        t        p
-----------  --------  ----------  -----  -------  -------  ---
(Intercept)     61.33       1.026      4    59.79  <0.0001  ***
T              -2.576       1.026      4   -2.511    0.066  .
t              -2.407      0.1366  11.64   -17.61  <0.0001  ***
dose            -6.09       0.132  11.23   -46.14  <0.0001  ***
radius2         1.003     0.01979    382    50.71  <0.0001  ***
slot           0.7662      0.2143  20.75    3.575  0.00181  **
T:t           0.08992      0.1366  11.64   0.6581    0.523
T:dose          1.147      0.1304  11.09    8.794  <0.0001  ***
t:dose       -0.04479      0.1304  11.09  -0.3435    0.738
T:radius2      0.6099     0.01979    382    30.82  <0.0001  ***
T:t:dose      -0.3317      0.1366  11.64   -2.427   0.0325  *

tests of model terms (Kenward–Roger)
term           F  ndf    ddf        p       tested in
---------  -----  ---  -----  -------  ---  ----------
T          6.305    1      4    0.066  .    whole plot
t          310.2    1  11.64  <0.0001  ***  run
dose        2129    1  11.23  <0.0001  ***  run
radius2     2571    1    382  <0.0001  ***  residual
slot       12.78    1  20.75  0.00181  **   wafer
T:t        0.433    1  11.64    0.523       run
T:dose     77.33    1  11.09  <0.0001  ***  run
t:dose     0.118    1  11.09    0.738       run
T:radius2  950.2    1    382  <0.0001  ***  residual
T:t:dose   5.891    1  11.64   0.0325  *    run
strata (containment df): whole plot 4, run 12, wafer 23, residual 382
REML criterion 85.634592
```

The bowl (`radius2`) and its growth with temperature (`T:radius2`) are detected, tested against
the within-wafer variation; the slot gradient (0.77 per half-range of slots 1 … 8, about 0.2 Ω/sq
per slot, as simulated) against the wafer-to-wafer variation. One term, `T:t:dose`, comes out at
p = 0.03 although the truth has no such effect: with ten tests at 5 %, a false alarm is not
surprising, which is why a reduced model is a suggestion and a confirmation run the test.

## Uniformity as a response

Summarise each wafer by the log of the standard deviation of its nine readings, and model that:

```console
$ doe summary examples/furnace-anneal.aikidoe.json Rs --stats logsd
Rs_logsd: per-wafer log₁₀ of the standard deviation of Rs (computed from the readings; fit it like any response)
$ doe fit examples/furnace-anneal.aikidoe.json "Rs_logsd ~ T + t + dose"
Rs_logsd ~ T + t + dose
mixed model (REML): 48 readings from 24 runs; random effects: Whole plot (6), Run (24); residual = within run

variance components
source      variance  std. dev.  95% CI (variance)             % of total
----------  --------  ---------  ----------------------------  ----------
Whole plot         0          0  estimate on the boundary (0)  0
Run         0.002272    0.04767  0.000884 … 0.01375            41.7
Residual    0.003179    0.05639  0.001938 … 0.006153           58.3

fixed effects (coded units; Kenward–Roger standard errors and df)
term          estimate  std. error  df        t        p
-----------  ---------  ----------  --  -------  -------  ---
(Intercept)    -0.3199     0.01269   4   -25.22  <0.0001  ***
T               0.2549     0.01269   4    20.09  <0.0001  ***
t            -0.005217     0.01269  16  -0.4113    0.686
dose          -0.01716     0.01269  16   -1.353    0.195

tests of model terms (Kenward–Roger)
term       F  ndf  ddf        p       tested in
----  ------  ---  ---  -------  ---  ----------
T      403.7    1    4  <0.0001  ***  whole plot
t     0.1691    1   16    0.686       run
dose    1.83    1   16    0.195       run
strata (containment df): whole plot 4, run 16, residual 24
note: Whole plot variance estimated as 0 (on the boundary): the data show no variation at that level beyond what the levels below explain
REML criterion -94.941565
```

The non-uniformity grows with temperature (p < 0.0001: the per-wafer spread is dominated by the
bowl, which is the same in every furnace run at a given temperature) — the same finding as
`T:radius2`, from a different angle. A [robust design](optimisation.md#robust-design) could now trade the mean against the
uniformity.

## Predictions for new runs

Predictions for a new furnace run include its whole-plot, run and wafer variation:

```console
$ doe predict examples/furnace-anneal.aikidoe.json "Rs ~ T*t*dose + radius2 + T:radius2" --at "T=950,t=20,dose=2e15"
settings                predicted  95% CI (mean, KR)  95% PI (one new run, measured like the others)
----------------------  ---------  -----------------  ----------------------------------------------
T=950, t=20, dose=2e15      61.72  58.88 … 64.57      54.32 … 69.13 (df 4.78)
mixed model: the prediction interval includes whole plot, run, wafer and residual variation (Satterthwaite df); position terms averaged over the sites
```
