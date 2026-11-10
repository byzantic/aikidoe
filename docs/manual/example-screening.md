# Worked example: a 2⁵⁻¹ screening experiment

A chemical reactor's percent reacted depends — perhaps — on five factors. Sixteen runs of a
resolution V half fraction find which ones matter and how. The data are real: the reactor
experiment of Box, Hunter and Hunter, *Statistics for Experimenters* (1978, p. 379; see the
[bibliography](bibliography.md)). The same study is in the app:
[open it](../../index.html#example=reactor-bhh).

This page uses the command line (`doe`); every command below is run by the test suite and its
output compared with what is shown here.

## Define the study

Five continuous factors, each with a low and a high setting, and one response:

```console
$ doe init reactor.aikidoe.json --name "Reactor screening" --factor feed:10:15:L/min --factor cat:1:2:% --factor agit:100:120:rpm --factor temp:140:180:°C --factor conc:3:6:% --response yield:% --seed 51
created reactor.aikidoe.json: 5 factors, 1 responses, seed 51
```

## Choose a design

Ask for the options for screening within a budget of 16 runs:

```console
$ doe recommend reactor.aikidoe.json --goal screen --budget 16 --no-optimal
goal: screen — find the active factors (main effects); model main (6 terms); power at Δ = 2σ, α = 0.05; budget 16 runs
#  design                runs  res.  P  D-eff %  min power
-  --------------------  ----  ----  -  -------  ---------
1  Plackett–Burman 12      12  3.67  3      100     0.8213
2  2^(5−1) fraction        16  V     4      100     0.9488
3  Definitive screening    13             80.36     0.7738
4  2^(5−2) fraction         8  III   2      100     0.3568
5  Full factorial          32               100     0.9997
6  Central composite       32             78.68      0.997
7  Box–Behnken             43             43.87     0.9735
res.: resolution (Plackett–Burman: generalised resolution, between III and IV); P: projectivity — any P factors form a full two-level factorial

1. Plackett–Burman 12 (12 runs)
   + estimates every main effect (6 terms) in 12 runs
   + 2fis partially aliased with main effects (spread out, not confounded; generalised resolution 3.67)
   + projectivity 3: any 3 factors form a full 2³ (and any 4 support main effects and their 2fis) — if only that many matter, their interactions come from these runs
   + power ≥ 0.8 for every term at Δ = 2σ (smallest 0.82)
   + fits the budget (12 of 16 runs)

2. 2^(5−1) fraction (16 runs)
   + estimates every main effect (6 terms) in 16 runs
   + resolution V: main effects and 2fis clear of each other
   + projectivity 4: any 4 factors form a full 2⁴ — if only that many matter, their interactions come from these runs
   + power ≥ 0.8 for every term at Δ = 2σ (smallest 0.95)
   + fits the budget (16 of 16 runs)

3. Definitive screening (13 runs)
   + estimates every main effect (6 terms) in 13 runs
   + main effects clear of 2fis and quadratic terms
   + the full quadratic in any 3 factors can be fitted from these runs
   + fits the budget (13 of 16 runs)
   ! power < 0.8 for some terms at Δ = 2σ (smallest 0.77)
```

The 12-run Plackett–Burman design is the cheapest that estimates every main effect with
adequate power; the 16-run half fraction costs four more runs and buys resolution V: main
effects *and* two-factor interactions are all clear of each other. (The Plackett–Burman's
projectivity 3 would still give the interactions of any three factors that turned out to matter
from the same 12 runs, and of any four with a single residual degree of freedom — but not of all
five.) With five factors in a reactor, interactions are
likely, so take the half fraction:

```console
$ doe design reactor.aikidoe.json --generators "E=ABCD"
reactor.aikidoe.json: fractional-factorial, 16 runs, randomisation complete, seed 51
resolution V; generators conc = feed:cat:agit:temp  (see: alias reactor.aikidoe.json)
```

The generator `E = ABCD` (here `conc = feed:cat:agit:temp`) defines the fraction; the defining
relation is `I = ABCDE`, so every main effect is aliased only with a four-factor interaction and
every two-factor interaction with a three-factor one:

```console
$ doe alias reactor.aikidoe.json
2^(5−1) design, 5 factors in 16 runs, resolution V
factors: A = feed, B = cat, C = agit, D = temp, E = conc
generators: conc = feed:cat:agit:temp
defining relation: I = feed:cat:agit:temp:conc
word-length pattern (A3, A4, …): 0, 0, 1
projectivity 4: any 4 factors form a full 2^4 (resolution V → R − 1)

no aliasing among effects up to order 2
```

`doe sheet reactor.aikidoe.json --csv sheet.csv` writes the run sheet in its randomised order
(`--html` for a printable one). Run the experiment in that order.

## Enter the results

The results, by run number (the design's standard order; the sheet gives each run's place in
the randomised order):

```file results.csv
run,yield
1,56
2,53
3,63
4,65
5,53
6,55
7,67
8,61
9,69
10,45
11,78
12,93
13,49
14,60
15,95
16,82
```

```console
$ doe import reactor.aikidoe.json results.csv
16 value(s) read (wide format)
reactor.aikidoe.json: 16 observation(s)
```

## Which effects are active?

Fit every main effect and two-factor interaction. That is 16 coefficients from 16 runs, so
there is no residual error to test against; Lenth's method judges the effects against each other
instead:

```console
$ doe fit reactor.aikidoe.json "yield ~ (feed+cat+agit+temp+conc)^2" --lenth
yield ~ feed + cat + agit + temp + conc + feed:cat + feed:agit + feed:temp + feed:conc + cat:agit + cat:temp + cat:conc + agit:temp + agit:conc + temp:conc
16 runs, 16 estimable coefficients, 0 residual df

term         estimate
-----------  --------
(Intercept)     65.25
feed               -1
cat             10.25
agit                0
temp            6.125
conc           -3.125
feed:cat         0.75
feed:agit        0.25
feed:temp      -0.375
feed:conc       0.625
cat:agit         0.75
cat:temp        5.375
cat:conc        0.625
agit:temp       0.125
agit:conc       1.125
temp:conc       -4.75
coded units: each continuous factor runs from −1 (low) to +1 (high)

no residual degrees of freedom: use --lenth to judge the effects

Lenth: PSE = 1.875, ME = 4.82, SME = 9.785 (15 effects, d = 5)
effect     estimate  t (PSE)
---------  --------  -------  -----
cat            20.5    10.93  > SME
temp          12.25    6.533  > SME
cat:temp      10.75    5.733  > SME
temp:conc      -9.5   -5.067  > ME
conc          -6.25   -3.333  > ME
agit:conc      2.25      1.2
feed             -2   -1.067
feed:cat        1.5      0.8
cat:agit        1.5      0.8
feed:conc      1.25   0.6667
cat:conc       1.25   0.6667
feed:temp     -0.75     -0.4
feed:agit       0.5   0.2667
agit:temp      0.25   0.1333
agit              0        0
effect = 2 × coefficient (change from low to high)
```

Five effects stand out. Catalyst, temperature and their interaction exceed the simultaneous
margin of error (SME, which controls the chance of *any* false alarm among the 15); concentration
and the temperature × concentration interaction exceed the individual margin (ME). These are the
five effects Box, Hunter and Hunter find (20.5, 12.25, 10.75, −9.5, −6.25). The next largest,
2.25, is in the noise; feed rate and agitation do nothing detectable.

## The reduced model

Fit the five active effects (hierarchy is kept: both interactions' main effects are in):

```console
$ doe fit reactor.aikidoe.json "yield ~ cat + temp + conc + cat:temp + temp:conc"
yield ~ cat + temp + conc + cat:temp + temp:conc
16 runs, 6 estimable coefficients, 10 residual df

term         estimate  std. error       t         p
-----------  --------  ----------  ------  --------  ---
(Intercept)     65.25      0.6626   98.47   <0.0001  ***
cat             10.25      0.6626   15.47   <0.0001  ***
temp            6.125      0.6626   9.244   <0.0001  ***
conc           -3.125      0.6626  -4.716  0.000821  ***
cat:temp        5.375      0.6626   8.112   <0.0001  ***
temp:conc       -4.75      0.6626  -7.169   <0.0001  ***
coded units: each continuous factor runs from −1 (low) to +1 (high)

σ = 2.65   R² = 0.9789   adjusted R² = 0.9684   predicted R² = 0.946
F = 92.83 on 5 and 10 df, p <0.0001

ANOVA (type I, sequential)
source     df  sum of sq.  mean sq.      F         p
---------  --  ----------  --------  -----  --------
cat         1        1681      1681  239.3   <0.0001
temp        1       600.2     600.2  85.44   <0.0001
conc        1       156.2     156.2  22.24  0.000821
cat:temp    1       462.3     462.3   65.8   <0.0001
temp:conc   1         361       361  51.39   <0.0001
Residuals  10       70.25     7.025
```

The model explains almost all of the variation (R² = 0.979, predicted R² = 0.946) with
σ = 2.65 %; the ten residual degrees of freedom are the dropped effects. Every coefficient is
half an effect (coded units: each factor runs from −1 to +1). Interpreting it: raising the
catalyst from 1 to 2 % adds about 20 points, and more at the high temperature (`cat:temp`);
raising the temperature helps, but less at the high concentration (`temp:conc`). Best: high
catalyst, high temperature, low concentration.

## Predict, and confirm

Predict the best corner with its 95% confidence and prediction intervals:

```console
$ doe predict reactor.aikidoe.json "yield ~ cat + temp + conc + cat:temp + temp:conc" --at "feed=12.5,cat=2,agit=110,temp=180,conc=3"
settings                                      predicted  95% CI (mean)  95% PI (one run)
--------------------------------------------  ---------  -------------  ----------------
feed=12.5, cat=2, agit=110, temp=180, conc=3      94.88  91.26 … 98.49  87.95 … 101.8
```

Before acting on it, run it: [confirmation runs](designs-sequential.md#confirmation-runs)
(`doe augment --confirm`) add runs at those settings and store the prediction interval they
should land in. Feed rate and agitation can be set for cost or convenience — the experiment
shows they do not matter over these ranges.

## In the app

The same steps in the browser: open the [example](../../index.html#example=reactor-bhh), look at
the Analyse step's effects plot (half-normal, with Lenth's limits) and the profiler on the
Optimise step. See [getting started](getting-started.md).
