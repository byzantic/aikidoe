# Power for counts with nested random intercepts (issue #78), by simulation with lme4::glmer:
# days ⊃ whole plots ⊃ runs. For each term the experiment is simulated with that term at its effect
# (the others 0, the intercept at the baseline), each day and each whole plot shifted by normal
# draws (σ_day, σ_wp on the log scale); glmer (Laplace, (1 | day) + (1 | wp)) is fitted with and
# without the term, and the likelihood-ratio test counted at α = 0.05 as aikidoe's analysis does
# it: a term whose columns all lie in one stratum — the outermost grouping, among those whose σ is
# estimated above 0, within whose groups they are constant — is an F = χ²/df on that stratum's df
# (its groups, less those of the grouping outside it, less the stratum's coefficients); others χ².
# Recorded: the simulated power of each term and its Monte Carlo standard error. Seeded.
source("tests/ref/fixture.R")
suppressPackageStartupMessages(library(lme4))
ctrl <- glmerControl(optimizer = "bobyqa", optCtrl = list(maxfun = 1e5), check.conv.singular = "ignore",
                     check.conv.grad = "ignore", check.conv.hess = "ignore")
cases <- list()

layout <- function(days, wpd, k) {
  d <- expand.grid(run = seq_len(k), wp = seq_len(wpd), day = seq_len(days))
  d$wp <- (d$day - 1) * wpd + d$wp
  d$D <- ifelse(d$day %% 2 == 1, -1, 1); d$T <- ifelse(d$wp %% 2 == 1, -1, 1); d$B <- rep(c(-1, 1), length.out = nrow(d))
  d
}

simnested <- function(name, days, wpd, k, base, ratio, sigma, nsim = 400, seed = 1) {
  set.seed(seed)
  d <- layout(days, wpd, k); n <- nrow(d); labels <- c("D", "T", "B")
  X <- model.matrix(~ D + T + B, d)
  grp <- list(day = d$day, wp = d$wp)
  constIn <- function(x, g) all(tapply(x, g, function(v) length(unique(v)) == 1))
  power <- se <- done <- numeric(3)
  for (ti in 1:3) {
    beta <- c(log(base), 0, 0, 0); beta[ti + 1] <- log(ratio[[labels[ti]]]) / 2
    hits <- 0; ok <- 0
    for (s in seq_len(nsim)) {
      ud <- rnorm(days, 0, sigma$day); uw <- rnorm(days * wpd, 0, sigma$wp)
      d$y <- rpois(n, exp(drop(X %*% beta) + ud[d$day] + uw[d$wp]))
      r <- tryCatch({
        m1 <- glmer(y ~ D + T + B + (1 | day) + (1 | wp), d, family = poisson, control = ctrl)
        m0 <- glmer(as.formula(paste("y ~", paste(labels[-ti], collapse = " + "), "+ (1 | day) + (1 | wp)")), d, family = poisson, control = ctrl)
        x2 <- max(0, 2 * (as.numeric(logLik(m1)) - as.numeric(logLik(m0))))
        vc <- as.data.frame(VarCorr(m1)); sd <- c(day = vc$sdcor[vc$grp == "day"], wp = vc$sdcor[vc$grp == "wp"])
        active <- names(sd)[sd > 1e-4]
        lev <- vapply(colnames(X), function(cn) { for (a in active) if (constIn(X[, cn], grp[[a]])) return(a); NA_character_ }, "")
        L <- lev[labels[ti]]
        if (is.na(L)) pchisq(x2, 1, lower.tail = FALSE) else {
          i <- match(L, active); units <- length(unique(grp[[L]])) - (if (i > 1) length(unique(grp[[active[i - 1]]])) else 0)
          ddf <- units - sum(lev == L, na.rm = TRUE)
          pf(x2, 1, ddf, lower.tail = FALSE)
        }
      }, error = function(e) NA)
      if (!is.na(r)) { ok <- ok + 1; if (r < 0.05) hits <- hits + 1 }
    }
    power[ti] <- hits / ok; se[ti] <- sqrt(power[ti] * (1 - power[ti]) / ok); done[ti] <- ok
  }
  list(name = name, input = list(days = days, wholePlotsPerDay = wpd, perWholePlot = k, distribution = "poisson", baseline = base, ratio = ratio, sigma = sigma, alpha = 0.05, formula = "D + T + B"),
       output = list(terms = I(labels), power = I(power), se = I(se), nsim = I(done)))
}

cases[[1]] <- simnested("poisson-6days-4wp-2runs", 6, 4, 2, 15, list(D = 2.2, T = 1.6, B = 1.25), list(day = 0.35, wp = 0.3), seed = 21)
cases[[2]] <- simnested("poisson-8days-3wp-4runs", 8, 3, 4, 10, list(D = 1.8, T = 1.5, B = 1.2), list(day = 0.25, wp = 0.4), seed = 22)

write_fixture("power-glmm-nested-r", cases, "tests/ref/power_glmm_nested_r.R", c("lme4"), tolerance = list(rel = 0, abs = 0.03))
