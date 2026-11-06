# Concepts

The ideas the rest of the manual relies on. Most textbooks cover them at length; the
[bibliography](bibliography.md) suggests some.

## Factors and coded units

A **factor** is something you set: temperature, gas, time. A continuous factor has a range
(low … high); aikidoe works internally in **coded units**, where the low setting is −1 and the
high +1, so a coefficient means the same thing for every factor: the change in the response from
the centre to the high end. An *effect* — the change from low to high — is twice the coefficient.

For a factor marked *log*, the coding is on the log scale: a dose of 10¹⁵ … 10¹⁶ cm⁻² has its
centre at 3.16 × 10¹⁵, not 5.5 × 10¹⁵. Use it when a factor acts multiplicatively.

A categorical factor's levels are coded by *effect coding* (each level against the average of
all levels); for two levels this is −1 / +1, like a continuous factor.

## Responses and measurement

A **response** is what you measure. How it is measured matters as much as the design:

- **once per run** — one number per run;
- **per wafer, per site** — several readings from each run: they are not replicates of the run
  (they share its settings and its run-to-run error), and aikidoe keeps them apart in a mixed
  model ([wafers and sites](process.md#wafers-and-sites));
- **measurement error** — a gauge R&R study gives the measurement system's σ, which sets a floor
  on what any experiment can detect ([gauge R&R](process.md#gauge-rr)).

## Randomisation and blocking

Runs are done in a **random order** so that anything that drifts — a tool warming up, a
contaminated chamber, a change of operator — is spread across the factors instead of being
mistaken for one of them. aikidoe randomises with the study's seed, so the order is reproducible.

When the runs fall into groups that may differ — days, batches, lots, the stages of a sequential
experiment — they are **blocks**: the design is arranged so that the block differences fall on
effects you can spare (high-order interactions), the runs are randomised within each block, and
the analysis includes a block term.

A **split-plot** design is the restricted randomisation you get when a factor is hard to change:
it is set once for a group of runs (a *whole plot*) and the others vary within it. That changes
the analysis, not just the logistics ([split-plot designs](designs-split-plot.md)).

## Aliasing and resolution

A fraction of a factorial runs only some of the combinations, so some effects cannot be told
apart: they are **aliased**. A regular two-level fraction is defined by its generators — in the
2⁵⁻¹ with `E = ABCD`, the column for E is the product of A, B, C and D — and the *defining
relation* `I = ABCDE` gives every alias: multiply an effect by ABCDE to find its partner
(A = BCDE, AB = CDE, …).

The **resolution** is the length of the shortest word in the defining relation:

| resolution | main effects | two-factor interactions |
|---|---|---|
| III | aliased with 2fis | aliased with main effects |
| IV | clear of 2fis | aliased in pairs |
| V | clear | clear of each other |

Among fractions of the same size and resolution, aikidoe uses the minimum-aberration ones (the
fewest short words). `doe alias` and the Design step show the alias chains.

## Replication and repeated measurement

A **replicate** is a complete new run at the same settings: set up again, run again. Its
variation is the run-to-run error that effects are judged against. Measuring the same run twice
— two sites on a wafer, two readings of a gauge — is a **repeated measurement**: it says how
precise the measurement is, not how repeatable the process is. Treating repeated measurements as
replicates makes every effect look more significant than it is; aikidoe's mixed models avoid it.

Centre points (runs at the middle of every range) replicate cheaply, give a pure-error estimate
and test for curvature.

## Power

The **power** of a test is the chance of detecting an effect of a given size. For a design and a
model, aikidoe computes it from the non-central F distribution: an effect Δ (the change from the
low to the high setting) against run-to-run noise σ, at significance level α (0.05). Power above
0.8 is the usual target. Power depends on Δ/σ, so a good estimate of σ — from earlier data or a
gauge study — matters; for a split-plot the whole-plot variance matters too (η = σ²_wp / σ²).

The Design step shows the power of each term; `doe power` prints it, with the effect detectable
with 80 % power.

## Hierarchy

A model is **hierarchical** if, whenever it contains an interaction (A:B) or a power (A²), it
also contains the terms they are made of (A and B). Hierarchical models do not change meaning
when the factors are recoded, so aikidoe keeps hierarchy when it reduces a model and warns when a
formula breaks it.

## Sequential experimentation

Rarely does one experiment answer everything. A typical path: a resolution III or IV fraction
screens many factors; a fold-over separates the aliased effects that matter; axial points add
curvature for a response surface on the few active factors; confirmation runs check the
prediction at the chosen settings. Each stage is a block of the same study, so the analysis
uses every run ([sequential experiments](designs-sequential.md)).
