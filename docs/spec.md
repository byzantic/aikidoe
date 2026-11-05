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
  | `js/model/*.js` | model formula, model matrix, OLS, REML (§6, §7) |
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
| Regular fractional 2^(k−p) | generators chosen from minimum-aberration catalogue (k ≤ 15, up to 128 runs); user generators allowed; defining relation, resolution, full alias table to 2- or 3-factor interactions | #5 |
| Fold-over | full and single-factor, for de-aliasing (U7) | #11 |
| Plackett–Burman | N = 12, 20, 24, 28, … 48; partial alias (correlation) table | #5 |
| Definitive screening (DSD) | Jones–Nachtsheim conference-matrix construction, 2k+1 (or 2k+3) runs; categorical 2-level extension | #10 |
| CCD | circumscribed / inscribed / face-centred; α for rotatability or orthogonal blocking | #9 |
| Box–Behnken | k = 3…7 standard tables | #9 |
| D-, I-optimal | coordinate exchange over a candidate set or continuous region, linear constraints, fixed runs to augment, multiple random starts; reports D-, A-, G-efficiency and the fraction-of-design-space (FDS) curve | #10 |
| Split-plot | from a factorial or optimal design: htc factors grouped into whole plots; optimal split-plot by coordinate exchange on the GLS information matrix with an assumed variance ratio η | #14 |
| Latin hypercube | maximin, for simulators (U6) | #20 |
| Gauge R&R layout | parts × operators × repeats, crossed or nested | #17 |

**Randomisation.** Complete randomisation by default; restricted when there are whole plots (randomise whole-plot order, then sub-plot order within each) or blocks. The run sheet always states which randomisation was used, so the analysis can match it.

**Design diagnostics, shown before running:** alias / correlation matrix of model terms, power for a stated effect size and σ (§6.4), variance inflation factors, prediction-variance profile.

## 6. Analysis

### 6.1 Model specification

Formula language similar to R/Wilkinson notation in coded factor ids: `Rs ~ (T + t + amb + dose)^2 + I(T^2)`. Shortcuts: `main`, `2fi`, `quadratic`. Hierarchy is maintained by default when terms are removed.

### 6.2 Fixed-effects fit (OLS)

- Coefficients, SE, t, p; ANOVA (sequential and partial / Type II–III for unbalanced data); R², adjusted and predicted R² (PRESS); lack-of-fit test when there are replicates.
- **Unreplicated 2-level screening:** half-normal plot of effects, Lenth's pseudo-standard error with the t-like margin of error (ME) and simultaneous margin (SME).
- **Residual diagnostics:** residual vs fitted, normal plot, residual vs run order (drift in the tool), leverage, Cook's distance.
- **Box–Cox** suggestion for positive responses.

### 6.3 Model reduction

Stepwise by p-value or AICc with hierarchy preserved; the user always sees and can override the chosen model.

### 6.4 Power

Power to detect an effect of size Δ given σ (or Δ/σ) for each term in the chosen model, by the non-central t / F. Shown at design time, before money is spent.

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
- per-wafer summaries (mean, standard deviation, range/mean, log s) as derived responses for robust design (§8).

Per-die wafer maps are out of scope for v1 (§14) but the observation format (§4.2) already allows any number of sites.

### 7.3 REML

- Linear mixed model y = Xβ + Σ Z_k u_k + ε, u_k ~ N(0, σ_k² I).
- Fixed effects profiled out; variance components optimised on the log scale (Newton with analytic gradient, Nelder–Mead fallback); boundary estimates (σ_k² = 0) reported as such, not as failure.
- Output: variance components with approximate CIs, fixed-effect estimates by GLS, and tests with **Kenward–Roger** denominator degrees of freedom (the accepted standard for split-plot analysis). Containment df are given first, as the first milestone; KR follows.
- A naive OLS fit of a split-plot experiment is shown side by side on request, to show what restricted randomisation does to whole-plot standard errors.

### 7.4 Boat / slot position

Furnace boat or cassette slot can be entered per wafer and used as a fixed covariate or block — load-end effects are common and otherwise confound with treatments.

## 8. Multiple responses and robust design

- **Desirability** (Derringer–Suich): per-response goal (maximise / minimise / target / in range), weights and importance; overall D maximised over the fitted models, with constraints.
- **Overlay / sweet-spot plots** of feasible regions for 2 factors at a time.
- **Dual response (mean and variance):** model log s (within-wafer or replicate standard deviation) alongside the mean, then optimise e.g. "mean on target, minimise s".
- **Propagation of error:** with tolerances on continuous factors, variance transmitted through the fitted surface (σ_y² ≈ Σ (∂f/∂x_i)² σ_i² + σ²), so settings can be chosen on a flat part of the surface.
- **Prediction profiler:** interactive slices of every response vs each factor, with confidence bands.

## 9. Measurement systems analysis (gauge R&R)

- Crossed (parts × operators × repeats) and nested designs.
- ANOVA method with variance components: repeatability, reproducibility, operator × part, part-to-part; %contribution, %study variation, %tolerance; number of distinct categories (ndc).
- Also for a single instrument with no operators (repeatability only), common in fabs where the tool is automated.
- Recommended before any experiment whose effects of interest are near the measurement noise; the planner links σ_meas into the power calculation (§6.4).

## 10. Simulator adapters and yield

- **Adapter interface:** `factors()` (with ranges and tolerances), `run(settings) → {response: value}`, possibly async; batching allowed.
- **comb-over adapter:** factors from `.param … tune` lines and substrate parameters (εr, h, t, etch bias); responses are named scalar metrics computed from S-parameters (e.g. |S21| at f0, min directivity over a band, f at |S11| minimum). Lives in aikidoe; imports comb-over as a module.
- **Workflow:** space-filling or RSM design → run simulator → fit surrogate (quadratic RSM; option of Gaussian-process / kriging later) → cross-validated error → global sensitivity (Sobol first-order and total indices on the surrogate) → **Monte Carlo yield** against spec limits with the stated tolerance distributions (normal, uniform, truncated), with a confidence interval on yield and a check of a sample of points on the real simulator.
- Yield is reported with the surrogate's own error stated; if cross-validated error is comparable to the spec margin, aikidoe says the yield estimate is not trustworthy.

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

A manual with worked examples (`docs/manual.md`, `docs/examples/`) is part of the deliverable, as in comb-over. Examples should include at least: a 2^(5−1) screening experiment from a textbook, a furnace split-plot, a gauge R&R study, and a comb-over coupler yield study.

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
| M6 Docs | manual and worked examples, report export |
