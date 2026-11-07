# Dose–response

How does a response depend on the dose — the concentration of a compound, an inhibitor, an
antigen? On a log-dose axis the answer is usually an S-shaped curve: nothing happens at low doses,
then the response falls (or rises) over a decade or two, then levels off. The questions are where
the curve sits — the **EC50**, the dose giving half the full effect — how two compounds compare
(**relative potency**), and, for a standard curve, which dose a sample's reading corresponds to.
These curves are nonlinear in their parameters, so they are fitted by nonlinear least squares, not
by the polynomial models of the other pages; and the doses you choose matter more than in most
designs.

In the app: the Design step's **dose–response design** panel and the Analyse step's dose–response
fit; on the command line, `doe design --dose` and `doe dose`.

## Models

The curves are those of R's drc package (Ritz et al. 2015), with the same parameters, and the
fits agree with drc's. With u = (x / e)^b:

| model | curve | parameters |
|---|---|---|
| LL.4 | c + (d − c) / (1 + u) | slope b, asymptotes c and d, EC50 e |
| LL.3 | d / (1 + u) | the lower asymptote fixed at 0 |
| LL.5 | c + (d − c) / (1 + u)^f | an asymmetry f (f = 1 is LL.4) |
| W1.4 | c + (d − c) exp(−u) | Weibull, asymmetric (type 1) |
| W2.4 | c + (d − c) (1 − exp(−u)) | Weibull, asymmetric (type 2) |

b > 0 is a decreasing curve (d at zero dose, c at high doses), b < 0 an increasing one; |b| is the
Hill coefficient. LL.4 is the usual starting point; LL.5 or a Weibull when the curve is clearly
asymmetric and the data are good enough to tell. Doses of 0 are allowed (untreated wells give the
zero-dose asymptote).

## Choosing doses

The EC50 is fixed by doses **on the slope**; the asymptotes by doses on the flat ends. So:

- **Space doses on a log scale** — a dilution series (top dose, dilution factor, number of doses).
  Doses spaced evenly on a linear scale (0, 15, 30 … 100) put almost all the runs on the flat part
  of the curve when the EC50 is low, and the EC50 can hardly be estimated at all.
- **Cover the whole curve**: from where nothing happens to where the effect is complete, with
  untreated (zero-dose) wells, and several doses on the slope.
- **Work in stages** when the EC50 is unknown: a wide range-finding series first (zero and six
  doses a decade apart, once per compound), then eight or so doses over two to three decades
  around the EC50 it suggests, two or three replicates each — **Add these doses as a new stage**,
  or `doe design STUDY --dose --stage --at …`.
- **Optimal doses for a guess.** Given a guess of the slope, the asymptotes and the EC50,
  aikidoe finds D-optimal doses (the whole curve) or EC50-optimal ones (the precision of
  log EC50) on a log-spaced grid. Locally optimal designs bunch the doses at a few points that are
  only right if the guess is; the **robust** option optimises the average over EC50s ×/÷ a factor
  (and slopes ×/÷ 1.5) instead, and is usually the better choice.
- **Before running**: the panel shows, for the guess and a σ, the standard error of log EC50 the
  doses would give (the EC50 to within ×/÷ e^(1.96 se)) and, for two curves, the power to detect a
  given potency ratio (`doe dose STUDY --quality --guess … --sigma s --power 2`).

On plates, lay the dilution series out with the [balanced plate layout](plates.md#layouts) — it
protects every dose of every curve separately — so that no dose sits only on the edge or in one row.

## Fitting curves

The Analyse step (or `doe dose STUDY`) fits the model to the run means, by Levenberg–Marquardt from
self-starting values, and shows the curves on a log-dose axis with 95 % confidence bands, the
parameters with standard errors (from the Hessian of the residual sum of squares, as drc), and σ.
With several curves (a categorical factor such as the compound), every parameter is separate by
default; **parallel** fits curves that share slope and asymptotes and differ only in EC50.

**Weighting.** In many assays the scatter grows with the response. *variance ∝ mean^θ* fits with
weights 1/μ^θ, refitted until the weights settle: θ = 2 for a constant coefficient of variation,
θ = 1 for counts-like scatter, θ = 0 (default) for constant variance. Look at the residuals against
the fitted values to choose.

## Effective doses

EDp is the dose at which the response has moved p % of the way from the zero-dose asymptote d
towards c (drc's "relative" definition); ED50 is the EC50 of LL.4. Intervals:

- **symmetric on the log dose** (the default in the app): EDp × exp(± t·se(log EDp)) — doses are
  positive and their uncertainty is multiplicative;
- **delta method**: EDp ± t·se, as drc's default.

Both use the t distribution on the residual degrees of freedom.

## Relative potency

The relative potency of a test against a reference is ED50(reference) ÷ ED50(test): 2 means half
as much of the test gives the same effect. It is one number only when the curves are **parallel** —
the same shape shifted along the dose axis — so it is estimated from the parallel fit, with an
interval symmetric on the log scale.

Parallelism is checked two ways:

- the **F test** of separate curves against parallel ones (as drc's anova). A small p-value says the
  curves differ in shape; a large one does *not* show they are parallel — with few data it can
  hardly ever be small;
- the **slope ratio** test/reference from the separate fit, with a 90 % interval: if it lies within
  0.8 … 1.25 the slopes are equivalent (the two one-sided tests approach of USP ⟨1032⟩/⟨1034⟩).
  Outside it, the potency depends on the response level, and the curves should be compared at
  more than one EDp.

## Standard curves

With one curve of known doses (an ELISA standard curve, a calibration series), the dose of an
unknown sample is read off the curve from its response — **inverse prediction**. The interval
combines the curve's uncertainty with the noise of the sample's own readings (σ²/m for the mean of
m readings), on the log dose. Responses outside the range of the curve have no dose.

The **limit of detection** (LOD) is the dose where the curve has moved 3σ away from the zero-dose
response, the **limit of quantification** (LOQ) 10σ, σ the residual standard deviation. Below the
LOQ, doses read off the curve are too uncertain to report as numbers.

## On the command line

The dose exercise: a reference compound and a new analogue, 48 runs. A range-finding stage first:

```console
$ doe exercise new pot.aikidoe.json --topic dose --seed 1
Dose–response: EC50 and relative potency — medium (dose-medium-1)
A cell-based assay measures how strongly compounds inhibit proliferation. A new analogue has been made, and the chemists want to know how potent it is compared with the reference compound.
budget: 48 runs
  - What is the EC50 of the analogue (the dose giving half the full effect), with a 95 % interval?
  - How potent is the analogue relative to the reference (EC50 of the reference ÷ EC50 of the analogue), with a 95 % interval?
  - Stay within the run budget.

pot.aikidoe.json: design it (doe recommend / doe design), then "doe exercise run pot.aikidoe.json" for the results
$ doe design pot.aikidoe.json --dose conc --curve compound --top 100 --dilution 10 --doses 6 --zeros 1
pot.aikidoe.json: dose–response design, 14 runs: conc at 0, 0.001, 0.01, 0.1, 1, 10, 100, for each compound; randomisation complete, seed 1
$ doe exercise run pot.aikidoe.json
pot.aikidoe.json: results for 14 runs (budget 48)
$ doe dose pot.aikidoe.json --parallel
growth ~ LL.4 (four-parameter log-logistic) in conc, 2 curves (compound: reference, analogue); parallel: only e differs
14 results, 5 parameters, 9 residual df
parameter    estimate  std. error      t        p
-----------  --------  ----------  -----  -------
b               1.792      0.5272  3.399  0.00789
c               3.769       1.462  2.578   0.0298
d               104.5       1.597  65.44  <0.0001
e:reference    0.1042    0.007952   13.1  <0.0001
e:analogue    0.08141    0.008332  9.771  <0.0001
σ = 3.293   (b > 0: decreasing, b < 0: increasing; e = EC50 for LL.4 and LL.3)

effective doses (delta-method intervals, 95 %)
curve        ED     dose  std. error    lower   upper
---------  ----  -------  ----------  -------  ------
reference  ED50   0.1042    0.007952  0.08617  0.1222
analogue   ED50  0.08141    0.008332  0.06256  0.1003

relative potency of analogue against reference (ED50 reference ÷ ED50 analogue, parallel curves): 1.28 (95 % 0.9698 … 1.688)
parallelism: F = 0.6948 on 3 and 6 df, p = 0.588 (separate curves against parallel); slope ratio 0.515 (90 % 3.09e-6 … 86000) not within 0.8 … 1.25
```

The EC50s are near 0.1 µM, so a second stage of eight doses around them, twice each, then the fit:

```console
$ doe design pot.aikidoe.json --dose --stage --at 0.005,0.01,0.02,0.05,0.1,0.2,0.5,1 --replicates 2
pot.aikidoe.json: dose–response design, 46 runs in all (a new stage): conc at 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2 replicates, for each compound; randomisation complete, seed 1
$ doe exercise run pot.aikidoe.json
pot.aikidoe.json: results for 46 runs (budget 48)
$ doe dose pot.aikidoe.json --parallel --interval log
growth ~ LL.4 (four-parameter log-logistic) in conc, 2 curves (compound: reference, analogue); parallel: only e differs
46 results, 5 parameters, 41 residual df
parameter    estimate  std. error      t        p
-----------  --------  ----------  -----  -------
b                1.42      0.1006  14.12  <0.0001
c                 2.8       1.474    1.9   0.0645
d               102.7       1.381  74.39  <0.0001
e:reference    0.1184    0.006702  17.66  <0.0001
e:analogue    0.07188    0.004173  17.23  <0.0001
σ = 4.011   (b > 0: decreasing, b < 0: increasing; e = EC50 for LL.4 and LL.3)

effective doses (intervals symmetric on the log dose, 95 %)
curve        ED     dose  std. error    lower    upper
---------  ----  -------  ----------  -------  -------
reference  ED50   0.1184    0.006702   0.1056   0.1327
analogue   ED50  0.07188    0.004173  0.06393  0.08083

relative potency of analogue against reference (ED50 reference ÷ ED50 analogue, parallel curves): 1.647 (95 % 1.442 … 1.88)
parallelism: F = 0.6008 on 3 and 38 df, p = 0.618 (separate curves against parallel); slope ratio 0.935 (90 % 0.73 … 1.2) not within 0.8 … 1.25
```

The [dose lesson](../../index.html#lesson=dose&difficulty=medium&seed=1) runs the same exercise in
the app, and compares it with doses spaced evenly from 0 to 100.
