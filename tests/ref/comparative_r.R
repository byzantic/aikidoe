# Designs for comparing treatments (issue #80, phase 2): Latin squares, balanced incomplete
# blocks and crossovers, and their analysis.
#
# Designs: crossdes::williams(t) for t = 2 … 9 (the sequences, compared exactly); balanced
# incomplete block designs from crossdes::find.BIB (AlgDesign's optBlock), with their efficiency
# (the harmonic mean of the canonical efficiency factors, the non-zero eigenvalues of
# R^-1/2 C R^-1/2 with C = R - N K^-1 N') and whether they are balanced (equal concurrences);
# also an unbalanced design (6 treatments in 8 blocks of 3).
# Analyses (simulated data): a 5 x 5 Latin square, fixed rows and columns (lm, type II F tests,
# emmeans Tukey) and random crossed rows and columns (lmer, Kenward-Roger); a balanced incomplete
# block design, 6 treatments in 10 blocks of 3, fixed blocks (the intra-block analysis) and random
# blocks (the recovery of inter-block information, lmer, Kenward-Roger); a Williams crossover, 4
# treatments, 8 subjects, with first-order carry-over (sum-to-zero columns, 0 in the first period):
# fixed subjects (lm; the treatment and carry-over F tests by model comparison, so each adjusted for
# the other) and random subjects (lmer, Kenward-Roger). Only differences of treatments are compared
# for the crossover: its means depend on how carry-over is averaged.
source("tests/ref/fixture.R")
suppressPackageStartupMessages({ library(crossdes); library(emmeans); library(lme4); library(pbkrtest); library(car) })
emm_options(msg.interaction = FALSE, msg.nesting = FALSE)
set.seed(20261181)
cases <- list()
add <- function(x) cases[[length(cases) + 1]] <<- x
rows_of <- function(d) unname(lapply(seq_len(nrow(d)), function(i) lapply(as.list(d[i, , drop = FALSE]), function(v) if (is.factor(v)) as.character(v) else v)))
pairs_of <- function(e) {
  s <- as.data.frame(summary(pairs(e, adjust = "tukey"), infer = c(TRUE, TRUE)))
  lapply(seq_len(nrow(s)), function(i) list(label = as.character(s$contrast[i]), estimate = s$estimate[i], se = s$SE[i], df = s$df[i], p = s$p.value[i]))
}
means_of <- function(e) { s <- as.data.frame(summary(e)); lapply(seq_len(nrow(s)), function(i) list(mean = s$emmean[i], se = s$SE[i], df = s$df[i])) }
ctrl <- lmerControl(optimizer = "bobyqa", optCtrl = list(maxfun = 1e5, rhoend = 1e-10), check.conv.singular = "ignore")
vc_of <- function(f) { v <- as.data.frame(VarCorr(f)); setNames(as.list(v$vcov), v$grp) }

# --- designs
for (t in 2:9) add(list(name = paste("williams", t), input = list(design = "williams", t = t), output = list(sequences = williams(t))))

eff_of <- function(blocks, t) {
  N <- matrix(0, t, length(blocks)); for (j in seq_along(blocks)) for (i in blocks[[j]]) N[i, j] <- N[i, j] + 1
  r <- rowSums(N); k <- colSums(N)
  C <- diag(r) - N %*% diag(1 / k) %*% t(N)
  W <- diag(1 / sqrt(r)) %*% C %*% diag(1 / sqrt(r))
  ev <- sort(eigen(W, symmetric = TRUE)$values, decreasing = TRUE)[1:(t - 1)]
  conc <- N %*% t(N); off <- conc[upper.tri(conc)]
  list(efficiency = (t - 1) / sum(1 / ev), factors = I(ev), balanced = length(unique(off)) == 1 && length(unique(r)) == 1, concurrence = list(min = min(off), max = max(off)))
}
# designs found by crossdes::find.BIB(t, b, 3, iter = 200) (set.seed(100 t + b)), written out here so
# that the fixture does not depend on the search's random path; find.BIB's verdict (isGYD) is
# checked when the designs are regenerated
bib <- list(
  list(t = 7, m = rbind(c(1,3,4), c(1,2,6), c(4,5,6), c(3,6,7), c(2,4,7), c(1,5,7), c(2,3,5))),
  list(t = 6, m = rbind(c(1,2,4), c(1,3,5), c(2,3,6), c(1,5,6), c(1,3,4), c(4,5,6), c(2,4,5), c(3,4,6), c(1,2,6), c(2,3,5))),
  list(t = 9, m = rbind(c(4,8,9), c(2,3,9), c(1,5,9), c(3,4,7), c(2,5,7), c(1,3,6), c(1,2,4), c(3,5,8), c(2,6,8), c(4,5,6), c(6,7,9), c(1,7,8))),
  list(t = 5, m = rbind(c(1,2,4), c(2,3,5), c(1,2,5), c(1,4,5), c(3,4,5), c(2,3,4), c(1,2,3), c(1,3,5), c(2,4,5), c(1,3,4))),
  list(t = 6, m = rbind(c(1,2,4), c(3,4,6), c(2,3,5), c(1,4,6), c(1,5,6), c(3,4,5), c(2,5,6), c(1,2,3))))
for (p in bib) {
  blocks <- lapply(seq_len(nrow(p$m)), function(j) I(p$m[j, ]))
  add(list(name = sprintf("block design t=%d b=%d k=3", p$t, nrow(p$m)), input = list(design = "blocks", t = p$t, blocks = blocks), output = eff_of(blocks, p$t)))
}

# --- analyses
trt <- c("A", "B", "C", "D", "E", "F")

# 1. a 5 x 5 Latin square: rows (days) and columns (operators)
sq <- outer(0:4, 0:4, function(i, j) (i + 2 * j) %% 5) + 1
d1 <- expand.grid(row = 1:5, column = 1:5); d1$G <- factor(trt[sq[cbind(d1$row, d1$column)]], levels = trt[1:5])
d1$y <- with(d1, 30 + c(A = 0, B = 1.2, C = 2.5, D = 0.4, E = -0.8)[as.character(G)] + rnorm(5, sd = 1.5)[row] + rnorm(5, sd = 1)[column] + rnorm(25, sd = 0.7))
{
  d <- d1; d$row <- factor(d$row); d$column <- factor(d$column)
  f <- lm(y ~ row + column + G, d); a <- Anova(f, type = 2); e <- emmeans(f, "G")
  g <- lmer(y ~ G + (1 | row) + (1 | column), d, REML = TRUE, control = ctrl); eg <- emmeans(g, "G", lmer.df = "kenward-roger")
  add(list(name = "latin square", input = list(rows = rows_of(d1), levels = I(trt[1:5]), blocking = I(c("row", "column"))),
    output = list(fixed = list(anova = list(F = a["G", "F value"], df = a["G", "Df"], p = a["G", "Pr(>F)"], sigma = sigma(f)), means = means_of(e), pairs = pairs_of(e)),
      random = list(varcomp = vc_of(g), means = means_of(eg), pairs = pairs_of(eg)))))
}

# 2. a balanced incomplete block design: 6 treatments in 10 blocks of 3
m <- bib[[2]]$m
stopifnot(eff_of(lapply(seq_len(nrow(m)), function(j) m[j, ]), 6)$balanced)
d2 <- data.frame(block = rep(1:10, each = 3), G = factor(trt[as.vector(t(m))], levels = trt))
set.seed(20261182)
d2$y <- with(d2, 12 + c(A = 0, B = 0.9, C = 1.8, D = -0.5, E = 0.3, F = 1.1)[as.character(G)] + rnorm(10, sd = 1.2)[block] + rnorm(30, sd = 0.6))
{
  d <- d2; d$block <- factor(d$block)
  f <- lm(y ~ block + G, d); a <- Anova(f, type = 2); e <- emmeans(f, "G")
  g <- lmer(y ~ G + (1 | block), d, REML = TRUE, control = ctrl); eg <- emmeans(g, "G", lmer.df = "kenward-roger")
  add(list(name = "balanced incomplete blocks", input = list(rows = rows_of(d2), levels = I(trt)),
    output = list(fixed = list(anova = list(F = a["G", "F value"], df = a["G", "Df"], p = a["G", "Pr(>F)"], sigma = sigma(f)), means = means_of(e), pairs = pairs_of(e)),
      random = list(varcomp = vc_of(g), means = means_of(eg), pairs = pairs_of(eg)))))
}

# 3. a Williams crossover: 4 treatments, 8 subjects (each sequence twice), 4 periods
W <- williams(4); seqOf <- c(1, 2, 3, 4, 1, 2, 3, 4)
d3 <- expand.grid(period = 1:4, subject = 1:8)[, 2:1]
d3$G <- factor(trt[W[cbind(seqOf[d3$subject], d3$period)]], levels = trt[1:4])
prev <- ifelse(d3$period == 1, NA, trt[W[cbind(seqOf[d3$subject], pmax(d3$period - 1, 1))]])
carry <- t(sapply(prev, function(p) if (is.na(p)) c(0, 0, 0) else if (p == "D") c(-1, -1, -1) else as.numeric(trt[1:3] == p)))
d3$c1 <- carry[, 1]; d3$c2 <- carry[, 2]; d3$c3 <- carry[, 3]
set.seed(20261183)
d3$y <- with(d3, 100 + c(A = 0, B = 3, C = 5, D = 1)[as.character(G)] + c(0, 1.5, 2, 2.5)[period] + rnorm(8, sd = 4)[subject] +
  ifelse(is.na(prev), 0, c(A = 0, B = 1, C = 1.5, D = -1)[prev]) + rnorm(32, sd = 1.5))
{
  d <- d3; d$subject <- factor(d$subject); d$period <- factor(d$period)
  f <- lm(y ~ subject + period + G + c1 + c2 + c3, d)
  noG <- lm(y ~ subject + period + c1 + c2 + c3, d); noC <- lm(y ~ subject + period + G, d)
  aG <- anova(noG, f); aC <- anova(noC, f)
  e <- emmeans(f, "G")
  g <- lmer(y ~ period + G + c1 + c2 + c3 + (1 | subject), d, REML = TRUE, control = ctrl); eg <- emmeans(g, "G", lmer.df = "kenward-roger")
  add(list(name = "williams crossover", input = list(rows = rows_of(d3[, c("subject", "period", "G", "y")]), levels = I(trt[1:4])),
    output = list(fixed = list(treatment = list(F = aG$F[2], df = aG$Df[2], p = aG[2, "Pr(>F)"]), carryover = list(F = aC$F[2], df = aC$Df[2], p = aC[2, "Pr(>F)"]), sigma = sigma(f), pairs = pairs_of(e)),
      random = list(varcomp = vc_of(g), pairs = pairs_of(eg)))))
}

write_fixture("comparative-r", cases, "tests/ref/comparative_r.R", c("crossdes", "AlgDesign", "emmeans", "lme4", "pbkrtest", "car"), tolerance = list(rel = 1e-6, abs = 1e-8))
