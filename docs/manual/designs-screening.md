# Plackett–Burman and definitive screening

Screening designs look at many factors in few runs, to find the few that matter.

## Plackett–Burman

Two-level designs whose run count is a multiple of 4 (12, 20, 24, 28, 32, 36, 40, 44, 48 runs) —
between and beyond the sizes of the regular fractions; the 32-run one is a cyclic design, not the
regular 2⁵. Main effects are orthogonal to each other. Two-factor interactions are not aliased
with main effects completely, as in a resolution III fraction, but *partially*: each is correlated
(±1/3 in the 12-run design) with the main effects it does not contain. A large interaction biases
several main effects a little instead of one completely. `doe alias` lists the correlations.

Their **generalised resolution** (Deng & Tang 1999) puts a number on this: 3.67 for 12 runs, 3.4
for 20 — between resolution III (complete aliasing, 3) and IV. The recommender offers every size
up to your budget (or the next two), since a few more runs buy power and a cleaner alias
structure.

Use it to screen main effects with a run count a regular fraction cannot give (11 factors in 12
runs), then look at the few active factors in more detail — often from the same runs
([projectivity](#projectivity)).

## Definitive screening

Three-level designs from a conference matrix (Jones & Nachtsheim 2011): for k factors, 2m + 1
runs where m is the conference-matrix order (13 runs for 5 or 6 factors, 17 for 7 or 8, 21 for
9 or 10). Each factor is at −1, 0 and +1. Properties:

- main effects are orthogonal to each other and to every two-factor interaction and every
  quadratic term — active interactions and curvature do not bias them;
- no two second-order terms are completely aliased;
- the full quadratic in **any 3 factors** can be fitted from the same runs (for 5 factors or more;
  with 3 or 4 factors, the 9-run design cannot for any 3 of them, so aikidoe adds fake factors by
  default, giving 13 runs, which can for all of them). In **4 factors** it rarely can: for none of
  the 4-factor sets with 5 to 10 factors, a third of them with 12, three quarters with 14.

Options: **fake factors** — extra conference-matrix columns that are dropped, giving more runs and
better estimates of second-order effects (Jones & Nachtsheim 2013 recommend 2); **centre runs**
(default 1). Two-level categorical factors are allowed (their main effects are slightly correlated
with the continuous ones, 1/(m−1)).

The default analysis model is main effects; then add the quadratic terms of the active factors.

## Projectivity

A design has **projectivity P** when every set of P of its factors contains a full 2^P factorial
(Box & Tyssedal 1996). If screening finds that only P factors matter, the runs already hold a
full factorial in them — replicated, since the other factors' settings now act as repeats — so
their interactions can be estimated without new runs.

| design | P |
|---|---|
| regular fraction of resolution R | R − 1 (III: 2, IV: 3, V: 4) |
| Plackett–Burman, 12 … 48 runs | 3 — and any 4 factors support their main effects and all 2fis |
| Plackett–Burman 40 with 39 factors | 2 (aikidoe offers 44 runs instead) |
| Plackett–Burman 16 | 2 (not offered: the regular 16-run fraction is as good) |

So a 12-run Plackett–Burman (P = 3) keeps more after screening than a 16-run resolution III
fraction (P = 2), though the fraction has more runs (Lin & Draper 1992). The recommender reports
P and, among designs alike in runs and power, prefers the larger. For definitive screening the
counterpart is how many factors' full quadratic can be fitted (above: any 3).

On the Analyse step, after a main-effects fit of a screening design, when 2 to 4 factors look
active and the runs can estimate their interactions (definitive screening: their quadratic) with
some residual degrees of freedom left, aikidoe offers **fit them with their interactions**.
`doe alias STUDY` reports P (and, for definitive screening, the projections that carry a
quadratic).

## Which?

Use `doe recommend STUDY --goal screen` or the Design step's **Recommend** for your factors and
budget. Roughly: a resolution IV fraction when interactions are likely and you can afford it;
definitive screening when curvature may matter and the factors are continuous; Plackett–Burman
when runs are tight and interactions unlikely.

## References

Plackett & Burman (1946); Lin & Draper (1992); Box & Tyssedal (1996); Deng & Tang (1999); Jones &
Nachtsheim (2011, 2013). See the [bibliography](bibliography.md).
