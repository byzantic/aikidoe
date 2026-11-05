# OLS references (issue #6): lm(), anova(), car::Anova types II and III, influence measures,
# lack of fit (pure error from a cell-means model) and MASS::boxcox, on 12 datasets including
# unbalanced, categorical, aliased, no-intercept and exactly-fitted-point cases.
#
# Coding matches aikidoe (spec §4.3): continuous factors are coded in R here, independently,
# from low/high (and log10 for log factors); categorical factors use contr.sum on the levels
# rotated so the first level is last, which makes R's columns identical to aikidoe's effect
# coding (first level = all −1).
source("tests/ref/fixture.R")
suppressPackageStartupMessages({ library(car); library(MASS) })
set.seed(20261105)

coded <- function(x, f) {
  t <- if (identical(f$transform, "log")) log10 else identity
  (2 * t(x) - (t(f$low) + t(f$high))) / (t(f$high) - t(f$low))
}
na2null <- function(v) { v <- unname(v); v[!is.finite(v)] <- NA; I(v) }

run_case <- function(name, factors, rows, y, fml, types = c(1, 2, 3), boxcox = FALSE) {
  d <- data.frame(y = y)
  for (f in factors) {
    x <- sapply(rows, function(r) r[[f$id]])
    if (f$type == "categorical") {
      lv <- unlist(f$levels)
      d[[f$id]] <- factor(x, levels = c(lv[-1], lv[1]))
      contrasts(d[[f$id]]) <- contr.sum(length(lv))
    } else d[[f$id]] <- coded(as.numeric(x), f)
  }
  fit <- do.call("lm", list(formula = as.formula(fml), data = d))   # objects embedded: car re-evaluates the call
  s <- summary(fit)
  cf <- coef(fit)
  ct <- matrix(NA_real_, length(cf), 4, dimnames = list(names(cf), NULL))
  ct[rownames(coef(s)), ] <- coef(s)
  h <- hatvalues(fit)
  out <- list(
    coef = na2null(cf), se = na2null(ct[, 2]), t = na2null(ct[, 3]), p = na2null(ct[, 4]),
    columns = I(names(cf)), rank = fit$rank, dfRes = fit$df.residual,
    sigma = s$sigma, r2 = s$r.squared, adjR2 = s$adj.r.squared,
    fitted = na2null(fitted(fit)), residuals = na2null(residuals(fit)), leverage = na2null(h),
    press = sum((residuals(fit) / (1 - h))^2),
    rstandard = na2null(suppressWarnings(rstandard(fit))), rstudent = na2null(suppressWarnings(rstudent(fit))),
    cooks = na2null(suppressWarnings(cooks.distance(fit)))
  )
  tab <- function(a, ss = "Sum Sq") lapply(seq_len(nrow(a)), function(i) list(
    term = rownames(a)[i], df = a$Df[i], ss = a[[ss]][i],
    F = if (is.na(a[["F value"]][i])) NA else a[["F value"]][i],
    p = if (is.na(a[["Pr(>F)"]][i])) NA else a[["Pr(>F)"]][i]))
  if (1 %in% types) out$anova1 <- tab(anova(fit))
  if (2 %in% types) out$anova2 <- tab(Anova(fit, type = 2))
  if (3 %in% types) out$anova3 <- tab(Anova(fit, type = 3))
  # pure error: residual SS of the cell-means model on identical settings
  key <- interaction(d[, sapply(factors, function(f) f$id), drop = FALSE], drop = TRUE)
  if (any(duplicated(key))) {
    pe <- lm(y ~ key, data = cbind(d, key = key))
    out$pureError <- list(df = pe$df.residual, ss = deviance(pe))
    if (fit$df.residual > pe$df.residual) {
      a <- anova(fit, pe)
      out$lackOfFit <- list(df = a$Df[2], ss = a$`Sum of Sq`[2], F = a$F[2], p = a$`Pr(>F)`[2])
    }
  }
  if (boxcox) {
    b <- boxcox(fit, lambda = seq(-2, 2, 0.1), plotit = FALSE)
    out$boxcox <- list(lambda = I(b$x), loglik = I(b$y))
  }
  list(name = name, input = list(factors = factors, rows = rows, y = I(y), formula = fml), output = out)
}

cont <- function(id, low = -1, high = 1, transform = "none") list(id = id, type = "continuous", low = low, high = high, transform = transform)
cat_ <- function(id, levels) list(id = id, type = "categorical", levels = I(levels))
grid <- function(...) { g <- expand.grid(..., stringsAsFactors = FALSE); lapply(seq_len(nrow(g)), function(i) as.list(g[i, , drop = FALSE])) }
cases <- list()

# 1. 2^3, two replicates, full model
r <- rep(grid(A = c(-1, 1), B = c(-1, 1), C = c(-1, 1)), 2)
y <- sapply(r, function(s) 10 + 2 * s$A - 1.5 * s$B + 0.8 * s$A * s$B + 0.3 * s$C) + rnorm(16, 0, 0.7)
cases[[1]] <- run_case("2^3 replicated, A*B*C", list(cont("A"), cont("B"), cont("C")), r, y, "y ~ A*B*C")

# 2. 2^3 + 4 centre points, main effects and 2fis (lack of fit with pure error)
r <- c(grid(A = c(-1, 1), B = c(-1, 1), C = c(-1, 1)), rep(list(list(A = 0, B = 0, C = 0)), 4))
y <- sapply(r, function(s) 5 + s$A + 0.5 * s$B - 0.7 * s$A * s$C + 0.9 * s$A^2) + rnorm(12, 0, 0.3)
cases[[2]] <- run_case("2^3 + 4 centre points, (A+B+C)^2", list(cont("A"), cont("B"), cont("C")), r, y, "y ~ (A+B+C)^2")

# 3. central composite, 2 factors, alpha = sqrt(2), 5 centre points, full quadratic
a <- sqrt(2)
r <- c(grid(A = c(-1, 1), B = c(-1, 1)), list(list(A = -a, B = 0), list(A = a, B = 0), list(A = 0, B = -a), list(A = 0, B = a)),
       rep(list(list(A = 0, B = 0)), 5))
y <- sapply(r, function(s) 80 + 4 * s$A + 2 * s$B - 3 * s$A^2 - 2 * s$B^2 + s$A * s$B) + rnorm(13, 0, 0.8)
cases[[3]] <- run_case("CCD 2 factors, quadratic", list(cont("A"), cont("B")), r, y, "y ~ A + B + A:B + I(A^2) + I(B^2)", boxcox = TRUE)

# 4. 3-level categorical x continuous, unbalanced
r <- grid(g = c("lo", "mid", "hi"), x = c(-1, 0, 1))
r <- c(r[-c(2, 7)], r[c(1, 5, 9, 9)])
y <- sapply(r, function(s) c(lo = 3, mid = 5, hi = 4)[[s$g]] + (if (s$g == "hi") 2 else 0.5) * s$x) + rnorm(length(r), 0, 0.5)
cases[[4]] <- run_case("categorical (3) x continuous, unbalanced", list(cat_("g", c("lo", "mid", "hi")), cont("x")), r, y, "y ~ g*x")

# 5. two categorical factors (2 x 4), unequal cell counts
cells <- grid(g1 = c("a", "b"), g2 = c("p", "q", "r", "s"))
cnt <- c(1, 3, 2, 2, 3, 1, 2, 3)
r <- unlist(mapply(function(c, k) rep(list(c), k), cells, cnt, SIMPLIFY = FALSE), recursive = FALSE)
y <- sapply(r, function(s) (s$g1 == "b") * 1.2 + match(s$g2, c("p", "q", "r", "s")) * 0.6) + rnorm(length(r), 0, 0.4)
cases[[5]] <- run_case("two categorical (2 x 4), unbalanced", list(cat_("g1", c("a", "b")), cat_("g2", c("p", "q", "r", "s"))), r, y, "y ~ g1*g2")

# 6. 2^(4-1) (D = ABC) with AB and CD in the model: CD is aliased (NA)
r <- lapply(grid(A = c(-1, 1), B = c(-1, 1), C = c(-1, 1)), function(s) c(s, D = s$A * s$B * s$C))
y <- sapply(r, function(s) 7 + s$A - s$D + 0.5 * s$A * s$B) + rnorm(8, 0, 0.2)
cases[[6]] <- run_case("2^(4-1) with aliased CD", list(cont("A"), cont("B"), cont("C"), cont("D")), r, y, "y ~ A + B + C + D + A:B + C:D", types = 1)

# 7. warpbreaks (R datasets): breaks ~ wool * tension, balanced 2 x 3 categorical
w <- warpbreaks
r <- lapply(seq_len(nrow(w)), function(i) list(wool = as.character(w$wool[i]), tension = as.character(w$tension[i])))
cases[[7]] <- run_case("warpbreaks: wool*tension", list(cat_("wool", c("A", "B")), cat_("tension", c("L", "M", "H"))), r, w$breaks, "y ~ wool*tension", boxcox = TRUE)

# 8. scattered continuous data with an interaction and a square
r <- lapply(1:25, function(i) list(x1 = runif(1, -1, 1), x2 = runif(1, -1, 1)))
y <- sapply(r, function(s) 1 + s$x1 - 2 * s$x2 + 1.5 * s$x1 * s$x2 + s$x1^2) + rnorm(25, 0, 0.3)
cases[[8]] <- run_case("scattered points, x1*x2 + I(x1^2)", list(cont("x1"), cont("x2")), r, y, "y ~ x1*x2 + I(x1^2)")

# 9. no intercept
r <- lapply(1:10, function(i) list(x = runif(1, -1, 1)))
y <- sapply(r, function(s) 3 * s$x) + rnorm(10, 0, 0.2)
cases[[9]] <- run_case("no intercept", list(cont("x")), r, y, "y ~ x - 1", types = c(1, 2))

# 10. drill advance (Daniel 1976; Box, Hunter & Hunter): unreplicated 2^4, main + 2fi, Box-Cox
r <- grid(A = c(-1, 1), B = c(-1, 1), C = c(-1, 1), D = c(-1, 1))
y <- c(1.68, 1.98, 3.28, 3.44, 4.98, 5.70, 9.97, 9.07, 2.07, 2.44, 4.09, 4.53, 7.77, 9.43, 11.75, 16.30)
cases[[10]] <- run_case("drill advance 2^4, (A+B+C+D)^2", list(cont("A"), cont("B"), cont("C"), cont("D")), r, y, "y ~ (A+B+C+D)^2", boxcox = TRUE)

# 11. a level observed once: leverage 1, standardised residuals NaN
r <- c(rep(list(list(g = "a")), 5), rep(list(list(g = "b")), 5), list(list(g = "c")))
y <- c(rnorm(5, 1), rnorm(5, 2), 4)
cases[[11]] <- run_case("single observation at one level (h = 1)", list(cat_("g", c("a", "b", "c"))), r, y, "y ~ g", types = 1)

# 12. ToothGrowth (R datasets): len ~ supp * dose, dose log-coded between 0.5 and 2 mg
tg <- ToothGrowth
r <- lapply(seq_len(nrow(tg)), function(i) list(supp = as.character(tg$supp[i]), dose = tg$dose[i]))
cases[[12]] <- run_case("ToothGrowth: supp*dose, log dose", list(cat_("supp", c("OJ", "VC")), cont("dose", 0.5, 2, "log")), r, tg$len,
                        "y ~ supp*dose + I(dose^2)", boxcox = TRUE)

write_fixture("ols-r", cases, "tests/ref/ols_r.R", c("stats", "car", "MASS"))
