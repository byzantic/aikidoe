# Power for counts and proportions in a split-plot (issue #64), by simulation with lme4::glmer:
# for each term, the experiment is simulated with that term at its effect (the intercept at the
# baseline, the other terms 0) and every whole plot shifted by a normal draw of standard deviation
# σ on the link scale; the GLMM with a random whole-plot intercept is fitted with and without the
# term (adaptive Gauss–Hermite quadrature, 25 nodes, as aikidoe's analysis), and the likelihood-
# ratio test counted at α = 0.05 — as aikidoe's analysis does it: a term whose columns are all
# constant within every whole plot is an F = χ²/df on (df, m − q) (m whole plots, q such columns,
# the intercept among them), unless σ is estimated as 0; other terms are χ² on df.
# Negative binomial counts (θ given) are simulated and fitted with glmmTMB (nbinom2, θ estimated in
# each fit, as aikidoe's analysis does; glmer.nb is too fragile to run unattended thousands of times).
# Recorded: the simulated power of each term and its Monte Carlo standard error. Seeded, so the
# result changes only if glmer's fits do; the drift tolerance allows for a few fits that change.
source("tests/ref/fixture.R")
suppressPackageStartupMessages({ library(lme4); library(glmmTMB) })
cases <- list()
ctrl <- glmerControl(optimizer = "bobyqa", optCtrl = list(maxfun = 1e5), check.conv.singular = "ignore",
                     check.conv.grad = "ignore", check.conv.hess = "ignore")

# W whole plots of k runs: T (hard to change) alternates between whole plots, B within them
splitplot <- function(W, k) {
  d <- do.call(rbind, lapply(seq_len(W), function(w) data.frame(wp = w, T = if (w %% 2 == 1) -1 else 1, B = rep(c(-1, 1), length.out = k))))
  d$wp <- factor(d$wp); d
}

simcase <- function(name, W, k, dist, base, ratio, sigma, trials = 30, nsim = 500, seed = 1, theta = NULL) {
  set.seed(seed)
  d <- splitplot(W, k); n <- nrow(d)
  X <- model.matrix(~ T + B, d); labels <- c("T", "B")
  lvl <- apply(X, 2, function(x) all(tapply(x, d$wp, function(v) length(unique(v)) == 1)))
  dfG <- W - sum(lvl)
  fam <- if (dist == "binomial") binomial() else poisson()
  power <- se <- done <- numeric(2)
  for (ti in 1:2) {
    beta <- c(fam$linkfun(base), 0, 0); beta[ti + 1] <- log(ratio[[labels[ti]]]) / 2
    wpTerm <- lvl[ti + 1]
    hits <- 0; ok <- 0
    for (s in seq_len(nsim)) {
      u <- rnorm(W, 0, sigma)
      eta <- drop(X %*% beta) + u[as.integer(d$wp)]
      if (dist == "negbin") { d$y <- rnbinom(n, size = theta, mu = exp(eta)); f1 <- y ~ T + B + (1 | wp); f0 <- as.formula(paste("y ~", labels[3 - ti], "+ (1 | wp)")) }
      else if (dist == "poisson") { d$y <- rpois(n, exp(eta)); f1 <- y ~ T + B + (1 | wp); f0 <- as.formula(paste("y ~", labels[3 - ti], "+ (1 | wp)")) }
      else { d$y <- rbinom(n, trials, plogis(eta)) / trials; f1 <- y ~ T + B + (1 | wp); f0 <- as.formula(paste("y ~", labels[3 - ti], "+ (1 | wp)")) }
      r <- if (dist == "negbin") tryCatch(suppressWarnings({
        m1 <- glmmTMB(f1, d, family = nbinom2); m0 <- glmmTMB(f0, d, family = nbinom2)
        if (is.na(logLik(m1)) || is.na(logLik(m0))) NA else {
          x2 <- max(0, 2 * (as.numeric(logLik(m1)) - as.numeric(logLik(m0))))
          if (wpTerm && sqrt(VarCorr(m1)$cond$wp[1]) > 1e-3) pf(x2, 1, dfG, lower.tail = FALSE) else pchisq(x2, 1, lower.tail = FALSE)
        } }), error = function(e) NA) else tryCatch({
        m1 <- if (dist == "poisson") glmer(f1, d, family = fam, nAGQ = 25, control = ctrl) else glmer(f1, d, family = fam, weights = rep(trials, n), nAGQ = 25, control = ctrl)
        m0 <- if (dist == "poisson") glmer(f0, d, family = fam, nAGQ = 25, control = ctrl) else glmer(f0, d, family = fam, weights = rep(trials, n), nAGQ = 25, control = ctrl)
        x2 <- max(0, 2 * (as.numeric(logLik(m1)) - as.numeric(logLik(m0))))
        if (wpTerm && getME(m1, "theta") > 1e-4) pf(x2, 1, dfG, lower.tail = FALSE) else pchisq(x2, 1, lower.tail = FALSE)
      }, error = function(e) NA)
      if (!is.na(r)) { ok <- ok + 1; if (r < 0.05) hits <- hits + 1 }
    }
    power[ti] <- hits / ok; se[ti] <- sqrt(power[ti] * (1 - power[ti]) / ok); done[ti] <- ok
  }
  list(name = name, input = list(wholePlots = W, perWholePlot = k, distribution = dist, baseline = base, ratio = ratio, sigma = sigma, trials = trials, alpha = 0.05,
                                 theta = theta, formula = "T + B", wholePlotTerms = I(labels[lvl[-1]]), dfGroups = dfG),
       output = list(terms = I(labels), power = I(power), se = I(se), nsim = I(done)))
}

cases[[1]] <- simcase("poisson-8x4-sigma0.3", 8, 4, "poisson", 20, list(T = 1.8, B = 1.3), 0.3, seed = 11)
cases[[2]] <- simcase("binomial-12x2-sigma0.4", 12, 2, "binomial", 0.4, list(T = 2.5, B = 1.6), 0.4, seed = 12)
cases[[3]] <- simcase("poisson-16x4-sigma0.6", 16, 4, "poisson", 10, list(T = 2, B = 1.25), 0.6, seed = 13)
cases[[4]] <- simcase("poisson-6x4-sigma0.15", 6, 4, "poisson", 50, list(T = 1.4, B = 1.15), 0.15, seed = 14)
cases[[5]] <- simcase("negbin-12x4-sigma0.4-theta4", 12, 4, "negbin", 20, list(T = 2, B = 1.4), 0.4, seed = 15, theta = 4)

write_fixture("power-glmm-r", cases, "tests/ref/power_glmm_r.R", c("lme4", "glmmTMB"), tolerance = list(rel = 0, abs = 0.03))
