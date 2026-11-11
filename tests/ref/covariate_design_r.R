# Covariates at the design stage (issue #82, phase 3).
#
# 1. Power with a covariate: the residual sigma becomes sigma * sqrt(1 - rho^2) and the residual df
#    fall by one. The exact power of each main effect of a 2^3 (and a replicated 2^3 with 2fi) from
#    the non-central F (pf with ncp), and a Monte Carlo check that this is the power of the analysis
#    with the covariate in the model: y = X b + gamma z + e with z balanced against the factors
#    (centred, uncorrelated with every column) and corr(y, z | factors) = rho; lm(y ~ factors + z),
#    the proportion of p < 0.05 for each term over 4000 simulations.
# 2. Balance of covariate values against a design: R^2 of the values on the model's columns
#    (summary(lm)$r.squared) and the inflation of each coefficient's variance when the covariate is
#    added (diag of (X'X)^-1 with and without it).
source("tests/ref/fixture.R")
set.seed(20261184)
cases <- list()
add <- function(x) cases[[length(cases) + 1]] <<- x

full <- function(k, reps = 1) { d <- as.matrix(expand.grid(rep(list(c(-1, 1)), k))); d[rep(seq_len(nrow(d)), reps), , drop = FALSE] }

power_case <- function(name, D, model, delta, sigma, rho, nsim = 4000) {
  colnames(D) <- LETTERS[seq_len(ncol(D))]; d <- as.data.frame(D)
  X <- model.matrix(as.formula(paste("~", model)), d); n <- nrow(X); p <- ncol(X)
  se <- sigma * sqrt(1 - rho^2); df2 <- n - p - 1
  V <- solve(crossprod(X)); b <- c(0, rep(delta / 2, p - 1))
  exact <- sapply(2:p, function(j) { lam <- (b[j] / se)^2 / V[j, j]; pf(qf(0.95, 1, df2), 1, df2, ncp = lam, lower.tail = FALSE) })
  # Monte Carlo: a covariate balanced against the design (orthogonal to X, centred), scaled to have
  # variance 1; y's residual = gamma z + e with gamma = rho sigma, sd(e) = sigma sqrt(1 - rho^2)
  z0 <- rnorm(n); z <- residuals(lm(z0 ~ X - 1)); z <- z / sd(z)
  hits <- matrix(0, nsim, p - 1)
  for (s in seq_len(nsim)) {
    y <- X %*% b + rho * sigma * z + rnorm(n, sd = se)
    f <- lm(y ~ X[, -1] + z); pv <- summary(f)$coefficients[2:p, 4]
    hits[s, ] <- pv < 0.05
  }
  add(list(name = name, input = list(design = unname(lapply(seq_len(n), function(i) I(unname(D[i, ])))), model = model, delta = delta, sigma = sigma, rho = rho),
    output = list(columns = I(colnames(X)[-1]), dfRes = df2, power = I(exact), simulated = I(colMeans(hits)), nsim = nsim)))
}
power_case("2^3 main effects, rho = 0.7", full(3), "A + B + C", 2, 1.5, 0.7)
power_case("2^3 x 2 with 2fi, rho = 0.5", full(3, 2), "(A + B + C)^2", 1.5, 1, 0.5)
power_case("2^4 main effects, rho = 0.9", full(4), "A + B + C + D", 1, 1, 0.9)

balance_case <- function(name, D, model, v) {
  colnames(D) <- LETTERS[seq_len(ncol(D))]; d <- as.data.frame(D)
  X <- model.matrix(as.formula(paste("~", model)), d)
  r2 <- summary(lm(v ~ ., data = data.frame(X[, -1, drop = FALSE], v = v)))$r.squared
  z <- v - mean(v)
  infl <- diag(solve(crossprod(cbind(X, z))))[seq_len(ncol(X))] / diag(solve(crossprod(X)))
  add(list(name = name, input = list(design = unname(lapply(seq_len(nrow(D)), function(i) I(unname(D[i, ])))), model = model, values = I(v)),
    output = list(columns = I(colnames(X)[-1]), r2 = r2, vif = I(unname(infl[-1])))))
}
balance_case("2^3 x 2, values in run order", full(3, 2), "A + B + C", round(rnorm(16, 50, 5), 1))
balance_case("2^3 x 2, values rising with A", full(3, 2), "(A + B + C)^2", round(50 + 3 * full(3, 2)[, 1] + rnorm(16, sd = 2), 1))

write_fixture("covariate-design-r", cases, "tests/ref/covariate_design_r.R", character(), tolerance = list(rel = 1e-9, abs = 1e-12))
