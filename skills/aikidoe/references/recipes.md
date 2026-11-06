# Recipes

Command sequences for the common paths. Every block here is run by the test suite in a fresh
directory (with the repository's `examples/` beside it) and its output compared, so the outputs are
real. `doe` is `node tools/doe.mjs`. Add `--json` to any command to parse its result instead.

## 1. From a problem to a run sheet

The user has five factors and a budget of 16 runs, wants to know which matter, and expects some
interactions.

```console
$ doe init etch.aikidoe.json --name "Etch rate" --factor power:200:400:W --factor press:20:80:mTorr --factor CF4:30:90:sccm --factor O2:0:10:sccm --factor gap:8:14:mm --response rate:nm/min --seed 101
created etch.aikidoe.json: 5 factors, 1 responses, seed 101
$ doe recommend etch.aikidoe.json --goal model --budget 16 --no-optimal
goal: model — estimate main effects and two-factor interactions; model 2fi (16 terms); power at Δ = 2σ, α = 0.05; budget 16 runs
#  design                runs  res.  D-eff %  min power
-  --------------------  ----  ----  -------  ---------
1  2^(5−1) fraction        16  V         100
2  Full factorial          32            100     0.9996
3  Central composite       32          59.27     0.9633
4  Box–Behnken             43          16.64     0.4876
–  2^(5−2) fraction         8  III
–  Plackett–Burman         12  III
–  Definitive screening    13

1. 2^(5−1) fraction (16 runs)
   + estimates main effects and all two-factor interactions (16 terms) in 16 runs
   + resolution V: main effects and 2fis clear of each other
   + fits the budget (16 of 16 runs)
   ! saturated: no residual degrees of freedom, so no test without pooling, Lenth or replication

2. Full factorial (32 runs)
   + estimates main effects and all two-factor interactions (16 terms) in 32 runs
   + power ≥ 0.8 for every term at Δ = 2σ (smallest 1)
   ! over budget: 32 runs, budget 16

3. Central composite (32 runs)
   + estimates main effects and all two-factor interactions (16 terms) in 32 runs
   + rotatable: equal precision at equal distance from the centre
   + power ≥ 0.8 for every term at Δ = 2σ (smallest 0.96)
   ! over budget: 32 runs, budget 16

not suitable for 2fi: 2^(5−2) fraction (cannot estimate 2fi: the runs support 8 of its 16 coefficients); Plackett–Burman (cannot estimate 2fi: the runs support 12 of its 16 coefficients); Definitive screening (cannot estimate 2fi: the runs support 11 of its 16 coefficients)
```

Explain the top options to the user (run counts, resolution, what is aliased, power), agree one,
then make it and hand over the sheet:

```console
$ doe design etch.aikidoe.json --runs 16
etch.aikidoe.json: fractional-factorial, 16 runs, randomisation complete, seed 101
resolution V; generators gap = power:press:CF4:O2  (see: alias etch.aikidoe.json)
$ doe sheet etch.aikidoe.json --csv sheet.csv
wrote sheet.csv
```

Parse results with `--json`, for example the power of each term for an effect of 2σ:

```console
$ doe power etch.aikidoe.json --model 2fi --json
{"schema":"aikidoe-cli/1","command":"power","ok":true,"model":"2fi","n":16,"rank":16,"dfRes":0,"alpha":0.05,"sigma":1,"delta":2,"target":0.8,"terms":[],"text":["power for 2fi: 16 runs, 16 coefficients, 0 residual df; α = 0.05, σ = 1, Δ = 2 (low → high)","no residual degrees of freedom: power is not defined (add runs, or a smaller model)"]}
```

## 2. Results in, effects out

The user returns the sheet with results; import it (the import checks run numbers and settings
before changing anything). Here, the textbook reactor data of `examples/reactor-bhh.aikidoe.json`,
which already has its results:

```console
$ doe fit examples/reactor-bhh.aikidoe.json "yield ~ (feed+cat+agit+temp+conc)^2" --lenth
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

The model is saturated, so judge the effects by Lenth's method, then fit the active ones and
report intervals:

```console
$ doe fit examples/reactor-bhh.aikidoe.json "yield ~ cat*temp + temp:conc + conc" --reduce p
model reduction (backward, p > 0.1; hierarchy kept), from yield ~ cat + temp + conc + cat:temp + temp:conc:
  nothing to remove
reduced model: yield ~ cat + temp + conc + cat:temp + temp:conc   (a suggestion: put a term back by editing the formula)

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

## 3. Predict, and confirm before acting

```console
$ doe predict examples/reactor-bhh.aikidoe.json "yield ~ cat*temp + temp:conc + conc" --at "feed=12.5,cat=2,agit=110,temp=180,conc=3"
settings                                      predicted  95% CI (mean)  95% PI (one run)
--------------------------------------------  ---------  -------------  ----------------
feed=12.5, cat=2, agit=110, temp=180, conc=3      94.88  91.26 … 98.49  87.95 … 101.8
$ doe augment examples/reactor-bhh.aikidoe.json --confirm "feed=12.5,cat=2,agit=110,temp=180,conc=3" --formula "yield ~ cat*temp + temp:conc + conc" --replicates 2
predicted yield at feed=12.5, cat=2, agit=110, temp=180, conc=3: 94.88 (95% prediction interval 87.95 … 101.8)
examples/reactor-bhh.aikidoe.json: 2 confirmation run(s) for yield; 2 runs added as block 2 (runs 17–18), 18 runs in all
```

Hand the two confirmation runs to the user; when their results are imported, `doe fit` reports
whether each landed in its prediction interval.

## 4. Wafers and sites: a mixed model

Several sites on each wafer and a hard-to-change furnace temperature: `doe fit` sees the structure
in the observations and fits a mixed model, testing each term in its stratum:

```console
$ doe fit examples/furnace-anneal.aikidoe.json "Rs ~ T + t + dose" --compare
Rs ~ T + t + dose
mixed model (REML): 432 readings from 24 runs; random effects: Whole plot (6), Run (24), Wafer (48); residual = within wafer (sites, repeats)

variance components
source      variance  std. dev.  95% CI (variance)  % of total
----------  --------  ---------  -----------------  ----------
Whole plot     5.611      2.369  1.836 … 70.62      63.4
Run            2.743      1.656  1.504 … 6.504      31
Wafer        0.07971     0.2823  0.03843 … 0.2532   0.901
Residual       0.413     0.6427  0.3603 … 0.4783    4.67

fixed effects (coded units; Kenward–Roger standard errors and df)
term         estimate  std. error  df       t        p
-----------  --------  ----------  --  ------  -------  ---
(Intercept)     61.08       1.026   4   59.55  <0.0001  ***
T              -2.729       1.026   4   -2.66   0.0564  .
t              -2.261      0.3419  16  -6.613  <0.0001  ***
dose           -6.017      0.3419  16   -17.6  <0.0001  ***

tests of model terms (Kenward–Roger)
term      F  ndf  ddf        p       tested in   p if independent
----  -----  ---  ---  -------  ---  ----------  ----------------
T     7.077    1    4   0.0564  .    whole plot           <0.0001
t     43.73    1   16  <0.0001  ***  run                  <0.0001
dose  309.8    1   16  <0.0001  ***  run                  <0.0001
strata (containment df): whole plot 4, run 16, wafer 24, residual 384
"p if independent": least squares on the same 432 readings as if every reading were independent — what an analysis that ignores the whole plots, runs and wafers would claim
REML criterion 989.52652
```

## 5. Clarifying a screening result

After a resolution III fraction, a fold-over separates the main effects from two-factor
interactions:

```console
$ doe init scr.aikidoe.json --factor A:0:1 --factor B:0:1 --factor C:0:1 --factor D:0:1 --factor E:0:1 --response y --seed 102
created scr.aikidoe.json: 5 factors, 1 responses, seed 102
$ doe design scr.aikidoe.json --runs 8
scr.aikidoe.json: fractional-factorial, 8 runs, randomisation complete, seed 102
resolution III; generators D = A:B, E = A:C  (see: alias scr.aikidoe.json)
$ doe augment scr.aikidoe.json --foldover
scr.aikidoe.json: full fold-over of 8 runs; 8 runs added as block 2 (runs 9–16), 16 runs in all
combined design: 3 alias chains among main effects and 2fis (see: alias scr.aikidoe.json)
```

## 6. Practising on a virtual process

To show a user how an experiment works — or to check your own strategy — use a generated exercise.
Its results are **simulated** (say so): a virtual process with a hidden truth, graded at the end.

```console
$ doe exercise new practice.aikidoe.json --topic factorial --difficulty medium --seed 9
Full factorial: effects and interactions — medium (factorial-medium-9)
A low-pressure CVD polysilicon deposition feeds several products. The tube is being requalified and the team wants a model of the deposition rate in terms of the recipe.
budget: 16 runs
  - Which factors affect deposition rate (alone or through an interaction)?
  - For each factor that matters, estimate its effect (low → high) on deposition rate, with a 95 % interval.
  - Which settings maximise deposition rate, within the ranges?
  - Stay within the run budget.

practice.aikidoe.json: design it (doe recommend / doe design), then "doe exercise run practice.aikidoe.json" for the results
$ doe design practice.aikidoe.json --full --replicates 2
practice.aikidoe.json: full-factorial, 16 runs, randomisation complete, seed 9
$ doe exercise run practice.aikidoe.json
practice.aikidoe.json: results for 16 runs (budget 16)
$ doe exercise grade practice.aikidoe.json
Full factorial: effects and interactions — medium (factorial-medium-9)
no answers given: graded on the standard analysis of your data (dep ~ 2fi, terms with p < 0.05)
question  points
--------  -----------  ----------------------------------------------------------------------
active    44.4 / 44.4  precision 100 %, recall 100 %
effects   27.8 / 27.8  every true effect has the right sign and is inside your interval
best      27.8 / 27.8  true value there 12.55, true optimum 12.55 (regret 0.0 % of the range)
budget    0            16 of 16 runs
score: 100 / 100

truth: active press, SiH4; effects press -0.5578, SiH4 -0.5425
model answer:
  - 2^3 full factorial, 2 replicates (16 runs); fit main effects and two-factor interactions
  → active press, SiH4; smallest power of the reference design 1
```
