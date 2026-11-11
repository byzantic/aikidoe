# Adjusted means and the test of equal slopes (ANCOVA; issue #82, phase 2).
#
# emmeans: estimated marginal means of a factor (other continuous factors and the covariate at
# their means, other categorical factors averaged with equal weight), on the response scale for
# GLMs (type = "response"), with Kenward-Roger df for lmer; pairwise comparisons with Tukey's
# adjustment (p values and intervals; ratios for a log link). Equal slopes: the model with every
# factor x covariate interaction against the model without, by anova() for lm (F) and glm (LRT),
# and pbkrtest::KRmodcomp for lmer. And ptukey, the studentized range, over a grid.
# aikidoe codes the covariate as (x - mean) / half-range; so does this script. Continuous factors
# are in coded units; categorical ones as R factors with their levels in the study's order.
source("tests/ref/fixture.R")
suppressPackageStartupMessages({ library(emmeans); library(lme4); library(pbkrtest) })
emm_options(msg.interaction = FALSE, msg.nesting = FALSE)
set.seed(20261183)
cases <- list()
add <- function(x) cases[[length(cases) + 1]] <<- x
rows_of <- function(d) unname(lapply(seq_len(nrow(d)), function(i) lapply(as.list(d[i, , drop = FALSE]), function(v) if (is.factor(v)) as.character(v) else v)))
scaled <- function(d) { xm <- mean(d$x); h <- (max(d$x) - min(d$x)) / 2; d$x <- (d$x - xm) / h; d }

emm_out <- function(e, p) {
  s <- as.data.frame(summary(e)); ps <- as.data.frame(summary(p, infer = c(TRUE, TRUE)))
  est <- intersect(c("emmean", "rate", "response", "prob"), names(s))[1]
  pe <- intersect(c("estimate", "ratio", "odds.ratio"), names(ps))[1]
  lo <- intersect(c("lower.CL", "asymp.LCL"), names(s))[1]; up <- intersect(c("upper.CL", "asymp.UCL"), names(s))[1]
  plo <- intersect(c("lower.CL", "asymp.LCL"), names(ps))[1]; pup <- intersect(c("upper.CL", "asymp.UCL"), names(ps))[1]
  stat <- intersect(c("t.ratio", "z.ratio"), names(ps))[1]
  list(means = lapply(seq_len(nrow(s)), function(i) list(mean = s[[est]][i], se = s$SE[i], df = if (is.finite(s$df[i])) s$df[i] else NULL, lower = s[[lo]][i], upper = s[[up]][i])),
    pairs = lapply(seq_len(nrow(ps)), function(i) list(contrast = as.character(ps$contrast[i]), estimate = ps[[pe]][i], se = ps$SE[i], df = if (is.finite(ps$df[i])) ps$df[i] else NULL,
      stat = ps[[stat]][i], p = ps$p.value[i], lower = ps[[plo]][i], upper = ps[[pup]][i])))
}

# 1. three groups and a covariate, unbalanced (two runs dropped): means, Tukey pairs, equal slopes
d <- data.frame(G = factor(rep(c("ctrl", "low", "high"), each = 7), levels = c("ctrl", "low", "high")))
d$x <- round(runif(21, 180, 260))
d$x[d$G == "high"] <- d$x[d$G == "high"] + 15          # the high group got larger units: adjusting matters
d$y <- with(d, 12 + c(ctrl = 0, low = 1.5, high = 3.2)[as.character(G)] + 0.04 * (x - 220) + rnorm(21, sd = 0.7))
d <- d[-c(3, 16), ]
{
  s <- scaled(d); fit <- lm(y ~ G + x, s); big <- lm(y ~ G * x, s)
  e <- emmeans(fit, "G"); o <- emm_out(e, pairs(e, reverse = FALSE))
  a <- anova(fit, big)
  add(list(name = "three groups and a covariate", input = list(rows = rows_of(d), levels = I(levels(d$G)), formula = "y ~ G + x", factor = "G"),
    output = c(o, list(raw = I(unname(tapply(d$y, d$G, mean))), n = I(unname(as.vector(table(d$G)))),
      slopes = list(df1 = a$Df[2], df2 = a$Res.Df[2], F = a$F[2], p = a[["Pr(>F)"]][2])))))
}

# 2. a continuous factor A, a three-level categorical B and a covariate, with A:B, unbalanced:
#    the means of A (at -1 and +1, averaged over B with equal weight) and of B (A at its mean)
d2 <- expand.grid(A = c(-1, 1), B = factor(c("p", "q", "r"), levels = c("p", "q", "r")), rep = 1:3)
d2$x <- round(rnorm(nrow(d2), 50, 6), 1)
d2$y <- with(d2, 20 + 2 * A + c(p = 0, q = 1, r = -1)[as.character(B)] + 0.8 * A * (B == "q") + 0.15 * (x - 50) + rnorm(nrow(d2), sd = 0.5))
d2 <- d2[-c(2, 9, 14), ]; d2$rep <- NULL
{
  s <- scaled(d2); fit <- lm(y ~ A * B + x, s); big <- lm(y ~ A * B + x + A:x + B:x, s)
  eA <- emmeans(fit, "A", at = list(A = c(-1, 1))); eB <- emmeans(fit, "B")
  a <- anova(fit, big)
  add(list(name = "a continuous and a categorical factor", input = list(rows = rows_of(d2), levels = I(levels(d2$B)), formula = "y ~ A * B + x", factor = "B", factor2 = "A"),
    output = c(emm_out(eB, pairs(eB)), list(A = emm_out(eA, pairs(eA)), raw = I(unname(tapply(d2$y, d2$B, mean))),
      slopes = list(df1 = a$Df[2], df2 = a$Res.Df[2], F = a$F[2], p = a[["Pr(>F)"]][2])))))
  # the same, with the covariate held at a given value (natural units) instead of its mean
  xm <- mean(d2$x); h <- (max(d2$x) - min(d2$x)) / 2
  eB2 <- emmeans(fit, "B", at = list(x = (56 - xm) / h))
  add(list(name = "means at a given covariate value", input = list(rows = rows_of(d2), levels = I(levels(d2$B)), formula = "y ~ A * B + x", factor = "B", at = list(x = 56)),
    output = emm_out(eB2, pairs(eB2))))
}

# 3. counts: a Poisson GLM, rates on the response scale, ratios between groups; equal slopes by LRT
d3 <- data.frame(G = factor(rep(c("a", "b", "c", "d"), each = 5), levels = c("a", "b", "c", "d")), A = rep(c(-1, 1), 10))
d3$x <- round(runif(20, 2, 30))
d3$y <- rpois(20, exp(3 + c(a = 0, b = 0.3, c = -0.2, d = 0.5)[as.character(d3$G)] + 0.2 * d3$A - 0.02 * (d3$x - 16)))
{
  s <- scaled(d3); fit <- glm(y ~ G + A + x, poisson, s); big <- glm(y ~ G + A + x + G:x + A:x, poisson, s)
  e <- emmeans(fit, "G", type = "response"); a <- anova(fit, big, test = "LRT")
  add(list(name = "poisson: rates and ratios", input = list(rows = rows_of(d3), levels = I(levels(d3$G)), formula = "y ~ G + A + x", factor = "G", distribution = "poisson"),
    output = c(emm_out(e, pairs(e)), list(slopes = list(df1 = a$Df[2], chisq = a$Deviance[2], p = a[["Pr(>Chi)"]][2])))))
}

# 4. REML: runs in whole plots of a hard-to-change factor W (2 levels), a three-level G within,
#    and a covariate per run; emmeans with Kenward-Roger df; equal slopes by KRmodcomp
ctrl <- lmerControl(optimizer = "bobyqa", optCtrl = list(maxfun = 1e5, rhoend = 1e-9), check.conv.singular = "ignore")
d4 <- expand.grid(G = factor(c("g1", "g2", "g3"), levels = c("g1", "g2", "g3")), wp = 1:8)
d4$W <- ifelse(d4$wp %% 2 == 0, 1, -1)
d4$x <- round(rnorm(nrow(d4), 10, 2), 2)
u <- rnorm(8, sd = 1)
d4$y <- with(d4, 30 + 1.5 * W + c(g1 = 0, g2 = 1, g3 = 2.5)[as.character(G)] + 0.6 * (x - 10) + u[wp] + rnorm(nrow(d4), sd = 0.6))
{
  s <- scaled(d4); s$wp <- factor(s$wp)
  fit <- lmer(y ~ W + G + x + (1 | wp), s, REML = TRUE, control = ctrl)
  big <- lmer(y ~ W + G + x + W:x + G:x + (1 | wp), s, REML = TRUE, control = ctrl)
  e <- emmeans(fit, "G", lmer.df = "kenward-roger"); k <- KRmodcomp(big, fit)$stats
  add(list(name = "REML: Kenward-Roger", input = list(rows = rows_of(d4), levels = I(levels(d4$G)), formula = "y ~ W + G + x", factor = "G"),
    output = c(emm_out(e, pairs(e)), list(slopes = list(df1 = k$ndf, df2 = k$ddf, F = k$Fstat, p = k$p.value)))))
}

# 5. the studentized range
grid <- expand.grid(q = c(0.5, 1.5, 2.5, 3.5, 5, 8), nmeans = c(2, 3, 5, 10), df = c(2, 5, 12, 40, 150, 1000, Inf))
add(list(name = "ptukey", input = list(q = I(grid$q), nmeans = I(grid$nmeans), df = I(ifelse(is.finite(grid$df), grid$df, -1))),
  output = list(p = I(ptukey(grid$q, grid$nmeans, grid$df)), q95 = I(qtukey(0.95, grid$nmeans, grid$df)))))

write_fixture("adjusted-r", cases, "tests/ref/adjusted_r.R", c("emmeans", "lme4", "pbkrtest"), tolerance = list(rel = 1e-5, abs = 1e-7))
