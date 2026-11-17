# Worked example: reanalysing a published 2⁴ (dental composites)

Published experiments are a good way to practise analysis, and to see how much the choice of
analysis matters. This page takes the results of a 2⁴ factorial from a recent paper and analyses
them again in aikidoe:

> Alves, M., Alves, J., Silva, F. & Delgado, A. H. (2026). Design of Experiments (DOE) approach
> for multi-response optimization of experimental self-adhesive flowable resin composites.
> *Dental Materials*. doi:10.1016/j.dental.2026.07.012

The authors made 16 experimental flowable composites for filling teeth, one for each combination
of four factors:

| factor | low | high |
|---|---|---|
| `monomer`: the acidic monomer that makes the composite stick to the tooth | HEMA | 10-MDP |
| `mol`: how much of it, in mol % of the resin | 5 | 25 |
| `PL`: powder-to-liquid ratio | 2.5 | 3.2 |
| `filler`: the filler mix (low or high nanosilica) | FL | FH |

They measured these responses:

- shear bond strength to dentin (`SBS`, MPa, 5 teeth);
- degree of conversion after 40 s of light curing (`DC40`, %, 3 specimens);
- water sorption and solubility (`Wsp`, `Wsl`, µg/mm³, 8 discs);
- viscosity (`visc`, mPa·s), measured with a cone-plate rheometer for the low-filler pastes and
  a parallel-plate one for the high-filler pastes.

The paper's Table 3 gives each formulation's mean, and those 16 means are the data here. The
same study is in the app: [open it](../../index.html#example=dental-flowable).

The paper analysed each half of the design (low filler, high filler) as a separate 2³, with every
specimen as a data point. This page does three things differently:

- it analyses the whole 2⁴;
- it uses one value per formulation;
- it takes the log of viscosity.

The conclusions change in several places. The problems found here are common in published
experiments; they are not peculiar to this paper.

Every command below is run by the test suite, and its output is compared with what is shown.

## The study and the means

```console
$ doe init flowable.aikidoe.json --name "Self-adhesive flowable composite" --factor monomer=HEMA,MDP --factor mol:5:25:mol% --factor PL:2.5:3.2 --factor filler=FL,FH --response SBS:MPa --response DC40:% --response Wsp:µg/mm³ --response Wsl:µg/mm³ --response visc:mPa·s --response "lvisc:log10 mPa·s" --seed 2026
created flowable.aikidoe.json: 4 factors, 6 responses, seed 2026
$ doe design flowable.aikidoe.json --full
flowable.aikidoe.json: full-factorial, 16 runs, randomisation complete, seed 2026
```

Here are the means from Table 3, by run number. Run 1 is HEMA, 5 mol %, P/L 2.5, low filler.
The design's standard order puts `monomer` first, changing fastest, then `mol`, `PL` and
`filler`. `lvisc` is log₁₀ of the viscosity.

```file results.csv
run,SBS,DC40,Wsp,Wsl,visc,lvisc
1,0.62,89.93,12.17,0.03,13107.81,4.118
2,1.94,63.43,12.16,-0.92,30827.95,4.489
3,0.44,83.60,12.30,-3.32,10524.72,4.022
4,5.38,72.10,13.84,-8.18,57451.14,4.759
5,0.54,87.00,5.86,-6.15,50572.08,4.704
6,1.6,59.90,11.09,-1.43,149986.78,5.176
7,1.8,82.20,12.33,-3.47,46194.96,4.665
8,5.68,69.83,11.54,-7.32,301766.30,5.480
9,0.58,85.63,12.69,-0.17,299910.25,5.477
10,0.78,62.13,14.50,1.38,20309.78,4.308
11,1.64,86.63,10.10,-5.56,128740.13,5.110
12,7.18,78.93,11.71,-9.36,113995.53,5.057
13,1.54,86.20,11.83,-0.33,4865.05,3.687
14,1.74,67.63,8.72,-1.97,331036.16,5.520
15,0.26,88.33,16.25,0.67,108.46,2.035
16,3.42,54.43,12.67,-4.34,821262.07,5.914
```

```console
$ doe import flowable.aikidoe.json results.csv
warning line 6, Wsp: 5.86 is far from the other Wsp values (robust z = -7.4); check it, it is kept
warning line 17, visc: 821262.07 is far from the other visc values (robust z = 10.0); check it, it is kept
96 value(s) read (wide format)
flowable.aikidoe.json: 96 observation(s)
```

The import flags two values that stand apart from the rest:

- the sorption of run 5 (5.86 µg/mm³; the other runs are 8.7–16.3);
- the viscosity of run 16 (821,000 mPa·s).

They are kept, but worth remembering.

## One run per formulation

Each formulation was mixed once. The teeth and discs are **repeated measurements** of that one
batch, not replicates (see
[replication and repeated measurement](concepts.md#replication-and-repeated-measurement)).
Formulation-to-formulation variation (weighing, mixing, a slightly different cure) is in none of
the specimens' scatter. So the error against which an effect must be judged is the variation
among *formulations*, and that needs one value per formulation, the mean.

The data show how much this matters. Compare two numbers for each response:

- the residual σ of each response's reduced model (below), fitted to the 16 means;
- the standard error of a mean implied by the specimens' scatter (the root mean square of the
  SEs in Table 3).

| response | σ among formulation means | SE from the specimens | ratio |
|---|---|---|---|
| SBS (MPa) | 0.94 | 0.74 | 1.3 |
| DC40 (%) | 5.7 | 2.9 | 2.0 |
| Wsl (µg/mm³) | 2.8 | 0.42 | 6.6 |

Formulations differ from each other by much more than their specimens' scatter predicts. For
solubility, the difference is a factor of 6.6. Tests with the specimens as the error inflate
the F values by the square of that ratio, about 40 times for solubility. That is how the paper
finds F = 101 and seven significant solubility terms in an 8-formulation half of the design.

With one value per formulation and every interaction in the model, a 2⁴ has no residual degrees
of freedom left. [Lenth's method](analysis.md#effects-and-lenths-method) judges the 15 effects against each
other instead.

## Bond strength

```console
$ doe fit flowable.aikidoe.json "SBS ~ monomer*mol*PL*filler" --lenth
SBS ~ monomer + mol + PL + filler + monomer:mol + monomer:PL + mol:PL + monomer:filler + mol:filler + PL:filler + monomer:mol:PL + monomer:mol:filler + monomer:PL:filler + mol:PL:filler + monomer:mol:PL:filler
16 runs, 16 estimable coefficients, 0 residual df

term                            estimate
------------------------------  --------
(Intercept)                        2.196
monomer[MDP]                       1.269
mol                                1.029
PL                               -0.1237
filler[FH]                      -0.05375
monomer[MDP]:mol                  0.9213
monomer[MDP]:PL                  -0.2313
mol:PL                           -0.3112
monomer[MDP]:filler[FH]          -0.1313
mol:filler[FH]                  -0.04625
PL:filler[FH]                    -0.2788
monomer[MDP]:mol:PL              -0.1987
monomer[MDP]:mol:filler[FH]       0.1162
monomer[MDP]:PL:filler[FH]      -0.06625
mol:PL:filler[FH]                -0.5713
monomer[MDP]:mol:PL:filler[FH]  -0.09875
coded units: each continuous factor runs from −1 (low) to +1 (high)

no residual degrees of freedom: use --lenth to judge the effects

Lenth: PSE = 0.3825, ME = 0.9832, SME = 1.996 (15 effects, d = 5)
effect                          estimate  t (PSE)
------------------------------  --------  -------  -----
monomer[MDP]                       2.538    6.634  > SME
mol                                2.057    5.379  > SME
monomer[MDP]:mol                   1.843    4.817  > ME
mol:PL:filler[FH]                 -1.143   -2.987  > ME
mol:PL                           -0.6225   -1.627
PL:filler[FH]                    -0.5575   -1.458
monomer[MDP]:PL                  -0.4625   -1.209
monomer[MDP]:mol:PL              -0.3975   -1.039
monomer[MDP]:filler[FH]          -0.2625  -0.6863
PL                               -0.2475  -0.6471
monomer[MDP]:mol:filler[FH]       0.2325   0.6078
monomer[MDP]:mol:PL:filler[FH]   -0.1975  -0.5163
monomer[MDP]:PL:filler[FH]       -0.1325  -0.3464
filler[FH]                       -0.1075   -0.281
mol:filler[FH]                   -0.0925  -0.2418
effect = 2 × coefficient (change from low to high)
```

Three effects stand out, and they agree with the paper:

- 10-MDP bonds better than HEMA;
- more of it bonds better;
- the two together do best (the interaction).

A three-factor interaction passes the individual margin (ME) but not the simultaneous one (SME).
With 15 effects, one false alarm at ME is not unusual, so it is not taken further.

The filler's effect, which the paper never estimates, is −0.11 MPa: nothing. P/L does nothing
either.

The reduced model:

```console
$ doe fit flowable.aikidoe.json "SBS ~ monomer*mol"
SBS ~ monomer + mol + monomer:mol
16 runs, 4 estimable coefficients, 12 residual df

term              estimate  std. error      t         p
----------------  --------  ----------  -----  --------  ---
(Intercept)          2.196      0.2344  9.371   <0.0001  ***
monomer[MDP]         1.269      0.2344  5.414  0.000157  ***
mol                  1.029      0.2344   4.39  0.000881  ***
monomer[MDP]:mol    0.9213      0.2344  3.931     0.002  **
coded units: each continuous factor runs from −1 (low) to +1 (high)

σ = 0.9374   R² = 0.8422   adjusted R² = 0.8027   predicted R² = 0.7194
F = 21.34 on 3 and 12 df, p <0.0001

ANOVA (type I, sequential)
source       df  sum of sq.  mean sq.      F         p
-----------  --  ----------  --------  -----  --------
monomer       1       25.76     25.76  29.31  0.000157
mol           1       16.93     16.93  19.27  0.000881
monomer:mol   1       13.58     13.58  15.45     0.002
Residuals    12       10.55    0.8788
```

## Conversion, sorption and solubility

The same saturated fit for the other responses (`doe fit … "DC40 ~ monomer*mol*PL*filler" --lenth`
and so on) finds the following:

- **DC40:** only the monomer matters. 10-MDP converts 20 percentage points less than HEMA (the
  effect is −20.1, beyond the ME of 11.8). Nothing else comes near. The paper's monomer × mol
  interaction (F = 13.6) is not distinguishable from noise here.
- **Sorption:** nothing. The largest effect, 2.4, is well inside the ME of 3.8.
- **Solubility:** only `mol`, with an effect of −3.9 (ME 3.4).

```console
$ doe fit flowable.aikidoe.json "Wsl ~ monomer*mol*PL*filler" --lenth
Wsl ~ monomer + mol + PL + filler + monomer:mol + monomer:PL + mol:PL + monomer:filler + mol:filler + PL:filler + monomer:mol:PL + monomer:mol:filler + monomer:PL:filler + mol:PL:filler + monomer:mol:PL:filler
16 runs, 16 estimable coefficients, 0 residual df

term                            estimate
------------------------------  --------
(Intercept)                       -3.153
monomer[MDP]                      -0.865
mol                               -1.957
PL                                  0.11
filler[FH]                        0.6925
monomer[MDP]:mol                  -1.325
monomer[MDP]:PL                   0.1425
mol:PL                             1.385
monomer[MDP]:filler[FH]          -0.2475
mol:filler[FH]                     -0.23
PL:filler[FH]                     0.8575
monomer[MDP]:mol:PL              -0.1675
monomer[MDP]:mol:filler[FH]        0.235
monomer[MDP]:PL:filler[FH]       -0.6925
mol:PL:filler[FH]                   0.46
monomer[MDP]:mol:PL:filler[FH]     0.415
coded units: each continuous factor runs from −1 (low) to +1 (high)

no residual degrees of freedom: use --lenth to judge the effects

Lenth: PSE = 1.313, ME = 3.374, SME = 6.849 (15 effects, d = 5)
effect                          estimate  t (PSE)
------------------------------  --------  -------  ----
mol                               -3.915   -2.983  > ME
mol:PL                              2.77     2.11
monomer[MDP]:mol                   -2.65   -2.019
monomer[MDP]                       -1.73   -1.318
PL:filler[FH]                      1.715    1.307
filler[FH]                         1.385    1.055
monomer[MDP]:PL:filler[FH]        -1.385   -1.055
mol:PL:filler[FH]                   0.92    0.701
monomer[MDP]:mol:PL:filler[FH]      0.83   0.6324
monomer[MDP]:filler[FH]           -0.495  -0.3771
monomer[MDP]:mol:filler[FH]         0.47   0.3581
mol:filler[FH]                     -0.46  -0.3505
monomer[MDP]:mol:PL               -0.335  -0.2552
monomer[MDP]:PL                    0.285   0.2171
PL                                  0.22   0.1676
effect = 2 × coefficient (change from low to high)
```

Solubility needs care. Negative values mean that the discs weighed more after drying than at
the start, because they kept some of the water they had absorbed. So "lower solubility" at
25 mol % really means *more retained water*: the acidic monomers are hydrophilic. The paper
says as much in its discussion, but its optimisation still minimises Wsl, which rewards the most
water-retaining formulation. A value near 0 is what is wanted.

Filler has no detectable effect on any of these responses. That is useful news: the filler
level can be chosen for handling. Splitting the design by filler threw that information away
and halved the runs behind every other effect.

## Viscosity

Viscosity ranges from 108 to 821,000 mPa·s, and its standard errors grow with the mean. That
calls for a log scale. On the log scale, P/L should be one of the largest effects, because more
powder makes a stiffer paste:

```console
$ doe fit flowable.aikidoe.json "lvisc ~ monomer*mol*PL*filler" --lenth
lvisc ~ monomer + mol + PL + filler + monomer:mol + monomer:PL + mol:PL + monomer:filler + mol:filler + PL:filler + monomer:mol:PL + monomer:mol:filler + monomer:PL:filler + mol:PL:filler + monomer:mol:PL:filler
16 runs, 16 estimable coefficients, 0 residual df

term                             estimate
------------------------------  ---------
(Intercept)                         4.658
monomer[MDP]                       0.4303
mol                              -0.02731
PL                              -0.009937
filler[FH]                       -0.01906
monomer[MDP]:mol                   0.2419
monomer[MDP]:PL                    0.4446
mol:PL                           -0.09681
monomer[MDP]:filler[FH]            0.1309
mol:filler[FH]                   -0.08219
PL:filler[FH]                     -0.3396
monomer[MDP]:mol:PL               0.05669
monomer[MDP]:mol:filler[FH]        0.1533
monomer[MDP]:PL:filler[FH]         0.4222
mol:PL:filler[FH]                 -0.1082
monomer[MDP]:mol:PL:filler[FH]    0.05956
coded units: each continuous factor runs from −1 (low) to +1 (high)

no residual degrees of freedom: use --lenth to judge the effects

Lenth: PSE = 0.2685, ME = 0.6902, SME = 1.401 (15 effects, d = 5)
effect                          estimate   t (PSE)
------------------------------  --------  --------  ----
monomer[MDP]:PL                   0.8891     3.311  > ME
monomer[MDP]                      0.8606     3.205  > ME
monomer[MDP]:PL:filler[FH]        0.8444     3.145  > ME
PL:filler[FH]                    -0.6791    -2.529
monomer[MDP]:mol                  0.4839     1.802
monomer[MDP]:mol:filler[FH]       0.3066     1.142
monomer[MDP]:filler[FH]           0.2619    0.9753
mol:PL:filler[FH]                -0.2164   -0.8059
mol:PL                           -0.1936   -0.7211
mol:filler[FH]                   -0.1644   -0.6122
monomer[MDP]:mol:PL:filler[FH]    0.1191    0.4437
monomer[MDP]:mol:PL               0.1134    0.4223
mol                             -0.05462   -0.2034
filler[FH]                      -0.03812    -0.142
PL                              -0.01987  -0.07402
effect = 2 × coefficient (change from low to high)
```

Instead, the main effect of P/L is zero. What passes the margin is the monomer and its
interactions with P/L and filler. Looking at how much P/L 3.2 multiplies the viscosity at 2.5,
for each monomer and mol %, shows why:

| monomer, mol % | low filler (cone-plate) | high filler (parallel-plate) |
|---|---|---|
| HEMA, 5 | × 3.9 | × 0.016 |
| 10-MDP, 5 | × 4.9 | × 16 |
| HEMA, 25 | × 4.4 | × 0.0008 |
| 10-MDP, 25 | × 5.3 | × 7.2 |

The low-filler pastes behave as expected: more powder, 4–5 times thicker, every time. In the
high-filler group, by contrast, a paste becomes 1,200 times *thinner* with more powder (HEMA,
25 mol %: 128,740 → 108 mPa·s). A paste at P/L 3.2 cannot be less viscous than its resin.

So the trouble in the high-filler group is not only that the two rheometers can't be compared;
the parallel-plate measurements themselves are unreliable (wall slip or poor gap filling are
likely). The `filler` effect on viscosity also includes the change of geometry. Only the
low-filler viscosities are usable, and on them P/L dominates.

## Best settings

Set the goals and their limits:

- bond strength: as high as possible, at least 1 MPa, and 6 MPa is plenty;
- conversion: as high as possible, at least 60 %;
- solubility: on target at 0, from −6 to 2 µg/mm³.

Then optimise over the reduced models:

```console
$ doe goal flowable.aikidoe.json SBS --maximize --lower 1 --target 6
SBS: maximize, lower 1, target 6
$ doe goal flowable.aikidoe.json DC40 --maximize --lower 60 --target 85
DC40: maximize, lower 60, target 85
$ doe goal flowable.aikidoe.json Wsl --target 0 --lower -6 --upper 2
Wsl: target, lower -6, target 0, upper 2
$ doe optimise flowable.aikidoe.json --model "SBS ~ monomer*mol" --model "DC40 ~ monomer" --model "Wsl ~ mol" --fix "PL=2.5,filler=FL"
models: SBS ~ monomer*mol; DC40 ~ monomer; Wsl ~ mol
region: cube; held: PL=2.5, filler=FL

best settings: monomer=MDP, mol=15.9528, PL=2.5, filler=FL
overall desirability D = 0.3846
response  predicted  95% CI           goal                    d
--------  ---------  ---------------  -----------------  ------
SBS           3.651  2.925 … 4.376    max (1 → 6)        0.5302
DC40          66.05  61.72 … 70.38    max (60 → 85)      0.2419
Wsl          -3.339  -4.833 … -1.845  target 0 (-6 … 2)  0.4435
```

`PL` and `filler` are held (`--fix`) because they are in none of the models. An optimiser
reports a value for every factor, and the value of a factor that does nothing is arbitrary. The
paper's "optimal P/L of 2.72" may be such a value. If not, it is an interpolation between two
levels with no centre point to check it.

The result is a compromise:

- 10-MDP for bond strength, at the cost of conversion;
- about 16 mol %, which trades bond strength against water retention.

Compare this with the paper's goal, minimising solubility:

```console
$ doe goal flowable.aikidoe.json Wsl --minimize --target -10 --upper 2
Wsl: minimize, lower -6, target -10, upper 2
$ doe optimise flowable.aikidoe.json --model "SBS ~ monomer*mol" --model "DC40 ~ monomer" --model "Wsl ~ mol" --fix "PL=2.5,filler=FL"
models: SBS ~ monomer*mol; DC40 ~ monomer; Wsl ~ mol
region: cube; held: PL=2.5, filler=FL

best settings: monomer=MDP, mol=25, PL=2.5, filler=FL
overall desirability D = 0.5021
response  predicted  95% CI           goal                d
--------  ---------  ---------------  -------------  ------
SBS           5.415  4.394 … 6.436    max (1 → 6)     0.883
DC40          66.05  61.72 … 70.38    max (60 → 85)  0.2419
Wsl           -5.11  -7.213 … -3.007  min (-10 ← 2)  0.5925
```

With the goal of minimising solubility, 25 mol % wins outright, with the highest overall
desirability, because the most water-retaining formulation now scores best. The goal decides
the answer here, so it has to say what is really wanted.

Neither optimum has been made. The 16 mol % setting lies between the two levels tested, so
before acting on it, make it and test it: see
[confirmation runs](designs-sequential.md#confirmation-runs) (`doe augment --confirm`).

## What a second experiment would change

- **Mix each formulation twice.** Two batches per formulation give a real error estimate and
  honest tests. If 32 batches are too many, a half fraction with replicated centre points is
  cheaper.
- **Add centre points** (15 mol %, P/L 2.85). They test whether a straight line between the two
  levels is good enough, which matters when the optimum lands between them.
- **Measure every viscosity the same way.** Use one geometry, at a stated shear rate, and check
  for slip.
- **Treat the resin as a mixture.** Adding acidic monomer here displaces PPGDMA, the
  cross-linker, so `monomer` and `mol` partly measure the loss of cross-linker. A
  [mixture design with process variables](designs-mixture.md#process-variables) separates the
  two.

## In the app

The [example](../../index.html#example=dental-flowable) opens on the Analyse step with the goals
above already set.

- **Effects:** for the half-normal plot with Lenth's limits, type the saturated model in the
  formula box, for example `SBS ~ monomer*mol*PL*filler`.
- **Best settings:** on the Optimise step, enter the reduced models in the goals table's model
  column (`SBS ~ monomer*mol`, `DC40 ~ monomer`, `Wsl ~ mol`). The best settings and the overlay
  then match the commands above.
