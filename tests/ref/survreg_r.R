# Times to an event with right censoring (issue #83): survival::survreg (Weibull and log-normal
# accelerated-life models) — coefficients, standard errors, log(scale), the log-likelihood, the
# sequential likelihood-ratio tests (anova), drop1's tests (each term last) and the quantiles of the
# life with their standard errors (predict type = "quantile", se.fit: on the time scale); and the
# Kaplan-Meier estimate (survfit) behind the probability plot.
# The model matrix is written with R's assign (0 = intercept), so the test builds the same columns.
source("tests/ref/fixture.R")
suppressPackageStartupMessages(library(survival))
cases <- list()
add <- function(x) cases[[length(cases) + 1]] <<- x
mat_rows <- function(m) unname(lapply(seq_len(nrow(m)), function(i) I(unname(m[i, ]))))

fit_case <- function(name, d, formula, dist, newdata, drop = FALSE) {
  assign("dd", d, envir = globalenv())                 # anova and drop1 refit from the call: data in the global environment
  f <- eval(bquote(survreg(.(formula), data = dd, dist = .(dist))), globalenv())
  X <- model.matrix(delete.response(terms(f)), d)
  tl <- attr(terms(f), "term.labels")
  s <- summary(f)$table
  p <- nrow(s) - 1
  out <- list(coef = I(unname(coef(f))), se = I(unname(s[1:p, 2])), logScale = log(f$scale), logScaleSe = unname(s[p + 1, 2]), loglik = f$loglik[2])
  # (anova.survreg fails on an intercept-only model: there is nothing to test)
  if (length(tl)) { a <- anova(f); out$chisq <- I(unname(a$Deviance[-1])); out$df <- I(unname(a$Df[-1])) }
  if (drop) { d1 <- drop1(f, test = "Chisq"); out$drop1 <- list(terms = I(rownames(d1)[-1]), chisq = I(unname(d1$LRT[-1]))) }
  Xn <- model.matrix(delete.response(terms(f)), newdata)
  q <- predict(f, newdata, type = "quantile", p = c(0.1, 0.5), se.fit = TRUE)
  out$quantiles <- list(p = I(c(0.1, 0.5)), fit = mat_rows(matrix(q$fit, ncol = 2)), se = mat_rows(matrix(q$se.fit, ncol = 2)))
  add(list(name = name, input = list(distribution = dist, columns = I(colnames(X)), assign = I(attr(X, "assign")), terms = I(tl),
    X = mat_rows(X), time = I(d$t), status = I(as.integer(d$st)), newX = mat_rows(Xn)), output = out))
}

# 1. an accelerated life test of an interconnect (the app's example): temperature (A) and current
#    density (B) in coded units, eight structures per condition, the test stopped at 1000 h
times <- list(c(1000, 1000, 1000, 1000, 1000, 1000, 1000, 605), c(198, 761, 1000, 422, 588, 394, 341, 518), c(395, 1000, 1000, 578, 1000, 1000, 743, 336),
  c(359, 63, 204, 478, 217, 263, 418, 23), c(1000, 733, 1000, 859, 1000, 562, 1000, 389))
cond <- data.frame(A = c(-1, 1, -1, 1, 0), B = c(-1, -1, 1, 1, 0))
em <- do.call(rbind, lapply(1:5, function(i) data.frame(A = cond$A[i], B = cond$B[i], t = times[[i]], st = times[[i]] < 1000)))
nd <- data.frame(A = c(-1, 1, 0, -2), B = c(-1, 1, 0, -1))
fit_case("interconnect weibull additive", em, Surv(t, st) ~ A + B, "weibull", nd, drop = TRUE)
fit_case("interconnect weibull interaction", em, Surv(t, st) ~ A * B, "weibull", nd)
fit_case("interconnect lognormal interaction", em, Surv(t, st) ~ A * B, "lognormal", nd)
fit_case("interconnect lognormal quadratic", em, Surv(t, st) ~ A + B + I(A^2), "lognormal", nd)

# 2. survival::ovarian (time to death or censoring, age, treatment): a continuous and a categorical term
ov <- data.frame(t = ovarian$futime, st = ovarian$fustat == 1, age = ovarian$age, rx = factor(ovarian$rx))
ndo <- data.frame(age = c(50, 60), rx = factor(c(1, 2), levels = c(1, 2)))
fit_case("ovarian weibull", ov, Surv(t, st) ~ age + rx, "weibull", ndo, drop = TRUE)
fit_case("ovarian lognormal", ov, Surv(t, st) ~ rx + age, "lognormal", ndo, drop = TRUE)

# 3. no censoring: the hottest corner alone, intercept only
fit_case("uncensored weibull", em[em$A == 1 & em$B == 1, ], Surv(t, st) ~ 1, "weibull", data.frame(A = 0))

# 4. Kaplan-Meier at the centre point and at a corner (censored times among the failures)
for (i in c(3, 5)) {
  d <- em[em$A == cond$A[i] & em$B == cond$B[i], ]
  k <- survfit(Surv(t, st) ~ 1, data = d)
  ev <- k$n.event > 0
  add(list(name = sprintf("kaplan-meier condition %d", i), input = list(time = I(d$t), status = I(as.integer(d$st))),
    output = list(time = I(k$time[ev]), atRisk = I(k$n.risk[ev]), failed = I(k$n.event[ev]), S = I(k$surv[ev]))))
}

write_fixture("survreg-r", cases, "tests/ref/survreg_r.R", c("survival"), tolerance = list(rel = 1e-6, abs = 1e-9))
