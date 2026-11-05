# Issue #12 reference: power of each model term (F test) and each coefficient (t test) for a
# coded design, anticipated coefficient Δ/2 on every column (σ = 1), from the non-central F
# in base R:  λ = bᵀ (V_SS)⁻¹ b,  V = (XᵀX)⁻¹,  power = P(F'(df1, N − p, λ) > F_crit).
source("tests/ref/fixture.R")
source("tests/ref/fixture.power-designs.R")
power <- function(dd) {
  X <- model.matrix(dd$r, dd$d, contrasts.arg = if ("g" %in% names(dd$d)) list(g = "contr.sum") else NULL)
  V <- solve(crossprod(X)); df2 <- nrow(X) - ncol(X); asg <- attr(X, "assign"); lab <- attr(terms(dd$r), "term.labels")
  pw <- function(S) { b <- rep(dd$delta / 2, length(S)); lam <- drop(t(b) %*% solve(V[S, S, drop = FALSE]) %*% b)
    c(lambda = lam, power = pf(qf(1 - dd$alpha, length(S), df2), length(S), df2, ncp = lam, lower.tail = FALSE)) }
  terms <- lapply(seq_along(lab), function(t) { S <- which(asg == t); r <- pw(S); list(term = lab[t], df = length(S), lambda = r[["lambda"]], power = r[["power"]]) })
  params <- lapply(seq_len(ncol(X)), function(j) { r <- pw(j); list(name = colnames(X)[j], lambda = r[["lambda"]], power = r[["power"]]) })
  list(dfRes = df2, terms = terms, parameters = params)
}
cases <- lapply(designs, function(dd) list(name = dd$name, input = list(rows = rows_of(dd$d), model = dd$aikidoe, delta = dd$delta, alpha = dd$alpha, levels = dd$levels), output = power(dd)))
# split-plot (issue #15): GLS information with V = I + η Z Zᵀ; each term tested with the
# containment df of its stratum (whole-plot terms: W − 1 − p_wp; subplot terms: n − W − p_sp)
sp <- expand.grid(C = c(-1, 1), D = c(-1, 1), wp = 1:8); sp$A <- c(-1, 1, -1, 1, -1, 1, -1, 1)[sp$wp]; sp$B <- c(-1, -1, 1, 1, -1, -1, 1, 1)[sp$wp]
spf <- ~ A + B + C + D + A:B + A:C
X <- model.matrix(spf, sp); Z <- model.matrix(~ factor(wp) - 1, sp)
for (eta in c(1, 4)) {
  V <- solve(t(X) %*% solve(diag(nrow(X)) + eta * Z %*% t(Z), X)); asg <- attr(X, "assign"); lab <- attr(terms(spf), "term.labels")
  ddf <- c(A = 8 - 1 - 3, B = 4, C = 32 - 8 - 3, D = 21, "A:B" = 4, "A:C" = 21)
  terms <- lapply(seq_along(lab), function(t) { S <- which(asg == t); b <- rep(1, length(S)); lam <- drop(t(b) %*% solve(V[S, S, drop = FALSE]) %*% b)
    list(term = lab[t], df = length(S), ddf = ddf[[lab[t]]], lambda = lam, power = pf(qf(0.95, length(S), ddf[[lab[t]]]), length(S), ddf[[lab[t]]], ncp = lam, lower.tail = FALSE)) })
  cases[[length(cases) + 1]] <- list(name = sprintf("split-plot 8 x 4, eta = %g", eta), input = list(rows = rows_of(sp[, c("A", "B", "C", "D")]), wholePlot = I(sp$wp), model = "A + B + C + D + A:B + A:C", delta = 2, alpha = 0.05, eta = eta, splitPlot = TRUE),
    output = list(terms = terms))
}
write_fixture("power-r", cases, "tests/ref/power_r.R", c("stats"))
