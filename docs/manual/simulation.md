# Simulation and yield

A circuit, an electromagnetic structure or a process model can be explored like a process: a
designed set of runs, a model fitted to them, and then the questions a model can answer cheaply —
which parameters matter, and what fraction of manufactured parts will meet the specification when
every parameter varies within its tolerance.

## Simulators

A study's **simulator** runs the design instead of a lab: on the Run step, **Run on the
simulator**; on the command line, `doe simulate`. Available:

- **formulas** (`expression`): each response as a formula in the factor ids — for analytic models,
  test functions and exercises (`doe simulator STUDY --expression "y=…"`). The formulas use
  + − * / ^, parentheses, `sin cos tan exp log log10 sqrt abs min max pow tanh` and `pi`.
- **comb-over**: the coupled-line and microstrip circuit simulator
  [comb-over](https://github.com/byzantic/comb-over), with the netlist kept in the study. Factors
  are its tunable parameters, substrate properties (εr, height, copper thickness) or the etch bias;
  responses are expressions over the S-parameters at a frequency or over a band. See
  [the coupler example](example-coupler.md).
- a **Node module** (command line only): `doe simulator STUDY --module sim.mjs`, where the module
  exports `run(settingsList)` (batched, possibly async) or `simulate(settings)`.

## Surrogates

A **surrogate** is a model fitted to the simulator's runs — by default the full quadratic — that
predicts instantly anywhere in the region. How far to trust it is measured by **cross-validation**:
RMSE_cv, the root-mean-square error of predicting each run from a model fitted without it
(leave-one-out, from PRESS). Compare RMSE_cv with the differences that matter (the margins to
the specification limits). If it is too large: narrow the ranges, add runs, or add terms (a cubic
term where the response bends).

Use a [space-filling design](designs-space-filling.md) for a simulator.

## Sensitivity

**Sobol indices** split the variance of a response between the factors: the first-order index S
is the share due to a factor alone, the total index ST its share including interactions with the
others (Sobol 2001; estimators of Saltelli et al. 2010 and Jansen 1999). They are computed on the
surrogate with quasi-random sampling, with 95 % intervals.

- over the **ranges** (each factor uniform over its range): which factors matter anywhere in the
  design space;
- over the **tolerances** (each factor varying by its tolerance about the current settings): which
  tolerances drive the variation in production — where tighter control pays.

## Yield

Each factor's actual value scatters about its setting by its **tolerance**: a standard deviation,
with a distribution — normal, uniform (a flat ±√3 sd, as for a part sorted into a bin), or a
normal truncated at ±2 sd (parts screened to a limit). Each response may have **specification
limits** (lower, upper, or both). A unit passes when every response is within its limits.

The **yield** is estimated by Monte Carlo on the surrogates (20 000 samples by default), with a
95 % confidence interval (Wilson). The surrogate's own error is stated too: the yield is
recomputed with every limit moved in and out by 2 × RMSE_cv, and the result is graded:

- **good** — the surrogate's error moves the yield less than the sampling does;
- **fair** — the surrogate, not the sampling, limits the precision; the bounds say by how much;
- **poor** — the estimate says more about the surrogate than about the process: not trustworthy.

A **check on the simulator** draws fresh samples, runs them on the simulator itself and compares
the yields and the predictions point by point. It is the final word on a surrogate's yield.

```console
$ doe init rc.aikidoe.json --factor R:9:11:kΩ --factor C:9:11:nF --response f:kHz --seed 9
created rc.aikidoe.json: 2 factors, 1 responses, seed 9
$ doe design rc.aikidoe.json --lhs
rc.aikidoe.json: lhs, 20 runs, randomisation complete, seed 9
maximin Latin hypercube: smallest distance between runs 0.4123 (coded units); default model: quadratic
$ doe simulator rc.aikidoe.json --expression "f=1000/(2*pi*R*C)"
rc.aikidoe.json: simulator expression
$ doe simulate rc.aikidoe.json
rc.aikidoe.json: ran 20 runs on expression in 0.00 s
$ doe tolerance rc.aikidoe.json "R=0.05" "C=truncated:0.25:2"
R: sd 0.05 kΩ
C: truncated sd 0.25 cut at ±2 sd (actual sd 0.2199) nF
$ doe spec rc.aikidoe.json f --lower 1.5 --upper 1.68
f: spec 1.5 … 1.68
$ doe yield rc.aikidoe.json --check 500
surrogate  model          runs  R²  pred R²       RMSE  RMSE_cv (LOO)
---------  -------------  ----  --  -------  ---------  -------------
f          f ~ quadratic    20   1        1  0.0004403      0.0005508

nominal: R=10, C=10
tolerances: R sd 0.05, C truncated sd 0.25 cut at ±2 sd (actual sd 0.2199)
response  spec        at nominal   margin    RMSE_cv  % below  % above
--------  ----------  ----------  -------  ---------  -------  -------
f         1.5 … 1.68       1.591  0.08852  0.0005508    0.005      0.3

yield 99.69 %  (95% CI 99.61 … 99.76 %, 20000 samples of the surrogate)
with every limit moved by ±2·RMSE_cv: 99.62 … 99.74 %

direct check on expression: yield 99.8 % (95% CI 98.88 … 99.96 %, 500 runs)
surrogate vs simulator at those points: RMS error f 0.0002804; same pass/fail for 100 %
the two yield intervals overlap
```

The capacitor's 2.5 % tolerance dominates the resistor's 0.5 %:

```console
$ doe sensitivity rc.aikidoe.json --over tolerance
surrogate  model          runs  R²  pred R²       RMSE  RMSE_cv (LOO)
---------  -------------  ----  --  -------  ---------  -------------
f          f ~ quadratic    20   1        1  0.0004403      0.0005508

f: Sobol indices over the tolerances about nominal; variance 0.001312, 65536 surrogate evaluations
factor  first-order S  95% CI           total ST  95% CI
------  -------------  ---------------  --------  ---------------
R             0.05038  0.0482 … 0.0526    0.0495  0.0473 … 0.0518
C               0.955  0.952 … 0.958      0.9536  0.951 … 0.956
```
