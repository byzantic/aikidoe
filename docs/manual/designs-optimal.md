# Optimal designs

When no standard design fits — an awkward number of runs, a model with some interactions but
not others, a mix of factor types, constraints that cut corners off the region, runs already
done — an **optimal design** chooses the runs that estimate *your* model best.

## Criteria

- **D-optimal** maximises |XᵀX|: the most precise coefficients jointly (the default).
- **I-optimal** minimises the average prediction variance over the region: the best predictions
  (the app's default for quadratic models, which are for prediction; `--criterion I`).
- **A-optimal** minimises the average variance of the coefficients.

The search is coordinate exchange (Meyer & Nachtsheim 1995) from several random starts (20 by
default; the seed makes it reproducible). The Design step shows the D-, A- and G-efficiencies
(relative to an ideal orthogonal design on the cube), the average prediction variance, a
fraction-of-design-space plot and the correlations between model terms.

Give the **model** as a formula's right-hand side (`main`, `2fi`, `quadratic`, or terms such as
`A + B + C + A:B + I(C^2)`; see [formula syntax](reference-formulas.md)) and the **runs**: at
least as many as the model has coefficients, and preferably 4–6 more to estimate the error.

```console
$ doe init opt.aikidoe.json --factor A:0:10 --factor B:0:10 --factor gas=N2,O2,Ar --response y --seed 4
created opt.aikidoe.json: 3 factors, 1 responses, seed 4
$ doe design opt.aikidoe.json --optimal --runs 14 --model "A*B + gas + I(A^2)" --restarts 10
opt.aikidoe.json: optimal, 14 runs, randomisation complete, seed 4
D-optimal for A*B + gas + I(A^2): D-efficiency 60.69%, A 37.12%, G 83.91%, average prediction variance 0.4176 (10 starts)
```

## Constraints

Linear constraints on the settings — in natural units (`T + 2*t <= 1050`) or coded ones — remove
part of the region: a temperature–time combination that would damage the wafers, a mixture that
cannot exceed a total. Standard designs ignore them (aikidoe warns when a run violates one);
optimal designs search only the feasible region. Constraints are entered on the Define step or in
the study file ([format](reference-study-format.md#constraint)).

## Augmentation

The same search can add runs to existing ones: `doe augment --optimal --runs n --model …`
chooses n new runs that, *together with those already done*, estimate a bigger model — the
general-purpose next stage ([sequential experiments](designs-sequential.md)).

## Split-plot

With hard-to-change factors the search works on the generalised least-squares information of the
whole-plot structure ([split-plot designs](designs-split-plot.md#optimal-split-plot-designs)).

## References

Atkinson, Donev & Tobias (2007); Goos & Jones (2011); Meyer & Nachtsheim (1995). See the
[bibliography](bibliography.md).
