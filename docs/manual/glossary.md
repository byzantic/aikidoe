# Glossary

**Alias** — two effects a fraction cannot tell apart; their estimates are the same combination of
the runs. See [aliasing and resolution](concepts.md#aliasing-and-resolution).

**Adjusted mean** — the mean response at one level of a factor with the covariates (and the other
factors) held at the same values for every level; also called an estimated marginal mean or
least-squares mean. See [Adjusted means](analysis.md#adjusted-means).

**ANCOVA** (analysis of covariance) — the analysis of an experiment with a
[covariate](analysis.md#covariates) in the model beside the factors.

**Axial points** — runs at ±α on one factor's axis, the others at the centre; with a factorial and
centre points they make a central composite design.

**Balanced allocation** — giving the units (animals, flasks, wafers) to the runs so that a
covariate known in advance is uncorrelated with the factors' effects, instead of leaving it to
chance. See [Covariates known in advance](analysis.md#covariates-known-in-advance).

**Block** — a group of runs that may differ systematically from other groups (a day, a batch, a
stage); the design and analysis account for it.

**Centre point** — a run at the middle of every continuous factor's range.

**Coded units** — each continuous factor scaled so its range runs from −1 to +1.

**Confirmation run** — a run at settings chosen from a model, to check its prediction.

**Covariate** — a variable measured at each run but not set (a starting weight, the room
temperature). In the model it explains part of the scatter, and the factors' effects are compared
at the same value of it. See [Covariates](analysis.md#covariates).

**Cox direction** — in a mixture, the line along which one component changes while the others keep
their proportions to each other; the traces of the response along it show each component's effect.
See [analysis](designs-mixture.md#analysis).

**Deviance** — for counts and proportions, twice the log-likelihood lost against a model that fits
every run exactly: the analogue of the residual sum of squares. A term's drop in deviance is its
likelihood-ratio χ². See [counts and proportions](analysis.md#counts-and-proportions).

**Defining relation** — the set of words (products of factors) equal to the identity in a regular
fraction; it gives every alias.

**Desirability** — a 0–1 score of how acceptable a response value is; the overall desirability
combines several responses.

**EC50** — the dose giving half the full effect of a dose–response curve, half way between its
asymptotes. See [dose–response](dose-response.md).

**Edge effect** — wells on the outer ring of a microplate reading differently from the inner
wells (evaporation, temperature). See [microplates](plates.md).

**Effect** — the change in a response from a factor's low to its high setting (twice the coded
coefficient).

**Extrapolation** — predicting from a fitted model at settings beyond the runs: outside the
region they cover (their convex hull), or where its prediction variance is larger than at any run.
See [Beyond the runs](optimisation.md#beyond-the-runs).

**Extreme vertices** — the corners of a mixture region cut by the components' limits; with the
centroids of its edges and faces, a design for constrained mixtures. See
[constrained regions](designs-mixture.md#constrained-regions).

**Fold-over** — a second fraction with signs reversed, run to separate aliased effects.

**Generalised linear model (GLM)** — a linear model for a transform of the mean (the log of a count,
the log-odds of a proportion) with the noise of the data (Poisson, binomial …), fitted by maximum
likelihood. See [counts and proportions](analysis.md#counts-and-proportions).

**Generalised resolution** — for a non-regular design such as a Plackett–Burman, a resolution
between the whole numbers: 3.67 for 12 runs, where main effects are only partially aliased with
two-factor interactions (3 would be complete aliasing). See
[screening designs](designs-screening.md#plackettburman).

**Generator** — the rule defining an added factor's column in a fraction, e.g. `E = ABCD`.

**GLMM** (generalised linear mixed model) — a model for counts or proportions with random
effects, such as a shift per whole plot on the log or logit scale
([random effects for counts](analysis.md#random-effects-for-counts-and-proportions)).

**Hard-to-change factor** — a factor set once for a group of runs (a whole plot).

**Hierarchy** — a model is hierarchical if every interaction or power comes with the terms it is
made of.

**Kenward–Roger** — a method for standard errors and degrees of freedom of fixed effects in a mixed
model, accurate in small samples.

**Lack of fit** — the part of the residual variation that replicates show the model cannot
explain.

**Lenth's method** — judging effects in an unreplicated two-level design from the spread of the
effects themselves.

**Mixture** — factors that are shares of a whole and add up to a fixed total; they cannot be varied
independently. See [mixture designs](designs-mixture.md).

**Mixed model** — a model with fixed effects (the factors) and random effects (whole plots, runs,
wafers) for nested sources of variation.

**Nested random effects** — groupings inside groupings, each with its own random shift: whole
plots within days, plates within runs. Each factor is judged against the variation at the level
where it changes ([random effects for counts](analysis.md#random-effects-for-counts-and-proportions)).

**Odds ratio** — with a logit link, e^b: the factor by which the odds of success change per coded unit.

**Overdispersion** — counts or proportions varying more than the Poisson or binomial allows
(Pearson χ²/df well above 1); remedied by the negative binomial or a quasi-likelihood model.

**Parallel curves** — dose–response curves of the same shape shifted along the log-dose axis; the
condition for a single relative potency. See [relative potency](dose-response.md#relative-potency).

**Plate layout** — which run goes in which well of a microplate; a balanced layout keeps the
effects clear of plate, edge and row and column differences. See [layouts](plates.md#layouts).

**Projectivity** — the largest P such that any P factors of a design form a full two-level
factorial: if only P factors matter, their interactions can be estimated from the same runs
(resolution R gives R − 1; Plackett–Burman designs 3). See
[projectivity](designs-screening.md#projectivity).

**Pseudo-component** — a mixture component rescaled to its share of what is left above the lower
limits: zᵢ = (xᵢ − Lᵢ) / (total − ΣL), from 0 to 1. See
[pseudo-components](designs-mixture.md#pseudo-components).

**Power** — the probability that a test detects an effect of a given size.

**Prediction interval** — the range in which one new observation is expected to fall (wider than
the confidence interval for the mean).

**Pure error** — variation between replicate runs: the run-to-run noise free of model error.

**Randomisation** — doing the runs in a random order, so that unknown trends do not masquerade as
effects.

**Rate ratio** — with a log link, e^b: the factor by which the mean count (per unit exposure)
changes per coded unit.

**REML** — restricted maximum likelihood: the standard way to estimate variance components.

**Relative potency** — how many times less of a test compound gives the same effect as a reference:
EC50 of the reference ÷ EC50 of the test. See [relative potency](dose-response.md#relative-potency).

**Replicate** — an independent repeat of a run, set up again from scratch (not a repeated
measurement of the same run).

**Resolution** — the length of the shortest word in a fraction's defining relation: III, IV, V …

**Response** — what is measured.

**Scheffé model** — a polynomial for a mixture without an intercept (it is absorbed in the linear
terms): Σ βᵢ zᵢ, plus blending terms βᵢⱼ zᵢ zⱼ (quadratic) and so on. See
[Scheffé models](designs-mixture.md#mixture-models).

**Separation** — a factor setting giving only successes (or only failures), so the fitted odds
there are infinite; Firth's penalised likelihood gives finite estimates.

**Split-plot** — a design in which hard-to-change factors are set once per whole plot and the
others vary within it.

**Stationary point** — where a fitted second-order surface is flat: a maximum, a minimum or a
saddle, read from the signs of the canonical eigenvalues. See [fitted response](analysis.md#fitted-response).

**Stratum** — the level of a design at which a factor changes (between days, between whole plots
within a day, within whole plots), and so the variation it is judged against.

**Scaled prediction variance** — N · Var(ŷ)/σ² at given settings: how precisely a design predicts
there, before any run is made. See [prediction variance](concepts.md#prediction-variance).

**Surrogate** — a model fitted to a simulator's runs, used in its place for fast prediction.

**Tolerance** — the spread of a factor's actual value about its setting.

**Tukey's method** — comparing every pair of a factor's levels with intervals and p values that
allow for all the comparisons at once (the studentized range), so that many comparisons do not
give many chances of a false alarm. See [Adjusted means](analysis.md#adjusted-means).

**Variance dispersion graph** — the smallest, average and largest scaled prediction variance at
each distance from the centre of a design: one picture to compare response-surface designs.

**Whole plot** — a group of runs sharing the settings of the hard-to-change factors.

**Yield** — the fraction of units meeting every specification.

**Z′ factor** — the assay window from the positive and negative controls,
1 − 3(σ₊ + σ₋)/|μ₊ − μ₋|; 0.5 or more is excellent. See [microplates](plates.md#controls).
