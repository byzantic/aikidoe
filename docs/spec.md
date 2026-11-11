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

### 4.2a Covariates (#82)

Variables that are measured but not set (a starting weight, the room temperature, the passage number of the cells, the incoming film thickness): `covariates: [{ id, name, units?, note?, values: [{ run, value, lot?, wafer?, site? }] }]`, numeric, with ids distinct from factors and responses (and from the words formulas reserve). A value belongs to a run, or to one wafer (lot, site) of it. They are kept apart from the observations, so that "has results" is about responses only; a new design clears the values and keeps the covariates. Entered in a column of their own on the run sheet (a wafer's row holds the wafer's value), read back by the results import (wide: the column; long: the id in the response column; two different values for one run and wafer are an error).

**In models** (`js/model/covariates.js`, phase 1): a covariate named in a formula is a term like a factor — linear, and in interactions with factors on request; the shortcuts `main`, `2fi`, `quadratic` are over the factors only. Its value for a row is the mean of the run's values for a model of run means, and the most specific match (the wafer's own before the run's) for a model of individual readings. It is coded (x − mean) / ((max − min) / 2) over the rows used: the intercept and the other terms are then at the average covariate — the adjusted effects, also when it interacts with a factor — and its coefficient is on the footing of a factor's; the slope per unit is coefficient / half-range, reported with its standard error. Rows without a value are left out and named. A prediction without a value is at the mean (coded 0), so the profiler, contours, optimisation, surrogates and reports need no change. Least squares, GLMs, REML (Kenward–Roger) and GLMMs all take covariates through the same step. Checked against R (`tests/ref/covariate_r.R`): `lm` coefficients, standard errors and the slope on the covariate as measured, `car::Anova` types II and III (with and without a covariate × factor interaction, continuous and three-level categorical factors), `predict.lm` intervals at covariate values and at the mean, `na.omit`, a Poisson `glm` with likelihood-ratio tests, and `lme4` + `pbkrtest` with a covariate per wafer and per run. **Adjusted means and equal slopes** (`js/model/adjusted.js`, phase 2): emmeans' reference grid — the factor at each level (continuous: low and high), other categorical factors and continuous factors run at two settings averaged with equal weight (cov.keep = "2"), other continuous factors and covariates at their mean, blocks averaged — one linear function lβ per level; least squares on the residual df, GLMs on the link scale (z, or t with estimated dispersion) back-transformed (delta-method SE), mixed models with the Kenward–Roger covariance and df per function. Pairwise comparisons Tukey-adjusted by the studentized range (`tukey` in `js/dist.js`, AS 190 as R's ptukey); ratios (log link) and odds ratios (logit). Equal slopes: the model with every factor × covariate interaction it lacks against the model, by F (least squares), likelihood ratio (GLM) or Kenward–Roger F (mixed), and each added term on its own. Checked against `emmeans`, `anova()`, `KRmodcomp` and `ptukey` (`tests/ref/adjusted_r.R`). **At the design stage** (phase 3): a note on measuring covariates before the settings can affect them (Design step, `doe design`); allocation of units to runs by a covariate known in advance (`js/design/allocate.js`: minimise R² of the covariate on the model's columns, an orthonormal basis and pairwise swaps from seeded random starts, with more units than runs allowed; within blocks on request; an order mode rearranging the runs among positions with known values, not for whole plots), stored as each run's value with its `unit` and shown on the run sheet; power with ρ (`powerFromMatrix`: residual σ√(1 − ρ²), one residual df per covariate; not yet for split-plots); and optimisation with covariates held (`fixed` takes covariate ids; the result reports them as `held`). Checked against R (`tests/ref/covariate_design_r.R`): power by `pf` with ncp and a 4000-run simulation of `lm` with the covariate; R² and the variance inflation by `lm` and `solve`.

### 4.2b Comparing treatments (#80)

**Comparisons** (`js/model/compare.js`, phase 1): `compareLevels(fit, factor, { method, control, contrasts, at })` on the reference grid of the adjusted means (`levelSystem` in `js/model/adjusted.js`), so every kind of fit (least squares, GLM on the link scale, REML with Kenward–Roger df per comparison) and covariates and blocks are handled as for adjusted means. Families: all pairs (default Tukey: Tukey–Kramer by the studentized range), against a control (default Dunnett, single step: each p on its own df, the critical value on the smallest), and contrasts parsed from text (`"(M-2 + M-3)/2 - Standard"`, weights that need not sum to zero flagged; default the multivariate t). Adjustments `tukey`, `dunnett`/`mvt`, `holm`, `bonferroni`, `none`; Holm and Bonferroni intervals are Bonferroni's (as emmeans). A compact letter display for pairs (Piepho's insert–absorb; 'a' for the largest mean). Random blocks: `RANDOM.block` in `js/model/mixed.js`, requested explicitly (`--random block`), replaces the fixed block term.

**Multivariate t** (`js/mvt.js`): P(|T_i| ≤ c, all i) for correlation R and df. Exact when R is of product form ρij = λiλj (Dunnett with equal weights or balanced models): a Gauss–Hermite integral over the common factor (80 nodes) within 64-point Gauss–Legendre over s = √(χ²/df) between its 1e−15 quantiles. Otherwise Genz's separation of variables on a randomised Kronecker lattice (1024 points × 10 shifts, antithetic, baker's transform), χ² as an extra coordinate; a singular R (dependent contrasts) folds each dependent row into the bounds of its last pivot variable (Genz & Bretz 2009). Quantiles by safeguarded secant on the probability. Checked against R (`tests/ref/compare_r.R`): `emmeans` (Tukey, Holm, Bonferroni, contrasts), Dunnett by `integrate()` of the exact product form (to 1e−9; `mvtnorm::qmvt` is accurate only to ~1e−4), contrasts by `mvtnorm::pmvt` (abseps 1e−7), letters by `multcompView`, for an unbalanced one-way layout, fixed blocks, Poisson counts and random blocks (`lme4`, Kenward–Roger).

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
| Plackett–Burman | N = 12, 20, 24, 28, 32 (cyclic, non-regular), … 48; partial alias (correlation) table; generalised resolution (Deng & Tang), projectivity (`js/design/projectivity.js`) | #5, #79 |
| Definitive screening (DSD) | Jones–Nachtsheim conference-matrix construction, 2k+1 (or 2k+3) runs; categorical 2-level extension; fake factors by default for k = 3, 4 up to order 6, 13 runs (the 9-run designs fit the quadratic in no 3 factors) | #10, #79 |
| CCD | circumscribed / inscribed / face-centred; α for rotatability or orthogonal blocking | #9 |
| Box–Behnken | k = 3…7 standard tables | #9 |
| D-, I-optimal | coordinate exchange over a candidate set or continuous region, linear constraints, fixed runs to augment, multiple random starts; reports D-, A-, G-efficiency and the fraction-of-design-space (FDS) curve | #10 |
| Split-plot | from a factorial or optimal design: htc factors grouped into whole plots; regular fractions by minimum aberration among split-plot-compatible generators (unassigned whole-plot base columns count as pseudo-factors, as in FrF2); optimal split-plot by coordinate exchange on the GLS information matrix with an assumed variance ratio η; restricted randomisation (whole plots, then runs within them); centre points and blocking of split-plots later | #14 |
| Latin hypercube | maximin, for simulators (U6) | #20 |
| Gauge R&R layout | parts × operators × repeats, crossed or nested | #17 |

**Randomisation.** Complete randomisation by default; restricted when there are whole plots (randomise whole-plot order, then sub-plot order within each) or blocks. The run sheet always states which randomisation was used, so the analysis can match it.

**Design diagnostics, shown before running:** alias / correlation matrix of model terms, power for a stated effect size and σ (§6.4), variance inflation factors, prediction-variance profile. **Where the runs are** (#88; `js/design/space.js`, SVG by `js/io/svg-space.js`, the Design step's panels and `doe plot`): a scatterplot matrix of the runs in coded units (run kinds by shape, replicates counted, blocks or whole plots coloured with the Okabe–Ito palette, constraint-infeasible areas shaded with the other factors at their centre), the scaled prediction variance N·f(x)ᵀ(FᵀF)⁻¹f(x) over two continuous factors for a chosen model (the others held at chosen coded values; runs off the slice faded; viridis fill with labelled contour lines), and the variance dispersion graph (min, mean and max over 200 directions — axes, cube diagonals, seeded random — at each radius) for designs of continuous factors, for any estimable model; for the study's own design (with augmentation stages) and for a candidate before it is created. Checked against base R's model.matrix and (FᵀF)⁻¹ (`tests/ref/space_r.R`: CCD, Box–Behnken, an irregular design, a categorical factor). Mixture designs: the ternary's three components chosen (others projected out). **The fitted response** (#88 phase 2; `js/model/surface.js`, the Analyse step's panel, the report, `doe plot --contour`): the fitted mean over two continuous factors (the others held at chosen coded values; least squares and GLMs on the response scale, REML mixed models, GLMMs for a typical group) with the runs on it — filled with their own result on the colour scale, or by residual (blue above, orange below, sized by size), faded by their distance from the slice; for a model with squares, the canonical analysis: x_s = −½B⁻¹b (coded), the fitted value there, the eigenvalues and eigenvectors of B (maximum, minimum, saddle; a near-zero eigenvalue flagged as a ridge; outside the runs flagged as an extrapolation), the two canonical axes lying most in the slice drawn. Checked against base R (`tests/ref/surface_r.R`: lm, solve, eigen — a maximum, a saddle, and a categorical shift) and against predict at the grid points.

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
user can undo or edit the result. Counts and proportions use their noise model's test (the deviance
χ², or F for quasi models) and log-likelihood; with a random effect, the GLMM's likelihood-ratio
tests (§7, `reduceGLMM`). Forward and bidirectional stepwise selection are not provided:
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

Counts and proportions (#64, phase 5; `js/model/glmm.js`): one random intercept — the whole plots of a split-plot (automatic for Poisson, binomial and pass/fail responses) or blocks (when asked) — in a GLMM, η = Xβ + offset + σz_g, z_g ~ N(0, 1). Maximum likelihood with each group's integral by adaptive Gauss–Hermite quadrature (25 nodes; 1 = Laplace), centred at the conditional mode and scaled by the Fisher weights there, as `lme4::glmer`; Newton's method over (β, σ) with a finite-difference Hessian; vcov of β from the inverse Hessian over (σ, β), as lme4's default; σ = 0 is the boundary (the GLM), tested by the likelihood ratio against ½χ²₀ + ½χ²₁. Small-sample correction (not in lme4): coefficients constant within every group get standard errors × √(m/(m − q)) and t on m − q df (m groups, q such coefficients); likelihood-ratio tests of such terms are F = χ²/df on m − q df; predictions for a typical group, averaged over groups, and a new run in a new group. Checked against `lme4::glmer` (`tests/ref/glmm_r.R`): Poisson with an exposure, binomial (logit, probit), pass/fail, and a boundary fit, at nAGQ 1 and 25. The negative binomial (#78): θ estimated with (β, σ) — Newton over (β, σ, log θ), the NB density in the integrand and its Fisher weights in the adaptive quadrature; θ's standard error from the same Hessian; at σ = 0 the fit is `glm.nb`'s. Checked against the likelihood integrated directly (`stats::integrate`, maximised by `optim`) for nAGQ 25, `glmer` with `negative.binomial(θ)` maximised over θ for Laplace (`glmer.nb`'s own outer loop stopped at a poor optimum), and `glmmTMB` (`tests/ref/glmm_nb_r.R`). Poisson GLMMs report Pearson χ² of the conditional residuals on n − p − 1 df, and flag overdispersion within groups (ratio > 1.5, p < 0.05; in simulated split-plots of 48 runs: 0 % of Poisson data sets, 97 % at θ = 3). Nested random intercepts (#78; `fitGLMM` with a list of groupings, outermost first; `randomGroupsOf` for a study's: block, wholePlot and run — the repeated observations of a run — any nested combination, crossed ones refused): η = Xβ + o + Σ_k σ_k u_k; the likelihood factorises over the outermost groups, and each one's integral over all its random effects is by the Laplace approximation (Fisher scoring to the joint mode, ½ log det of I + ΛZᵀWZΛ with the Fisher weights there), as `lme4::glmer` (nAGQ > 1 is refused, as in lme4); Newton over (β, σ_1 … σ_K, log θ); a σ below 1e-4 that is no better than 0 is set to 0 and held there for the covariance. Small-sample correction per stratum: a coefficient belongs to the outermost grouping (σ > 0) within whose groups it is constant; stratum t has u_t units (its groups less those of the active grouping outside it) and q_t coefficients, which get standard errors × √(u_t/(u_t − q_t)) and t on u_t − q_t df; likelihood-ratio tests of terms whose columns all lie in one stratum are F on its df (for one random effect, the m − q above); predictions use the outermost active stratum's t, the total σ² for the average over groups and Σ σ_k² × its scale for a new run in new groups. σ_k = 0 is tested by the fit without grouping k, against ½χ²₀ + ½χ²₁. Checked against `glmer` (`tests/ref/glmm_nested_r.R`: Poisson days ⊃ whole plots, binomial days ⊃ runs, Poisson days ⊃ whole plots ⊃ runs with a σ at 0, negative binomial with θ by `optimize`, a weak whole-plot σ): β, σ's, log-likelihood and σ tests to 1e-4, standard errors (the numDeriv Hessian of glmer's Laplace deviance over σ's and β) to 5e-4. Coverage, Poisson, 4/6/8 days of 4 whole plots of 2 runs, σ_day 0.4, σ_wp 0.3, 400 data sets each: day-level factor 91.5/92.5/94.5 % (Wald z: 73.5/81.5/87 %), whole-plot factor 95/95.8/93 %; tests under no effect, day-level 7.5/6.5/4.8 % by F (19.5/13.3/10.3 % by χ²), whole-plot 4.3/3.8/6.8 %. Not with a random effect: the quasi models (no likelihood), Firth. Model reduction (`reduceGLMM`, #78): backward elimination keeping hierarchy, each candidate refitted without the term (σ re-estimated) and dropped by the largest p of its likelihood-ratio test (F on (df, m − q) for a group-level term, as the tests) while p > 0.10, or by AICc (k = coefficients + σ, n = rows); the CLI's `--reduce` and the Analyse step's buttons (in the worker). Checked against the same elimination of `glmer` fits (`tests/ref/reduce_glmm_r.R`: a Poisson split-plot and binomial proportions in random blocks, both methods; AICc compared as the change from the start, since lme4 1.x and 2.x differ by a constant). Split-plot power for counts and proportions (`js/model/power-glmm.js`, `--sigma-wp`, the Design step's whole-plot σ): Cov(β̂) ≈ (XᵀV⁻¹X)⁻¹ with V = W⁻¹ + σ²ZZᵀ at the anticipated means (W the GLM weights, Z the whole-plot indicators); a term whose columns are all constant within whole plots has its λ from V with σ² × m/(m − q) (the small-sample correction applied to the whole-plot variance only; ML σ̂² is biased low by about (m − q)/m) and an F on (df, m − q), the others χ² with σ² as given; by simulation, fitGLMM with and without the term and the analysis's likelihood-ratio test. Against `lme4::glmer` simulations of that test (`tests/ref/power_glmm_r.R`, 500 per term) the approximation is 0.5–4.5 points low for whole-plot factors and within 2.5 points for the others. (#77 divided the whole λ by m/(m − q) instead: 2–6 points low; with no correction at all, 1–11 points high.) Nested groupings (`--sigma-block` with `--sigma-wp`): V = W⁻¹ + Σ σ_k² Z_kZ_kᵀ, block-diagonal over the outermost groups; each term's stratum and df as the analysis's, only that stratum's σ² widened by units/df; checked against `glmer` simulations (`tests/ref/power_glmm_nested_r.R`, two layouts, 400 per term): day-level factors 6.4 points low to 0.1 high, whole-plot factors 4 low to 1.6 high, factors within whole plots 3.5–5 points low. For the negative binomial, V(μ) = μ + μ²/θ in W with θ as anticipated, and the simulation draws gamma–Poisson counts and estimates θ in each fit; against glmmTMB simulations (12 whole plots of 4, θ = 4, σ = 0.4) the approximation matches for the subplot factor and is 7.6 points low for the whole-plot factor (10 with #77's λ ÷ m/(m − q), which also scaled the within-whole-plot scatter).

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
- Model reduction of mixed models: backward elimination keeping hierarchy, by Kenward–Roger p, or by AICc of maximum-likelihood fits (REML criteria are not comparable across fixed effects); the random effects stay as in the starting model. Counts and proportions with a random intercept: by likelihood-ratio p or AICc (§7, `reduceGLMM`).
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
- Implementation (#18): desirability functions as the R package `desirability` (dMax, dMin, dTarget with two shapes, dBox), from each response's goal and lower / target / upper, `weight` (shape) and `importance` (exponent in the weighted geometric mean). Optimisation over the fitted models (least squares, or the mixed model for split-plot / nested readings): Latin-hypercube screen, Nelder–Mead from the best starts projected onto the region (cube of a given half-width, or sphere — e.g. to the axial points of a CCD), coordinate polish; categorical factors enumerated; constraints respected; factors can be held. An Optimise step shows the goals, the best settings with each response's d, a profiler (responses × factors, with 95% bands; click to move a factor) and a two-factor overlay of D with the infeasible region greyed (with the runs on it, #88; `doe plot --desirability A,B` draws it as SVG, #97).

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
| Covariates (ANCOVA) | R `lm`, `car::Anova` (types II, III), `predict.lm`, `glm`, `lme4` + `pbkrtest`; adjusted means and Tukey comparisons: `emmeans`, `ptukey`; equal slopes: `anova()`, `KRmodcomp` |
| Multiple comparisons | R `emmeans` (Tukey, Holm, Bonferroni, contrasts), `mvtnorm`, `integrate()` of Dunnett's exact form, `multcompView` letters |
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
  and example links are checked; generated reference pages are regenerated and diffed. Pictures
  (#97) are generated too: a page's `![…](img/NAME.svg)` is the `NAME.svg` its console blocks
  write (`doe plot … --out NAME.svg`), kept in `docs/manual/img/` by `gen-manual --outputs` and
  diffed by the tests; the viewer inlines them so they follow the light or dark theme.

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
- Later topics, each with its own scenarios and a comparison strategy: `plate` (#63; tidy plate
  layout), `dose` (#65; evenly spaced doses), `mixture` (#62; one component at a time) and `counts`
  (#64, lesson 17): a count response (Poisson, or negative binomial when harder, with the volume
  plated as the exposure, drawn per run from 10–200 µL) or seeds germinated out of those sown
  (binomial, 10–50 seeds drawn per dish and recorded; logit-scale extra variation when harder); the truth on the link scale with ratios from low to
  high drawn by difficulty; the reference is a replicated 2^k (16 or 32 runs) with a GLM of main
  effects and two-factor interactions, the negative binomial or quasi-binomial when it shows
  overdispersion, Firth's method when separated, ratios exp(2β) with profile intervals; power by the
  Wald approximation with the actual exposures, θ, or φ = 1 + n p(1 − p) σ²; the grader judges
  each ratio on the log scale (side of 1, interval holding the truth); germination also asks the
  mean percentage at the corner nearest 0 or 100 % (half for covering the truth, half for staying in
  0–100 %); the comparison is least squares on the raw counts, or on the percentages, on the same
  design.
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
14. Plates (#63). 15. Dose–response (#65). 16. Mixtures (#62).
17. Counts and percentages: when least squares is the wrong tool (#64).

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
  - Recommender (`js/design/recommend.js`, shared by `doe recommend` and the Design step's Recommend button): goals *screen* (main effects), *model* (main effects and 2fis) and *optimise* (full quadratic; 2fi when no factor is continuous); default screen for ≥ 5 factors, else model. Each candidate (§5; the optimal design searched for the goal's model at the budget, else p + 6 runs; Latin hypercubes only for a study with a simulator) is built and assessed: estimable (the model matrix has full rank), runs against the budget, resolution, D-efficiency, and the smallest power over the model's terms at Δ = 2σ (split-plots: GLS with η = 1). Ranked: estimable and within budget first; then power ≥ 0.8 (fewest runs first) before underpowered (most power first); then projectivity; then D-efficiency. Projection (#79, `js/design/projectivity.js`): projectivity P of two-level designs (every P factors contain a full 2^P; capped at 4; regular fractions R − 1, Plackett–Burman 3 — 16 runs and the stored 40 with 39 columns 2, so neither is offered for those), the generalised resolution r + 1 − max|J_r|/N for Plackett–Burman designs (in place of resolution III), and for definitive screening whether the full quadratic in every 3 continuous factors is estimable. Plackett–Burman sizes offered: every N > k up to the budget, else the next two. After a main-effects fit of a screening design, `activeProjection` offers the 2fi model (definitive screening: the quadratic) in 2–4 active factors (p < 0.05, or Lenth's ME when saturated) when the same runs estimate it with ≥ 1 residual df. Each option carries reasons and warnings (aliasing, saturation, too few whole plots, over budget, ignores hard-to-change factors).
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

