# Comparing a factor's levels (issue #80, phase 1).
#
# emmeans: the adjusted means of the levels; all pairs with Tukey's adjustment, Holm's and
# Bonferroni's (p values; Bonferroni intervals, which emmeans also gives for Holm); each level
# against a control and user contrasts, whose single-step (multivariate t) p values and critical
# value are computed here at high precision rather than at emmeans' default: Dunnett's
# comparisons have product-form correlations, done exactly by integrate(); other contrasts by
# mvtnorm's pmvt (abseps 1e-7); critical values by uniroot. The compact letter display:
# multcompView::multcompLetters on the Tukey p values, compared as which levels share a letter.
# Cases: a one-way layout of five media, unbalanced; a randomised complete block design (fixed
# blocks); counts (a Poisson GLM, ratios against the control); the block design with random blocks
# (lmer, Kenward-Roger df, integers here).
source("tests/ref/fixture.R")
suppressPackageStartupMessages({ library(emmeans); library(mvtnorm); library(multcompView); library(lme4); library(pbkrtest) })
emm_options(msg.interaction = FALSE, msg.nesting = FALSE)
set.seed(20261180)
cases <- list()
add <- function(x) cases[[length(cases) + 1]] <<- x
rows_of <- function(d) unname(lapply(seq_len(nrow(d)), function(i) lapply(as.list(d[i, , drop = FALSE]), function(v) if (is.factor(v)) as.character(v) else v)))
G <- GenzBretz(maxpts = 2e6, abseps = 1e-7, releps = 0)
pm <- function(t, R, df) { set.seed(1); if (is.finite(df)) { stopifnot(abs(df - round(df)) < 1e-6); df <- round(df) }; if (is.finite(df)) pmvt(-rep(abs(t), nrow(R)), rep(abs(t), nrow(R)), df = df, corr = R, algorithm = G)[1] else pmvnorm(-rep(abs(t), nrow(R)), rep(abs(t), nrow(R)), corr = R, algorithm = G)[1] }
# the product form (Dunnett's comparisons from independent means, or a balanced model):
# R_ij = l_i l_j, and the probability is an integral over a common normal factor (and over s for
# t), done here by integrate() (QUADPACK) to 1e-12 — exact, and independent of mvtnorm
lambda_of <- function(R) {
  m <- nrow(R); if (m < 3) return(NULL)
  l <- sapply(seq_len(m), function(i) { o <- setdiff(seq_len(m), i); sqrt(R[i, o[1]] * R[i, o[2]] / R[o[1], o[2]]) })
  for (i in 2:m) if (sign(R[1, i]) != sign(l[1] * l[i])) l[i] <- -l[i]
  L <- outer(l, l); diag(L) <- 1
  if (all(is.finite(l)) && all(abs(l) < 1 - 1e-9) && max(abs(L - R)) < 1e-9) l else NULL
}
p_prod <- function(c, l, df) {
  inner <- function(b) integrate(function(z) sapply(z, function(zz) dnorm(zz) * prod(pnorm((b + l * zz) / sqrt(1 - l^2)) - pnorm((-b + l * zz) / sqrt(1 - l^2)))), -12, 12, rel.tol = 1e-11, abs.tol = 1e-15, subdivisions = 2000L)$value
  if (!is.finite(df)) return(inner(c))
  lo <- sqrt(qchisq(1e-15, df) / df); hi <- sqrt(qchisq(1e-15, df, lower.tail = FALSE) / df)
  integrate(function(s) sapply(s, function(ss) 2 * df * ss * dchisq(df * ss^2, df) * inner(c * ss)), lo, hi, rel.tol = 1e-10, abs.tol = 1e-14, subdivisions = 2000L)$value
}
pm_any <- function(t, R, df) { l <- lambda_of(R); if (!is.null(l)) p_prod(abs(t), l, df) else pm(t, R, df) }
crit <- function(R, df) uniroot(function(c) pm_any(c, R, df) - 0.95, c(1.5, 4.5), tol = 1e-10)$root

summ <- function(s, est = c("estimate", "ratio", "odds.ratio")) {
  s <- as.data.frame(s); e <- intersect(est, names(s))[1]
  lo <- intersect(c("lower.CL", "asymp.LCL"), names(s))[1]; up <- intersect(c("upper.CL", "asymp.UCL"), names(s))[1]
  lapply(seq_len(nrow(s)), function(i) list(label = as.character(s$contrast[i]), estimate = s[[e]][i], se = s$SE[i], df = if (is.finite(s$df[i])) s$df[i] else NULL,
    p = s$p.value[i], lower = if (!is.null(lo)) s[[lo]][i] else NULL, upper = if (!is.null(up)) s[[up]][i] else NULL))
}
# single-step for a contrast object: correlations from its vcov; p by mvtnorm at high precision
mvt_out <- function(cn) {
  s <- as.data.frame(summary(cn, adjust = "none", infer = c(FALSE, TRUE)))
  V <- vcov(cn); R <- cov2cor(V); df <- s$df[1]; if (!is.finite(df)) df <- Inf
  t <- s[[intersect(c("t.ratio", "z.ratio"), names(s))[1]]]
  c95 <- crit(R, df)
  est <- s[[intersect(c("estimate", "ratio", "odds.ratio"), names(s))[1]]]
  list(comparisons = lapply(seq_len(nrow(s)), function(i) list(label = as.character(s$contrast[i]), estimate = est[i], se = s$SE[i], stat = t[i], p = 1 - pm_any(t[i], R, df))),
    critical = c95, method = if (is.null(lambda_of(R))) "mvtnorm" else "product form, integrate()")
}
letters_of <- function(pr) {
  # which levels share a letter (multcompView), as a 0/1 matrix in the levels' order
  p <- pr$p.value; names(p) <- gsub(" ", "", as.character(pr$contrast))
  l <- multcompLetters(p, threshold = 0.05)$Letters
  lv <- names(l); m <- outer(lv, lv, Vectorize(function(a, b) as.integer(length(intersect(strsplit(l[a], "")[[1]], strsplit(l[b], "")[[1]])) > 0)))
  list(levels = I(lv), share = lapply(seq_len(nrow(m)), function(i) I(m[i, ])))
}

# 1. five media, unbalanced; the control "M0"
d1 <- data.frame(G = factor(rep(c("M0", "M1", "M2", "M3", "M4"), times = c(4, 5, 4, 6, 5)), levels = c("M0", "M1", "M2", "M3", "M4")))
d1$y <- with(d1, 20 + c(M0 = 0, M1 = 0.4, M2 = 2.6, M3 = 3.1, M4 = 1.2)[as.character(G)] + rnorm(nrow(d1), sd = 1.1))
{
  f <- lm(y ~ G, d1); e <- emmeans(f, "G")
  em <- as.data.frame(summary(e))
  tk <- pairs(e, adjust = "tukey"); tks <- summary(tk, infer = c(TRUE, TRUE))
  dn <- contrast(e, "trt.vs.ctrl", ref = 1)
  cs <- contrast(e, list("M2 - M0" = c(-1, 0, 1, 0, 0), "(M2 + M3)/2 - M0" = c(-1, 0, .5, .5, 0), "M3 - M2" = c(0, 0, -1, 1, 0)))
  add(list(name = "five media, unbalanced", input = list(rows = rows_of(d1), levels = I(levels(d1$G)), formula = "y ~ G", control = "M0", contrasts = I(c("M2 - M0", "(M2 + M3)/2 - M0", "M3 - M2"))),
    output = list(means = lapply(seq_len(nrow(em)), function(i) list(mean = em$emmean[i], se = em$SE[i], lower = em$lower.CL[i], upper = em$upper.CL[i])),
      tukey = summ(tks), holm = summ(summary(pairs(e, adjust = "holm"), infer = c(TRUE, TRUE))), bonferroni = summ(summary(pairs(e, adjust = "bonferroni"), infer = c(TRUE, TRUE))),
      dunnett = mvt_out(dn), dunnettHolm = summ(summary(dn, adjust = "holm", infer = c(TRUE, TRUE))), contrasts = mvt_out(cs),
      letters = letters_of(as.data.frame(tks)))))
}

# 2. a randomised complete block design: 4 treatments in 5 blocks (fixed), one run lost
d2 <- expand.grid(G = factor(c("ctrl", "A", "B", "C"), levels = c("ctrl", "A", "B", "C")), block = 1:5)
bl <- rnorm(5, sd = 2)
d2$y <- with(d2, 50 + c(ctrl = 0, A = 1.5, B = 3, C = 0.5)[as.character(G)] + bl[block] + rnorm(nrow(d2), sd = 0.8))
d2 <- d2[-7, ]
{
  d2f <- d2; d2f$block <- factor(d2f$block)
  f <- lm(y ~ block + G, d2f); e <- emmeans(f, "G")
  em <- as.data.frame(summary(e))
  add(list(name = "randomised complete blocks", input = list(rows = rows_of(d2), levels = I(levels(d2$G)), formula = "y ~ G", control = "ctrl"),
    output = list(means = lapply(seq_len(nrow(em)), function(i) list(mean = em$emmean[i], se = em$SE[i], lower = em$lower.CL[i], upper = em$upper.CL[i])),
      tukey = summ(summary(pairs(e), infer = c(TRUE, TRUE))), dunnett = mvt_out(contrast(e, "trt.vs.ctrl", ref = 1)))))
}

# 3. counts: colonies on four media, a Poisson GLM; each medium against the control as a ratio
d3 <- data.frame(G = factor(rep(c("std", "m1", "m2", "m3"), each = 5), levels = c("std", "m1", "m2", "m3")))
d3$y <- rpois(20, exp(log(40) + c(std = 0, m1 = 0.25, m2 = -0.1, m3 = 0.5)[as.character(d3$G)]))
{
  f <- glm(y ~ G, poisson, d3); e <- emmeans(f, "G", type = "response")
  dn <- contrast(e, "trt.vs.ctrl", ref = 1)
  em <- as.data.frame(summary(e))
  add(list(name = "counts: ratios with the control", input = list(rows = rows_of(d3), levels = I(levels(d3$G)), formula = "y ~ G", control = "std", distribution = "poisson"),
    output = list(means = lapply(seq_len(nrow(em)), function(i) list(mean = em$rate[i], se = em$SE[i], lower = em$asymp.LCL[i], upper = em$asymp.UCL[i])),
      dunnett = mvt_out(dn), tukey = summ(summary(pairs(e), infer = c(TRUE, TRUE))))))
}

# 4. the block design with random blocks (complete, so the KR df are integers)
d4 <- expand.grid(G = factor(c("ctrl", "A", "B", "C"), levels = c("ctrl", "A", "B", "C")), block = 1:6)
bl <- rnorm(6, sd = 1.5)
d4$y <- with(d4, 10 + c(ctrl = 0, A = 0.8, B = 1.6, C = -0.4)[as.character(G)] + bl[block] + rnorm(nrow(d4), sd = 0.7))
{
  d4f <- d4; d4f$block <- factor(d4f$block)
  ctrl <- lmerControl(optimizer = "bobyqa", optCtrl = list(maxfun = 1e5, rhoend = 1e-9), check.conv.singular = "ignore")
  f <- lmer(y ~ G + (1 | block), d4f, REML = TRUE, control = ctrl); e <- emmeans(f, "G", lmer.df = "kenward-roger")
  em <- as.data.frame(summary(e))
  add(list(name = "random blocks", input = list(rows = rows_of(d4), levels = I(levels(d4$G)), formula = "y ~ G", control = "ctrl", random = "block"),
    output = list(means = lapply(seq_len(nrow(em)), function(i) list(mean = em$emmean[i], se = em$SE[i], lower = em$lower.CL[i], upper = em$upper.CL[i])),
      tukey = summ(summary(pairs(e), infer = c(TRUE, TRUE))), dunnett = mvt_out(contrast(e, "trt.vs.ctrl", ref = 1)))))
}

write_fixture("compare-r", cases, "tests/ref/compare_r.R", c("emmeans", "mvtnorm", "multcompView", "lme4", "pbkrtest"), tolerance = list(rel = 1e-6, abs = 1e-8))
