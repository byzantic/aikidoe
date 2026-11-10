# Model reduction for counts and proportions with a random intercept (issue #78): backward
# elimination, keeping hierarchy, of lme4::glmer fits (adaptive Gauss–Hermite quadrature, 25 nodes,
# as aikidoe's analysis).
#   p:    each candidate's likelihood-ratio test (refitted without it, σ re-estimated; drop1's LRT);
#         a term whose columns are all constant within every group is an F = χ²/df on (df, m − q)
#         (m groups, q such columns of the current model, the intercept among them), unless σ is
#         estimated as 0; the largest p is dropped while p > 0.10.
#   aicc: AIC(glmer) + 2k(k+1)/(n − k − 1), k = fixed coefficients + 1 (σ), n = rows; the lowest
#         is dropped while it is lower than the current model's.
# Hierarchy: a term may go only when no remaining term has it as a parent. AIC is compared within
# one data set only, so lme4's convention for the saturated log-likelihood does not matter.
# Recorded: the sequence of dropped terms, each step's χ², F, p and AICc less the starting model's
# (lme4 1.x and 2.x differ in the log-likelihood's constant, which cancels), and the final terms.
source("tests/ref/fixture.R")
suppressPackageStartupMessages(library(lme4))
set.seed(20261110)
ctrl <- glmerControl(optimizer = "bobyqa", optCtrl = list(maxfun = 1e5), check.conv.singular = "ignore")
comps <- function(l) strsplit(l, ":", fixed = TRUE)[[1]]
parents <- function(l) { cs <- comps(l); if (length(cs) < 2) return(character()); vapply(seq_along(cs), function(i) paste(sort(cs[-i]), collapse = ":"), "") }
key <- function(l) paste(sort(comps(l)), collapse = ":")

fitg <- function(rhs, d, fam, trials) {
  f <- as.formula(paste("y ~", if (length(rhs)) paste(rhs, collapse = " + ") else "1", "+ (1 | g)"))
  if (fam$family == "poisson") glmer(f, d, family = fam, nAGQ = 25, control = ctrl)
  else { d$p <- d$y / trials; f <- update(f, p ~ .); glmer(f, d, family = fam, weights = rep(trials, nrow(d)), nAGQ = 25, control = ctrl) }
}
aicc <- function(m) { n <- nobs(m); k <- length(fixef(m)) + 1; AIC(m) + if (n - k - 1 > 0) 2 * k * (k + 1) / (n - k - 1) else Inf }
dropTest <- function(m1, m0, term, d) {
  X <- getME(m1, "X"); asg <- attr(X, "assign"); labs <- attr(terms(m1), "term.labels")
  lvl <- apply(X, 2, function(x) all(tapply(x, d$g, function(v) length(unique(v)) == 1)))
  cols <- which(asg == match(term, labs))
  df <- ncol(X) - ncol(getME(m0, "X")); x2 <- max(0, 2 * (as.numeric(logLik(m1)) - as.numeric(logLik(m0))))
  if (all(lvl[cols]) && getME(m1, "theta") > 1e-4) {
    ddf <- nlevels(d$g) - sum(lvl)
    list(df = df, chi2 = x2, F = x2 / df, ddf = ddf, p = pf(x2 / df, df, ddf, lower.tail = FALSE))
  } else list(df = df, chi2 = x2, p = pchisq(x2, df, lower.tail = FALSE))
}
reduce <- function(rhs, d, fam, method, trials = 1, alpha_out = 0.1) {
  m <- fitg(rhs, d, fam, trials); steps <- list(); start <- aicc(m)
  repeat {
    pk <- unique(unlist(lapply(rhs, parents)))
    cands <- rhs[!(vapply(rhs, key, "") %in% pk)]
    if (!length(cands)) break
    fits <- lapply(cands, function(l) fitg(setdiff(rhs, l), d, fam, trials))
    tests <- mapply(function(l, f) dropTest(m, f, l, d), cands, fits, SIMPLIFY = FALSE)
    a <- vapply(fits, aicc, 0)
    if (method == "p") { ps <- vapply(tests, function(t) t$p, 0); i <- which.max(ps); if (!(ps[i] > alpha_out)) break }
    else { i <- which.min(a); if (!(a[i] < aicc(m))) break }
    t <- tests[[i]]
    steps[[length(steps) + 1]] <- c(list(drop = cands[i], df = t$df, chi2 = t$chi2), if (!is.null(t$F)) list(F = t$F, ddf = t$ddf) else list(), list(p = t$p, daicc = a[i] - start))
    rhs <- setdiff(rhs, cands[i]); m <- fits[[i]]
  }
  list(steps = steps, final = I(rhs))
}
all2 <- function(f) { f <- f; out <- f; for (i in seq_along(f)) for (j in seq_along(f)) if (i < j) out <- c(out, paste(f[i], f[j], sep = ":")); out }
cases <- list()

# 1. Poisson counts, a split-plot: A and B hard to change (12 whole plots, the 2^2 three times),
#    C and D within each whole plot (a 2^2); whole-plot σ 0.4 on the log scale
wp <- expand.grid(A = c(-1, 1), B = c(-1, 1)); wp <- wp[rep(1:4, 3), ]; wp$g <- 1:12
sp <- expand.grid(C = c(-1, 1), D = c(-1, 1))
d1 <- do.call(rbind, lapply(1:12, function(w) cbind(wp[rep(w, 4), ], sp)))
u <- rnorm(12, 0, 0.4)
d1$y <- rpois(nrow(d1), exp(log(25) + 0.35 * d1$A + 0.05 * d1$B + 0.2 * d1$C + 0.12 * d1$A * d1$C + u[d1$g]))
d1$g <- factor(d1$g)
for (m in c("p", "aicc")) cases[[length(cases) + 1]] <- list(name = paste0("poisson-splitplot-", m),
  input = list(distribution = "poisson", group = "wholePlot", method = m, alphaOut = 0.1, formula = "y ~ (A+B+C+D)^2",
               data = list(A = I(d1$A), B = I(d1$B), C = I(d1$C), D = I(d1$D), g = I(as.integer(d1$g)), y = I(d1$y))),
  output = reduce(all2(c("A", "B", "C", "D")), d1, poisson(), m))

# 2. Binomial proportions (successes out of 30) in 10 blocks of a replicated 2^3, each block a half
#    replicate split on C (so C, constant within blocks, is judged between them); block σ 0.5 on
#    the logit scale
d2 <- expand.grid(A = c(-1, 1), B = c(-1, 1), C = c(-1, 1)); d2 <- d2[rep(1:8, 5), ]
d2$g <- rep(1:10, each = 4)
v <- rnorm(10, 0, 0.5)
d2$y <- rbinom(nrow(d2), 30, plogis(-0.3 + 0.45 * d2$A - 0.3 * d2$B + 0.25 * d2$A * d2$B + v[d2$g]))
d2$g <- factor(d2$g)
for (m in c("p", "aicc")) cases[[length(cases) + 1]] <- list(name = paste0("binomial-blocks-", m),
  input = list(distribution = "binomial", trials = 30, group = "block", method = m, alphaOut = 0.1, formula = "y ~ (A+B+C)^2",
               data = list(A = I(d2$A), B = I(d2$B), C = I(d2$C), g = I(as.integer(d2$g)), y = I(d2$y))),
  output = reduce(all2(c("A", "B", "C")), d2, binomial(), m, trials = 30))

write_fixture("reduce-glmm-r", cases, "tests/ref/reduce_glmm_r.R", c("lme4"), tolerance = list(rel = 2e-3, abs = 1e-4))
