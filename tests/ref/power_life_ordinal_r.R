# Power for times to failure and ordinal scores (issue #83, phase 3).
# 1. The expected information per unit of a Weibull (smallest extreme value) or log-normal life
#    with Type I censoring at standardised time zc, by stats::integrate over the failures plus the
#    survival term of the units still working (Escobar & Meeker 1994); uncensored, the textbook
#    values for the extreme-value distribution: 1, 1 - gamma, pi^2/6 + (1 - gamma)^2.
# 2. Whitehead's (1993) sample size formula for the proportional-odds model, two equal groups:
#    var(log OR) = 12 / (N (1 - sum p^3)), p the average category probabilities.
# 3. Power by simulation with survival::survreg and ordinal::clm (likelihood-ratio tests, as the
#    analysis), for a replicated 2^2 in coded units: the reference the app's power is compared with,
#    within the Monte Carlo error.
source("tests/ref/fixture.R")
suppressPackageStartupMessages({ library(survival); library(ordinal) })
cases <- list()
add <- function(x) cases[[length(cases) + 1]] <<- x

# 1. expected information (location, log scale) per unit, sigma = 1
info <- function(dist, zc) {
  if (dist == "weibull") { f <- function(z) exp(z - exp(z)); Fz <- function(z) 1 - exp(-exp(z))
    l1e <- function(z) 1 - exp(z); l2e <- function(z) -exp(z); l1c <- function(z) -exp(z); l2c <- function(z) -exp(z) }
  else { f <- dnorm; Fz <- pnorm; l1e <- function(z) -z; l2e <- function(z) -1
    lam <- function(z) dnorm(z) / pnorm(z, lower.tail = FALSE); l1c <- function(z) -lam(z); l2c <- function(z) -lam(z) * (lam(z) - z) }
  up <- if (is.finite(zc)) zc else Inf
  E <- function(h) integrate(function(z) { fz <- f(z); v <- h(z) * fz; v[fz == 0] <- 0; v }, -Inf, up, rel.tol = 1e-12, abs.tol = 1e-14)$value   # (0 where the density underflows)
  A <- -E(l2e); B <- -E(function(z) l2e(z) * z + l1e(z)); C <- -E(function(z) l2e(z) * z^2 + l1e(z) * z)
  if (is.finite(zc)) { S <- 1 - Fz(zc); A <- A - S * l2c(zc); B <- B - S * (l2c(zc) * zc + l1c(zc)); C <- C - S * (l2c(zc) * zc^2 + l1c(zc) * zc) }
  c(A = A, B = B, C = C, failed = if (is.finite(zc)) Fz(zc) else 1)
}
for (d in c("weibull", "lognormal")) for (zc in c(Inf, 1, 0, -1, -2.5)) {
  v <- info(d, zc)
  add(list(name = sprintf("information %s zc %s", d, format(zc)), input = list(kind = "information", distribution = d, zc = if (is.finite(zc)) zc else NULL),
    output = as.list(v)))
}
g <- -digamma(1)
add(list(name = "information weibull uncensored textbook", input = list(kind = "information", distribution = "weibull"), output = list(A = 1, B = 1 - g, C = pi^2 / 6 + (1 - g)^2, failed = 1)))

# 2. Whitehead: the non-centrality for a coefficient b = log(OR)/2 on a +-1 column, N scores in all
for (cs in list(list(p = c(0.25, 0.25, 0.25, 0.25), or = 2, N = 100), list(p = c(0.4, 0.2, 0.2, 0.2), or = 3, N = 60), list(p = c(0.5, 0.3, 0.2), or = 1.5, N = 200))) {
  # the average category probabilities of the two groups at log OR -+ b
  th <- qlogis(cumsum(cs$p)[-length(cs$p)]); b <- log(cs$or) / 2
  pg <- function(e) diff(c(0, plogis(th - e), 1)); pbar <- (pg(-b) + pg(b)) / 2
  add(list(name = sprintf("whitehead OR %s N %d", cs$or, cs$N), input = list(kind = "whitehead", baseline = I(cs$p), ratio = cs$or, N = cs$N),
    output = list(lambdaCentre = log(cs$or)^2 * cs$N * (1 - sum(cs$p^3)) / 12, lambdaAverage = log(cs$or)^2 * cs$N * (1 - sum(pbar^3)) / 12)))
}

# 3. power by simulation on a 2^2 (A, B coded), the effect on A, B at 0
X <- expand.grid(A = c(-1, 1), B = c(-1, 1))
nsim <- 1000
life_power <- function(dist, median, ratio, shape, sigma, units, testEnd, seed) {
  set.seed(seed); s <- if (dist == "weibull") 1 / shape else sigma
  w05 <- if (dist == "weibull") log(log(2)) else 0
  b0 <- log(median) - s * w05; d <- X[rep(1:4, each = units), ]; eta <- b0 + log(ratio) / 2 * d$A
  hits <- 0; failed <- 0
  for (k in 1:nsim) {
    W <- if (dist == "weibull") log(rexp(nrow(d))) else rnorm(nrow(d))
    t0 <- exp(eta + s * W); d$t <- pmin(t0, testEnd); d$st <- as.integer(t0 < testEnd); failed <- failed + mean(d$st)
    if (!sum(d$st)) next
    ok <- tryCatch({ f1 <- survreg(Surv(t, st) ~ A + B, d, dist = dist); f0 <- survreg(Surv(t, st) ~ B, d, dist = dist)
      pchisq(2 * (f1$loglik[2] - f0$loglik[2]), 1, lower.tail = FALSE) < 0.05 }, error = function(e) FALSE, warning = function(w) FALSE)
    if (isTRUE(ok)) hits <- hits + 1
  }
  list(power = hits / nsim, failed = failed / nsim)
}
for (cs in list(list(dist = "weibull", median = 800, ratio = 0.5, shape = 2, units = 6, testEnd = 1000, seed = 831),
                list(dist = "weibull", median = 800, ratio = 0.5, shape = 2, units = 6, testEnd = Inf, seed = 832),
                list(dist = "lognormal", median = 800, ratio = 0.5, sigma = 0.6, units = 6, testEnd = 1000, seed = 833),
                list(dist = "weibull", median = 800, ratio = 0.5, shape = 2, units = 6, testEnd = 600, seed = 834))) {
  r <- life_power(cs$dist, cs$median, cs$ratio, if (is.null(cs$shape)) 2 else cs$shape, if (is.null(cs$sigma)) 0.5 else cs$sigma, cs$units, cs$testEnd, cs$seed)
  inp <- cs; inp$seed <- NULL; if (!is.finite(inp$testEnd)) inp$testEnd <- NULL
  add(list(name = sprintf("life power %s end %s", cs$dist, format(cs$testEnd)), input = c(list(kind = "life"), inp, list(nsim = nsim)), output = r))
}
ord_power <- function(p, or, n, seed) {
  set.seed(seed); th <- qlogis(cumsum(p)[-length(p)]); d <- X[rep(1:4, each = n), ]; eta <- log(or) / 2 * d$A; K <- length(p)
  hits <- 0
  for (k in 1:nsim) {
    z <- eta + rlogis(nrow(d)); d$f <- factor(findInterval(z, th) + 1, levels = 1:K, ordered = TRUE)
    if (any(table(d$f) == 0)) next
    ok <- tryCatch({ f1 <- clm(f ~ A + B, data = d); f0 <- clm(f ~ B, data = d)
      pchisq(2 * (as.numeric(logLik(f1)) - as.numeric(logLik(f0))), 1, lower.tail = FALSE) < 0.05 }, error = function(e) FALSE)
    if (isTRUE(ok)) hits <- hits + 1
  }
  list(power = hits / nsim)
}
for (cs in list(list(p = c(0.25, 0.25, 0.25, 0.25), or = 3, n = 10, seed = 835), list(p = c(0.4, 0.2, 0.2, 0.2), or = 2, n = 20, seed = 836), list(p = c(0.1, 0.2, 0.4, 0.3), or = 4, n = 5, seed = 837))) {
  add(list(name = sprintf("ordinal power OR %s n %d", cs$or, cs$n), input = list(kind = "ordinal", baseline = I(cs$p), ratio = cs$or, scoresPerRun = cs$n, nsim = nsim), output = ord_power(cs$p, cs$or, cs$n, cs$seed)))
}

write_fixture("power-life-ordinal-r", cases, "tests/ref/power_life_ordinal_r.R", c("survival", "ordinal"), tolerance = list(rel = 1e-6, abs = 1e-9))
