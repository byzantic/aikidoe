# Issue #12 reference: backward elimination keeping hierarchy, by p-value (drop1(test = "F"),
# drop the largest p above alpha_out) and by AICc (AIC(lm) + 2k(k+1)/(n-k-1), k = rank + 1;
# drop the term giving the lowest AICc while it decreases). Hierarchy: a term may go only when
# no remaining term has it as a parent (drop one component of an interaction; I(x^2) -> x).
source("tests/ref/fixture.R")
set.seed(20261105)
comps <- function(l) strsplit(l, ":", fixed = TRUE)[[1]]
parents <- function(l) {
  cs <- comps(l); out <- list()
  if (length(cs) > 1) for (i in seq_along(cs)) out[[length(out) + 1]] <- cs[-i]
  for (i in seq_along(cs)) if (grepl("^I\\((.*)\\^2\\)$", cs[i])) { x <- sub("^I\\((.*)\\^2\\)$", "\\1", cs[i]); out[[length(out) + 1]] <- c(cs[-i], x) }
  vapply(out, function(p) paste(sort(p), collapse = ":"), "")
}
key <- function(l) paste(sort(comps(l)), collapse = ":")
aicc <- function(f) { n <- nobs(f); k <- f$rank + 1; AIC(f) + if (n - k - 1 > 0) 2 * k * (k + 1) / (n - k - 1) else Inf }
reduce <- function(form, data, method, alpha_out = 0.1, contr = NULL) {
  fit <- lm(form, data, contrasts = contr); steps <- list()
  repeat {
    labs <- attr(terms(fit), "term.labels")
    pk <- unique(unlist(lapply(labs, parents)))
    cands <- labs[!(vapply(labs, key, "") %in% pk)]
    if (!length(cands)) break
    if (method == "p") {
      d <- drop1(fit, scope = cands, test = "F")
      d <- d[-1, , drop = FALSE]; i <- which.max(d[["Pr(>F)"]])
      if (!(d[["Pr(>F)"]][i] > alpha_out)) break
      drop <- rownames(d)[i]; newfit <- update(fit, as.formula(paste(". ~ . -", drop)))
      steps[[length(steps) + 1]] <- list(drop = drop, F = d[["F value"]][i], p = d[["Pr(>F)"]][i], aicc = aicc(newfit))
    } else {
      fits <- lapply(cands, function(l) update(fit, as.formula(paste(". ~ . -", l))))
      a <- vapply(fits, aicc, 0); i <- which.min(a)
      if (!(a[i] < aicc(fit))) break
      drop <- cands[i]; newfit <- fits[[i]]
      steps[[length(steps) + 1]] <- list(drop = drop, aicc = a[i])
    }
    fit <- newfit
  }
  list(start_aicc = aicc(lm(form, data, contrasts = contr)), steps = steps, final = I(attr(terms(fit), "term.labels")))
}
rows_of <- function(d) lapply(seq_len(nrow(d)), function(i) lapply(as.list(d[i, , drop = FALSE]), function(v) if (is.factor(v)) as.character(v) else v))
cases <- list()

d1 <- expand.grid(A = c(-1, 1), B = c(-1, 1), C = c(-1, 1), D = c(-1, 1))
d1$y <- with(d1, 10 + 3 * A + 2 * B + 1.5 * A * B + 0.6 * C + rnorm(16, sd = 0.8))
for (m in c("p", "aicc")) cases[[length(cases) + 1]] <- list(name = paste("2^4, (A+B+C+D)^2,", m), input = list(rows = rows_of(d1), formula = "y ~ (A+B+C+D)^2", method = m, alphaOut = 0.1), output = reduce(y ~ (A + B + C + D)^2, d1, m))

a <- 8^(1/4)
d2 <- rbind(as.matrix(expand.grid(x1 = c(-1, 1), x2 = c(-1, 1), x3 = c(-1, 1))), rbind(c(-a, 0, 0), c(a, 0, 0), c(0, -a, 0), c(0, a, 0), c(0, 0, -a), c(0, 0, a)), matrix(0, 6, 3))
d2 <- as.data.frame(d2); names(d2) <- c("x1", "x2", "x3")
d2$y <- with(d2, 50 + 4 * x1 - 2 * x2 - 3 * x1^2 + 1.5 * x1 * x2 + 0.4 * x3 + rnorm(20, sd = 0.7))
fq <- y ~ x1 + x2 + x3 + I(x1^2) + I(x2^2) + I(x3^2) + x1:x2 + x1:x3 + x2:x3
for (m in c("p", "aicc")) cases[[length(cases) + 1]] <- list(name = paste("CCD k = 3, quadratic,", m), input = list(rows = rows_of(d2), formula = "y ~ quadratic", method = m, alphaOut = 0.1), output = reduce(fq, d2, m))

d3 <- expand.grid(x1 = c(-1, 1), x2 = c(-1, 1), g = c("a", "b", "c")); d3 <- d3[rep(1:12, 2), ]
d3$y <- with(d3, 5 + 2 * x1 + c(a = 0, b = 1.5, c = -1)[as.character(g)] + 0.3 * x2 + rnorm(24, sd = 0.6))
d3$g <- factor(d3$g, levels = c("b", "c", "a"))
for (m in c("p", "aicc")) cases[[length(cases) + 1]] <- list(name = paste("2 x 2 x 3 replicated, x1*x2*g,", m), input = list(rows = rows_of(d3), formula = "y ~ x1*x2*g", method = m, alphaOut = 0.1, levels = c("a", "b", "c")),
  output = reduce(y ~ x1 * x2 * g, d3, m, contr = list(g = "contr.sum")))
write_fixture("reduce-r", cases, "tests/ref/reduce_r.R", c("stats"))
