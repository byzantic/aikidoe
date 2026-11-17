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

## Three-level fractions

When every factor has three levels (categorical factors with three categories, or continuous
factors with three levels listed on the Define step), a full factorial soon gets large: 3⁵ = 243
runs. A **3ᵏ⁻ᵖ fraction** runs 1/3ᵖ of it, in 9, 27 or 81 runs. Its runs are every combination of
k − p **base factors**. Each other factor is a sum of base factors, counted round the three
levels (modulo 3). For example D = AB²C means level(D) = level(A) + 2·level(B) + level(C),
modulo 3. Every pair of factors appears in all nine combinations equally often.

Two things differ from two-level fractions:
- **A main effect has 2 df** (a linear and a quadratic part for a continuous factor).
- **The interaction of two factors (4 df) splits into two components, AB and AB²**, of 2 df each.
  A word of length 3 in the defining relation, such as I = BCD², aliases a main effect with one
  component of an interaction: here D with BC, B with CD² and C with BD². The main effect is
  biased only by that part of the interaction.

aikidoe offers the **minimum-aberration** fraction for each size (fewest words of length 3, then
4, …). For 9 and 27 runs, and for up to 8 factors in 81 runs, it comes from a complete search.
Beyond that, a sequential search is used; it found the same pattern wherever both were run. You
can also give your own generators (`doe design --generators "D=AB, E=AB²C"`, or AB2C). The
generators use letters for the factors, in order: A for the first, B for the second, and so on.

```console
$ doe init panel.aikidoe.json --factor "solvent=water,ethanol,acetone" --factor "temp=low,mid,high" --factor "time=short,mid,long" --factor "stir=none,slow,fast" --factor "pH=4,7,10" --response y --seed 5
created panel.aikidoe.json: 5 factors, 1 responses, seed 5
$ doe design panel.aikidoe.json --runs 27
panel.aikidoe.json: fractional-factorial-3, 27 runs, randomisation complete, seed 5
three-level fraction 3^(5−2): resolution III; generators D=BC, E=ABC² (A = solvent, B = temp, C = time, D = stir, E = pH); minimum aberration (complete search)  (see: alias panel.aikidoe.json)
$ doe alias panel.aikidoe.json
three-level fraction: 27 runs; resolution III; factors A = solvent, B = temp, C = time, D = stir, E = pH
generators: D=BC, E=ABC²
defining relation: I = BCD² = ACDE² = ABC²E² = AB²D²E²
word-length pattern (A3, A4, …): 1, 3, 0
main effects aliased with two-factor interaction components:
  B = CD²
  C = BD²
  D = BC
(a two-factor interaction A×B of three-level factors has two components, AB and AB², of 2 df each)
```

| factors | runs | resolution | A3, A4 |
|---|---|---|---|
| 4 | 9 | III | 4, 0 |
| 4 | 27 | IV | 0, 1 |
| 5 | 27 | III | 1, 3 |
| 6 | 27 | III | 2, 9 |
| 5 | 81 | V | 0, 0 |
| 6 | 81 | IV | 0, 2 |

The word-length patterns match a complete search with R's `DoE.base`. With resolution III, check
the alias list: put the factors whose interactions you expect to matter where they are not aliased
with main effects. The default model on the Analyse step is the main effects, with the quadratic
part of each continuous factor.

## Orthogonal arrays

With factors at different numbers of levels (a two-level catalyst, a three-level temperature, a
four-level supplier), a full factorial is often too big, and a regular fraction may not exist. An
**orthogonal array** (OA) is a table of runs in which every two columns contain every combination
of their levels equally often. The main effects are then estimated independently of each other:
the classical Taguchi tables L9, L16, L18, L27 and L36 are of this kind. aikidoe has:

| array | runs | columns |
|---|---|---|
| L9, L27, L81 | 9, 27, 81 | 3⁴, 3¹³, 3⁴⁰ |
| L8, L12, L16, L20, L24, L32 | 8 … 32 | two-level only |
| L16 | 16 | 4⁵, 2³4⁴, 2⁶4³, 2⁹4², 2¹²4 |
| L18 | 18 | 2 3⁷, 3⁶6 |
| L25 | 25 | 5⁶ |
| L32 | 32 | 2 4⁹ |
| L36 | 36 | 2¹¹3¹², 2²3¹³, 3¹³4 |

The arrays are built by standard methods: regular arrays over finite fields, difference matrices,
and replacing one many-level column by several with fewer levels. Each one is checked for
orthogonality, and its word-length pattern is checked against R's `DoE.base`. A factor is put
only on a column with its own number of levels.

When an array has more columns than factors, the choice of columns matters. It decides how the
main effects are tangled with interactions, which is measured by the **generalised word-length
pattern** (A3, A4, …; Xu & Wu 2001). A3 = 0 means no main effect is tangled with a two-factor
interaction. aikidoe gives the factors the columns with the smallest A3, then the smallest A4,
by a complete search where that takes a moment and column by column otherwise. With
`doe design --array L36 --columns …` you choose the array and its columns yourself.

```console
$ doe init mixed.aikidoe.json --factor "catalyst=A,B" --factor "temp=low,mid,high" --factor "time=short,mid,long" --factor "solvent=water,ethanol,acetone" --factor "stir=none,slow,fast" --response y --seed 5
created mixed.aikidoe.json: 5 factors, 1 responses, seed 5
$ doe design mixed.aikidoe.json --array
mixed.aikidoe.json: orthogonal-array, 18 runs, randomisation complete, seed 5
orthogonal array L18 (2 3^7): columns 1, 2, 3, 6, 7 for catalyst, temp, time, solvent, stir; generalised word-length pattern (A3, A4) 3.5, 4.5; columns of least aberration (complete search)  (see: alias mixed.aikidoe.json)
$ doe alias mixed.aikidoe.json
orthogonal array L18 (2 3^7): columns 1, 2, 3, 6, 7 for catalyst, temp, time, solvent, stir
generalised word-length pattern (A1 … A5): 0, 0, 3.5, 4.5, 0
main effects are orthogonal to each other but partly aliased with two-factor interactions (A3 > 0); in a non-regular array this aliasing is spread thinly over many interactions
```

L18 and L36 are **non-regular**. An interaction is not confounded with one main effect but spread
thinly over many of them. So an array of this kind is good for finding the few important factors,
provided interactions are modest, and poor for estimating interactions. The recommender lists the
arrays that fit, with an optimal design of the same size for comparison. The default model is the
main effects, with the quadratic part of each continuous factor at three or more levels.

## Diagnostics

For any regular fraction aikidoe shows the aliasing; for every design, the power of each model
term for an effect of 2σ (adjust the effect size, α, and the model). With a single replicate and
a model that uses every degree of freedom, there is no error estimate: judge the effects with
[Lenth's method](analysis.md#effects-and-lenths-method) or add centre points.

## References

Box, Hunter & Hunter (2005), chapters 5–6; Montgomery (2017), chapters 6–8; minimum aberration:
Fries & Hunter (1980); three-level fractions: Wu & Hamada (2009), chapter 6; orthogonal arrays: Hedayat, Sloane &
Stufken (1999), Wu & Hamada (2009), chapters 7–8; generalised word-length pattern: Xu & Wu (2001). See the [bibliography](bibliography.md).
