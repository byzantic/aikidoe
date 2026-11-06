# Formula syntax

A model is written as a formula over the factor ids, in a subset of R's (Wilkinson–Rogers)
notation. The response before `~` is optional where the response is known from context.

| write | means |
|---|---|
| `y ~ A + B + C` | main effects of A, B and C |
| `A:B` | the interaction of A and B (the product of their columns) |
| `A*B` | crossing: `A + B + A:B` |
| `(A + B + C)^2` | the main effects and all their two-factor interactions (`^3`: up to three-factor) |
| `I(T^2)` | a squared continuous factor, as one variable (`I(T^3)`, `I(T*t)` likewise) |
| `- A:B` | remove a term |
| `-1` or `+ 0` | no intercept |
| `main` | all main effects |
| `2fi` | all main effects and two-factor interactions |
| `quadratic` | `2fi` plus the square of every continuous factor |

Shortcuts and terms combine: `quadratic + I(etch^3)`, `main + A:B`, `(A+B+C)^2 - B:C`.

## Columns

- A continuous factor contributes its coded value (−1 at low, +1 at high; on the log scale for a
  log-transformed factor), so coefficients are per half-range.
- A categorical factor with k levels contributes k − 1 effect-coded columns (each level against
  the average; the first level is all −1). A two-level factor is −1 / +1.
- An interaction is the product of its components' columns.
- In a mixed model, the position terms `radius2`, `edge`, `waferX`, `waferY`, `slot` and `slotZone`
  can be used like factors ([wafers and sites](process.md#position-terms)).
- When the runs fall in several blocks, a block term is added first automatically.

## Order

Terms are ordered as R orders them — by degree (main effects, then two-factor interactions, …;
`I(…)` counts as one), keeping the order of appearance within a degree. Type I (sequential) sums of
squares follow this order.

## Hierarchy

aikidoe warns when a formula is not hierarchical (an interaction or power without its parts) and
keeps hierarchy when it reduces a model; see [concepts](concepts.md#hierarchy).
