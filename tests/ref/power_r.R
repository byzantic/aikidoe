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
write_fixture("power-r", cases, "tests/ref/power_r.R", c("stats"))
