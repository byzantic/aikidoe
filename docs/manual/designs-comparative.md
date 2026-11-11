# Designs for comparing treatments

Many experiments have a single factor: five media, four coatings, three diets, six enzyme
preparations. The question is which of them differ, and which beat the standard. The analysis is
[Comparing treatments](analysis.md#comparing-treatments): Tukey for every pair, Dunnett against
a control, or planned contrasts.

The design's job is to keep other sources of variation out of the comparison. Days differ,
operators differ, animals differ, and each of these can be larger than the treatment effects you
are looking for. The designs on this page group the runs so that those differences cancel out of
every comparison:

| the runs fall into… | design |
| --- | --- |
| groups that can each hold every treatment (days, batches, plates) | randomised complete blocks |
| two crossed groupings (day × operator, row × column of a field or rack) | Latin square |
| groups too small for every treatment (three assays a day, six preparations) | balanced incomplete blocks |
| units that can take every treatment in turn (animals, volunteers, cell lines, instruments) | crossover |

All of them need one factor, so give the study just the treatment. The Design step offers these
designs alongside the full factorial, which is completely randomised with no grouping. `doe
design` makes them with `--complete-blocks`, `--latin`, `--bibd` and `--crossover`. Treatment
labels, rows, columns and subjects are all randomised from the study's seed.

## Randomised complete blocks

Each block (a day, a batch, a plate) holds every treatment once, in random order. This is the
standard design for comparing a few treatments. Run each block in one go, and the analysis takes
out the differences between blocks.

```console
$ doe init media.aikidoe.json --factor medium=Standard,M-2,M-3,M-4 --response biomass:g/L --seed 4
created media.aikidoe.json: 1 factors, 1 responses, seed 4
$ doe design media.aikidoe.json --complete-blocks 5
media.aikidoe.json: complete-blocks, 20 runs, seed 4
5 blocks, each with every level of medium once (in random order within the block); run each block in one go — a day, a batch — and the analysis takes out the differences between blocks
```

## Latin squares

When there are two groupings, for example days and operators, a **Latin square** puts each
treatment once on every day and once with every operator. Five treatments take 5 × 5 = 25 runs.
The analysis adjusts for days and for operators, so neither blurs the comparison.

```console
$ doe init coat.aikidoe.json --factor coating=C1,C2,C3,C4,C5 --response time:min --seed 81
created coat.aikidoe.json: 1 factors, 1 responses, seed 81
$ doe design coat.aikidoe.json --latin --rows Day --columns Operator
coat.aikidoe.json: latin-square, 25 runs, seed 81
a Latin square: 5 treatments, 5 days × 5 operators; each level of coating once in every day and every operator
the days are run in turn, in random order within each; the analysis adjusts for both
```

The run sheet has a column for the day and one for the operator, and lists the runs day by day.
The example *Five tablet coatings* (Examples menu, or `examples/coating-latin.aikidoe.json`) has
the results:

```console
$ doe compare examples/coating-latin.aikidoe.json coating --control C1
coating: least squares, time ~ main (adjusted for day, operator)

coating   mean  std. error  95% CI         runs
-------  -----  ----------  -------------  ----
C1       12.28      0.2055  11.83 … 12.73     5
C2       13.42      0.2055  12.97 … 13.87     5
C3       12.16      0.2055  11.71 … 12.61     5
C4          14      0.2055  13.55 … 14.45     5
C5       12.92      0.2055  12.47 … 13.37     5

comparison  difference  std. error  95% CI (simultaneous)  p (adjusted)
----------  ----------  ----------  ---------------------  ------------
C2 − C1           1.14      0.2906  0.3244 … 1.956         0.00684
C3 − C1          -0.12      0.2906  -0.9356 … 0.6956       0.98
C4 − C1           1.72      0.2906  0.9044 … 2.536         0.00025
C5 − C1           0.64      0.2906  -0.1756 … 1.456        0.141
Dunnett's method (each level against C1); critical value 2.8071
```

The days and operators use up degrees of freedom: a 5 × 5 square leaves 12 for the error, and a
3 × 3 square only 2. For three treatments use two squares (`--squares 2`, the default for three
in the Design step). The second square adds new rows and keeps the same columns.

## Balanced incomplete blocks

Sometimes a block cannot hold every treatment: three assays fit in a day, but there are six
preparations. In a **balanced incomplete block design**, every pair of treatments is together in
the same number of blocks. Every comparison is then equally precise. `--bibd K` asks for blocks
of K and finds the smallest balanced design (Cochran & Cox 1957 list them):

```console
$ doe init enz.aikidoe.json --factor enzyme=E1,E2,E3,E4,E5,E6 --response activity:U/mL --seed 82
created enz.aikidoe.json: 1 factors, 1 responses, seed 82
$ doe design enz.aikidoe.json --bibd 3
enz.aikidoe.json: bibd, 30 runs, seed 82
10 blocks of 3, each treatment 5 times; every pair together in 2 blocks (balanced)
efficiency 0.8: comparisons are as precise as with complete blocks and 4 runs of each treatment
blocks: E1 E3 E5 | E1 E2 E6 | E2 E5 E6 | E1 E4 E5 | E2 E3 E4 | E1 E2 E3 | E2 E4 E5 | E3 E5 E6 | E3 E4 E6 | E1 E4 E6
```

The **efficiency** is the price of the small blocks. It is the share of information kept,
compared with complete blocks and the same number of runs of each treatment: λt / (rk) for a
balanced design, here 0.8. For some sizes no balanced design exists with the number of blocks you
can afford (`--blocks B`). aikidoe then gives the most efficient design it finds and says that it
is not balanced.

```console
$ doe compare examples/enzyme-bibd.aikidoe.json enzyme
enzyme: least squares, activity ~ main (with the block term)

enzyme   mean  std. error  95% CI         runs  group
------  -----  ----------  -------------  ----  -----
E1      100.4       1.094  98.1 … 102.8      5  bc
E2      105.2       1.094  102.9 … 107.5     5  ab
E3      107.6       1.094  105.3 … 110       5  a
E4       98.9       1.094  96.57 … 101.2     5  c
E5      101.9       1.094  99.57 … 104.2     5  bc
E6      104.7       1.094  102.3 … 107       5  ab
levels sharing a letter do not differ (Tukey's method (all pairs), α = 0.05)

comparison  difference  std. error  95% CI (simultaneous)  p (adjusted)
----------  ----------  ----------  ---------------------  ------------
E1 − E2         -4.767       1.574  -9.88 … 0.3467         0.0747
E1 − E3         -7.217       1.574  -12.33 … -2.103        0.00394
E1 − E4          1.533       1.574  -3.58 … 6.647          0.919
E1 − E5         -1.467       1.574  -6.58 … 3.647          0.932
E1 − E6         -4.233       1.574  -9.347 … 0.88          0.135
E2 − E3          -2.45       1.574  -7.563 … 2.663         0.636
E2 − E4            6.3       1.574  1.187 … 11.41          0.012
E2 − E5            3.3       1.574  -1.813 … 8.413         0.339
E2 − E6         0.5333       1.574  -4.58 … 5.647          0.999
E3 − E4           8.75       1.574  3.637 … 13.86          0.000639
E3 − E5           5.75       1.574  0.6366 … 10.86         0.0234
E3 − E6          2.983       1.574  -2.13 … 8.097          0.441
E4 − E5             -3       1.574  -8.113 … 2.113         0.435
E4 − E6         -5.767       1.574  -10.88 … -0.6533       0.0229
E5 − E6         -2.767       1.574  -7.88 … 2.347          0.518
Tukey's method (all pairs)
```

## Crossovers

When each unit (an animal, a volunteer, a cell line, an instrument) can receive every treatment
in turn, compare the treatments **within** each unit. This takes the differences between units
out of the comparison, and they are often the largest source of variation. Each unit is a
*subject* and each turn a *period*. Two things need care:

- **Periods differ.** The animals get older and the season changes, so the order is balanced: each
  treatment appears once in each period.
- **Carry-over.** A treatment can still act in the next period. A **Williams design** (Williams
  1949) orders the treatments so that each one follows every other equally often. The analysis
  can then estimate the carry-over and allow for it. Leave a wash-out between periods anyway:
  the carry-over model assumes it lasts one period and is the same whatever follows.

For two treatments the design is **AB/BA**. Three treatments need six sequences, so use a
multiple of six subjects. Four treatments need four sequences.

```console
$ doe init diet.aikidoe.json --factor diet=Control,D-1,D-2 --response glucose:mmol/L --seed 83
created diet.aikidoe.json: 1 factors, 1 responses, seed 83
$ doe design diet.aikidoe.json --crossover --subjects 12 --subject-name Animal
diet.aikidoe.json: crossover, 36 runs, seed 83
Williams crossover: 12 subjects, 3 periods; sequences D-1→Control→D-2, Control→D-2→D-1, D-2→D-1→Control, D-2→Control→D-1, D-1→D-2→Control, Control→D-1→D-2
each treatment follows every other equally often, so carry-over can be estimated and allowed for; the analysis adjusts for subject, period and carry-over
the periods are run in turn; leave a wash-out between them
```

The analysis fits subject, period and carry-over (the treatment the same subject had in the
period before), with none in the first period:

```console
$ doe compare examples/diet-crossover.aikidoe.json diet --control Control
diet: least squares, glucose ~ main (adjusted for animal, period, carry-over)

diet      mean  std. error  95% CI         runs
-------  -----  ----------  -------------  ----
Control  6.874     0.09217  6.68 … 7.067     12
D-1      6.139     0.09217  5.945 … 6.332    12
D-2      5.628     0.09217  5.434 … 5.822    12

comparison     difference  std. error  95% CI (simultaneous)  p (adjusted)
-------------  ----------  ----------  ---------------------  ------------
D-1 − Control      -0.735      0.1349  -1.059 … -0.4114       <0.0001
D-2 − Control      -1.246      0.1349  -1.569 … -0.922        <0.0001
Dunnett's method (each level against Control); critical value 2.3986
```

In a two-treatment AB/BA design, carry-over cannot be told apart from the difference between the
two sequences. With subjects fixed it cannot be estimated at all, so the analysis leaves it out
and says so. With subjects random it is estimated from the differences between subjects, which
is imprecise. Plan a wash-out long enough to rule it out.

## Fixed or random blocks

By default the blocks (days, operators, subjects) are fixed: each one's level is taken out, and
the treatments are compared only within them. That is all a complete design needs. In an
incomplete design, the differences *between* blocks carry some information about the treatments
as well. Treating the blocks as **random** (a mixed model, REML, with Kenward–Roger degrees of
freedom) recovers it, and the intervals usually get a little narrower:

```console
$ doe compare examples/enzyme-bibd.aikidoe.json enzyme --random block
enzyme: mixed model (block random), Kenward–Roger, activity ~ main

enzyme   mean  std. error  95% CI         readings  group
------  -----  ----------  -------------  --------  -----
E1      100.5       1.874  96.49 … 104.4         5  bc
E2      105.3       1.874  101.3 … 109.3         5  ab
E3      107.6       1.874  103.6 … 111.5         5  a
E4       98.8       1.874  94.83 … 102.8         5  c
E5        102       1.874  98.02 … 106           5  bc
E6      104.6       1.874  100.6 … 108.6         5  ab
levels sharing a letter do not differ (Tukey's method (all pairs), α = 0.05)

comparison  difference  std. error  df    95% CI (simultaneous)  p (adjusted)
----------  ----------  ----------  ----  ---------------------  ------------
E1 − E2         -4.841       1.567  15.5  -9.912 … 0.23          0.0657
E1 − E3         -7.101       1.567  15.5  -12.17 … -2.03         0.00408
E1 − E4          1.661       1.567  15.5  -3.41 … 6.732          0.89
E1 − E5          -1.53       1.567  15.5  -6.601 … 3.541         0.919
E1 − E6         -4.149       1.567  15.5  -9.22 … 0.9217         0.144
E2 − E3          -2.26       1.567  15.5  -7.331 … 2.81          0.703
E2 − E4          6.502       1.567  15.5  1.431 … 11.57          0.00861
E2 − E5          3.311       1.567  15.5  -1.76 … 8.382          0.33
E2 − E6         0.6917       1.567  15.5  -4.379 … 5.763         0.997
E3 − E4          8.762       1.567  15.5  3.691 … 13.83          0.000541
E3 − E5          5.572       1.567  15.5  0.5009 … 10.64         0.0273
E3 − E6          2.952       1.567  15.5  -2.119 … 8.023         0.447
E4 − E5          -3.19       1.567  15.5  -8.261 … 1.881         0.367
E4 − E6          -5.81       1.567  15.5  -10.88 … -0.7391       0.0203
E5 − E6          -2.62       1.567  15.5  -7.691 … 2.451         0.568
Tukey's method (all pairs)
```

On the Analyse step, tick *… as random*. For a Latin square `--random day,operator` makes both
random. For a crossover `--random animal` makes the subjects random, and the periods stay
fixed. Random blocks need enough of them, say six or more, for their variance to be estimated.

## Power

Power on the Design step (and `doe power`) fits the blocks, rows and columns, or subjects,
periods and carry-over, as the analysis will. The degrees of freedom they use come off the
error.
