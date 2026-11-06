# Split-plot designs

Some factors are **hard to change**: a furnace temperature that takes hours to stabilise, a
chamber pressure, a raw-material lot. Resetting them for every run is slow, expensive or
impossible, so in practice they are set once for a group of runs — a **whole plot** — and the
easy factors vary within it. That is a split-plot design, whether it was planned or not.

The structure matters for the analysis: the whole plots differ from each other by more than runs
within a whole plot do (the furnace is never set to *exactly* the same temperature twice), so
effects of the hard-to-change factors must be judged against the whole-plot variation, with
fewer degrees of freedom. Analysing a split-plot as if it were completely randomised makes those
effects look far more significant than they are.

Mark a factor *hard to change* on the Define step (or append `!` to it in `doe init`), and the
Design step offers split-plot versions of the factorial and optimal designs.

## Split-plot fractions

Two-level fractions whose generators keep the hard-to-change factors constant within each whole
plot. aikidoe searches the minimum-aberration fractional-factorial split-plot (FFSP) designs
(Bingham & Sitter 1999), as R's FrF2 does, and reports which effects are tested at the
whole-plot level. Choose the number of whole plots: more whole plots give more degrees of freedom
for the whole-plot error (and cost more resets).

```console
$ doe init sp.aikidoe.json --factor T:900:1000:°C! --factor P:1:2:atm! --factor t:10:30:min --factor G=N2,O2 --factor F:1:3:slm --response y --seed 5
created sp.aikidoe.json: 5 factors, 1 responses, seed 5
$ doe design sp.aikidoe.json --runs 16 --whole-plots 8
sp.aikidoe.json: split-plot-fraction, 16 runs, randomisation restricted, seed 5
split-plot: 8 whole plots of 2 runs; whole-plot (hard-to-change) factors T, P are set once per whole plot
resolution IV; generators G=T:P:t, F=T:w3:t
whole-plot effects (tested against the whole-plot error): T, P, T:P, t:G, t:F, G:F
alias chains (main effects and 2fis): T:P = t:G; T:t = P:G; T:G = P:t
note: 8 whole plots leave 1 df for the whole-plot error after the whole-plot main effects and 2fis: too few to test them; more whole plots (--whole-plots) or replicates (--replicates) would help
```

Full factorials have split-plot versions too (`--full`), with replicates as whole-plot
replicates.

## Optimal split-plot designs

For other run counts, models or factor types: a D-optimal design under the split-plot error
structure (Goos & Vandebroek 2003; Jones & Nachtsheim 2009), maximising |XᵀV⁻¹X| with
V = I + η ZZᵀ, for a chosen number of whole plots and an assumed variance ratio
η = σ²_wp / σ² (1 by default).

## Randomisation

*Restricted*: the order of the whole plots is randomised, and the order of the runs within each.
The run sheet groups the runs by whole plot and says which hard-to-change settings to make for
each.

## Analysis

A mixed model with a random whole-plot effect, fitted by REML, with Kenward–Roger tests: each
term is tested against the variation in its own stratum ([mixed models](analysis.md#mixed-models)).
`doe fit --compare` shows what an analysis that ignored the whole plots would have claimed.

## Power

Power for split-plots uses the generalised least-squares information with the assumed η, and each
term's test degrees of freedom from its stratum. Whole-plot effects need enough whole plots: 8
whole plots give 7 whole-plot degrees of freedom, and every effect estimated at the whole-plot
level uses one. In the example above six effects fall there (T, P and four interactions aliased
with whole-plot contrasts), leaving one degree of freedom for the whole-plot error — too few to
test anything, as `doe design` says. More whole plots, or replicating them, fixes it.

The `w3` in the generators is a *pseudo factor*: a whole-plot column with no factor of its own,
which the FFSP search uses to place subplot factors (Bingham & Sitter 1999).

## References

Jones & Nachtsheim (2009); Bingham & Sitter (1999); Goos & Vandebroek (2003); Kenward & Roger
(1997). A worked example: [furnace split-plot with drop-in sites](example-furnace.md).
