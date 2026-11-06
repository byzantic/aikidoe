# Worked example: coupler yield with comb-over

A 10 dB coupled-line coupler on Rogers RO4350B (0.508 mm), designed in
[comb-over](https://github.com/byzantic/comb-over) for 5 GHz. On paper it couples 10.07 dB with
13.2 dB directivity. In production the copper is over- or under-etched and the laminate's εr
varies: what fraction of boards will couple 10 ± 0.5 dB with at least 12 dB directivity?

The netlist is comb-over's example `coupler-10dB-ro4350b.cir`, in `examples/`; the finished study
is `examples/coupler-10dB-ro4350b.aikidoe.json` ([open it in the app](../../index.html#example=coupler)).

## Assumptions

- **Etch bias** e, per edge (µm; positive = over-etched): every strip width W becomes W − 2e and
  every gap S becomes S + 2e. Standard deviation 8 µm — an assumed value, not a fabricator's
  figure; use yours.
- **εr**: nominal 3.66 (Rogers' design Dk), standard deviation 0.025 (Rogers quotes ±0.05).
- Specs: coupling 9.5 … 10.5 dB and directivity ≥ 12 dB, both at 5 GHz.

## The study

Factors from the netlist — the etch bias and the substrate's εr, each with its tolerance — and
the metrics as comb-over trace expressions:

```console
$ doe comb-over cpl.aikidoe.json examples/coupler-10dB-ro4350b.cir --seed 21 --factor etch=8 --factor er=0.025 --metric "coupling=-db(S31) @ 5G" --metric "directivity=db(S31/S41) @ 5G" --spec "coupling=9.5:10.5" --spec "directivity=12:"
created cpl.aikidoe.json: comb-over simulator on examples/coupler-10dB-ro4350b.cir
factor  netlist               range                      tolerance
------  --------------------  -----------  ------------  ---------
etch    etch bias (per edge)  -32 … 32 µm  nominal 0     sd 8
er      substrate er          3.56 … 3.76  nominal 3.66  sd 0.025
metrics: coupling = -db(S31) @ 5G (spec 9.5 … 10.5); directivity = db(S31/S41) @ 5G (spec 12 … ∞)
```

Each factor's range is ±4 standard deviations about nominal, so the surrogate covers the
tolerance region. A 30-run Latin hypercube, run on comb-over (a few milliseconds a run):

```console
$ doe design cpl.aikidoe.json --lhs --runs 30
cpl.aikidoe.json: lhs, 30 runs, randomisation complete, seed 21
maximin Latin hypercube: smallest distance between runs 0.3333 (coded units); default model: quadratic
$ doe simulate cpl.aikidoe.json
cpl.aikidoe.json: ran 30 runs on comb-over in 0.06 s
```

## Yield

```console
$ doe yield cpl.aikidoe.json --check 1000
surrogate    model                    runs      R²  pred R²     RMSE  RMSE_cv (LOO)
-----------  -----------------------  ----  ------  -------  -------  -------------
coupling     coupling ~ quadratic       30  0.9996   0.9992  0.02209        0.02764
directivity  directivity ~ quadratic    30  0.9929   0.9858  0.08164         0.1031

nominal: etch=0, er=3.66
tolerances: etch sd 8, er sd 0.025
response     spec        at nominal  margin  RMSE_cv  % below  % above
-----------  ----------  ----------  ------  -------  -------  -------
coupling     9.5 … 10.5       10.08  0.4241  0.02764    9.875    14.46
directivity  12 … ∞           13.25   1.248   0.1031     0.29        0

yield 75.66 %  (95% CI 75.06 … 76.25 %, 20000 samples of the surrogate)
with every limit moved by ±2·RMSE_cv: 70.06 … 80.53 %
note: the surrogate's error, not the sampling, limits this estimate (it could lie anywhere in 70.1 … 80.5 %); --check M compares with the simulator

direct check on comb-over: yield 78.3 % (95% CI 75.64 … 80.74 %, 1000 runs)
surrogate vs simulator at those points: RMS error coupling 0.01303, directivity 0.046; same pass/fail for 98.8 %
the two yield intervals overlap
```

About three boards in four meet both specs, almost all failures on coupling. The quadratic
surrogates are good (RMSE_cv 0.03 dB on coupling) but not good enough to pin the yield down to the
sampling precision: the trust check reports that the surrogate limits the estimate, and the
direct check on 1000 comb-over runs agrees within the intervals.

Coupling bends with etch more than a quadratic allows. A cubic etch term:

```console
$ doe yield cpl.aikidoe.json --model "coupling ~ quadratic + I(etch^3)" --model "directivity ~ quadratic + I(etch^3)"
surrogate    model                                runs      R²  pred R²     RMSE  RMSE_cv (LOO)
-----------  -----------------------------------  ----  ------  -------  -------  -------------
coupling     coupling ~ quadratic + I(etch^3)       30       1   0.9999  0.00605       0.008445
directivity  directivity ~ quadratic + I(etch^3)    30  0.9992   0.9979  0.02821         0.0397

nominal: etch=0, er=3.66
tolerances: etch sd 8, er sd 0.025
response     spec        at nominal  margin   RMSE_cv  % below  % above
-----------  ----------  ----------  ------  --------  -------  -------
coupling     9.5 … 10.5       10.08  0.4209  0.008445     9.05    13.48
directivity  12 … ∞           13.26    1.26    0.0397      0.3        0

yield 77.47 %  (95% CI 76.89 … 78.04 %, 20000 samples of the surrogate)
with every limit moved by ±2·RMSE_cv: 75.78 … 78.94 %
note: the surrogate's error, not the sampling, limits this estimate (it could lie anywhere in 75.8 … 78.9 %); --check M compares with the simulator
```

The cross-validated error falls about threefold and the bounds tighten.

## What drives it

```console
$ doe sensitivity cpl.aikidoe.json --over tolerance
surrogate    model                    runs      R²  pred R²     RMSE  RMSE_cv (LOO)
-----------  -----------------------  ----  ------  -------  -------  -------------
coupling     coupling ~ quadratic       30  0.9996   0.9992  0.02209        0.02764
directivity  directivity ~ quadratic    30  0.9929   0.9858  0.08164         0.1031

coupling: Sobol indices over the tolerances about nominal; variance 0.1771, 65536 surrogate evaluations
factor  first-order S  95% CI                total ST  95% CI
------  -------------  -------------------  ---------  -------------------
etch            1.021  0.958 … 1.08             1.021  0.958 … 1.08
er            0.00041  0.000139 … 0.000681  0.0003873  0.000384 … 0.000391

directivity: Sobol indices over the tolerances about nominal; variance 0.144, 65536 surrogate evaluations
factor  first-order S  95% CI           total ST  95% CI
------  -------------  ---------------  --------  ---------------
etch            1.008  0.957 … 1.06        1.009  0.958 … 1.06
er              0.017  0.0153 … 0.0187   0.01773  0.0175 … 0.0179
```

The etch bias accounts for essentially all the variation in coupling and directivity (indices of
1 within their sampling error); εr's tolerance hardly matters. The yield is a fabrication question: tighter etch control, or a design
whose coupling is less sensitive to the gap.

## A sharper requirement

Directivity above 15 dB, say? This design has 13.2 dB at 5 GHz nominally, so the yield at that
limit would be zero — a design change, not a tolerance problem.
