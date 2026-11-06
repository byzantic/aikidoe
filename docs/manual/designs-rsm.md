# Response surfaces: central composite and Box–Behnken

Response-surface designs fit a full quadratic model — main effects, two-factor interactions and
squared terms — to find an optimum or describe curvature, usually for two to five factors that
screening has shown to matter.

## Central composite

A two-level factorial (the *cube*, a full factorial or a resolution V fraction), *axial* points at
±α on each factor's axis with the others at the centre, and centre points. Options:

- **α**: *rotatable* (the default: prediction variance depends only on the distance from the
  centre), *orthogonal*, *spherical* (√k), *face-centred* (α = 1: three levels only, useful when
  the ranges cannot be exceeded), or a value;
- **inscribed**: scale the design so the axial points are at the range limits and the cube
  inside them (when the ranges are hard limits);
- **centre points**: by default as many as give uniform precision for a rotatable design;
- **blocks**: the cube and the axial points in separate blocks (with α chosen for orthogonal
  blocking), which is also how a CCD is built sequentially from a factorial.

## Box–Behnken

Three levels per factor, for 3 to 7 factors: combinations of two-level factorials on pairs (or
groups) of factors with the others at their centre, plus centre points (default 3). There are no
corner runs — no run has every factor at an extreme — which matters when extreme combinations
are unsafe or impossible. Orthogonal blocking is available for 4 and 5 factors.

## Diagnostics

The Design step shows the **scaled prediction variance** against the distance from the centre —
flat for a rotatable design out to the cube — and the correlations between model terms. `doe
design --ccd` prints the variance by radius:

```console
$ doe init rsm.aikidoe.json --factor T:150:170 --factor time:20:80:min:log --response conv --seed 3
created rsm.aikidoe.json: 2 factors, 1 responses, seed 3
$ doe design rsm.aikidoe.json --ccd
rsm.aikidoe.json: ccd, 13 runs, randomisation complete, seed 3
α = 1.4142 (rotatable); cube 4 runs; centre points 5
scaled prediction variance (full quadratic) by radius: ρ 0: 2.6, ρ 0.5: 2.47, ρ 1: 3.49, ρ 1.41: 8.12
```

## Analysis

The default model is `quadratic`. The [Optimise](optimisation.md) step finds the best settings
within the region (the cube, or a sphere out to the axial points), with the profiler and the
overlay of the desirability over two factors. A quadratic surface is a local approximation: predictions beyond the axial points are
extrapolation.

## References

Box & Wilson (1951); Box & Behnken (1960); Myers, Montgomery & Anderson-Cook (2016). See the
[bibliography](bibliography.md).
