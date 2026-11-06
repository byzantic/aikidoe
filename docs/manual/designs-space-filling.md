# Space-filling designs

A **simulator** gives the same answer every time it is run at the same settings: there is no
noise to average, no need to randomise or replicate. What matters is covering the region well
enough that a **surrogate model** fitted to the runs predicts accurately between them. Corner-
heavy factorial designs are a poor fit; space-filling designs spread the runs evenly.

## Latin hypercube

Each factor's range is cut into n equal slices and each slice holds exactly one run, so every
factor is sampled at n distinct levels. Among the many such designs aikidoe searches for a
**maximin** one: the smallest distance between any two runs is as large as possible (Morris &
Mitchell 1995), by exchanging levels within columns from several random starts.

The default size is max(10 k, p + 5) runs for k factors (p: the number of coefficients of the
full quadratic), enough to fit a quadratic surrogate and check it by cross-validation.

```console
$ doe init lhs.aikidoe.json --factor a:-2:2 --factor b:-2:2 --factor c:-1:1 --response y --seed 7
created lhs.aikidoe.json: 3 factors, 1 responses, seed 7
$ doe design lhs.aikidoe.json --lhs
lhs.aikidoe.json: lhs, 30 runs, randomisation complete, seed 7
maximin Latin hypercube: smallest distance between runs 0.5538 (coded units); default model: quadratic
```

Latin hypercubes are offered on the Design step for continuous factors, first when the study has
a simulator. The design's diagnostics show the correlations between the quadratic model's terms
and its efficiency for that model.

## Then

Run the design on the simulator, fit the surrogate and check its cross-validated error, then
estimate sensitivities and yield: [simulation and yield](simulation.md).

## References

McKay, Beckman & Conover (1979); Morris & Mitchell (1995); Santner, Williams & Notz (2018). See
the [bibliography](bibliography.md).
