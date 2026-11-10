# Full and fractional factorials

## Full factorial

Every combination of the factors' levels. For k two-level factors that is 2ᵏ runs, and every
main effect and interaction can be estimated. Mixed levels are allowed (a three-level continuous
factor, a four-level categorical one). Options: **replicates**, **centre points** (continuous
factors at their mid-range), **blocks** (for two-level designs, confounded with the highest-order
interactions).

Use it for up to four or five factors, or when all interactions matter.

## Fractional factorial

A 2ᵏ⁻ᵖ fraction runs 1/2ᵖ of the full factorial, chosen by p generators. aikidoe offers the
minimum-aberration fraction for each run size from its catalogue (up to 128 runs), or the
fraction defined by generators you give (`doe design --generators "E=ABCD,F=-ABC"`). The Design
step and `doe alias` show the generators, the defining relation, the word-length pattern and the
alias chains among main effects and two-factor interactions (see
[aliasing and resolution](concepts.md#aliasing-and-resolution)).

| factors | runs | resolution |
|---|---|---|
| 5 | 16 | V |
| 6 | 16 | IV |
| 7 | 16 | IV |
| 8 | 16 | IV |
| 6 | 32 | VI |
| 7 | 32 | IV |
| 9 | 32 | IV |

Resolution III fractions (8 runs for 4–7 factors) screen main effects only; a
[fold-over](designs-sequential.md#fold-over) clears them of two-factor interactions later.

A fraction of resolution R has **projectivity** R − 1: any R − 1 of its factors form a full
factorial (any 3 in a resolution IV design), so if only that many turn out to matter, their
interactions can be estimated from the same runs
([projectivity](designs-screening.md#projectivity)).

```console
$ doe alias --factors 7 --runs 16
2^(7−3) design, 7 factors in 16 runs, resolution IV
generators: E = ABC, F = ABD, G = ACD
defining relation: I = ABCE = ABDF = ACDG = AEFG = BCFG = BDEG = CDEF
word-length pattern (A3, A4, …): 0, 7, 0, 0, 0
projectivity 3: any 3 factors form a full 2^3 (resolution IV → R − 1)

alias chains among effects up to order 2:
  AB = CE = DF
  AC = BE = DG
  AD = BF = CG
  AE = BC = FG
  AF = BD = EG
  AG = CD = EF
  BG = CF = DE
```

## Diagnostics

For any regular fraction aikidoe shows the aliasing; for every design, the power of each model
term for an effect of 2σ (adjust the effect size, α, and the model). With a single replicate and
a model that uses every degree of freedom, there is no error estimate: judge the effects with
[Lenth's method](analysis.md#effects-and-lenths-method) or add centre points.

## References

Box, Hunter & Hunter (2005), chapters 5–6; Montgomery (2017), chapters 6–8; minimum aberration:
Fries & Hunter (1980). See the [bibliography](bibliography.md).
