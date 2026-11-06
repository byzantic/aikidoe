# Plackett–Burman and definitive screening

Screening designs look at many factors in few runs, to find the few that matter.

## Plackett–Burman

Two-level designs whose run count is a multiple of 4 that is not a power of 2 (12, 20, 24, 28,
36, 40, 44, 48 runs) — between the sizes of the regular fractions. Main effects are orthogonal to
each other. Two-factor interactions are not aliased with main effects completely, as in a
resolution III fraction, but *partially*: each is correlated (±1/3 in the 12-run design) with the
main effects it does not contain. A large interaction biases several main effects a little instead
of one completely. `doe alias` lists the correlations.

Use it to screen main effects with a run count a regular fraction cannot give (11 factors in 12
runs), then fit the few active factors in more detail.

## Definitive screening

Three-level designs from a conference matrix (Jones & Nachtsheim 2011): for k factors, 2m + 1
runs where m is the conference-matrix order (13 runs for 5 or 6 factors, 17 for 7 or 8, 21 for
9 or 10). Each factor is at −1, 0 and +1. Properties:

- main effects are orthogonal to each other and to every two-factor interaction and every
  quadratic term — active interactions and curvature do not bias them;
- no two second-order terms are completely aliased;
- with only a few active factors, the full quadratic in those factors can usually be fitted from
  the same runs.

Options: **fake factors** — extra conference-matrix columns that are dropped, giving more runs and
better estimates of second-order effects (Jones & Nachtsheim 2013 recommend 2); **centre runs**
(default 1). Two-level categorical factors are allowed (their main effects are slightly correlated
with the continuous ones, 1/(m−1)).

The default analysis model is main effects; then add the quadratic terms of the active factors.

## Which?

Use `doe recommend STUDY --goal screen` or the Design step's **Recommend** for your factors and
budget. Roughly: a resolution IV fraction when interactions are likely and you can afford it;
definitive screening when curvature may matter and the factors are continuous; Plackett–Burman
when runs are tight and interactions unlikely.

## References

Plackett & Burman (1946); Jones & Nachtsheim (2011, 2013). See the [bibliography](bibliography.md).
