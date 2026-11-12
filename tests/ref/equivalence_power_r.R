# Power and sample size for equivalence and non-inferiority (issue #84, phase 2), from PowerTOST:
# power.TOST (method "exact", Owen's Q), power.noninf and sampleN.TOST / sampleN.noninf, for a
# parallel design (two groups), paired data and a 2x2 crossover, on the additive scale (theta as
# differences, CV as the standard deviation: of the runs for "parallel", within a pair or subject
# for "paired" and "2x2") and on the log scale (ratios, CV the coefficient of variation; within a
# pair or subject for "paired" and "2x2"). n is the total number of subjects or runs.
source("tests/ref/fixture.R")
suppressPackageStartupMessages(library(PowerTOST))
cases <- list()
add <- function(x) cases[[length(cases) + 1]] <<- x
pw <- function(...) power.TOST(alpha = 0.05, method = "exact", ...)

# power, additive scale
for (p in list(list(design = "parallel", theta0 = 0, CV = 1, n = 20), list(design = "parallel", theta0 = 0.2, CV = 1, n = 40),
               list(design = "parallel", theta0 = 0.5, CV = 0.8, n = 30), list(design = "parallel", theta0 = 0, CV = 2, n = 12),
               list(design = "paired", theta0 = 0.3, CV = 1.2, n = 15), list(design = "paired", theta0 = 0, CV = 0.5, n = 6)))
  add(list(name = sprintf("power %s additive theta0=%g CV=%g n=%d", p$design, p$theta0, p$CV, p$n), input = c(p, list(logscale = FALSE, lower = -1, upper = 1)),
    output = list(power = pw(logscale = FALSE, theta1 = -1, theta2 = 1, theta0 = p$theta0, CV = p$CV, n = p$n, design = p$design))))
# power, log scale (ratios, margins 0.8 ... 1.25)
for (p in list(list(design = "parallel", theta0 = 0.95, CV = 0.25, n = 40), list(design = "parallel", theta0 = 1, CV = 0.3, n = 24),
               list(design = "2x2", theta0 = 0.95, CV = 0.2, n = 20), list(design = "2x2", theta0 = 1.05, CV = 0.3, n = 32), list(design = "paired", theta0 = 0.9, CV = 0.15, n = 12)))
  add(list(name = sprintf("power %s log theta0=%g CV=%g n=%d", p$design, p$theta0, p$CV, p$n), input = c(p, list(logscale = TRUE, lower = 0.8, upper = 1.25)),
    output = list(power = pw(logscale = TRUE, theta1 = 0.8, theta2 = 1.25, theta0 = p$theta0, CV = p$CV, n = p$n, design = p$design))))
# non-inferiority power (margin below: higher is better), additive and log
for (p in list(list(design = "parallel", margin = -1, theta0 = 0, CV = 1, n = 20, logscale = FALSE), list(design = "parallel", margin = -0.5, theta0 = 0.2, CV = 1, n = 50, logscale = FALSE),
               list(design = "2x2", margin = 0.8, theta0 = 0.95, CV = 0.25, n = 24, logscale = TRUE)))
  add(list(name = sprintf("noninferiority %s margin=%g theta0=%g CV=%g n=%d", p$design, p$margin, p$theta0, p$CV, p$n), input = p,
    output = list(power = power.noninf(alpha = 0.05, logscale = p$logscale, margin = p$margin, theta0 = p$theta0, CV = p$CV, n = p$n, design = p$design))))
# sample sizes for 80 % power
for (p in list(list(design = "parallel", logscale = FALSE, theta0 = 0, CV = 1), list(design = "parallel", logscale = FALSE, theta0 = 0.2, CV = 1),
               list(design = "parallel", logscale = FALSE, theta0 = 0.3, CV = 0.6), list(design = "2x2", logscale = TRUE, theta0 = 0.95, CV = 0.25),
               list(design = "2x2", logscale = TRUE, theta0 = 0.9, CV = 0.2), list(design = "parallel", logscale = TRUE, theta0 = 0.95, CV = 0.3))) {
  th <- if (p$logscale) c(0.8, 1.25) else c(-1, 1)
  s <- sampleN.TOST(alpha = 0.05, targetpower = 0.8, logscale = p$logscale, theta0 = p$theta0, theta1 = th[1], theta2 = th[2], CV = p$CV, design = p$design, method = "exact", print = FALSE, details = FALSE)
  add(list(name = sprintf("sample size %s %s theta0=%g CV=%g", p$design, if (p$logscale) "log" else "additive", p$theta0, p$CV), input = c(p, list(lower = th[1], upper = th[2])),
    output = list(n = s[["Sample size"]], power = s[["Achieved power"]])))
}
s <- sampleN.noninf(alpha = 0.05, targetpower = 0.8, logscale = FALSE, margin = -1, theta0 = 0, CV = 1, design = "parallel", print = FALSE, details = FALSE)
add(list(name = "sample size noninferiority parallel", input = list(design = "parallel", logscale = FALSE, margin = -1, theta0 = 0, CV = 1), output = list(n = s[["Sample size"]], power = s[["Achieved power"]])))

write_fixture("equivalence-power-r", cases, "tests/ref/equivalence_power_r.R", c("PowerTOST"), tolerance = list(rel = 1e-7, abs = 1e-9))
