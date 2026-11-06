# Worked example: furnace split-plot with drop-in sites

An anneal: furnace temperature T (900 … 1000 °C) is set once per furnace run; anneal time t and
implant dose vary between the wafers in it. Each condition gets two wafers, placed in boat slots,
and the sheet resistance Rs is measured at nine drop-in sites on each. The data are **simulated**
(with a known structure: furnace-to-furnace, run-to-run and wafer-to-wafer variation, a bowl across
the wafer that deepens with temperature, and a slot gradient), so the analysis can be checked
against the truth. The study is `examples/furnace-anneal.aikidoe.json`, and in the app:
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
Whole plot     3.464      1.861  1.198 … 33.63      75.6
Run           0.6072     0.7792  0.289 … 1.994      13.3
Wafer         0.1264     0.3556  0.06693 … 0.3231   2.76
Residual      0.3849     0.6204  0.3358 … 0.4457    8.4

fixed effects (coded units; Kenward–Roger standard errors and df)
term         estimate  std. error  df       t        p
-----------  --------  ----------  --  ------  -------  ---
(Intercept)     61.92      0.7786   4   79.52  <0.0001  ***
T              -4.082      0.7786   4  -5.243  0.00633  **
t              -2.147      0.1698  12  -12.65  <0.0001  ***
dose           -5.941      0.1698  12  -34.99  <0.0001  ***
T:t            0.3102      0.1698  12   1.827   0.0926  .
T:dose          1.177      0.1698  12   6.934  <0.0001  ***
t:dose        0.09699      0.1698  12  0.5713    0.578
T:t:dose       0.0587      0.1698  12  0.3458    0.736

tests of model terms (Kenward–Roger)
term           F  ndf  ddf        p       tested in   p if independent
--------  ------  ---  ---  -------  ---  ----------  ----------------
T          27.49    1    4  0.00633  **   whole plot           <0.0001
t            160    1   12  <0.0001  ***  run                  <0.0001
dose        1225    1   12  <0.0001  ***  run                  <0.0001
T:t        3.339    1   12   0.0926  .    run                 0.000394
T:dose     48.09    1   12  <0.0001  ***  run                  <0.0001
t:dose    0.3263    1   12    0.578       run                    0.265
T:t:dose  0.1195    1   12    0.736       run                    0.499
strata (containment df): whole plot 4, run 12, wafer 24, residual 384
"p if independent": least squares on the same 432 readings as if every reading were independent — what an analysis that ignores the whole plots, runs and wafers would claim
REML criterion 947.78821
```

Three quarters of the variation is between furnace runs. Every term is tested in its stratum:
T against the whole plots (4 degrees of freedom — six furnace runs, less the mean and T itself),
the subplot terms against the run-to-run variation (12). The naive analysis is wrong in the
dangerous direction: it counts 432 readings where there are 6 furnace runs and 24 runs, so every
p-value shrinks — the time × temperature interaction `T:t` looks clearly significant (p = 0.0004)
when the evidence is weak (p = 0.09).

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
Whole plot     3.526      1.878  1.236 … 32.21      86.4
Run           0.3654     0.6045  0.1624 … 1.442     8.96
Wafer         0.1534     0.3916  0.09206 … 0.3053   3.76
Residual      0.0353     0.1879  0.03078 … 0.04089  0.865

fixed effects (coded units; Kenward–Roger standard errors and df)
term         estimate  std. error     df        t        p
-----------  --------  ----------  -----  -------  -------  ---
(Intercept)     62.16      0.7786      4    79.84  <0.0001  ***
T               -3.94      0.7786      4   -5.061  0.00717  **
t              -2.273      0.1426  11.62   -15.94  <0.0001  ***
dose           -6.004      0.1377  11.22    -43.6  <0.0001  ***
radius2        0.9873     0.01844    382    53.54  <0.0001  ***
slot           0.6589       0.225  20.26    2.928  0.00823  **
T:t            0.1847      0.1426  11.62    1.295     0.22
T:dose          1.177       0.136  11.08    8.655  <0.0001  ***
t:dose        0.09699       0.136  11.08    0.713    0.491
T:radius2      0.5649     0.01844    382    30.63  <0.0001  ***
T:t:dose     -0.06679      0.1426  11.62  -0.4683    0.648

tests of model terms (Kenward–Roger)
term            F  ndf    ddf        p       tested in
---------  ------  ---  -----  -------  ---  ----------
T           25.61    1      4  0.00717  **   whole plot
t             254    1  11.62  <0.0001  ***  run
dose         1901    1  11.22  <0.0001  ***  run
radius2      2867    1    382  <0.0001  ***  residual
slot        8.576    1  20.26  0.00823  **   wafer
T:t         1.678    1  11.62     0.22       run
T:dose      74.92    1  11.08  <0.0001  ***  run
t:dose     0.5084    1  11.08    0.491       run
T:radius2   938.3    1    382  <0.0001  ***  residual
T:t:dose   0.2194    1  11.62    0.648       run
strata (containment df): whole plot 4, run 12, wafer 23, residual 382
REML criterion 33.854201
```

The bowl (`radius2`) and its growth with temperature (`T:radius2`) are detected, tested against
the within-wafer variation; the slot gradient against the wafer-to-wafer variation.

## Uniformity as a response

Summarise each wafer by the log of the standard deviation of its nine readings, and model that:

```console
$ doe summary examples/furnace-anneal.aikidoe.json Rs --stats logsd
Rs_logsd: per-wafer log₁₀ of the standard deviation of Rs (computed from the readings; fit it like any response)
$ doe fit examples/furnace-anneal.aikidoe.json "Rs_logsd ~ T + t + dose"
Rs_logsd ~ T + t + dose
mixed model (REML): 48 readings from 24 runs; random effects: Whole plot (6), Run (24); residual = within run

variance components
source       variance  std. dev.  95% CI (variance)             % of total
----------  ---------  ---------  ----------------------------  ----------
Whole plot  0.0002121    0.01456  1.857e-5 … 1.314e38           2.13
Run                 0          0  estimate on the boundary (0)  0
Residual     0.009738    0.09868  0.005937 … 0.01885            97.9

fixed effects (coded units; Kenward–Roger standard errors and df)
term         estimate  std. error  df       t        p
-----------  --------  ----------  --  ------  -------  ---
(Intercept)   -0.3248     0.01543   4  -21.04  <0.0001  ***
T              0.2402     0.01543   4   15.56  <0.0001  ***
t              0.0164     0.01424  16   1.151    0.266
dose          0.01444     0.01424  16   1.014    0.326

tests of model terms (Kenward–Roger)
term      F  ndf  ddf        p       tested in
----  -----  ---  ---  -------  ---  ----------
T     242.1    1    4  <0.0001  ***  whole plot
t     1.326    1   16    0.266       run
dose  1.028    1   16    0.326       run
strata (containment df): whole plot 4, run 16, residual 24
note: Run variance estimated as 0 (on the boundary): the data show no variation at that level beyond what the levels below explain
REML criterion -62.802657
```

The non-uniformity grows with temperature — the same finding as `T:radius2`, from a different
angle. A [robust design](optimisation.md#robust-design) could now trade the mean against the
uniformity.

## Predictions for new runs

Predictions for a new furnace run include its whole-plot, run and wafer variation:

```console
$ doe predict examples/furnace-anneal.aikidoe.json "Rs ~ T*t*dose + radius2 + T:radius2" --at "T=950,t=20,dose=2e15"
settings                predicted  95% CI (mean, KR)  95% PI (one new run, measured like the others)
----------------------  ---------  -----------------  ----------------------------------------------
T=950, t=20, dose=2e15      62.56  60.39 … 64.72      56.95 … 68.16 (df 5.01)
mixed model: the prediction interval includes whole plot, run, wafer and residual variation (Satterthwaite df); position terms averaged over the sites
```
