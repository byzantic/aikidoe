# Issue #12 reference: skpr::eval_design effect and parameter power for the designs of
# fixture.power-designs.R (effectsize = Δ; categorical with contr.sum and anticipated coefficients 1 per
# column, given explicitly), and pwr::pwr.t.test for the one-factor two-group case.
source("tests/ref/fixture.R")
source("tests/ref/fixture.power-designs.R")
suppressPackageStartupMessages({ library(skpr); library(pwr) })
cases <- lapply(designs, function(dd) {
  args <- list(design = dd$d, model = dd$r, alpha = dd$alpha, effectsize = dd$delta)
  if ("g" %in% names(dd$d)) { args$contrasts <- contr.sum; args$anticoef <- rep(dd$delta / 2, ncol(model.matrix(dd$r, dd$d, contrasts.arg = list(g = "contr.sum")))) }
  out <- tryCatch({ e <- as.data.frame(do.call(eval_design, args)); list(parameter = as.character(e$parameter), type = as.character(e$type), power = e$power) },
    error = function(err) list(error = conditionMessage(err)))
  list(name = dd$name, input = list(rows = rows_of(dd$d), model = dd$aikidoe, delta = dd$delta, alpha = dd$alpha, levels = dd$levels), output = out)
})
p <- pwr.t.test(n = 6, d = 1.5, sig.level = 0.05, type = "two.sample", alternative = "two.sided")
cases[[length(cases) + 1]] <- list(name = "pwr.t.test n = 6 per group, d = 1.5", input = list(n = 6, d = 1.5, alpha = 0.05), output = list(power = p$power))
write_fixture("power-skpr", cases, "tests/ref/power_skpr.R", c("skpr", "pwr"), tolerance = list(rel = 1e-6, abs = 1e-8))
