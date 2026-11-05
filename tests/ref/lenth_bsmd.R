# Lenth's method references (issue #6): PSE, ME and SME from BsMD::LenthPlot, which returns
# c(alpha, PSE, ME, SME) for a vector of effects.
source("tests/ref/fixture.R")
suppressPackageStartupMessages(library(BsMD))
set.seed(20261105)

# drill advance, Daniel (1976) / Box, Hunter & Hunter: saturated 2^4 on log10(y)
d <- expand.grid(A = c(-1, 1), B = c(-1, 1), C = c(-1, 1), D = c(-1, 1))
y <- c(1.68, 1.98, 3.28, 3.44, 4.98, 5.70, 9.97, 9.07, 2.07, 2.44, 4.09, 4.53, 7.77, 9.43, 11.75, 16.30)
drill <- 2 * coef(lm(log10(y) ~ A * B * C * D, data = d))[-1]

sets <- list(
  list("drill advance 2^4, log10 (15 effects)", unname(drill)),
  list("7 effects, one large", c(0.3, -0.1, 4.2, 0.05, -0.2, 0.15, -0.35)),
  list("31 random effects with 4 active", c(rnorm(27, 0, 1), 8, -6, 5, 9)),
  list("11 effects (Plackett-Burman 12)", c(rnorm(9, 0, 0.5), 3, -2.5))
)
cases <- lapply(sets, function(s) {
  r <- LenthPlot(s[[2]], alpha = 0.05, plt = FALSE)
  list(name = s[[1]], input = list(effects = I(s[[2]])),
       output = list(pse = unname(r[2]), me = unname(r[3]), sme = unname(r[4])))
})
write_fixture("lenth-bsmd", cases, "tests/ref/lenth_bsmd.R", c("BsMD"))
