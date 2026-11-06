# Process topics: wafers, sites, gauges

Semiconductor and other batch processes add structure that a textbook design ignores: furnace
runs that hold many wafers, several wafers per condition, many sites per wafer, slots in a boat,
a measurement tool with its own variation. aikidoe models that structure, so effects are judged
against the right variation.

## Hard-to-change factors

A furnace temperature, a chamber condition, a gas chemistry that takes a purge to change: set once
for a group of runs, these are the whole-plot factors of a [split-plot design](designs-split-plot.md).
Mark them *hard to change* when defining the study.

## Wafers and sites

Say how each response is measured (Define step, *measured*): once per run, per wafer, per site,
or per wafer and site. The run sheet then has one result column per site (or a row per wafer),
and the observations keep the wafer, site and boat slot of every reading.

**Drop-in sites** are the positions of the test structures, in mm from the wafer centre. Presets
for 5 and 9 sites on a wafer of given diameter, or your own list (`doe sites --scheme 9
--diameter 200`, or `--site id:x:y …`). Each site has a radius r and a relative radius ρ = r / R.

The readings of one wafer are not replicates of the run: they share its settings and its
run-to-run error. The analysis is a [mixed model](analysis.md#mixed-models) with random effects for
whole plots (if any), runs and wafers, so a run-level effect is tested against the run-to-run
variation, not the much smaller within-wafer variation.

### Position terms

Within-wafer patterns can be modelled in the same mixed model with **position terms**, used in a
formula like factors:

| term | meaning |
|---|---|
| `radius2` | ρ², coded from the centre (−1) to the edge (+1): a bowl or dome across the wafer |
| `edge` | centre (ρ < 0.5) or edge, as a two-level factor |
| `waferX`, `waferY` | x / R and y / R: a tilt across the wafer |
| `slot` | the boat or cassette slot, as a linear covariate (coded over the slots used) |
| `slotZone` | the slot in three equal zones, as a blocking factor |

An interaction such as `T:radius2` asks whether the bowl deepens with temperature — uniformity as
a response of the process. The Analyse step's Sites panel shows each wafer's readings on an
outline and against radius.

### Per-wafer summaries

A response measured per site can be summarised per wafer — the **mean**, the **standard
deviation**, **log s** (log₁₀ of the standard deviation, the usual response for uniformity) or the
**range / mean** — and the summaries analysed as responses of their own (`doe summary STUDY Rs
--stats mean,logsd`). They are computed from the readings when needed, so they never go stale.

See the [furnace worked example](example-furnace.md).

## Gauge R&R

A **gauge repeatability and reproducibility** study measures the measurement system: several parts
(wafers, structures) measured several times by several operators (or tools), in random order.
aikidoe analyses it by the ANOVA method (as R's `SixSigma::ss.rr` does):

- **variance components**: repeatability (the same operator measuring the same part again),
  reproducibility (between operators, and the operator × part interaction when it is
  significant at 0.05; otherwise it is pooled into repeatability) and part-to-part;
- **%contribution** (of variance), **%study variation** (of 6σ, or 5.15σ), and **%tolerance**
  when the specification width is given;
- the **number of distinct categories** ndc = ⌊√2 σ_part / σ_gauge⌋: how many groups of parts the
  gauge can tell apart (5 or more is wanted);
- a verdict by the AIAG guidelines: gauge R&R below 10 % of study variation is good, 10–30 %
  marginal, above 30 % unacceptable.

Crossed studies (every operator measures every part), nested ones (each operator their own parts,
for destructive tests) and repeatability-only studies (an automated tool, no operators) are
supported. On the Define step, the **gauge…** button beside a response; on the command line, `doe gauge`.

The result — σ_meas — is kept with the response and used by the power calculation: σ =
√(σ²_process + σ²_meas), or σ_meas alone as an upper bound on power. An experiment cannot detect
effects much smaller than the measurement's own noise.

See the [gauge worked example](example-gauge.md).
