# Microplates

Many lab experiments run in the wells of a microplate — 96, 384 or 1536 wells — and every well is
one run. The wells are not all alike, and where a run sits can matter as much as its settings.
This page covers laying a design out on plates, controls, reading the results back, and the
analysis. In the app: the Design step's **plate layout** panel, the plate maps on the Run step and
the **Plates** panel on the Analyse step; on the command line, `doe plate`.

## Why position matters

- **Edge effects.** The outer ring of wells evaporates and warms faster than the inner wells, so
  it reads differently, most of all in the corners and over long incubations.
- **Rows and columns.** A multichannel pipette dispenses a row (or a column) at once, and each
  channel is a little different; plate washers, dispensers and readers can leave gradients
  across the plate.
- **Plates.** Plates differ from one another: the lot, the time they were read, the stack position
  in the incubator.

Filling a plate the tidy way — each condition in its own row, replicates side by side, controls in
the first column — lines these differences up with the conditions. A factor that changes between
the top and the bottom half of the plate is then indistinguishable from the rows it sits in. The
cure is the same as for any nuisance: [randomise and block](concepts.md#randomisation-and-blocking).

## Layouts

`doe plate` (or **Lay out the runs** in the app) assigns every run of the design a well. Three
layouts:

| layout | what it does |
|---|---|
| balanced (default) | a restricted randomisation: random layouts improved by random swaps, keeping the one whose effects are least entangled with plate, edge and row and column gradients |
| random | one random layout |
| ordered | conditions in standard order, replicates side by side, row by row — the tidy layout, for comparison |

The **efficiency** of a layout is how much information about the design's model survives
adjusting for position: the determinant of the information matrix after adjusting for plate, edge
and gradients relative to before, to the power 1/p. 1 means position costs nothing. The least
efficient term is shown too: its variance is 1/efficiency times what it would be without position.
A balanced layout is typically above 0.99; the tidy layout can lose most of the information about
a factor that changes between halves of the plate.

Other options:

- **Plate format** (`--format 96`, `384`, `1536`, or rows×cols such as `16x24`).
- **Excluded wells** (`--exclude edge` leaves the outer ring empty, or list wells: `--exclude
  A01,H12`). Leaving the edge empty (or filling it with buffer) avoids the edge effect at the cost
  of capacity: 60 of 96 wells.
- **Several plates.** When the runs need more than one plate, they are spread evenly over the
  plates and each run's block becomes its plate, so the analysis takes out plate-to-plate shifts. A
  design already in blocks keeps its blocks apart: no plate holds runs of two blocks.
- **New runs.** Runs added later (a fold-over, axial points, confirmation runs) go on new plates;
  runs already in wells keep their wells.

## Controls

Controls are wells with known content on every plate: a positive control (full signal), a negative
control (no signal, a blank), standards. Give each an id, a role and the number of wells per plate
(`--control pos:positive:4 --control neg:negative:4`). They are spread over the rows and columns of
the plate — never packed in one column, where an edge or a pipette channel would bias them.

From the positive and negative controls, every plate gets the assay's **Z′ factor**
(Zhang, Chung & Oldenburg 1999):

Z′ = 1 − 3(σ₊ + σ₋) / |μ₊ − μ₋|

Z′ ≥ 0.5 is an excellent assay window; 0 to 0.5 is marginal; below 0 the controls overlap. A plate
whose Z′ is much lower than the others deserves a look before its results are trusted.

## Running and reading

The plate map shows each plate's wells with run numbers and controls; the printable map (`doe
plate --html FILE`) also shows each run's settings, and the pipetting list (`doe plate --pipetting
FILE.csv`) gives plate, well, content and settings, well by well, for a liquid handler or for
pipetting by hand. The run sheet gains plate and well columns.

Results come back either way:

- **A long file** with plate and well columns and the response (and no run column needed): run
  wells give the runs' results, control wells the controls' readings.
- **A plate reader's grid** — rows A, B, … down, columns 1, 2, … across — one plate at a time:
  `doe import STUDY reader.csv --grid --plate 1 --response y`, or **Import grid…** on the Run step.
  Lines before the grid's header row are skipped.

## Analysis

For runs on plates the model gets position terms, fitted first like a block term:

| term | what it is |
|---|---|
| Block | the plate, when there are several |
| Edge | outer ring against inner wells |
| Row | a linear gradient down the plate (coded −1 at row A, +1 at the last row) |
| Col | a linear gradient across the plate |

Each is added only when it varies among the runs (Edge disappears when the edge is left empty).
They are nuisance terms: left out of the effects, the power and model reduction, and predictions
are for an average well. `--no-position` (or unticking **fit Edge, Row and Col**) leaves them out.

The Analyse step also shows the controls with Z′, and the residuals well by well on each plate. A
ring, a stripe or a corner left in the residuals is a position effect the model does not capture
(a row offset from one pipette channel, say); with a randomised layout it adds to the noise
instead of biasing an effect.

**Normalisation.** Plate assays are often normalised before analysis — percent of the positive
control, or B-scores (median polish of rows and columns; Brideau et al. 2003). With a designed experiment on one or a
few plates, the block and position terms do the same job inside the model, with honest degrees of
freedom; normalise first only when the plates differ in scale (gain), not just in offset, and then
analyse the normalised values the same way.

## On the command line

The plate exercise: an enzyme assay with four factors, 48 runs, one 96-well plate with four
positive and four negative controls.

```console
$ doe exercise new assay.aikidoe.json --topic plate --seed 1
Plates: where a sample sits matters — medium (plate-medium-1)
A kinetic assay measures the activity of a purified enzyme in 96-well plates. The assay window is too small to rank inhibitors reliably, and the team wants to know which buffer and reaction conditions raise the activity.
budget: 48 runs
  - Which factors affect activity (alone or through an interaction)?
  - For each factor that matters, estimate its effect (low → high) on activity, with a 95 % interval.
  - Stay within the run budget.

assay.aikidoe.json: design it (doe recommend / doe design), then "doe exercise run assay.aikidoe.json" for the results
$ doe design assay.aikidoe.json --full --replicates 3
assay.aikidoe.json: full-factorial, 48 runs, randomisation complete, seed 1
$ doe plate assay.aikidoe.json --map
assay.aikidoe.json: 48 run(s) laid out (balanced) on 1 plate(s) of 8 × 12, 88 wells for runs per plate
layout efficiency 0.9994 for the design's model (1 = position costs nothing); least efficient term pH:DTT 0.998

plate 1
     1   2   3   4   5   6   7   8   9  10  11  12
A   20   · pos   6   ·   1   ·   ·   7   ·   ·   ·
B   25   ·  47   ·  42   ·  31   ·   ·  33 neg  44
C    ·   ·  13  23  46   ·   ·  19  37  12   · pos
D    ·  43   ·   ·  48 neg  36  40   ·  38  11  14
E    ·   ·  30   4  22   9   ·  34 pos   ·   ·   ·
F    ·   ·  10  32   8   ·   · neg  41   ·   ·  45
G   18 pos   5   ·  39  28  29  17  35   ·   2  24
H   21  16   3  27 neg   ·  26   ·   ·  15   ·   ·
```

The runs and the controls are spread over the plate. The results, the controls' Z′, and a fit
with the position terms:

```console
$ doe exercise run assay.aikidoe.json
assay.aikidoe.json: results for 48 runs (budget 48)
$ doe plate assay.aikidoe.json
layout efficiency 0.9994 for the design's model (1 = position costs nothing); least efficient term pH:DTT 0.998

controls, activity:
plate  pos mean (sd)  neg mean (sd)  Z′
-----  -------------  -------------  -----
    1  1457 (102)     72.18 (52)     0.667
$ doe fit assay.aikidoe.json "activity ~ (time+pH+DTT+NaCl)^2"
activity ~ Edge + Row + Col + time + pH + DTT + NaCl + time:pH + time:DTT + time:NaCl + pH:DTT + pH:NaCl + DTT:NaCl
48 runs, 14 estimable coefficients, 34 residual df

term         estimate  std. error        t        p
-----------  --------  ----------  -------  -------  ---
(Intercept)      1132       10.25    110.5  <0.0001  ***
Edge[edge]     -52.04       10.17   -5.119  <0.0001  ***
Row             64.68       14.99    4.315  0.00013  ***
Col             36.99       15.96    2.319   0.0266  *
time            3.827       9.549   0.4008    0.691
pH              111.5       9.549    11.68  <0.0001  ***
DTT             117.1       9.552    12.26  <0.0001  ***
NaCl           -116.5       9.551    -12.2  <0.0001  ***
time:pH        -7.712       9.549  -0.8075    0.425
time:DTT        7.183       9.552    0.752    0.457
time:NaCl        -9.6       9.551   -1.005    0.322
pH:DTT          -19.2       9.556    -2.01   0.0525  .
pH:NaCl          -124       9.553   -12.98  <0.0001  ***
DTT:NaCl        4.254       9.551   0.4454    0.659
coded units: each continuous factor runs from −1 (low) to +1 (high)

σ = 66.15   R² = 0.9504   adjusted R² = 0.9315   predicted R² = 0.9065
F = 50.16 on 13 and 34 df, p <0.0001

ANOVA (type I, sequential)
source     df  sum of sq.  mean sq.       F         p
---------  --  ----------  --------  ------  --------
Edge        1      104600    104600   23.91   <0.0001
Row         1       59380     59380   13.57  0.000794
Col         1       17620     17620   4.025    0.0528
time        1         703       703  0.1606     0.691
pH          1      597400    597400   136.5   <0.0001
DTT         1      657500    657500   150.2   <0.0001
NaCl        1      651000    651000   148.8   <0.0001
time:pH     1        2828      2828  0.6462     0.427
time:DTT    1        2527      2527  0.5773     0.453
time:NaCl   1        4405      4405   1.006     0.323
pH:DTT      1       17590     17590   4.019     0.053
pH:NaCl     1      737400    737400   168.5   <0.0001
DTT:NaCl    1       868.2     868.2  0.1984     0.659
Residuals  34      148800      4376
```

The same design laid out the tidy way (`doe plate assay.aikidoe.json --layout ordered --relayout`
before running) shows a much lower efficiency for the factor that changes between the halves of the
plate; the [plate lesson](../../index.html#lesson=plate&difficulty=medium&seed=1) compares the two.
