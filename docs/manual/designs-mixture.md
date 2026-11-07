# Mixture designs

In a recipe, a formulation, a glaze or an alloy, the factors are **shares of a whole**: the
ingredients add up to a fixed total (100 %, 1, or the batch size). One ingredient cannot be
changed without changing another, so the usual designs do not apply — most corners of a factorial
over the ingredients' ranges do not add up — and "the effect of glucose" means nothing until you
say what it replaces. Mixture experiments have their own designs (spread over the region the
ingredients' limits leave) and their own models (Scheffé polynomials, with no intercept). The
standard text is Cornell (2002).

In the app: tick the ingredients as **mixture** components on the Define step and give the total;
the Design step then offers the mixture designs, the Analyse step the mixture ANOVA, a ternary
plot and Cox traces, and the Optimise step a ternary map of the desirability. On the command line:
`doe init … --mixture A,B,C --total T`, then `doe design STUDY --mixture …`.

## When to use a mixture design

Use one when the response depends on the **proportions** of the ingredients, not on their amounts:
the strength of a concrete, the colour of a glaze, the yield from a culture medium, the hardness of
an alloy. If the amounts matter too (more of everything is better), the total is a factor in its
own right — a process factor, below — or the problem is not a mixture.

The examples in the exercises are typical: a cell-culture supplement of glucose, glutamine and a
growth supplement; a ceramic glaze of feldspar, silica and whiting; a bronze of copper, zinc and
tin. All have lower and upper limits on each ingredient, which is the usual case in practice.

## Defining a mixture

Each component is a continuous factor (not on a log scale) with a low and a high limit; the
mixture lists the components and the total:

```json
"mixture": { "components": ["glucose", "glutamine", "supplement"], "total": 100 }
```

The lower limits must leave room (their sum below the total) and the upper limits must reach it
(their sum at least the total). Other factors in the study are **process factors** (below). Every
run of a design must add up to the total; aikidoe checks it.

## Pseudo-components

With lower limits L₁ … L_q, every blend has at least ΣL of fixed material, and the rest,
total − ΣL, is shared out. The **L-pseudo-components**

  zᵢ = (xᵢ − Lᵢ) / (total − ΣL)

run from 0 to 1 and add up to 1 over that rest. aikidoe fits the models in pseudo-components: the
coefficients are better conditioned than in the original proportions, and a linear coefficient is
the response of the pure pseudo-component (the blend with that component as high as the other lower
limits allow). Predictions are the same either way.

If there are no upper limits that bind, the blends in pseudo-components fill the whole simplex — a
triangle for three components, a tetrahedron for four — and the classical simplex designs apply.

## Simplex designs

For a simplex region (lower limits only):

- **Simplex lattice {q, m}**: every blend whose pseudo-components are multiples of 1/m. {q, 2}
  is the pure components and the 50:50 binary blends — exactly the points the quadratic model
  needs; {q, 3} supports the cubic.
- **Simplex centroid**: the pure components, the 50:50 binaries, the 1/3:1/3:1/3 ternaries, … and
  the overall centroid: 2^q − 1 blends, for the special cubic model.
- **Axial blends** (half way from the centroid to each vertex) and replicated **centroid runs**
  add interior points, to check for lack of fit and estimate pure error: designs on the edges
  alone say nothing about the inside of the triangle.

## Constrained regions

Upper limits (or constraints on combinations) cut corners off the simplex, and the region left is a
polyhedron. Two designs fit it:

- **Extreme vertices** (McLean & Anderson 1966): the vertices of the region, the centroids of its
  edges (and, with more components, of its faces) and the overall centroid. Good for three or four
  components; the number of vertices grows quickly with more.
- **Optimal** designs: a point-exchange search (Fedorov) over candidates — the vertices, the edge
  and face centroids, the overall centroid and the axial blends — for a given model and number of
  runs. **D**-optimal for precise coefficients, **I**-optimal for precise predictions over the
  region (the usual choice when the aim is the best blend). Any number of runs, any region.

```console
$ doe exercise new medium.aikidoe.json --topic mixture --seed 2
Mixtures: the best blend — medium (mixture-medium-2)
A cell line is grown in a basal medium with a supplement mix of glucose, glutamine and a growth supplement. The three are blended to a fixed total, and the process group wants the blend that gives the highest viable-cell density.
budget: 14 runs
  - Which settings maximise viable-cell density, within the ranges?
  - Predict viable-cell density at glucose = 61.29, glutamine = 21.08, supplement = 17.63.
  - Stay within the run budget.

medium.aikidoe.json: design it (doe recommend / doe design), then "doe exercise run medium.aikidoe.json" for the results
$ doe design medium.aikidoe.json --mixture optimal --runs 14 --model mixquadratic --criterion I
medium.aikidoe.json: mixture design (optimal), 14 runs over glucose, glutamine, supplement (adding up to 100); randomisation complete, seed 2
I-optimal for mixquadratic: log det -8.98661, average prediction variance 0.36
the region is not a simplex (upper bounds or constraints cut it): coefficients are for L-pseudo-components
```

## Process variables

Other factors — a firing temperature, a mixing time — are **process factors**. In a mixture design
they are crossed with the blends: every blend at the low and high settings of each (coded ±1). The
model adds each component's interaction with the process factors (`mixlinear:(T)`), so the best
blend can depend on them; with several process factors an optimal design is smaller than the full
cross.

## Mixture models

Because the components add up to a constant, an intercept and all q linear terms cannot be
estimated together; Scheffé (1958) absorbed the intercept into the linear terms and the squares into
the cross products. The models (in pseudo-components z):

| formula | model | terms |
|---|---|---|
| `mixlinear` | Σ βᵢ zᵢ | q |
| `mixquadratic` | Σ βᵢ zᵢ + Σ βᵢⱼ zᵢ zⱼ | q(q+1)/2 |
| `mixspecial` | + Σ βᵢⱼₖ zᵢ zⱼ zₖ (special cubic) | + q(q−1)(q−2)/6 |
| `mixcubic` | + Σ δᵢⱼ zᵢ zⱼ (zᵢ − zⱼ) (full cubic) | + q(q−1)/2 more |

Read the coefficients as: βᵢ is the response of the pure (pseudo-)component; βᵢⱼ is the
**blending** of i and j — positive is synergistic (the 50:50 blend is better than the average of
the two by βᵢⱼ/4), negative antagonistic. The individual βᵢ cannot be tested against zero in a
useful way (a pure component's response is rarely zero); what is tested is whether the linear
blending differs between components, and whether each blending term matters.

Because the model has no explicit intercept but contains one implicitly, R² and the F test are
about the mean, as for an ordinary model. With process factors: `y ~ mixquadratic + mixlinear:(T)`.

## Analysis

Cornell's yarn data: the elongation of yarn spun from polyethylene (PE), polystyrene (PS) and
polypropylene (PP), a {3, 2} simplex lattice run twice (Cornell 2002; the third replicate of the
binary blends left out here):

```console
$ doe init yarn.aikidoe.json --factor PE:0:1 --factor PS:0:1 --factor PP:0:1 --response elongation --mixture PE,PS,PP --seed 3
created yarn.aikidoe.json: 3 factors, 1 responses, seed 3
$ doe design yarn.aikidoe.json --mixture lattice --degree 2 --replicates 2
yarn.aikidoe.json: mixture design (lattice {3,2}), 12 runs over PE, PS, PP (adding up to 1); randomisation complete, seed 3
```

```file yarn.csv
run,elongation
1,11.0
2,15.0
3,17.7
4,8.8
5,10.0
6,16.8
7,12.4
8,14.8
9,16.4
10,10.0
11,9.7
12,16.0
```

```console
$ doe import yarn.aikidoe.json yarn.csv
12 value(s) read (wide format)
yarn.aikidoe.json: 12 observation(s)
$ doe fit yarn.aikidoe.json "elongation ~ mixquadratic" --trace
elongation ~ PE + PS + PP + PE:PS + PE:PP + PS:PP (no intercept)
12 runs, 6 estimable coefficients, 6 residual df

term   estimate  std. error      t         p
-----  --------  ----------  -----  --------  ---
PE         11.7      0.4941  23.68   <0.0001  ***
PS          9.4      0.4941  19.02   <0.0001  ***
PP         16.4      0.4941  33.19   <0.0001  ***
PE:PS      17.4       2.421  7.188  0.000367  ***
PE:PP        12       2.421  4.957   0.00256  **
PS:PP     -12.2       2.421  -5.04   0.00236  **
mixture components in L-pseudo-components (x − low) / 1, 0 … 1; no intercept (the linear blending terms add up to it)

σ = 0.6988   R² = 0.9744   adjusted R² = 0.9531   predicted R² = 0.8978
F = 45.76 on 5 and 6 df, p = 0.000106

ANOVA (mixture: linear blending against the mean, then each further term in order)
source           df  sum of sq.  mean sq.      F         p
---------------  --  ----------  --------  -----  --------
Linear blending   2       55.86     27.93   57.2  0.000124
PE:PS             1       26.58     26.58  54.43  0.000318
PE:PP             1       16.88     16.88  34.57   0.00107
PS:PP             1        12.4      12.4   25.4   0.00236
Residuals         6        2.93    0.4883

response traces (Cox directions through the centroid of the region; each component from its smallest to its largest feasible value)
component  low                                             high
---------  --------  -----------  ----------  -----------  -------
PE         0: 9.85   0.25: 13.64  0.5: 15.21  0.75: 14.57  1: 11.7
PS         0: 17.05  0.25: 15.06  0.5: 13.12  0.75: 11.24  1: 9.4
PP         0: 14.9   0.25: 14.44  0.5: 14.54  0.75: 15.19  1: 16.4
```

Of the pure fibres PP stretches most (16.4). PE blends synergistically with both others — the
50:50 PE/PS blend is predicted at 11.7/2 + 9.4/2 + 17.4/4 = 14.9, well above either alone — while
PS and PP are antagonistic. (With Cornell's third replicate of the binaries the coefficients are
11.7, 9.4, 16.4, 19.0, 11.4 and −9.6; the test suite checks aikidoe's fit against R on those data.)
The **mixture ANOVA** tests linear
blending (q − 1 df: do the pure components differ?) against the mean, then each further term in
turn.

The **ternary plot** (Analyse step) shows the fitted response over the triangle of three
components; with more, choose the three and the others are held at the region's centroid. Grey
cells are outside the limits. The **Cox traces** show each component's effect along its Cox
direction: the component changes and the others keep their proportions to each other, from the
centroid of the region to its edges. A steep trace is an influential component; a flat one could
be fixed (Cox 1971; for constrained regions see Piepel 1982, and for screening many components
with traces, Snee & Marquardt 1976).

## Optimising a blend

The Optimise step (or `doe optimise`) searches the mixture region — random feasible blends, then
transfers between pairs of components and steps of the process factors — for the best overall
desirability, and shows it on a ternary map. The prediction profiler moves one component along its
Cox direction, so the blend still adds up to the total. `doe optimise` on the exercise above:

```console
$ doe exercise run medium.aikidoe.json
medium.aikidoe.json: results for 14 runs (budget 14)
$ doe goal medium.aikidoe.json density --maximize --lower 4 --upper 5.5
density: maximize, lower 4, upper 5.5
$ doe optimise medium.aikidoe.json --model "density ~ mixquadratic"
models: density ~ mixquadratic
region: the mixture (glucose + glutamine + supplement = 100, within the bounds)

best settings: glucose=40, glutamine=40, supplement=20
overall desirability D = 0.7537
response  predicted  95% CI         goal                d
--------  ---------  -------------  -------------  ------
density        5.13  4.927 … 5.334  max (4 → 5.5)  0.7537
```

## The slack-variable alternative

When one ingredient is a filler — water, a base, a diluent — whose own effect does not interest
you, the **slack-variable** approach treats the others as ordinary factors and lets the filler make
up the rest. Any of the usual designs can then be used, and the coefficients read as "replacing the
filler with this". It is simpler, and often fine; but the effects depend on which ingredient is
chosen as the slack, and when the filler's own blending matters (or it is not clearly the largest
ingredient), the Scheffé approach is safer (Cornell 2002). aikidoe does not automate the
slack variable: define the non-filler ingredients as ordinary factors, with a constraint that their
sum stays below the total.
