# Covariates in models (ANCOVA; issue #82, phase 1): lm, glm and lmer with a measured covariate
# beside the factors.
#
# aikidoe codes a covariate as (x − mean) / ((max − min) / 2) over the rows used; the same is done
# here, independently, so that the coefficients compare one to one. Checked: coefficients, standard
# errors, σ, car::Anova types II and III (which differ once the covariate interacts with a factor),
# the slope per unit of the covariate from a fit on the covariate as measured, confidence and
# prediction intervals at given covariate values and at its mean (predict.lm), rows dropped for
# a missing covariate (na.omit), a Poisson GLM (coefficients, likelihood-ratio tests) and REML
# fits with a covariate per wafer and per run (lme4, Kenward–Roger tests by pbkrtest).
# Factors are in coded units (−1, +1); the categorical factor uses contr.sum on the levels rotated
# so that the first is last (aikidoe's effect coding).
source("tests/ref/fixture.R")
suppressPackageStartupMessages({ library(car); library(lme4); library(pbkrtest) })
set.seed(20261182)
cases <- list()
add <- function(x) cases[[length(cases) + 1]] <<- x

ccode <- function(x) (x - mean(x)) / ((max(x) - min(x)) / 2)
na2null <- function(v) { v <- unname(v); v[!is.finite(v)] <- NA; I(v) }
tab <- function(a, ss = "Sum Sq", st = "F value", pv = "Pr(>F)") lapply(seq_len(nrow(a)), function(i) list(
  term = rownames(a)[i], df = a$Df[i], ss = if (is.null(a[[ss]])) NA else a[[ss]][i],
  F = if (is.na(a[[st]][i])) NA else a[[st]][i], p = if (is.na(a[[pv]][i])) NA else a[[pv]][i]))
rows_of <- function(d) unname(lapply(seq_len(nrow(d)), function(i) lapply(as.list(d[i, , drop = FALSE]), function(v) if (is.factor(v)) as.character(v) else if (is.na(v)) NULL else v)))

# least squares: d has the factors (coded), the covariate x as measured (NA when missing) and y;
# fml in terms of the factors and x; at: settings to predict at (x as measured, or absent: the mean)
lm_case <- function(name, d, fml, at, levels = NULL) {
  input <- list(rows = rows_of(d), formula = fml, at = at)
  if (!is.null(levels)) input$levels <- I(levels)
  d <- d[!is.na(d$x), ]
  xm <- mean(d$x); h <- (max(d$x) - min(d$x)) / 2
  raw <- d
  d$x <- (d$x - xm) / h
  if (!is.null(levels)) for (dd in c("d", "raw")) { e <- get(dd); e$G <- factor(e$G, levels = c(levels[-1], levels[1])); contrasts(e$G) <- contr.sum(length(levels)); assign(dd, e) }
  fit <- do.call("lm", list(formula = as.formula(fml), data = d))
  fr <- do.call("lm", list(formula = as.formula(fml), data = raw))
  s <- summary(fit)
  nd <- do.call(rbind, lapply(at, function(a) { r <- d[1, , drop = FALSE]; for (k in names(a)) if (k != "x") r[[k]] <- if (k == "G") factor(a[[k]], levels = levels(d$G)) else a[[k]]
    r$x <- if (is.null(a$x)) 0 else (a$x - xm) / h; r }))
  ci <- predict(fit, nd, interval = "confidence"); pi <- predict(fit, nd, interval = "prediction")
  list(name = name, input = input, output = list(
    n = nrow(d), mean = xm, halfRange = h,
    columns = I(names(coef(fit))), coef = na2null(coef(fit)), se = na2null(coef(s)[, 2]), sigma = s$sigma, dfRes = fit$df.residual,
    slope = unname(coef(fr)["x"]), slopeSe = unname(coef(summary(fr))["x", 2]),
    anova2 = tab(Anova(fit, type = 2)), anova3 = tab(Anova(fit, type = 3)),
    pred = lapply(seq_len(nrow(nd)), function(i) list(fit = unname(ci[i, 1]), lower = unname(ci[i, 2]), upper = unname(ci[i, 3]), predLower = unname(pi[i, 2]), predUpper = unname(pi[i, 3])))))
}

# 1, 2. a replicated 2^3 with the room temperature measured at each run
d1 <- rbind(expand.grid(A = c(-1, 1), B = c(-1, 1), C = c(-1, 1)), expand.grid(A = c(-1, 1), B = c(-1, 1), C = c(-1, 1)))
d1$x <- round(rnorm(16, 21, 1.4), 1)
d1$y <- with(d1, 50 + 3 * A - 2 * B + 0.5 * C + 1.2 * A * B + 1.5 * (x - 21) + rnorm(16, sd = 0.8))
at1 <- list(list(A = 1, B = -1, C = 0, x = 22.5), list(A = 0, B = 0, C = 0, x = 19), list(A = 1, B = 1, C = -1))
add(lm_case("2^3 x 2 with a covariate", d1, "y ~ A + B + C + A:B + x", at1))
d2 <- d1; d2$y <- with(d2, y + 0.9 * A * (x - 21))
add(lm_case("covariate by factor interaction", d2, "y ~ A * x + B + C", at1))
# 3. two runs without the covariate: left out
d3 <- d1; d3$x[c(4, 11)] <- NA
add(lm_case("covariate missing for two runs", d3, "y ~ A + B + C + A:B + x", at1))
# 4, 5. one factor at three levels (the classic ANCOVA), common slope and separate slopes
d4 <- data.frame(G = rep(c("ctrl", "low", "high"), each = 7), stringsAsFactors = FALSE)
d4$x <- round(runif(21, 180, 260))
d4$y <- with(d4, 12 + c(ctrl = 0, low = 1.5, high = 3.2)[G] + 0.04 * (x - 220) + rnorm(21, sd = 0.7))
at4 <- list(list(G = "ctrl"), list(G = "high", x = 200), list(G = "low", x = 250))
add(lm_case("three groups, common slope", d4, "y ~ G + x", at4, levels = c("ctrl", "low", "high")))
d5 <- d4; d5$y <- with(d5, y + c(ctrl = 0, low = 0.02, high = -0.03)[G] * (x - 220))
add(lm_case("three groups, separate slopes", d5, "y ~ G * x", at4, levels = c("ctrl", "low", "high")))

# 6. counts: a Poisson GLM with a covariate (colonies; the inoculum's age in hours)
d6 <- expand.grid(A = c(-1, 1), B = c(-1, 1))[rep(1:4, 4), ]
d6$x <- round(runif(16, 2, 30))
d6$y <- rpois(16, exp(3.2 + 0.4 * d6$A - 0.25 * d6$B - 0.02 * (d6$x - 16)))
{
  input <- list(rows = rows_of(d6), formula = "y ~ A + B + x")
  d <- d6; xm <- mean(d$x); h <- (max(d$x) - min(d$x)) / 2; d$x <- (d$x - xm) / h
  g <- glm(y ~ A + B + x, family = poisson, data = d); s <- summary(g)
  a2 <- Anova(g, type = 2, test.statistic = "LR")
  add(list(name = "poisson with a covariate", input = input, output = list(mean = xm, halfRange = h,
    columns = I(names(coef(g))), coef = na2null(coef(g)), se = na2null(coef(s)[, 2]), deviance = deviance(g),
    lr = lapply(seq_len(nrow(a2)), function(i) list(term = rownames(a2)[i], df = a2$Df[i], chisq = a2[["LR Chisq"]][i], p = a2[["Pr(>Chisq)"]][i])),
    pred = unname(predict(g, data.frame(A = 1, B = -1, x = (10 - xm) / h), type = "response")))))
}

# 7, 8. REML: 8 runs of 3 wafers; the incoming film thickness of each wafer (7), and the chamber
# pressure logged once per run (8)
ctrl <- lmerControl(optimizer = "bobyqa", optCtrl = list(maxfun = 1e5, rhoend = 1e-9), check.conv.singular = "ignore")
runs <- expand.grid(A = c(-1, 1), B = c(-1, 1))[rep(1:4, 2), ]; runs$run <- 1:8
runs$w <- round(rnorm(8, 5, 0.4), 2)
d7 <- merge(runs, data.frame(wafer = 1:3)); d7 <- d7[order(d7$run, d7$wafer), ]
u <- rnorm(8, sd = 1.1)
d7$x <- round(rnorm(24, 100, 4), 1)
d7$y <- with(d7, 200 + 6 * A - 4 * B + 0.7 * (x - 100) + 3 * (w - 5) + u[run] + rnorm(24, sd = 0.9))
reml_case <- function(name, d, cov, fml) {
  input <- list(rows = rows_of(d), formula = fml, covariate = cov)
  xm <- mean(d[[cov]]); h <- (max(d[[cov]]) - min(d[[cov]])) / 2
  d$x <- (d[[cov]] - xm) / h; d$run <- factor(d$run)
  fit <- lmer(y ~ A + B + x + (1 | run), d, REML = TRUE, control = ctrl)
  X <- getME(fit, "X"); vc <- as.data.frame(VarCorr(fit))
  kr <- lapply(2:ncol(X), function(j) { L <- matrix(0, 1, ncol(X)); L[1, j] <- 1; k <- KRmodcomp(fit, L)$stats; list(term = colnames(X)[j], ddf = k$ddf, F = k$Fstat) })
  list(name = name, input = input, output = list(mean = xm, halfRange = h, columns = I(colnames(X)), coef = I(unname(fixef(fit))),
    varcomp = list(run = vc$vcov[1], Residual = vc$vcov[2]), REML = REMLcrit(fit), kr = kr))
}
add(reml_case("REML, a covariate per wafer", d7, "x", "y ~ A + B + x"))
add(reml_case("REML, a covariate per run", d7, "w", "y ~ A + B + w"))

write_fixture("covariate-r", cases, "tests/ref/covariate_r.R", c("car", "lme4", "pbkrtest"), tolerance = list(rel = 1e-5, abs = 1e-7))
