# Paths to a better region (issue #81): rsm::steepest (the straight path of a first-order fit;
# ridge analysis for a second-order fit) and rsm::canonical.path, on data in coded units; and the
# confidence region for the direction of steepest ascent (Box & Draper 1987, sec. 6.4), from its
# formula: cos^2(theta) = 1 - (k - 1) s_b^2 F(alpha; k - 1, df) / sum(b^2), the fraction of
# directions inside the cone 0.5 * pbeta(sin^2(theta), (k - 1)/2, 1/2).
# rsm rounds the path to 3 decimals and predicts there: yhat is compared at the rounded points.
# rsm::steepest finds each point by uniroot at its default tolerance (also for a first-order fit,
# through its ridge-analysis code with B = 0), so its points are good to about 1e-3; the exact
# path is recorded as well: b/|b| * dist (first order), and ridge analysis solved to 1e-13.
source("tests/ref/fixture.R")
suppressPackageStartupMessages(library(rsm))
cases <- list()
add <- function(x) cases[[length(cases) + 1]] <<- x
rows_of <- function(d) unname(lapply(seq_len(nrow(d)), function(i) as.list(d[i, ])))
path_of <- function(p, vars) list(dist = p$dist, x = unname(lapply(seq_len(nrow(p)), function(i) unlist(p[i, vars]))), yhat = p$yhat)
exact_linear <- function(f, vars, dist, descent = FALSE) { b <- coef(f)[vars]; d <- b / sqrt(sum(b^2)) * (if (descent) -1 else 1); unname(lapply(dist, function(r) unname(r * d))) }
exact_ridge <- function(f, dist, descent = FALSE) {
  b <- f$b; B <- f$B; ev <- eigen(B)$values; edge <- if (descent) min(ev) else max(ev); dir <- if (descent) -1 else 1
  xo <- function(mu) -0.5 * solve(B - mu * diag(length(b)), b); rad <- function(mu) sqrt(sum(xo(mu)^2))
  unname(lapply(dist, function(r) { if (abs(r) < 0.01) return(0 * unname(b))
    far <- edge + dir; while (rad(far) > r) far <- edge + dir * 2 * abs(far - edge)
    unname(xo(uniroot(function(m) rad(m) - r, sort(c(edge + dir * 1e-9, far)), tol = 1e-14)$root)) }))
}
region <- function(f, vars) {
  b <- coef(f)[vars]; V <- vcov(f)[vars, vars]; k <- length(b); df <- df.residual(f)
  sb2 <- mean(diag(V)); Fq <- qf(0.95, k - 1, df); c2 <- 1 - (k - 1) * sb2 * Fq / sum(b^2)
  if (c2 <= 0) return(list(angle = 180, fraction = 1, F = Fq))
  th <- acos(sqrt(c2)); list(angle = th * 180 / pi, fraction = 0.5 * pbeta(sin(th)^2, (k - 1) / 2, 0.5), F = Fq)
}

# 1. a first-order experiment: 2^3 factorial plus 4 centre points, far from the optimum
set.seed(811)
d1 <- rbind(expand.grid(x1 = c(-1, 1), x2 = c(-1, 1), x3 = c(-1, 1)), data.frame(x1 = 0, x2 = 0, x3 = rep(0, 4)))
d1$y <- round(60 + 4 * d1$x1 + 2.5 * d1$x2 - 1.2 * d1$x3 + rnorm(12, 0, 0.6), 2)
f1 <- rsm(y ~ FO(x1, x2, x3), data = d1)
add(list(name = "first order ascent", input = list(rows = rows_of(d1), model = "main", dist = I(seq(0, 5, by = 0.5))),
  output = c(path_of(steepest(f1, dist = seq(0, 5, by = 0.5)), c("x1", "x2", "x3")), list(exact = exact_linear(lm(y ~ x1 + x2 + x3, d1), c("x1", "x2", "x3"), seq(0, 5, by = 0.5)), region = region(lm(y ~ x1 + x2 + x3, d1), c("x1", "x2", "x3"))))))
add(list(name = "first order descent", input = list(rows = rows_of(d1), model = "main", dist = I(seq(0, 3, by = 1)), descent = TRUE),
  output = c(path_of(steepest(f1, dist = seq(0, 3, by = 1), descent = TRUE), c("x1", "x2", "x3")), list(exact = exact_linear(lm(y ~ x1 + x2 + x3, d1), c("x1", "x2", "x3"), seq(0, 3, by = 1), TRUE)))))

# 2. a weak first-order experiment: the direction is poorly determined
set.seed(812)
d2 <- expand.grid(x1 = c(-1, 1), x2 = c(-1, 1), x3 = c(-1, 1)); d2 <- rbind(d2, data.frame(x1 = 0, x2 = 0, x3 = rep(0, 3)))
d2$y <- round(30 + 0.4 * d2$x1 + 0.3 * d2$x2 + 0.1 * d2$x3 + rnorm(11, 0, 0.8), 2)
f2 <- rsm(y ~ FO(x1, x2, x3), data = d2)
add(list(name = "first order weak", input = list(rows = rows_of(d2), model = "main"), output = list(region = region(lm(y ~ x1 + x2 + x3, d2), c("x1", "x2", "x3")))))

# 3. a second-order experiment (rotatable CCD, 6 centre points) with a ridge: ridge analysis and
# the canonical path
set.seed(813)
a <- 1.682
d3 <- rbind(expand.grid(x1 = c(-1, 1), x2 = c(-1, 1), x3 = c(-1, 1)),
  data.frame(x1 = c(-a, a, 0, 0, 0, 0), x2 = c(0, 0, -a, a, 0, 0), x3 = c(0, 0, 0, 0, -a, a)), data.frame(x1 = 0, x2 = 0, x3 = rep(0, 6)))
d3$y <- round(with(d3, 80 + 2 * x1 + 1.5 * x2 - 0.8 * x3 - 1.6 * x1^2 - 0.9 * x2^2 - 2.1 * x3^2 + 0.7 * x1 * x2 - 0.4 * x2 * x3) + rnorm(20, 0, 0.5), 2)
f3 <- rsm(y ~ SO(x1, x2, x3), data = d3)
add(list(name = "second order ridge", input = list(rows = rows_of(d3), model = "quadratic", dist = I(seq(0, 3, by = 0.5))),
  output = c(path_of(steepest(f3, dist = seq(0, 3, by = 0.5)), c("x1", "x2", "x3")), list(exact = exact_ridge(f3, seq(0, 3, by = 0.5))))))
add(list(name = "second order ridge descent", input = list(rows = rows_of(d3), model = "quadratic", dist = I(seq(0, 2, by = 0.5)), descent = TRUE),
  output = c(path_of(steepest(f3, dist = seq(0, 2, by = 0.5), descent = TRUE), c("x1", "x2", "x3")), list(exact = exact_ridge(f3, seq(0, 2, by = 0.5), TRUE)))))
cp <- canonical.path(f3, dist = seq(-2, 2, by = 0.5))
can <- canonical(f3)
add(list(name = "canonical path", input = list(rows = rows_of(d3), model = "quadratic", dist = I(seq(-2, 2, by = 0.5))),
  output = c(path_of(cp, c("x1", "x2", "x3")), list(stationary = unname(can$xs), eigenvalues = unname(can$eigen$values)))))

write_fixture("path-r", cases, "tests/ref/path_r.R", c("rsm"), tolerance = list(rel = 1e-6, abs = 1e-9))
