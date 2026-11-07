# aikidoe — project specification

Status: draft v0.1, 2026-11-05. Work is planned as GitHub issues; this document is the reference they point back to. Section numbers (§) are stable and cited from issues.

## 1. Purpose

aikidoe is a Design of Experiments (DOE) assistant that runs in the browser, with no install and no server. It covers two kinds of work with one statistics core:

- **Simulation and yield.** Choose experiments over a simulator's parameters (first client: comb-over's `tune` parameters), fit surrogate models, and estimate sensitivity and yield under manufacturing tolerances.
- **Physical process development.** Plan, randomise and analyse experiments on real equipment (furnaces, implanters, etch, deposition), where runs are expensive, some factors are hard to change, and measurements are nested (lot / wafer / site).

The aim is to make correct statistical practice the easy path: alias structure shown before a fractional design is run, restricted randomisation analysed as such, measurement-system capability checked before small effects are believed.

## 2. Users and use cases

| ID | Use case | Notes |
|---|---|---|
| U1 | Screen many factors in few runs | Fractional factorial, Plackett–Burman, definitive screening |
| U2 | Optimise a few factors | CCD, Box–Behnken, optimal designs; response surface, desirability |
| U3 | Furnace / batch experiments | Hard-to-change factors per batch, easy ones per wafer → split-plot |
| U4 | Robust settings | Minimise within-wafer or run-to-run variance as well as hitting target |
| U5 | Measurement capability | Gauge R&R on a probe, ellipsometer, CV plotter etc. |
| U6 | Simulator tolerance / yield | Latin hypercube or factorial on a simulator, surrogate Monte Carlo yield |
| U7 | Sequential study | Screen → augment (fold-over, axial points) → confirm, as one study |

## 3. Architecture

- **Language:** plain ES modules (JavaScript), no build step, same conventions as comb-over. The core runs unchanged in Node (tests, CLI) and the browser (UI).
- **Layout:**

  | path | contents |
  |---|---|
  | `js/linalg.js` | dense matrices: QR (Householder), Cholesky, symmetric eigen, solve, inverse, determinant (log) |
  | `js/dist.js` | t, F, χ², normal, studentised range: cdf/quantile |
  | `js/design/*.js` | design generators (§5) |
  | `js/model/*.js` | model formula, model matrix, noise models and fitting (`noise.js`, `fit.js`), OLS, REML (§6, §7) |
  | `js/study.js` | study data model and JSON (de)serialisation (§4) |
  | `js/io/*.js` | CSV run sheets and results import (§11) |
  | `js/adapters/*.js` | simulator adapters (§10) |
  | `index.html`, `ui/` | browser front end (§12) |
  | `tools/*.mjs` | command-line front ends |
  | `tests/` | Node test runners and reference fixtures (§13) |
  | `tests/ref/*.py`, `*.R` | scripts that regenerate fixtures; not needed to run tests |

- **Dependencies:** none at run time. Plotting is hand-written SVG, as in comb-over.
- **Numerics:** all fits by QR or Cholesky on the model matrix, never by forming (X′X)⁻¹ explicitly for estimation. Problem sizes are small (≤ a few hundred runs, ≤ ~50 model terms), so dense O(n·p²) methods are fine.
- **Determinism:** every random step (randomisation, coordinate-exchange starts, Monte Carlo) takes an explicit seed, recorded in the study file. Same seed → same run sheet.

## 4. Data model

A **study** is one JSON document holding everything needed to reproduce the plan and the analysis.

```jsonc
{
  "aikidoe": 1,                      // file format version
  "name": "Gate oxide anneal",
  "seed": 12345,
  "factors": [
    { "id": "T",    "name": "Anneal temperature", "units": "°C", "type": "continuous",
      "low": 900, "high": 1000, "htc": true },              // hard to change → whole-plot
    { "id": "t",    "name": "Anneal time", "units": "min", "type": "continuous",
      "low": 10, "high": 30, "transform": "log" },
    { "id": "amb",  "name": "Ambient", "type": "categorical", "levels": ["N2", "Ar"], "htc": true },
    { "id": "dose", "name": "Implant dose", "units": "cm-2", "type": "continuous",
      "low": 1e15, "high": 5e15, "transform": "log" }
  ],
  "constraints": [ "T + 2*t <= 1050" ],           // linear in coded or natural units
  "responses": [
    { "id": "Rs", "name": "Sheet resistance", "units": "Ω/sq",
      "goal": "target", "target": 60, "lower": 55, "upper": 65,
      "levels": ["run", "wafer", "site"] }       // measurement nesting (§7)
  ],
  "design": { "kind": "split-plot", "params": { }, "runs": [ /* §4.1 */ ] },
  "observations": [ /* §4.2 */ ],
  "sites": { "scheme": "dropin-5", "positions": [ /* §7.2 */ ] },
  "history": [ /* stages: screen, augment, confirm (U7) */ ]
}
```

### 4.1 Runs

Each run carries: `run` (planned id, positive integer), `order` (randomised execution order), `wholePlot` (id, split-plot only), `block`, `settings` (factor id → value in natural units; level name for categorical factors), and `kind` (`factorial`, `fraction`, `axial`, `centre`, `confirm`, `augment`, `optimal`, `space-filling`, `other`). The design also records `randomisation` (`complete`, `restricted`, `blocked` or `none`) so the analysis can match it. Runs in one whole plot must share their hard-to-change settings.

### 4.2 Observations

Long format, one row per measured value: `run`, optional `lot`, `wafer`, `site`, `slot` (boat or cassette position), `response`, `value`, optional `operator`, `repeat`. A run with no observations is "planned"; with some, "partial".

### 4.3 Coding

Continuous factors are coded to [−1, +1] after the optional transform (`log` → log10); axial points may lie beyond ±1. Categorical factors use effect (sum-to-zero) coding by default, so main effects stay orthogonal to the intercept in balanced designs: the first level is the row of all −1 and level i ≥ 1 is the unit vector e_(i−1), so a 2-level categorical codes −1 / +1 like a continuous low / high (R's `contr.sum` uses the last level instead). All design generators work in coded units; reports show both.

### 4.4 File format

Study files are JSON; comments (`//`, `/* */`) and trailing commas are accepted so files can be written by hand. Unknown fields are errors (with a "did you mean" hint), and every problem in a file is reported at once. `aikidoe` is the format version; older versions are upgraded on load by a chain of upgrade functions, and files from a newer version are refused. Constraints are linear expressions in factor ids, as strings (natural units) or `{ "expr": …, "units": "coded" }`; a run that violates one gives a warning, not an error.

## 5. Design generators

| Design | Notes | Issue |
|---|---|---|
| Full factorial 2^k and mixed-level | with centre points, replicates, blocking | #5 |
| Regular fractional 2^(k−p) | generators chosen from minimum-aberration catalogue (k ≤ 15, up to 128 runs; built by aikidoe's own search and checked against FrF2's); user generators allowed, with signs; defining relation, resolution, full alias table to 2- or 3-factor interactions | #5 |
| Fold-over | full and single-factor, for de-aliasing (U7) | #11 |
| Plackett–Burman | N = 12, 20, 24, 28, … 48; partial alias (correlation) table | #5 |
| Definitive screening (DSD) | Jones–Nachtsheim conference-matrix construction, 2k+1 (or 2k+3) runs; categorical 2-level extension | #10 |
| CCD | circumscribed / inscribed / face-centred; α for rotatability or orthogonal blocking | #9 |
| Box–Behnken | k = 3…7 standard tables | #9 |
| D-, I-optimal | coordinate exchange over a candidate set or continuous region, linear constraints, fixed runs to augment, multiple random starts; reports D-, A-, G-efficiency and the fraction-of-design-space (FDS) curve | #10 |
| Split-plot | from a factorial or optimal design: htc factors grouped into whole plots; regular fractions by minimum aberration among split-plot-compatible generators (unassigned whole-plot base columns count as pseudo-factors, as in FrF2); optimal split-plot by coordinate exchange on the GLS information matrix with an assumed variance ratio η; restricted randomisation (whole plots, then runs within them); centre points and blocking of split-plots later | #14 |
| Latin hypercube | maximin, for simulators (U6) | #20 |
| Gauge R&R layout | parts × operators × repeats, crossed or nested | #17 |

**Randomisation.** Complete randomisation by default; restricted when there are whole plots (randomise whole-plot order, then sub-plot order within each) or blocks. The run sheet always states which randomisation was used, so the analysis can match it.

**Design diagnostics, shown before running:** alias / correlation matrix of model terms, power for a stated effect size and σ (§6.4), variance inflation factors, prediction-variance profile.

## 6. Analysis

### 6.1 Model specification

Formula language similar to R/Wilkinson notation in coded factor ids: `Rs ~ (T + t + amb + dose)^2 + I(T^2)`. Shortcuts: `main`, `2fi`, `quadratic`. Hierarchy is maintained by default when terms are removed.

### 6.2 Fixed-effects fit (OLS)

Fitting goes through a **noise model** (`js/model/noise.js`, issue #64): what is assumed about the variation of a response around its mean. Each noise model fits a model matrix, tests the terms, predicts with intervals on the response scale, gives residuals, compares nested models and their log-likelihood (for model reduction and AICc), and weights the runs' information for power. `fit.js` (`fitModel`, `predict`, `anova`) picks the response's noise model; normal noise with constant variance, fitted by least squares (`ols.js`), is the default and so far the only one. Lack of fit, Box–Cox, Lenth and the mixed models (§7) are normal-theory tools and refuse fits from other noise models.

- Coefficients, SE, t, p; ANOVA (sequential and partial / Type II–III for unbalanced data); R², adjusted and predicted R² (PRESS); lack-of-fit test when there are replicates.
- **Unreplicated 2-level screening:** half-normal plot of effects, Lenth's pseudo-standard error with the t-like margin of error (ME) and simultaneous margin (SME).
- **Residual diagnostics:** residual vs fitted, normal plot, residual vs run order (drift in the tool), leverage, Cook's distance.
- **Box–Cox** suggestion for positive responses.

### 6.3 Model reduction

Backward elimination by p-value (partial F test, drop while p > 0.10) or AICc (k = rank + 1, as
R's `AIC`), with hierarchy preserved (a term stays while an interaction or power containing it is
in the model; block terms and terms the user marks to keep never go). The steps are shown and the
user can undo or edit the result. Forward and bidirectional stepwise selection are not provided:
with designed experiments the full model is usually estimable and backward elimination from it
is the standard practice.

### 6.4 Power

Power to detect an effect of size Δ given σ (or Δ/σ) for each term in the chosen model, by the non-central t / F. Shown at design time, before money is spent.

Convention (as skpr's `effectsize`): Δ is the change in the response from the low to the high
coded setting, so every column of a term has anticipated coefficient Δ/2; λ = bᵀ(V_SS)⁻¹b/σ² with
V = (XᵀX)⁻¹. Term power is the F test of all its columns (effect power), coefficient power the
two-sided t test (parameter power). Blocks are fixed nuisance terms. The smallest Δ/σ detectable
with 80% power is shown alongside. Coded units are aikidoe's (factor low/high at ±1); skpr instead
rescales each column of an imported design to ±1, which differs for designs with points outside
the cube (CCD axial points). σ comes from the user for now; the measurement-system study (#17)
will supply σ_meas when it lands.

## 7. Variance structure and mixed models

Process data are rarely independent. aikidoe treats the hierarchy explicitly.

### 7.1 Random effects supported

The first version supports **nested** random effects only, which covers the process cases:

- whole plot (batch / furnace run) — split-plot designs,
- lot, wafer within run or lot, site within wafer (residual),
- block as fixed or random.

Crossed random effects (e.g. operator × part in gauge R&R) are handled by the dedicated ANOVA method in §9, not the general REML engine.

### 7.2 Drop-in test structures and sites

Measurements usually come from a few drop-in test die (process control monitor structures) at fixed reticle positions, typically 5 or 9 per wafer, not full per-die maps. aikidoe supports:

- a site scheme: named positions with (x, y) in mm from wafer centre, and derived radius r;
- site as a random effect (within-wafer variance), or **position as fixed effects** — centre vs edge, or a radial term in r² — when the pattern is systematic (e.g. bowl-shaped Rs after anneal);
- per-wafer summaries (mean, standard deviation, range/mean, log s) as derived responses for robust design (§8): declared as `{ "derived": { "from": "Rs", "stat": "logsd" } }`, computed from the readings whenever needed (never stored), analysed like any response.
- Implementation (#16): presets `dropin-5` (centre + 4 at 0.8 R) and `dropin-9` (centre, 4 at 0.45 R, 4 diagonal at 0.8 R — three radii, so curvature in r is estimable) for a given wafer diameter, or custom positions; position terms usable in mixed-model formulas: `radius2` (ρ², coded centre → edge), `edge` (ρ ≥ 0.5), `waferX`, `waferY` (tilt), `slot` (linear) and `slotZone` (three equal zones, as a block); a study factor with the same id takes precedence. Site (with repeats at a site) can be a random effect. A wafer plot shows site means (or within-wafer residuals) as dots on the wafer outline, with the readings against r/R.

Per-die wafer maps are out of scope for v1 (§14) but the observation format (§4.2) already allows any number of sites.

### 7.3 REML

- Linear mixed model y = Xβ + Σ Z_k u_k + ε, u_k ~ N(0, σ_k² I).
- σ² and β profiled out; the variance ratios γ_k = σ_k²/σ² optimised by Newton's method with the exact gradient and Hessian, damped, with a backtracking line search projected onto γ ≥ 0 (so a component can sit exactly on the boundary, reported as estimate 0, not as failure); Nelder–Mead on √γ as fallback. All components nested, so H is block diagonal over the coarsest groups and the algebra is done block by block.
- Random effects chosen automatically from the data: whole plots (when the design has them), runs (when a run has several readings), wafers (when runs have several wafers and wafers several readings); duplicates of another level or of the residual are dropped; the user can name them instead (`wholePlot`, `run`, `wafer`, `lot`).
- Variance components with Satterthwaite (scaled χ²) intervals from the asymptotic covariance of the REML estimates.
- Output: variance components with approximate CIs, fixed-effect estimates by GLS, and tests with **Kenward–Roger** denominator degrees of freedom and adjusted covariance (the accepted standard for split-plot analysis), or containment (stratum) df on request. A term is tested in the finest stratum within whose groups its columns are constant.
- Power for split-plot designs uses the GLS information for an assumed η = σ²_wp/σ² and the containment df of each term's stratum.
- Predictions: x β̂ with the KR standard error and df; prediction intervals for a new run measured like the others (or the mean of n such runs, in one new whole plot or in separate ones) add the variance components weighted by how many groups of each level a run holds, with Satterthwaite df 2V²/(gᵀWg), g_k = xᵀΦP_kΦx + c_k. Confirmation runs planned from a mixed model store these intervals, and in a split-plot study they get a new whole plot.
- Model reduction of mixed models: backward elimination keeping hierarchy, by Kenward–Roger p, or by AICc of maximum-likelihood fits (REML criteria are not comparable across fixed effects); the random effects stay as in the starting model.
- H⁻¹ within each top-level group by Woodbury (q_b × q_b factorisation over the group indicators), so the cost grows with the number of groups, not readings.
- A naive OLS fit of a split-plot experiment is shown side by side on request, to show what restricted randomisation does to whole-plot standard errors.

### 7.4 Boat / slot position

Furnace boat or cassette slot can be entered per wafer and used as a fixed covariate (`slot`) or block (`slotZone`) — load-end effects are common and otherwise confound with treatments. Slot is constant within a wafer, so it is tested in the wafer stratum.

## 8. Multiple responses and robust design

- **Desirability** (Derringer–Suich): per-response goal (maximise / minimise / target / in range), weights and importance; overall D maximised over the fitted models, with constraints.
- **Overlay / sweet-spot plots** of feasible regions for 2 factors at a time.
- **Dual response (mean and variance):** model log s (within-wafer or replicate standard deviation) alongside the mean, then optimise e.g. "mean on target, minimise s".
- **Propagation of error:** with tolerances on continuous factors, variance transmitted through the fitted surface (σ_y² ≈ Σ (∂f/∂x_i)² σ_i² + σ²), so settings can be chosen on a flat part of the surface.
- **Prediction profiler:** interactive slices of every response vs each factor, with confidence bands.
- Implementation (#19): factors may carry `noise: { sd, mean? }` (varied in the experiment, random in production) and `tolerance` (sd of the actual value about its setting), both in natural units. Propagation of error to second order: E[y] ≈ f(x̄) + ½ Σ H_ii σ_i², Var[y] ≈ Σ g_i² σ_i² + ½ Σ H_ij² σ_i² σ_j² + σ² (exact for quadratic surfaces with normal deviations; for a model linear in a noise factor it is the response-model approach). Dual response: σ from POE or from a fitted log₁₀ s model (e.g. a per-wafer summary, §7.4); goals "mean on target, minimum sd" (Vining–Myers, by a penalty continuation), "minimum (μ − T)² + σ²" (Lin–Tu), or "max / min mean with sd ≤ s". The Optimise step's Robustness panel sets noise and tolerances, shows the variance breakdown at the current settings and the sd surface over two control factors. Worked example: the filtration-rate 2⁴ data of Montgomery, *Design and Analysis of Experiments*, example 6.2, with temperature treated as a noise factor (σ_z = 1); mean and variance models follow from the data, the optimisation is checked analytically.
- Implementation (#18): desirability functions as the R package `desirability` (dMax, dMin, dTarget with two shapes, dBox), from each response's goal and lower / target / upper, `weight` (shape) and `importance` (exponent in the weighted geometric mean). Optimisation over the fitted models (least squares, or the mixed model for split-plot / nested readings): Latin-hypercube screen, Nelder–Mead from the best starts projected onto the region (cube of a given half-width, or sphere — e.g. to the axial points of a CCD), coordinate polish; categorical factors enumerated; constraints respected; factors can be held. An Optimise step shows the goals, the best settings with each response's d, a profiler (responses × factors, with 95% bands; click to move a factor) and a two-factor overlay of D with the infeasible region greyed.

## 9. Measurement systems analysis (gauge R&R)

- Crossed (parts × operators × repeats) and nested designs.
- ANOVA method with variance components: repeatability, reproducibility, operator × part, part-to-part; %contribution, %study variation, %tolerance; number of distinct categories (ndc).
- Also for a single instrument with no operators (repeatability only), common in fabs where the tool is automated.
- Recommended before any experiment whose effects of interest are near the measurement noise; the planner links σ_meas into the power calculation (§6.4).
- Implementation (#17): balanced designs by the expected-mean-square formulas; the crossed operator × part interaction is pooled into repeatability when p > 0.05 (as SixSigma::ss.rr); negative components set to 0; study variation k·σ with k = 6 (5.15 selectable); ndc = max(1, ⌊√2 σ_part/σ_GRR⌋); verdict by AIAG bands (< 10 %, 10–30 %, > 30 % of study variation). The result is kept on the response (`measurement: { sigma, design, pctGRR, ndc, tolerance, data }`, readings included so it can be re-analysed); power then uses σ = √(σ_process² + σ_meas²), or σ_meas alone as an upper bound. Unbalanced gauge studies are not handled yet.

## 10. Simulator adapters and yield

- **Adapter interface:** `factors()` (with ranges and tolerances), `run(settings) → {response: value}`, possibly async; batching allowed.
- **comb-over adapter:** factors from `.param … tune` lines and substrate parameters (εr, h, t, etch bias); responses are named scalar metrics computed from S-parameters (e.g. |S21| at f0, min directivity over a band, f at |S11| minimum). Lives in aikidoe; imports comb-over as a module.
- **Workflow:** space-filling or RSM design → run simulator → fit surrogate (quadratic RSM; option of Gaussian-process / kriging later) → cross-validated error → global sensitivity (Sobol first-order and total indices on the surrogate) → **Monte Carlo yield** against spec limits with the stated tolerance distributions (normal, uniform, truncated), with a confidence interval on yield and a check of a sample of points on the real simulator.
- Yield is reported with the surrogate's own error stated; if cross-validated error is comparable to the spec margin, aikidoe says the yield estimate is not trustworthy.
- Implementation (#20):
  - **Study format.** `simulator: { adapter, …options }` names the simulator; `adapter: 'expression'` gives each response a formula in the factor ids (a small parser, no `eval`), for analytic test functions, exercises and quick what-ifs; the CLI adds `adapter: 'module'` (a Node module exporting `run(settingsList)` or `simulate(settings)`). Adapters are `{ name, factors(), responses(), run(settingsList) → Promise<[{ id: value }]> }`, registered by name; `runOnSimulator` runs the design's missing runs in batches and stores non-finite results as empty. A factor's `tolerance` is a number (normal sd) or `{ sd, dist: normal | uniform | truncated, at }` (uniform with that sd, i.e. ±√3·sd; normal cut at ±at·sd, default 2, whose actual sd is smaller — robust design uses the actual sd). A response's `spec: { lower?, upper? }` holds its specification limits (separate from the desirability limits of §8).
  - **Design.** Maximin Latin hypercube (`design --lhs`, default max(10k, p + 5) runs for the full quadratic's p terms): stratum-centred points, column-swap search on the smallest pairwise distance and then the number of pairs at it (Morris–Mitchell), several random starts. Default model `quadratic`.
  - **Surrogate.** Least squares on the Analyse step's formula (quadratic by default); its error is RMSE_cv = √(PRESS/n) (leave-one-out). Continuous-factor models are compiled to a direct polynomial evaluator for the sampling loops.
  - **Sobol indices.** Saltelli (2010) first-order estimator, centred on the sample mean, and Jansen (1999) total; (k + 2)N evaluations, the A and B matrices drawn as 2k-dimensional R_d quasi-random points (Roberts' generalised golden ratio sequence: no direction tables). The N points form 8 independently randomly shifted replicates; estimate = their mean, 95 % interval = t interval over replicates (coverage checked on the Ishigami function). Over the factor ranges (uniform) or over the tolerances about the current settings.
  - **Yield.** Plain Monte Carlo (default 20 000 samples of the surrogate) with a Wilson score interval; per-response fractions below and above. Trust check: the yield is recomputed with every limit moved in and out by 2·RMSE_cv; if that spread exceeds the Monte Carlo interval (or 1 %), the estimate is flagged. `--check M` (CLI) / "Check on the simulator" (UI) draws M fresh samples, runs them on the simulator and reports the direct yield with its interval, the surrogate's RMS error at those points and the fraction with the same pass/fail.
  - Validation: Ishigami (a = 7, b = 0.1) indices within 0.01 of the analytic values and interval coverage over 20 seeds; additive linear function; normal and uniform yields against closed forms; surrogate yield against direct Monte Carlo on an exact quadratic simulator; the trust flag on an oscillating response fitted by a quadratic.
  - **Trust levels** (refined in #21): *good* when the ±2·RMSE_cv bounds are within the Monte Carlo interval (or 1 point); *fair* up to 20 points — the surrogate, not the sampling, limits the precision, and the bounds are shown; *poor* beyond, reported as not trustworthy.
  - UI: a "Simulator" panel on Define (formulas per response), a Latin-hypercube candidate on Design (listed first when the study has a simulator), "Run on the simulator" on Run, and a "Yield and sensitivity" panel on Optimise (tolerance distributions, spec limits, surrogate table, yield with histograms against the limits, Sobol tables). Example: a unity-gain Sallen–Key low-pass filter from its formulas.

- Implementation (#21), the comb-over adapter:
  - comb-over's netlist parser, solver and expression evaluator (16 files, ~210 kB, MIT) are **vendored** in `vendor/comb-over/` by `tools/vendor-comb-over.mjs`, which follows the static import closure from js/netlist.js, js/solver.js and js/expr.js and records the comb-over commit in `vendor/comb-over/VERSION`. Same-origin files, no build step, work offline; updating comb-over is a re-run and a reviewed diff. The worked example's stored results are re-simulated in the tests, so a solver change that alters them is caught.
  - `simulator: { adapter: 'comb-over', netlist: text, factors: { id: { param } | { substrate: er | h | t | tand | … } | { etch: true }, scale? }, metrics: { id: 'EXPR @ F' | 'min|max|mean(EXPR) @ F1..F2' }, points }`. The netlist is kept in the study, so the study file is self-contained.
  - Factor values are in the study's units, scaled to SI: a param by the unit suffix of its netlist value (mm, µm, mil …), substrate h in mm and t in µm, etch in µm. A param is overridden through comb-over's parameter overrides; substrate keys are appended to the `.substrate` line (later keys win); etch bias e (per edge, over-etch positive) rewrites every `W=x` to `W=(x)−2e` and every `S=x` to `S=(x)+2e`, including lists and the `w` / `s` lines of cline blocks. Other geometry (tee widths, finger dimensions) is not etched.
  - Metrics: comb-over trace expressions (real part) at one frequency, or the min / max / mean over a band (21 points by default). Only the frequencies the metrics need are solved: about 1–2 ms a run.
  - A study from a netlist (`doe comb-over STUDY NETLIST.cir --factor …`, `combOverStudy`): a param's range is its `tune` limits; a factor given a tolerance gets ±4 sd about nominal (so the surrogate covers the tolerance region); otherwise ±5 % (etch ±30 µm). In the UI the Define step's Simulator panel takes a netlist (pasted or loaded), maps each factor and gives each response its metric.
  - Worked example (`examples/coupler-10dB-ro4350b.aikidoe.json`, from comb-over's examples/coupler-10dB-ro4350b.cir): etch bias sd 8 µm (an assumed value, not a JLCPCB figure) and εr sd 0.025 (Rogers quotes ±0.05 on Dk); coupling 10 ± 0.5 dB and directivity ≥ 12 dB at 5 GHz. The issue's "> 15 dB" is unattainable: this design has 13.2 dB nominal at 5 GHz. A 30-run LHS; quadratic surrogates give RMSE_cv 0.028 dB (coupling) and 0.10 dB (directivity), trust *fair*; adding I(etch³) cuts them about 3×. The test runs 200 fresh tolerance samples on comb-over: RMS surrogate error below RMSE_cv, all points within 2·RMSE_cv.

## 11. Files

- **Study:** `*.aikidoe.json` (§4). Versioned; older versions are upgraded on load.
- **Run sheet:** CSV or printable HTML in execution order, with blank columns for results; whole plots visually grouped.
- **Results import:** CSV in long (§4.2) or wide (one column per response, or per site) format, with a column-mapping dialog; checks against the plan (unknown runs, missing wafers, out-of-range values).
- **Export:** analysis report as self-contained HTML; coefficients and predictions as CSV.
- **Share:** a study can be encoded in the URL fragment when small, as comb-over does with netlists.

## 12. User interface

Single page, step-based, each step usable on its own:

1. **Define** — factors, responses, constraints, measurement hierarchy and site scheme.
2. **Design** — choose a design (with a recommender: given number of factors, budget, htc factors and goal, suggest options with their run counts and diagnostics), compare candidates side by side, then randomise.
3. **Run** — run sheet export, results entry or import, progress.
4. **Analyse** — model fit, diagnostics, effects, variance components.
5. **Optimise** — profiler, desirability, overlay plots, yield.
6. **Next stage** — augment (fold-over, axial points, optimal augmentation) or confirmation runs, with predicted values and prediction intervals for the confirmation runs.

A manual with worked examples, an interactive tutorial with generated exercises, and guidance for AI agents are part of the deliverable (§16). Examples should include at least: a 2^(5−1) screening experiment from a textbook, a furnace split-plot, a gauge R&R study, and a comb-over coupler yield study.

## 13. Validation

Every statistical routine is checked against an independent implementation or a published worked example before it is considered done.

| Area | Reference |
|---|---|
| Fractional factorials, aliasing | R `FrF2`; minimum-aberration catalogue (Chen–Sun–Wu 1993) |
| Plackett–Burman, DSD | published tables; R `daewr::DefScreen` |
| CCD, Box–Behnken | R `rsm` |
| Optimal designs | R `AlgDesign` / `skpr`; efficiency within 1 % of reference over random restarts |
| OLS, ANOVA | `statsmodels` / R `lm` and `car::Anova`, to 1e−8 |
| Lenth | Lenth (1989) worked example |
| REML, variance components | R `lme4` + `lmerTest` (Satterthwaite) and `pbkrtest` (Kenward–Roger); `statsmodels` MixedLM; to 1e−5 on estimates, 1e−3 on df |
| Split-plot examples | Montgomery, *Design and Analysis of Experiments*, ch. 14; Jones & Nachtsheim (2009) split-plot review |
| Gauge R&R | AIAG MSA manual example; R `SixSigma` / `qualityTools` |
| Desirability | R `desirability` package |
| Sobol indices | analytic Ishigami function; SALib |
| Distributions | scipy.stats to 1e−10 over a grid |

Reference values are generated by scripts in `tests/ref/` and committed as JSON fixtures, so `npm test` needs only Node. CI also runs the fixtures' generator scripts on a schedule to catch drift.

## 14. Non-goals for v1

- Per-die wafer maps and spatial models (kriging across the wafer) — the data model allows them later.
- Mixture designs (composition sums to 1) — likely a later issue, e.g. for gas mixtures.
- Bayesian / sequential Bayesian optimisation.
- SPC / control charts — a natural follow-on (§1 "does the optimum hold in production") but separate.
- Crossed random effects in the general REML engine.
- Multi-user or server storage.

## 15. Milestones

| Milestone | Scope |
|---|---|
| M1 Core | linear algebra, distributions, study model, factorial / fractional / PB designs, OLS + ANOVA + Lenth, CSV run sheet and import, CLI |
| M2 Screening & RSM | DSD, CCD, BBD, optimal designs with constraints, augmentation, power, model reduction, first UI |
| M3 Process | split-plot designs, REML with variance components, drop-in sites, boat slot, gauge R&R |
| M4 Optimise | desirability, dual response, propagation of error, profiler |
| M5 Simulation | adapter interface, comb-over adapter, LHS, surrogates, Sobol, Monte Carlo yield |
| M6 Docs | online manual and worked examples, report export, virtual process and exercise generator, interactive tutorial, agent skill and machine-readable CLI (§16) |

## 16. Manual, tutorial and agent guidance

Three ways in, for three kinds of reader: someone looking something up (manual), someone
learning DOE (tutorial), and an AI agent helping a user with a new problem (skill). They share
one source of truth — the library, the CLI and the study format — and are tested against it, so
none of them can drift from what the tool actually does.

### 16.1 Online manual (#22)

- **Where:** Markdown in `docs/manual/`, published with the UI on GitHub Pages at `/manual/` and
  rendered in the browser by a small in-repo Markdown renderer (no build step, §3). Each UI panel
  has a `?` link to the relevant manual section; the manual links back into the UI with example
  studies preloaded (`index.html#example=…`).
- **Contents:**
  1. *Getting started* — the four steps on one example, from Define to a confirmed model.
  2. *Concepts* — coded units, randomisation and blocking, aliasing and resolution, replication
     vs repeated measurement, power, hierarchy, sequential experimentation; each with a small
     interactive figure where it helps (e.g. an alias table that updates as generators change).
  3. *Designs* — one page per family (§5): when to use it, what it estimates, run counts, the
     options, its diagnostics, references.
  4. *Analysis* — formulas, OLS, ANOVA types, Lenth, diagnostics, Box–Cox, reduction, prediction
     and confirmation, mixed models (as they land).
  5. *Process topics* — split-plot and hard-to-change factors, wafers and sites, boats, gauge R&R.
  6. *Simulation and yield* — adapters, surrogates, sensitivity, yield (§10).
  7. *Reference* — study file format (generated from the schema, §16.3), CLI (generated from the
     CLI's own help), formula syntax, glossary, bibliography.
  8. *Worked examples* (§12).
- **Tested:** every command block in the manual is run by `npm test` against the CLI and its
  output compared with what the manual shows (numbers to the printed precision); internal links
  and example links are checked; generated reference pages are regenerated and diffed.

- Implementation (#22):
  - 23 pages in `docs/manual/` (contents in `docs/manual/pages.js`): getting started; concepts;
    seven design pages; analysis; optimisation and robust design; process topics; simulation and
    yield; four worked examples; reference (CLI, study format, formulas), glossary, bibliography.
  - Viewer: `docs/manual/index.html?p=PAGE#section` renders the Markdown with `js/markdown.js`
    (headings with ids, emphasis, code, links, images, fenced blocks, nested lists, quotes,
    GitHub tables, raw HTML blocks); links `page.md#x` stay in the viewer, so the same files read
    correctly on GitHub. Published on Pages at `/docs/manual/` (`/manual/` redirects); the app links
    to it from the header, the welcome page and a `?` on each panel; `index.html#example=ID` opens a
    built-in example (the manual's "open it" links).
  - Worked examples: the 2⁵⁻¹ reactor experiment of Box, Hunter & Hunter (1978, p. 379; real data,
    effects checked against the published B 20.5, D 12.25, E −6.25, BD 10.75, DE −9.5); the furnace
    split-plot with drop-in sites (simulated, stated); gauge R&R on SixSigma's `ss.data.rr` (paper
    helicopter, checked against `ss.rr`); the comb-over coupler yield. Also as app examples
    (`reactor-bhh`) and files in `examples/`.
  - Tested (`tests/manual.test.mjs`): every page listed and present; generated pages
    (`reference-cli.md` from `doe help` and the CLI schema, `reference-study-format.md` from the
    study schema; `node tools/gen-manual.mjs`) up to date; every link — between pages and to their
    anchors, to app examples, to repository files — and every `?` link in the app resolves; every
    `console` block is run in a fresh directory (with `file` blocks written first) and its output
    compared with the page (a line `…` skips lines; timings are normalised).
    `node tools/gen-manual.mjs --outputs [page]` rewrites the outputs after a deliberate change.
  - Report export: `doe report STUDY [--model …]` and the app's **Report** button write one
    self-contained HTML page (inline CSS and SVG): factors, responses, constraints, design and stage
    history, the run sheet with results, and per response the fitted model (OLS: coefficients, fit
    statistics, ANOVA with lack of fit, observed-vs-predicted and residual-vs-order plots; mixed:
    variance components, KR fixed effects and tests), confirmation results; the study is embedded
    (`script#aikidoe-study`), and **Open…** reads it back from a report.

### 16.2 Interactive tutorial and exercise generator (#38, #39)

**Virtual process.** A seeded simulator of a process with a hidden true model, used by the
tutorial, by the UI's examples and as a test bed (and for agent evaluation, §16.3):

- *Truth:* a response function in coded units built from effect sparsity (a few active factors),
  heredity (interactions mostly among active factors), optional curvature with an optimum inside
  or outside the region, and effect sizes set as multiples of σ (so difficulty is a signal-to-noise
  choice). Optional transformations (multiplicative response → log), several responses with
  trade-offs (for desirability), constraints, and categorical factors.
- *Nuisance:* run-to-run noise; measurement error with nested wafers/sites (§7); whole-plot
  variance for hard-to-change factors; block shifts between days or stages; drift in run order;
  occasional outliers; a gauge with bias — each switched on by the scenario or the lesson.
- *Scenarios:* templates with engineering names, units and plausible ranges (gate-oxide growth,
  plasma etch, CVD uniformity, reactor yield, coupler tuning), so exercises read like real
  problems rather than x1…x5.
- *Running runs:* results are a deterministic function of (exercise seed, run settings,
  replicate index), so an exercise is reproducible and shareable as a link, and repeating a run
  gives a fresh but repeatable noise draw. A run budget can be set; each "run" spends it.

**Exercise generator.** `generateExercise({ topic, difficulty, seed, factors, budget, … })` →
an exercise: scenario text, factors and responses (an ordinary study with no design), budget,
questions, and the sealed truth.

- *Solvability check:* the generator solves its own exercise with a scripted reference strategy
  for the topic (e.g. fraction → fold-over → axial → confirmation) and rejects truths the budget
  cannot resolve with adequate power (#12), unless the lesson is about low power. The reference
  path is kept as the *model answer*.
- *Questions and grading:* which factors are active (scored by precision and recall); sign and
  size of effects (against the truth, with the user's interval); best settings (scored by the
  true response there vs the true optimum — regret — and constraint violations); a prediction
  at given settings; whether a confirmation held; the budget used. Feedback explains what was
  missed and shows the model answer and the truth.
- *Self-study vs class:* in self-study the truth travels sealed (encoded) inside the exercise so
  the browser can run it — enough to avoid spoilers, not a secret. In class mode an instructor
  generates a set of exercises (`doe exercise new --set …`) and keeps the key file; students
  receive studies without the truth, send their run sheets, and the instructor returns results
  (`doe exercise run KEY sheet.csv`) and grades submissions (`doe exercise grade KEY study`) —
  much as a real lab returns measurements.

Implementation (#38):

- `js/learn/process.js` — virtual processes as plain data `{ seed, factors, responses: [{ id, truth:
  { intercept, terms: { label: coef } }, sigma, transform, decimals }], nuisance }`. Truth labels over
  coded factors: `A`, `A:B`, `I(A^2)`, a two-level categorical as ±1, `g.L` indicators, and the
  position terms `radius2`, `slot`. Nuisance: run-to-run σ; whole plot (by label), block, drift per
  run, outliers, gauge bias; wafers per run, wafer and site sd, slot gradient. Randomness is hashed
  (FNV-1a + murmur finaliser → uniform → inverse normal) from (seed, response, kind, settings,
  replicate index, …), so results are deterministic and independent of the run order except for
  order-dependent nuisance.
- `js/learn/scenarios.js` — five scenarios (gate oxide, plasma etch, CVD, reactor, coupler), each
  with eight factors (one hard to change, one categorical), units, ranges, a response baseline and σ.
- `js/learn/exercise.js` — six topics (factorial, fraction, screening, blocking, rsm, split-plot) ×
  three difficulties (smallest active effect 4, 3, 2.4 σ). Truth: sparse main effects with random
  signs, an interaction among active factors with the topic's probability (heredity), for rsm a
  maximum inside the region (−Σ cᵢ(xᵢ − x*ᵢ)², x* in ±0.6, plus a small interaction). Order-dependent
  nuisance follows the actual run order: day shifts (blocking: 8 runs a day, 3σ) and resets of the
  hard-to-change factor (split-plot: 0.8σ per reset; every run of a design without whole plots is a
  reset). Questions: active factors, effects with intervals, best settings, a prediction, the budget.
  Solvability: truths are redrawn (≤ 40 attempts, recorded) until the reference strategy, within the
  budget, has power ≥ 0.8 for every questioned term (rsm: the curvature terms) and earns 100; its path
  is the model answer. Reference strategies: 2³ × 2; 8-run fraction + full fold-over; 16-run
  resolution IV; 2⁴ in two blocks; rotatable CCD; split-plot full factorial with 6 whole plots.
  One-factor-at-a-time: baseline at the low settings and each factor raised alone, repeated within
  the budget, run in order. Grader: active factors 40 (F1 of precision and recall), effects 25 (half
  for the sign, half for the interval containing the truth), best settings 25 (full at regret ≤ 5 %
  of the true range, none at ≥ 50 %), prediction 10 (full within 1.5σ, none beyond 4σ), weights
  renormalised to the questions asked; −20 over budget. Without answers, the study's data are
  analysed the standard way and that is graded.
- Self-study: the truth sealed in the study's `exercise` field (XOR keystream from the id, base64).
  Class mode: `doe exercise new --set N --out DIR` writes keys and student studies; `exercise run KEY
  sheet.csv` returns long-format results; `exercise grade KEY STUDY`.
- The app's simulated examples (reactor-results, ccd-results, anneal-results) are now virtual
  processes with the truths they always had.
- Tested: hashed randomness, truth evaluation, determinism and replicate draws, nuisance; across the
  6 topics × 3 difficulties × 50 seeds the reference strategy earns 100 every time and
  one-factor-at-a-time averages 31–82; reproducible from the seed; the class-mode round trip.

**Tutorial.** A sequence of lessons in the UI (a *Learn* mode beside the four steps), each a
short explanation linked to the manual, a task on a generated exercise, checks with hints while
working (e.g. "these two effects are aliased — can you tell them apart?"), and a graded result:

1. Why designed experiments: one-factor-at-a-time vs a factorial on the same virtual process.
2. Full factorials, effects and interactions; reading an interaction plot.
3. Replication, noise and significance; power before running (#12).
4. Fractional factorials, aliasing and resolution; fold-over to resolve an ambiguity.
5. Screening many factors (fractions, Plackett–Burman, DSD) and effect sparsity.
6. Blocking and randomisation: drift and day-to-day shifts, and what they do when ignored.
7. Response surfaces: curvature, CCD/BBD, sequential augmentation, finding an optimum.
8. Constraints and optimal designs.
9. Several responses: desirability and trade-offs (M4).
10. Hard-to-change factors and split-plots; wafers, sites and variance components (M3).
11. Measurement systems: gauge R&R before the experiment (M3).
12. Robust design: noise factors and propagation of error (M4).
13. Simulation and yield (M5).

Lessons for features not yet built are listed but locked. Progress is kept in the browser
(per viewer).

Implementation (#39): a *Learn* tab (`ui/learn.js`, lessons in `js/learn/lessons.js`). Available:
lessons 1–7 and 10 on the #38 topics (1 and 2 on `factorial`, 3 on `factorial`/hard with power on
the Design step, 4 `fraction`, 5 `screening`, 6 `blocking`, 7 `rsm`, 10 `split-plot`); 8, 9, 11, 12
and 13 are locked until their exercise topics exist (the features are built). While a study carries
an exercise, a banner above the steps shows the task, budget, hints (`hints(lesson, exercise,
study)`: no design yet; over budget; unblocked days; no whole plots; no curvature for an optimum;
an unresolved resolution III fraction; runs without results), **Get results** (the sealed truth via
`runExercise`) and **Answer and grade** (a form for each question, prefilled from the standard
analysis if asked; or grade the standard analysis directly). Feedback: score per question, the
truth, the model answer; lesson 1 adds the one-factor-at-a-time score on the same process.
Progress: best score per lesson in `localStorage` (`aikidoe:learn`, guarded). Links:
`index.html#lesson=ID&difficulty=D&seed=S`, also on hash change. Tested (`tests/ui/learn.mjs`,
in CI): for every available lesson and two exercises each, the reference strategy driven through
the UI — design chosen on the Design step, results, the fold-over as a next stage — produces the
reference design and gets 100; hints, the answer form, progress and locked lessons; every manual
link in the lesson texts resolves (manual tests). **Tested:** for each lesson and a range of seeds and difficulties, the reference
strategy solves the generated exercise and the grader gives it full marks; a deliberately poor
strategy (one-factor-at-a-time, ignoring blocks) scores lower; generation is reproducible from
the seed.

### 16.3 Guidance for AI agents (#37, #40)

So that an agent (Claude or another) can use aikidoe to help a user explore a new problem —
eliciting it, choosing designs, producing run sheets, analysing results and deciding the next
stage — without being taught the tool each time:

- **Skill:** `skills/aikidoe/SKILL.md` in the Agent Skills format (front matter `name`,
  `description`; instructions in the body; reference files beside it), loadable by any agent
  that supports skills and readable as plain Markdown by any that do not. Contents:
  - *When to use it* and what aikidoe does and does not do (§14).
  - *Workflow:* elicit → define the study → recommend designs (with run counts, aliasing and
    power) → agree one with the user → run sheet → import results → analyse → reduce → next
    stage or confirmation → report; the study file is the record of every step.
  - *Elicitation checklist:* objective (screen / model / optimise / robustness / measurement),
    responses and how they are measured (sites, wafers, repeat readings, gauge capability),
    factors with ranges and units, which are hard to change, known constraints and dangerous
    combinations, budget in runs and in time, expected noise or earlier data, likely
    interactions or curvature, nuisance sources (days, tools, lots).
  - *Decision guide:* a table from situation to design family and options, mirroring the
    recommender.
  - *Recipes:* CLI command sequences for the common paths, with `--json` output to parse.
  - *Rules:* never invent or "fill in" results — results come from the user (or a virtual
    process clearly labelled as simulation); keep randomisation; check estimability and power
    before recommending a design; say what is aliased; prefer sequential experimentation; give
    intervals, not just point estimates; hand decisions with cost or safety implications back to
    the user.
  - *References:* the generated CLI and study-format pages (§16.1), and the manual.
- **Machine-readable CLI:** every command accepts `--json` and then writes a single JSON object
  (with a `schema` version) to stdout instead of tables; errors as `{ error: { message, … } }`
  with a non-zero exit code. `doe schema` prints the JSON Schema of the study file;
  `doe recommend STUDY [--goal screen|model|optimise] [--budget N]` returns the ranked design
  options of the UI's recommender (§12) with their reasons, run counts, resolution / efficiency
  and power. These are equally useful for scripting.
- Implementation (#37):
  - `--json` on every command: `{ schema: "aikidoe-cli/1", command, ok: true, …results, text: [notes] }`; the notes are what the command would have printed (warnings and explanations included), so nothing is lost. Errors: `{ ok: false, error: { message, errors? } }` with exit code 1 (2 for an unknown command). NaN and ±∞ are written as null.
  - Schemas (JSON Schema 2020-12), published at `schema/`: `study.schema.json` (the study file; the semantic rules a schema cannot express — high > low, distinct ids, settings that match the factors, whole-plot consistency, linear constraints… — are listed in its `$comment` and enforced by `validateStudy`) and `cli.schema.json` (the envelope, and each command's results selected by `command`). `doe schema [--cli]` prints them. A small validator (`js/jsonschema.js`, the subset the schemas use) checks them in the tests: every command's `--json` output; every example and every study file the CLI tests write; a corpus of 33 structurally invalid studies rejected by both the schema and `validateStudy`.
  - Recommender (`js/design/recommend.js`, shared by `doe recommend` and the Design step's Recommend button): goals *screen* (main effects), *model* (main effects and 2fis) and *optimise* (full quadratic; 2fi when no factor is continuous); default screen for ≥ 5 factors, else model. Each candidate (§5; the optimal design searched for the goal's model at the budget, else p + 6 runs; Latin hypercubes only for a study with a simulator) is built and assessed: estimable (the model matrix has full rank), runs against the budget, resolution, D-efficiency, and the smallest power over the model's terms at Δ = 2σ (split-plots: GLS with η = 1). Ranked: estimable and within budget first; then power ≥ 0.8 (fewest runs first) before underpowered (most power first); then D-efficiency. Each option carries reasons and warnings (aliasing, saturation, too few whole plots, over budget, ignores hard-to-change factors).
- **Discovery:** `llms.txt` at the site root pointing to the skill, the manual and the reference
  pages.
- **Optional:** an MCP server (`tools/mcp.mjs`) exposing the same commands as tools, for agents
  without a shell; a thin wrapper over the CLI's JSON mode.
- Implementation (#40): `skills/aikidoe/SKILL.md` (front matter `name`, `description`; when to use,
  setup, workflow, rules, references) with `references/elicitation.md`, `decisions.md` (the
  recommender's logic as a table), `recipes.md` (six paths, 17 commands, outputs as run) and the
  generated `cli.md` and `study-format.md` (`tools/gen-manual.mjs` writes both copies, with links
  adjusted). `llms.txt` at the root (and on Pages, with `skills/`). `tools/mcp.mjs`: MCP over stdio
  (JSON-RPC 2.0 per line; `initialize`, `tools/list`, `tools/call`, `ping`), one tool per command
  (`doe_fit`, …) taking `{ args: [strings] }`, returning the command's `--json` object as text and
  `structuredContent`, `isError` when `ok` is false; files in `--cwd`. `tools/agent-eval.mjs prepare
  | score` and `docs/agent-eval.md` for the evaluation (class-mode exercises, briefs for the
  simulated user, a score table). `tests/skill.test.mjs`: front matter, links, generated
  references, recipes, llms.txt, the MCP server, the harness.
- **Tested:** every recipe in the skill is executed in CI; the reference files are regenerated and
  diffed. Not in CI (needs a model): an evaluation in which an agent with only the skill solves
  generated exercises (§16.2) through a simulated user, scored by the exercise grader — the same
  virtual processes serve as the benchmark.

