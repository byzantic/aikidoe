# Issue drafts

Filed by `tools/file-issues.py`. Each `## ` heading is `slug | title | milestone | labels`. In bodies, `#slug` is replaced by the filed issue number. § refers to docs/spec.md.

## harness | Test harness, reference fixtures and CI | M1 Core | infra
Set up `npm test`, a tiny assertion helper (tolerance compare of numbers / arrays / objects), and the fixture convention of spec §13: `tests/ref/*.py|*.R` generate `tests/fixtures/*.json`; tests read only the JSON.

- GitHub Actions: Node LTS, `npm test` on push/PR.
- Scheduled job (weekly) that installs R + Python deps, regenerates fixtures, and fails on diff.
- `package.json` with `"type": "module"`, no runtime deps.

**Done when:** a trivial fixture round-trips through both jobs.

## linalg | Dense linear algebra | M1 Core | core
`js/linalg.js` (§3): Householder QR with column pivoting and rank detection, Cholesky (with jitter option), symmetric eigendecomposition (Jacobi or tridiagonal QL), triangular solves, log-determinant, pseudo-inverse via QR.

- Rank-deficient model matrices must be detected and reported by term, not silently fitted (aliased terms in fractional designs).

**Done when:** matches numpy to 1e−10 on random and ill-conditioned (Hilbert, n ≤ 10) cases.

## dist | Distributions | M1 Core | core
`js/dist.js`: normal, t, F, χ² cdf and quantile; non-central t and F cdf (for power, #power); studentised range (for Tukey, optional).

**Done when:** matches scipy.stats to 1e−10 relative over a grid incl. tails (p down to 1e−12), df from 1 to 1e4.

## study | Study data model, coding and JSON | M1 Core | core
`js/study.js` implementing §4: factors (continuous / categorical, transform, htc), responses, constraints (parse linear expressions), runs, long-format observations, history; versioned JSON load/save with upgrade hook; coded ↔ natural conversion (§4.3); validation with readable errors.

**Done when:** example study in §4 round-trips; coding of log-transformed factors verified.

## design-core | Factorial, fractional factorial and Plackett–Burman designs | M1 Core | design
Spec §5.

- Full 2^k and mixed-level factorials; centre points; replicates; blocking by confounding chosen interactions.
- Regular 2^(k−p): minimum-aberration generator catalogue for k ≤ 15, N ≤ 128; user-supplied generators; defining relation, resolution, word-length pattern; alias table to chosen order.
- Plackett–Burman N = 12…48 with correlation (partial alias) table.
- Randomisation: complete, blocked; seeded (§3).

**Done when:** generators, word-length patterns and alias chains match R `FrF2` for all catalogue entries with N ≤ 64; PB matrices match published tables.

## ols | Model formula, OLS fit, ANOVA, Lenth | M1 Core | analysis
Spec §6.1–6.2.

- Formula parser (`~`, `+`, `:`, `*`, `^n`, `I()`, `main`/`2fi`/`quadratic`), hierarchy rules, model-matrix builder with effect coding.
- OLS by QR: coefficients, SE, t, p, ANOVA (sequential and Type II/III), R², adj R², pred R² (PRESS), lack of fit with pure error.
- Lenth PSE, ME, SME; half-normal plot data.
- Diagnostics: residuals, studentised residuals, leverage, Cook's D, residual vs run order; Box–Cox profile.

**Done when:** matches R `lm` / `car::Anova` to 1e−8 on ≥ 10 datasets incl. unbalanced and with categorical factors; Lenth (1989) example reproduced.

## io | Run sheets and results import | M1 Core | io
Spec §11.

- Run sheet CSV and printable HTML in execution order, whole plots / blocks grouped, blank result columns.
- Results import: long and wide CSV, column mapping, checks against plan (unknown/missing runs, wafers, sites; non-numeric; outliers flagged not dropped).

**Done when:** round-trip plan → sheet → filled sheet → observations is lossless on the example studies.

## cli | Command-line front end | M1 Core | io
`tools/doe.mjs`: `design` (write study + run sheet), `import`, `fit` (print ANOVA / coefficients), `alias`. Same core as the UI.

**Done when:** a 2^(5−1) screening example can be planned, imported and analysed end to end from the shell; documented in README.

## rsm | Response surface designs: CCD and Box–Behnken | M2 Screening & RSM | design
Spec §5: CCD (circumscribed, inscribed, face-centred; α rotatable / orthogonal-blocking; fractional cube portion), Box–Behnken k = 3…7; centre-point recommendations; prediction-variance profile.

**Done when:** matches R `rsm::ccd` / `bbd` designs and α values.

## dsd-optimal | Definitive screening and D/I-optimal designs | M2 Screening & RSM | design
Spec §5.

- DSD via conference matrices (k ≤ 30), +2 fake factors option, 2-level categorical extension.
- Coordinate exchange for D- and I-optimality over a continuous region with linear constraints (#study) or a candidate set; fixed runs; restarts; seeded.
- Diagnostics: D/A/G-efficiency, FDS curve, correlation map.

**Done when:** DSDs match published tables; optimal designs reach ≥ 99 % of the D/I-efficiency of R `skpr` on 6 benchmark problems (incl. a constrained region).

## augment | Sequential augmentation and confirmation | M2 Screening & RSM | design
U7, spec §5 and §12 step 6: full and single-factor fold-over; adding axial points to a factorial; optimal augmentation (#dsd-optimal with fixed runs); confirmation runs with prediction intervals; stages recorded in `history` with a block term added automatically.

**Done when:** a 2^(5−2) → fold-over → CCD sequence is reproducible from one study file and the block effect is in the model.

## power | Power and model reduction | M2 Screening & RSM | analysis
Spec §6.3–6.4: per-term power from non-central t/F (#dist) for given Δ/σ, α; uses σ_meas from #msa if present; stepwise reduction (p-value or AICc) preserving hierarchy, always user-overridable.

**Done when:** power agrees with R `skpr` / `pwr` on factorial and RSM examples to 1e−4.

## ui-shell | Browser UI: Define, Design, Run, Analyse | M2 Screening & RSM | ui
Spec §12 steps 1–4 on top of M1 core: factor/response editor, design chooser with side-by-side diagnostics and a simple recommender, run sheet export, results import, ANOVA / effects / half-normal / residual plots (SVG). Study saved to file and to URL fragment when small.

**Done when:** the M1 screening example is doable entirely in the browser.

## split-plot | Split-plot designs | M3 Process | design, process
Spec §5, §7.

- From factorials: assign htc factors to whole plots, with whole-plot fractionation (minimum aberration split-plot, Bingham–Sitter).
- Optimal split-plot by coordinate exchange on the GLS information matrix for an assumed η = σ²_wp/σ²; user sets number of whole plots and runs per whole plot.
- Restricted randomisation; run sheet grouped by whole plot.

**Done when:** reproduces Montgomery ch. 14 and Jones–Nachtsheim (2009) examples; optimal split-plot D-efficiency within 1 % of `skpr`.

## reml | REML mixed models and variance components | M3 Process | analysis, process
Spec §7.1, §7.3.

- Nested random effects (whole plot, lot, wafer, site/residual); fixed effects by GLS.
- Profiled REML, log-variance parametrisation, analytic gradient Newton + Nelder–Mead fallback, boundary handling.
- Containment df first; then Kenward–Roger.
- Variance-component CIs (profile or Satterthwaite).
- Side-by-side naive OLS on request.

**Done when:** matches `lme4` estimates to 1e−5 and `pbkrtest` KR df to 1e−3 on balanced and unbalanced split-plot and nested datasets (≥ 8 cases).

## sites | Drop-in sites, positional effects, boat slot | M3 Process | process
Spec §7.2, §7.4.

- Site schemes (5- and 9-site presets plus custom (x, y)); radius derived.
- Site as random effect, or position as fixed effects (centre/edge, r²); per-wafer summary responses (mean, s, log s, range/mean).
- Boat/cassette slot as covariate or block.
- Simple wafer plot of site values (dots at positions), not a full map.

**Done when:** a worked furnace example shows a radial term detected and wafer/site variance components reported.

## msa | Gauge R&R | M3 Process | analysis, process
Spec §9: crossed and nested studies, ANOVA method, %contribution, %SV, %tolerance, ndc; repeatability-only mode; σ_meas exported to #power.

**Done when:** AIAG MSA manual example reproduced; agrees with R `SixSigma::ss.rr`.

## desirability | Desirability and prediction profiler | M4 Optimise | analysis, ui
Spec §8: Derringer–Suich desirability with weights/importance, constrained optimisation (multi-start Nelder–Mead / coordinate search) over fitted models; overlay plot for 2 factors; interactive profiler with confidence bands.

**Done when:** matches R `desirability` on its vignette examples.

## robust | Dual response and propagation of error | M4 Optimise | analysis, process
Spec §8: model mean and log s together; optimise "on target, minimum s"; propagation of error from factor tolerances through the fitted surface; POE surface plot.

**Done when:** a worked example reproduces a published dual-response result (Vining–Myers 1990 or Montgomery ch. 12).

## sim-adapter | Simulator adapter, surrogates, sensitivity, yield | M5 Simulation | simulation
Spec §10: adapter interface (async, batched); maximin Latin hypercube; quadratic surrogate with cross-validation; Sobol first-order and total indices on the surrogate; Monte Carlo yield with tolerance distributions, CI on yield, spot-check on the real simulator; trust warning when surrogate error ~ spec margin.

**Done when:** Sobol indices of the Ishigami function within 1 % of analytic; yield on an analytic test function matches direct MC within its CI.

## combover | comb-over adapter | M5 Simulation | simulation
Spec §10: factors from `tune` params and substrate parameters (εr, h, t, etch bias) with tolerances; response metrics as small expressions over S-parameters; worked example: 10 dB coupler on RO4350B, yield of coupling 10 ± 0.5 dB and directivity > 15 dB against etch and εr tolerance.

**Done when:** the example runs from the CLI and UI; a sample of surrogate predictions agree with direct comb-over runs within stated CV error.

## docs | Manual, worked examples and report export | M6 Docs | docs
Spec §11–12: `docs/manual.md` and examples (2^(5−1) screening from a textbook; furnace split-plot with drop-in sites; gauge R&R; comb-over coupler yield); self-contained HTML report export; doc build check in `npm test`, as in comb-over.

**Done when:** every example is executable and its numbers are checked by the test suite.
