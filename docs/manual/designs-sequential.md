# Sequential experiments: augmenting and confirming

Experiments are usually done in stages, each chosen in the light of the last: screen, clarify,
model, confirm. aikidoe keeps every stage in the same study, as a new **block** of runs, so the
final analysis uses all of them and the block term absorbs any shift between stages. The study's
history records each stage.

In the app, the **Next stage** panel (on the Design step, once there is a design) offers the
augmentations that fit the design; on the command line, `doe augment`.

## Fold-over

A fold-over repeats the two-level runs with signs reversed:

- **full fold-over** (every factor reversed): turns a resolution III fraction into resolution IV —
  main effects become clear of two-factor interactions;
- **single-factor fold-over** (one factor reversed): that factor's main effect *and* all its
  two-factor interactions become clear — use it when one factor is clearly important and you need
  its interactions.

```console
$ doe init seq.aikidoe.json --factor A:0:1 --factor B:0:1 --factor C:0:1 --factor D:0:1 --factor E:0:1 --response y --seed 6
created seq.aikidoe.json: 5 factors, 1 responses, seed 6
$ doe design seq.aikidoe.json --runs 8
seq.aikidoe.json: fractional-factorial, 8 runs, randomisation complete, seed 6
resolution III; generators D = A:B, E = A:C  (see: alias seq.aikidoe.json)
$ doe augment seq.aikidoe.json --foldover
seq.aikidoe.json: full fold-over of 8 runs; 8 runs added as block 2 (runs 9–16), 16 runs in all
combined design: 3 alias chains among main effects and 2fis (see: alias seq.aikidoe.json)
$ doe alias seq.aikidoe.json
sequential design: fractional-factorial → foldover; 16 two-level runs
alias chains:
  B:C = D:E
  B:D = C:E
  B:E = C:D
```

## Axial points

Axial (star) points at ±α on each axis, plus centre points, turn a two-level design into a
central composite design for a quadratic model ([response surfaces](designs-rsm.md)). By default α
is chosen for orthogonal blocking with the existing runs as the cube block, so the shift between
stages does not bias the quadratic coefficients. Add them when the first stage shows curvature
(centre points far from the factorial average) or when the goal becomes optimisation.

```console
$ doe augment seq.aikidoe.json --axial --centre 2
seq.aikidoe.json: axial points at α = 2.4495 and 2 centre points; 12 runs added as block 3 (runs 17–28), 28 runs in all
```

## Optimal augmentation

`doe augment --optimal --runs n --model …` adds n runs chosen D-, I- or A-optimally *together
with* the existing ones, for any bigger model — interactions a fraction could not separate,
quadratic terms of the few active factors, a factor added later. See
[optimal designs](designs-optimal.md#augmentation).

## Confirmation runs

A model's prediction is a claim; confirmation runs test it. Choose settings (usually the best
ones), and aikidoe adds runs there — replicated if you like — and stores, with the stage, the
model's prediction and its 95 % prediction interval for those runs. When the results are in, the
analysis reports each confirmation against the interval it should land in: *confirmed*, or
*outside* — a sign that the model is missing something.

Confirmation runs are left out of the model fit (they test it), and for a mixed model the
interval includes the whole-plot, run and wafer variation of the new runs.

```console
$ doe augment seq.aikidoe.json --confirm "A=1,B=0.5,C=0.5,D=0.5,E=0.5" --formula "y ~ main" --replicates 2
error: no results for y yet
```

(Confirmation needs a fitted model, so it comes after the results.)
