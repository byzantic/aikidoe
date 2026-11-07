# Power for counts and proportions (issue #64, phase 2), computed independently in R: the Wald
# test of each term with the intercept at the baseline and that term alone at its anticipated
# effect, information XᵀWX at the anticipated means, non-centrality bᵀ(V_SS)⁻¹b / φ, and power from
# the non-central χ² (fixed dispersion) or F (estimated); the smallest detectable ratio by uniroot.
source("tests/ref/fixture.R")
cases <- list()

two <- expand.grid(A = c(-1, 1), B = c(-1, 1), C = c(-1, 1))
d1 <- rbind(two, two)
ccd <- rbind(expand.grid(A = c(-1, 1), B = c(-1, 1)), data.frame(A = c(-1.414, 1.414, 0, 0), B = c(0, 0, -1.414, 1.414)), data.frame(A = rep(0, 3), B = rep(0, 3)))

fam <- function(dist, link, theta) switch(dist,
  poisson = poisson(link), quasipoisson = quasipoisson(link), binomial = binomial(link), quasibinomial = quasibinomial(link),
  negbin = MASS::negative.binomial(theta, link = link))

coefOf <- function(dist, link, base, r) {
  g <- make.link(link)$linkfun
  if (dist %in% c("poisson", "quasipoisson", "negbin")) (g(base * sqrt(r)) - g(base / sqrt(r))) / 2
  else { o <- base / (1 - base); p <- function(x) x / (1 + x); (g(p(o * sqrt(r))) - g(p(o / sqrt(r)))) / 2 }
}

powcase <- function(name, data, formula, dist, link, base, ratio, trials = 1, exposure = 1, theta = NULL, phi = 1, alpha = 0.05) {
  X <- model.matrix(as.formula(paste("~", formula)), data)
  asg <- attr(X, "assign"); n <- nrow(X); labels <- attr(terms(as.formula(paste("~", formula))), "term.labels")
  f <- fam(dist, link, theta); lk <- make.link(link)
  counts <- dist %in% c("poisson", "quasipoisson", "negbin"); est <- dist %in% c("quasipoisson", "quasibinomial")
  m <- if (counts) rep(1, n) else rep_len(trials, n); e <- if (counts) rep_len(exposure, n) else rep(1, n)
  dfRes <- n - qr(X)$rank
  lam <- function(ti, r) {
    S <- which(asg == ti); beta <- c(lk$linkfun(base), rep(0, ncol(X) - 1)); beta[S] <- coefOf(dist, link, base, r)
    eta <- drop(X %*% beta) + if (counts && link == "log") log(e) else 0
    mu <- lk$linkinv(eta) * if (counts && link != "log") e else 1
    w <- m * lk$mu.eta(eta)^2 / f$variance(mu)
    V <- solve(crossprod(X * sqrt(w)))
    b <- beta[S]; drop(t(b) %*% solve(V[S, S, drop = FALSE]) %*% b) / phi
  }
  pw <- function(df, l) if (est) pf(qf(1 - alpha, df, dfRes), df, dfRes, ncp = l, lower.tail = FALSE) else pchisq(qchisq(1 - alpha, df), df, ncp = l, lower.tail = FALSE)
  dfs <- sapply(seq_along(labels), function(ti) sum(asg == ti))
  lambda <- sapply(seq_along(labels), function(ti) lam(ti, ratio))
  power <- sapply(seq_along(labels), function(ti) pw(dfs[ti], lambda[ti]))
  det <- sapply(seq_along(labels), function(ti) { g <- function(x) pw(dfs[ti], lam(ti, exp(x))) - 0.8; if (g(log(1000)) < 0) NA else exp(uniroot(g, c(1e-6, log(1000)), tol = 1e-12)$root) })
  cases[[length(cases) + 1]] <<- list(name = name, input = list(design = lapply(data, function(v) I(v)), formula = formula, distribution = dist, link = link,
    baseline = base, ratio = ratio, trials = I(trials), exposure = I(exposure), theta = theta, dispersion = phi, alpha = alpha),
    output = list(terms = I(labels), df = I(dfs), lambda = I(lambda), power = I(power), detectable = I(det), dfRes = dfRes))
}

powcase("Poisson, replicated 2^3, two-factor interactions, exposure", d1, "(A + B + C)^2", "poisson", "log", 10, 1.5, exposure = c(0.5, 1, 2, 1))
powcase("Poisson, square-root link", d1, "A + B + C", "poisson", "sqrt", 8, 1.6)
powcase("negative binomial theta = 3", d1, "A + B + C + A:B", "negbin", "log", 10, 2, theta = 3)
powcase("quasi-Poisson, dispersion 2 (F tests)", d1, "A + B + C", "quasipoisson", "log", 20, 1.5, phi = 2)
powcase("binomial, 20 or 25 trials", d1, "(A + B + C)^2", "binomial", "logit", 0.3, 2, trials = c(20, 25))
powcase("binomial, probit link, central composite", ccd, "A + B + I(A^2) + I(B^2) + A:B", "binomial", "probit", 0.6, 1.8, trials = 30)
powcase("pass/fail (Bernoulli), alpha = 0.1", d1, "A + B + C", "binomial", "logit", 0.5, 4, trials = 1, alpha = 0.1)

write_fixture("power-glm-r", cases, "tests/ref/power_glm_r.R", c("stats", "MASS"), tolerance = list(rel = 1e-9, abs = 1e-12))
