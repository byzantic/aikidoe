# Sequential experiments: augmenting and confirming

Experiments are usually done in stages, each chosen in the light of the last: screen, clarify,
model, confirm. aikidoe keeps every stage in the same study, as a new **block** of runs, so the
final analysis uses all of them and the block term absorbs any shift between stages. The study's
history records each stage.

In the app, the **Next stage** panel (on the Design step, once there is a design) offers the
augmentations that fit the design; on the command line, `doe augment`.

Before adding runs, check what the existing ones already hold: when screening leaves only a few
active factors, a resolution IV fraction or a Plackett–Burman design (projectivity 3) contains a
full factorial in any 3 of them, and a definitive screening design can fit the quadratic in any 3
— the Analyse step offers that fit ([projectivity](designs-screening.md#projectivity)). New runs
are needed when more factors are active, or to separate effects the projection still aliases.

## Fold-over

A fold-over repeats the two-level runs with signs reversed:

- **full fold-over** (every factor reversed): turns a resolution III fraction into resolution IV —
  main effects become clear of two-factor interactions;
- **single-factor fold-over** (one factor reversed): that factor's main effect *and* all its
  two-factor interactions become clear — use it when one factor is clearly important and you need
  its interactions.

```console
$ doe init seq.aikidoe.json --factor A:0:1 --factor B:0:1 --factor C:0:1 --factor D:0:1 --factor E:0:1 --response y --seed 6
created seq.aikidoe.json: 5 factors, 1 responses, seed 6
$ doe design seq.aikidoe.json --runs 8
seq.aikidoe.json: fractional-factorial, 8 runs, randomisation complete, seed 6
resolution III; generators D = A:B, E = A:C  (see: alias seq.aikidoe.json)
$ doe augment seq.aikidoe.json --foldover
seq.aikidoe.json: full fold-over of 8 runs; 8 runs added as block 2 (runs 9–16), 16 runs in all
combined design: 3 alias chains among main effects and 2fis (see: alias seq.aikidoe.json)
$ doe alias seq.aikidoe.json
sequential design: fractional-factorial → foldover; 16 two-level runs
alias chains:
  B:C = D:E
  B:D = C:E
  B:E = C:D
```

## Axial points

Axial (star) points at ±α on each axis, plus centre points, turn a two-level design into a
central composite design for a quadratic model ([response surfaces](designs-rsm.md)). By default α
is chosen for orthogonal blocking with the existing runs as the cube block, so the shift between
stages does not bias the quadratic coefficients. Add them when the first stage shows curvature
(centre points far from the factorial average) or when the goal becomes optimisation.

```console
$ doe augment seq.aikidoe.json --axial --centre 2
seq.aikidoe.json: axial points at α = 2.4495 and 2 centre points; 12 runs added as block 3 (runs 17–28), 28 runs in all
```

## Moving to a better region: steepest ascent

Sometimes the first experiment shows that the best settings lie *outside* the ranges studied. The
response rises steadily towards one corner, and the centre points sit on the plane (no curvature).
Adding axial points there would model a region you do not want to be in. Move first. The **path
of steepest ascent** (Box & Wilson 1951) leaves the centre of the design in the direction in which
the fitted first-order model rises fastest. Each factor moves in proportion to its effect, in coded
units.

The example *Reaction yield* (`examples/reaction-ascent.aikidoe.json`) is a 2² in time (30–40 min)
and temperature (150–160 °C) with five centre points. Both effects are large, and the centre points
show no curvature:

```console
$ doe path examples/reaction-ascent.aikidoe.json --steps 6
yield: yield ~ main; path of steepest ascent
direction (coded): time 0.452, temp 0.892
each step: time +2.534 min, temp +5 °C
95 % confidence cone about the direction: half-angle 8.06°, 4.48 % of all directions

step  distance  time (min)  temp (°C)  yield predicted  95% CI
----  --------  ----------  ---------  ---------------  ---------------  ----------------
   0  0         35          155        54.6             54.016 … 55.184
   1  1.121     37.534      160        61.607           60.464 … 62.749
   2  2.242     40.067      165        68.613           66.564 … 70.662  outside the runs
   3  3.363     42.601      170        75.62            72.617 … 78.622  outside the runs
   4  4.484     45.135      175        82.626           78.655 … 86.597  outside the runs
   5  5.605     47.668      180        89.633           84.688 … 94.577  outside the runs
   6  6.726     50.202      185        96.639           90.719 … 102.56  outside the runs

the predictions beyond the runs are extrapolation: run points along the path (one at a time, or a few), and stop when the response no longer rises; centre the next design there
```

Each step moves the factor with the largest effect (temperature) one coded unit, 5 °C. The others
move in proportion: time 2.5 min a step. `--step-size "time=5"` sets the step in one factor's
units instead. Categorical factors are held at their best level. Continuous factors not in the
model stay at the centre.

**Is the direction known?** The coefficients are estimates, so the direction is too. The 95 %
**confidence cone** around it (Box & Draper) holds every direction the data cannot rule out. Here
its half-angle is 8°, and it holds about 4.5 % of all directions: well determined. When the
effects are small against the noise, the cone takes in every direction, and `doe path` says the
direction is not determined. Replicate, or widen the ranges, before walking anywhere.

**Limits and constraints.** The path soon leaves the region studied. Give each factor its
**operating limits**, the settings the process can run at at all, as `limits: { lower, upper }`
in the study file. A factor that reaches its limit is held there while
the others go on: here the temperature stops at 190 °C, the solvent's boiling point. A constraint
ends the path.

```console
$ doe path examples/reaction-ascent.aikidoe.json --steps 9
yield: yield ~ main; path of steepest ascent
direction (coded): time 0.452, temp 0.892
each step: time +2.534 min, temp +5 °C
95 % confidence cone about the direction: half-angle 8.06°, 4.48 % of all directions

step  distance  time (min)  temp (°C)  yield predicted  95% CI
----  --------  ----------  ---------  ---------------  ---------------  -------------------------------
   0  0         35          155        54.6             54.016 … 55.184
   1  1.121     37.534      160        61.607           60.464 … 62.749
   2  2.242     40.067      165        68.613           66.564 … 70.662  outside the runs
   3  3.363     42.601      170        75.62            72.617 … 78.622  outside the runs
   4  4.484     45.135      175        82.626           78.655 … 86.597  outside the runs
   5  5.605     47.668      180        89.633           84.688 … 94.577  outside the runs
   6  6.726     50.202      185        96.639           90.719 … 102.56  outside the runs
   7  7.847     52.735      190        103.65           96.748 … 110.54  outside the runs
   8  8.089     55.269      190        105.08           97.968 … 112.19  outside the runs; temp at limit
   9  8.355     57.803      190        106.51           99.168 … 113.85  outside the runs; temp at limit

the predictions beyond the runs are extrapolation: run points along the path (one at a time, or a few), and stop when the response no longer rises; centre the next design there
```

**Predictions along the path are extrapolation.** They are the fitted plane, extended: here a
yield above 100 % by step 7. Real responses curve, so the path is something to *run*, not to
believe. Run the points one or two at a
time, and stop when the response no longer improves. Then centre the next design (a factorial,
with centre points to check for curvature) on the best point found.

**With curvature.** When the model has squares or interactions, `doe path` uses **ridge
analysis**. For each distance from the centre, it finds the best point at that distance on the
fitted surface. Away from the centre the path bends towards the optimum. `--canonical` gives the
path along a canonical axis through the stationary point instead: with a saddle or a ridge, this is
the direction in which the response changes most (largest eigenvalue) or least.

These paths are checked against R's `rsm` package (`steepest` for the first-order path and for
ridge analysis, `canonical.path`). The confidence cone is checked against the formula of Box and
Draper.

## Optimal augmentation

`doe augment --optimal --runs n --model …` adds n runs chosen D-, I- or A-optimally *together
with* the existing ones, for any bigger model — interactions a fraction could not separate,
quadratic terms of the few active factors, a factor added later. See
[optimal designs](designs-optimal.md#augmentation).

## Confirmation runs

A model's prediction is a claim; confirmation runs test it. Choose settings (usually the best
ones), and aikidoe adds runs there — replicated if you like — and stores, with the stage, the
model's prediction and its 95 % prediction interval for those runs. When the results are in, the
analysis reports each confirmation against the interval it should land in: *confirmed*, or
*outside* — a sign that the model is missing something.

Confirmation runs are left out of the model fit (they test it), and for a mixed model the
interval includes the whole-plot, run and wafer variation of the new runs.

```console
$ doe augment seq.aikidoe.json --confirm "A=1,B=0.5,C=0.5,D=0.5,E=0.5" --formula "y ~ main" --replicates 2
error: no results for y yet
```

(Confirmation needs a fitted model, so it comes after the results.)
