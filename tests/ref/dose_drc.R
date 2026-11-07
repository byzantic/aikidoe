# Dose–response references (issue #65): drc (Ritz et al. 2015) for log-logistic and Weibull fits,
# standard errors (from the Hessian of the RSS), effective doses with delta and log-scale ("fls" on
# the log-parameterised LL2.4) intervals, absolute effective doses, a parallel-curve model with
# relative potency and the F test against separate curves; and nls for Gauss–Newton standard
# errors, unweighted and weighted.
#
# drc's optimiser stops a little short of the minimum on harder fits (LL.5, separate curves), so
# each fit is also "polished": the RSS minimised from drc's estimates with optim (BFGS, tight
# tolerance) and the standard errors and the delta-method effective doses recomputed there from a
# numDeriv Hessian — the same quantities, at the exact minimum. (For the Weibull models drc's own
# ED standard errors differ from the delta method on its own covariance; the polished values are
# the delta method.)
source("tests/ref/fixture.R")
suppressPackageStartupMessages({ library(drc); library(numDeriv) })
set.seed(20261107)

cases <- list()
coefs <- function(m) { s <- summary(m)$coefficients; list(names = I(rownames(s)), estimate = I(unname(s[, 1])), se = I(unname(s[, 2]))) }
eds <- function(m, ps, ...) { e <- ED(m, ps, interval = "delta", display = FALSE, ...); list(p = I(ps), estimate = I(unname(e[, 1])), se = I(unname(e[, 2])), lower = I(unname(e[, 3])), upper = I(unname(e[, 4]))) }

curve_fn <- list(
  LL.4 = function(x, t) t[2] + (t[3] - t[2]) / (1 + (x / t[4])^t[1]),
  LL.3 = function(x, t) t[2] / (1 + (x / t[3])^t[1]),
  LL.5 = function(x, t) t[2] + (t[3] - t[2]) / (1 + (x / t[4])^t[1])^t[5],
  W1.4 = function(x, t) t[2] + (t[3] - t[2]) * exp(-(x / t[4])^t[1]),
  W2.4 = function(x, t) t[2] + (t[3] - t[2]) * (1 - exp(-(x / t[4])^t[1])))
ed_fn <- list(   # relative EDp, as drc defines it; t = (b, c, d, e[, f]) or (b, d, e) for LL.3
  LL.4 = function(t, p) t[4] * (p / (100 - p))^(1 / t[1]),
  LL.3 = function(t, p) t[3] * (p / (100 - p))^(1 / t[1]),
  LL.5 = function(t, p) t[4] * ((100 / (100 - p))^(1 / t[5]) - 1)^(1 / t[1]),
  W1.4 = function(t, p) t[4] * (-log((100 - p) / 100))^(1 / t[1]),
  W2.4 = function(t, p) t[4] * (-log(p / 100))^(1 / t[1]))

polish <- function(rss, start, n, ps, edf) {
  o <- optim(start, rss, method = "BFGS", control = list(reltol = 1e-15, maxit = 10000, parscale = abs(start) + 1e-3))
  o <- optim(o$par, rss, method = "Nelder-Mead", control = list(reltol = 1e-15, maxit = 20000))
  o <- optim(o$par, rss, method = "BFGS", control = list(reltol = 1e-15, maxit = 10000, parscale = abs(o$par) + 1e-3))
  df <- n - length(start); s2 <- o$value / df
  V <- s2 * solve(hessian(rss, o$par) / 2)
  out <- list(estimate = I(unname(o$par)), se = I(sqrt(unname(diag(V)))), rss = o$value, df = df)
  if (!is.null(edf)) {
    q <- qt(0.975, df)
    e <- t(sapply(ps, function(p) { est <- edf(o$par, p); g <- grad(function(t) edf(t, p), o$par); se <- sqrt(drop(t(g) %*% V %*% g)); c(est, se, est - q * se, est + q * se) }))
    out$ed <- list(p = I(ps), estimate = I(e[, 1]), se = I(e[, 2]), lower = I(e[, 3]), upper = I(e[, 4]))
  }
  out
}

# ryegrass, every model
for (mod in c("LL.4", "LL.3", "LL.5", "W1.4", "W2.4")) {
  m <- drm(rootl ~ conc, data = ryegrass, fct = get(mod)())
  out <- c(coefs(m), list(rss = sum(residuals(m)^2), df = df.residual(m), ed = eds(m, c(10, 50, 90))))
  if (mod == "LL.4") out$edAbsolute <- eds(m, c(2, 4, 6), type = "absolute")
  f <- curve_fn[[mod]]
  out$polished <- polish(function(t) sum((ryegrass$rootl - f(ryegrass$conc, t))^2), unname(coef(m)), nrow(ryegrass), c(10, 50, 90), ed_fn[[mod]])
  cases[[length(cases) + 1]] <- list(name = paste("ryegrass", mod), input = list(model = mod, x = I(ryegrass$conc), y = I(ryegrass$rootl)), output = out)
}
# log-scale intervals: LL2.4 estimates log(e); fls back-transforms
m2 <- drm(rootl ~ conc, data = ryegrass, fct = LL2.4())
e2 <- ED(m2, c(10, 50, 90), interval = "fls", display = FALSE)
cases[[length(cases) + 1]] <- list(name = "ryegrass LL.4 log-scale intervals", input = list(model = "LL.4", x = I(ryegrass$conc), y = I(ryegrass$rootl)),
  output = list(p = I(c(10, 50, 90)), estimate = I(unname(e2[, 1])), lower = I(unname(e2[, 2])), upper = I(unname(e2[, 3]))))

# S.alba: two herbicides, parallel (only e differs) against separate curves; relative potency
par <- drm(DryMatter ~ Dose, Herbicide, data = S.alba, fct = LL.4(), pmodels = list(~1, ~1, ~1, ~Herbicide - 1))
sep <- drm(DryMatter ~ Dose, Herbicide, data = S.alba, fct = LL.4())
a <- anova(par, sep, details = FALSE)
pot <- EDcomp(par, c(50, 50), interval = "delta", display = FALSE)
X <- S.alba$Dose; Y <- S.alba$DryMatter; G <- S.alba$Herbicide == "Glyphosate"
LL4 <- curve_fn$LL.4
# polished: parallel θ = (b, c, d, eB, eG); separate θ = (bG, bB, cG, cB, dG, dB, eG, eB) in drc's order
rss_par <- function(t) sum((Y - ifelse(G, LL4(X, t[c(1, 2, 3, 5)]), LL4(X, t[c(1, 2, 3, 4)])))^2)
rss_sep <- function(t) sum((Y - ifelse(G, LL4(X, t[c(1, 3, 5, 7)]), LL4(X, t[c(2, 4, 6, 8)])))^2)
cases[[length(cases) + 1]] <- list(name = "S.alba parallel and separate", input = list(model = "LL.4", x = I(S.alba$Dose), y = I(S.alba$DryMatter), curve = I(as.character(S.alba$Herbicide))),
  output = list(parallel = c(coefs(par), list(rss = sum(residuals(par)^2), df = df.residual(par), polished = polish(rss_par, unname(coef(par)), length(Y), NULL, NULL))),
                separate = c(coefs(sep), list(rss = sum(residuals(sep)^2), df = df.residual(sep), polished = polish(rss_sep, unname(coef(sep)), length(Y), NULL, NULL))),
                F = a[2, "F value"], p = a[2, "p value"],
                potency = list(test = "Glyphosate", reference = "Bentazone", estimate = unname(pot[1, 1]), lower = unname(pot[1, 2]), upper = unname(pot[1, 3]))))

# nls: Gauss–Newton standard errors, unweighted and weighted (variance ∝ mean²)
x <- rep(c(0, 0.1, 0.3, 1, 3, 10, 30, 100), each = 3)
mu <- 5 + 95 / (1 + (x / 3)^1.2)
y <- round(mu * exp(rnorm(length(x), 0, 0.08)), 3)
w <- 1 / mu^2; w <- w / mean(w)
for (wt in c(FALSE, TRUE)) {
  st <- setNames(as.list(coef(drm(y ~ x, fct = LL.4()))), c("b", "c", "d", "e"))
  ctl <- nls.control(tol = 1e-7, minFactor = 1e-10, maxiter = 1000, scaleOffset = 1)
  m <- if (wt) nls(y ~ c + (d - c) / (1 + (x / e)^b), start = st, weights = w, control = ctl)
       else nls(y ~ c + (d - c) / (1 + (x / e)^b), start = st, control = ctl)
  s <- summary(m)$coefficients
  cases[[length(cases) + 1]] <- list(name = paste("nls LL.4", if (wt) "weighted" else "unweighted"),
    input = c(list(model = "LL.4", x = I(x), y = I(y)), if (wt) list(weights = I(w)) else list()),
    output = list(names = I(rownames(s)), estimate = I(unname(s[, 1])), se = I(unname(s[, 2])), sigma = summary(m)$sigma, df = df.residual(m)))
}

write_fixture("dose-drc", cases, "tests/ref/dose_drc.R", c("drc", "numDeriv", "stats"), tolerance = list(rel = 1e-3, abs = 1e-6))
