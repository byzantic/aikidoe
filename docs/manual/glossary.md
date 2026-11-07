# Glossary

**Alias** — two effects a fraction cannot tell apart; their estimates are the same combination of
the runs. See [aliasing and resolution](concepts.md#aliasing-and-resolution).

**Axial points** — runs at ±α on one factor's axis, the others at the centre; with a factorial and
centre points they make a central composite design.

**Block** — a group of runs that may differ systematically from other groups (a day, a batch, a
stage); the design and analysis account for it.

**Centre point** — a run at the middle of every continuous factor's range.

**Coded units** — each continuous factor scaled so its range runs from −1 to +1.

**Confirmation run** — a run at settings chosen from a model, to check its prediction.

**Defining relation** — the set of words (products of factors) equal to the identity in a regular
fraction; it gives every alias.

**Desirability** — a 0–1 score of how acceptable a response value is; the overall desirability
combines several responses.

**Edge effect** — wells on the outer ring of a microplate reading differently from the inner
wells (evaporation, temperature). See [microplates](plates.md).

**Effect** — the change in a response from a factor's low to its high setting (twice the coded
coefficient).

**Fold-over** — a second fraction with signs reversed, run to separate aliased effects.

**Generator** — the rule defining an added factor's column in a fraction, e.g. `E = ABCD`.

**Hard-to-change factor** — a factor set once for a group of runs (a whole plot).

**Hierarchy** — a model is hierarchical if every interaction or power comes with the terms it is
made of.

**Kenward–Roger** — a method for standard errors and degrees of freedom of fixed effects in a mixed
model, accurate in small samples.

**Lack of fit** — the part of the residual variation that replicates show the model cannot
explain.

**Lenth's method** — judging effects in an unreplicated two-level design from the spread of the
effects themselves.

**Mixed model** — a model with fixed effects (the factors) and random effects (whole plots, runs,
wafers) for nested sources of variation.

**Plate layout** — which run goes in which well of a microplate; a balanced layout keeps the
effects clear of plate, edge and row and column differences. See [layouts](plates.md#layouts).

**Power** — the probability that a test detects an effect of a given size.

**Prediction interval** — the range in which one new observation is expected to fall (wider than
the confidence interval for the mean).

**Pure error** — variation between replicate runs: the run-to-run noise free of model error.

**Randomisation** — doing the runs in a random order, so that unknown trends do not masquerade as
effects.

**REML** — restricted maximum likelihood: the standard way to estimate variance components.

**Replicate** — an independent repeat of a run, set up again from scratch (not a repeated
measurement of the same run).

**Resolution** — the length of the shortest word in a fraction's defining relation: III, IV, V …

**Response** — what is measured.

**Split-plot** — a design in which hard-to-change factors are set once per whole plot and the
others vary within it.

**Surrogate** — a model fitted to a simulator's runs, used in its place for fast prediction.

**Tolerance** — the spread of a factor's actual value about its setting.

**Whole plot** — a group of runs sharing the settings of the hard-to-change factors.

**Yield** — the fraction of units meeting every specification.

**Z′ factor** — the assay window from the positive and negative controls,
1 − 3(σ₊ + σ₋)/|μ₊ − μ₋|; 0.5 or more is excellent. See [microplates](plates.md#controls).
