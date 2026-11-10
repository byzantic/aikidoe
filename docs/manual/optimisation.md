# Optimisation and robust design

## Desirability

Most processes have several responses, and the best settings for one are rarely the best for all.
**Desirability** (Derringer & Suich 1980) turns each response into a score d between 0
(unacceptable) and 1 (fully satisfactory), and combines them into one overall score D, the
weighted geometric mean of the d's — so any unacceptable response makes D = 0.

Each response's goal, on the Optimise step or with `doe goal`:

| goal | d = 0 | d = 1 |
|---|---|---|
| maximise | below *lower* | at or above *target* (or *upper*) |
| minimise | above *upper* | at or below *target* (or *lower*) |
| target | outside *lower* … *upper* | at *target* |
| in range | outside *lower* … *upper* | inside |

The **weight** shapes the curve between (1 linear; above 1 stricter, below 1 more lenient; two
weights for a target, below and above it), and the **importance** weights a response in D.

## Best settings

**Find best settings** searches for the settings with the largest D within the region — the
factor ranges (a cube), or a sphere, which suits a central composite design whose axial points
lie outside the cube — from many starting points, respecting constraints. Factors can be held at
a value. Each response's prediction is shown with its 95 % confidence interval: D is computed
from predictions, and the intervals say how sure they are. Confirm the result with
[confirmation runs](designs-sequential.md#confirmation-runs).

### Beyond the runs

A fitted model is only supported where there are runs. When the best settings (or settings you
type in) go beyond them, the Optimise step says so, in either of two ways:

- **outside the region of the runs**: the settings lie outside the convex hull of the runs — the
  smallest region with straight edges that contains them all — in the continuous factors. A
  sphere region, or a fraction that leaves corners of the cube unrun, can put the optimum there;
- **far from the runs**: inside that region, but the
  [scaled prediction variance](concepts.md#prediction-variance) of a fitted model there is larger
  than at any run — a gap in the design, where the prediction rests on few runs.

Either way the predicted D is an extrapolation: treat the settings as a direction to explore, and
run at or near them before relying on them. Augmenting the design towards them
([sequential designs](designs-sequential.md)) both checks the prediction and fills the gap.

## Profiler

The prediction profiler shows each response against each factor, with the others held at the
current settings, and the 95 % confidence band. Click a plot to move a factor; the dashed lines
mark each response's limits. It shows at a glance which factors matter for which response, and
where the trade-offs are.

## Overlay

The overlay plots D over two factors (the others at the current settings), with the regions
where some response is unacceptable greyed out: the sweet spot is the coloured region. The runs
are drawn on it as open circles, faded when their other factors differ from the current settings
(the filled circle); for a mixture, the triangle shows each run's shares of the three components.
A sweet spot with no runs near it rests on the model alone. The robustness map over two control
factors shows the runs the same way.

## Robust design

A robust process is insensitive to things that vary in production. Two kinds of variation:

- **noise factors**: varied deliberately in the experiment, but random in production (ambient
  temperature, raw-material lot) — give each a standard deviation in production;
- **tolerances**: how far a control factor's actual value wanders from its setting (a flow
  controller's accuracy) — a standard deviation about the setting.

**Propagation of error** transmits this variation through the fitted surface: to second order,
the variance of the response at settings x is Σ gᵢ² σᵢ² + ½ Σ Hᵢⱼ² σᵢ² σⱼ² + σ², with g and H the
gradient and curvature of the surface and σ² the run-to-run variance. Settings where the surface
is flat in the noisy directions are robust. The Robustness panel shows the breakdown at the
current settings and the standard deviation over two control factors.

**Dual response** optimisation (Vining & Myers 1990; Lin & Tu 1995) then chooses settings for
both the mean and the standard deviation: the mean on target with the smallest standard
deviation; the smallest mean-squared error; or the largest (or smallest) mean with the standard
deviation below a limit. The standard deviation can come from propagation of error, or from a
fitted model of log s (per-wafer or replicate standard deviations).

### An example

Montgomery's filtration-rate experiment (*Design and Analysis of Experiments*, example 6.2): a 2⁴
factorial in temperature (A), pressure (B), formaldehyde concentration (C) and stirring rate (D).
Temperature is hard to control in the plant, so treat it as a noise factor with standard
deviation 1 (coded) and find concentration and stirring settings that keep the rate at 72 gal/h
with the least variation:

```console
$ doe init filt.aikidoe.json --factor A:-1:1 --factor B:-1:1 --factor C:-1:1 --factor D:-1:1 --response rate:gal/h --seed 6
created filt.aikidoe.json: 4 factors, 1 responses, seed 6
$ doe design filt.aikidoe.json --full
filt.aikidoe.json: full-factorial, 16 runs, randomisation complete, seed 6
```

```file filt.csv
run,rate
1,45
2,71
3,48
4,65
5,68
6,60
7,80
8,65
9,43
10,100
11,45
12,104
13,75
14,86
15,70
16,96
```

```console
$ doe import filt.aikidoe.json filt.csv
16 value(s) read (wide format)
filt.aikidoe.json: 16 observation(s)
$ doe robust filt.aikidoe.json --model "rate ~ A + C + D + A:C + A:D" --noise "A=1" --target 72 --fix B=0
mean model: rate ~ A + C + D + A:C + A:D; residual sd 4.417
sd by propagation of error: A noise sd 1

minimum sd with the mean on target 72:
settings: B=0, C=0.886867, D=-0.333867
mean 72, sd 4.417 (transmitted 0, residual 4.417)
source       sd  slope ∂y/∂x  % of variance
--------  -----  -----------  -------------
A             1            0              0
residual  4.417                         100
```

The fitted surface's slope in temperature is 10.81 − 9.06 C + 8.31 D (coded units); it vanishes
at these settings, so only the run-to-run variation (σ = 4.42) remains: the mean is on target and the
temperature no longer matters.
