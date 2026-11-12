# Equivalence and non-inferiority (issue #84): two one-sided tests (TOST) and non-inferiority
# against margins, checked against TOSTER (two groups, unpaired and paired; the ratio of means on
# the log scale) and emmeans (a factor in a larger model, blocks, a mixed model with Kenward-Roger
# df, Poisson counts as rate ratios, proportions as a difference by regrid).
#
# Recorded per comparison (test - reference): estimate, SE, df, the 90 % interval, the two one-sided
# p values and the TOST p (TOSTER), or emmeans' (unadjusted: each comparison is its own question) equivalence p (side = "equivalence", the larger of
# the two one-sided p values) and non-inferiority p (side = ">" or "<"), with confint at 0.90.
source("tests/ref/fixture.R")
suppressPackageStartupMessages({ library(TOSTER); library(emmeans); library(lme4); library(pbkrtest) })
emm_options(msg.interaction = FALSE, msg.nesting = FALSE)
cases <- list()
add <- function(x) cases[[length(cases) + 1]] <<- x
ctrl <- lmerControl(optimizer = "bobyqa", optCtrl = list(maxfun = 1e5, rhoend = 1e-10), check.conv.singular = "ignore")
toster <- function(r) {
  T <- r$TOST; E <- r$effsize
  list(estimate = E$estimate[1], se = T$SE[1], df = T$df[1], lower = E$lower.ci[1], upper = E$upper.ci[1],
    pLower = T$p.value[2], pUpper = T$p.value[3], p = max(T$p.value[2], T$p.value[3]), pDiff = T$p.value[1])
}
emm_rows <- function(pr, delta, ni_side, ...) {
  ci <- as.data.frame(confint(pr, level = 0.90, adjust = "none", ...)); eq <- as.data.frame(test(pr, delta = delta, side = "equivalence", adjust = "none", ...))
  ni <- as.data.frame(test(pr, delta = delta, side = ni_side, adjust = "none", ...))
  lapply(seq_len(nrow(ci)), function(i) list(label = as.character(ci$contrast[i]), estimate = ci[i, 2], se = ci$SE[i], df = ci$df[i],
    lower = ci[i, ncol(ci) - 1], upper = ci[i, ncol(ci)], p = eq$p.value[i], pNoninf = ni$p.value[i]))
}

# 1. two groups, unpaired (pooled variance): a new supplier against the current one
set.seed(841)
cur <- round(rnorm(10, 50, 2), 2); new <- round(rnorm(10, 50.6, 2), 2)
add(list(name = "two groups", input = list(test = I(new), reference = I(cur), margin = 2),
  output = toster(t_TOST(new, cur, eqb = 2, var.equal = TRUE))))

# 2. paired: each of 8 samples measured by the old and the new method
set.seed(842)
s <- rnorm(8, 100, 6); old <- round(s + rnorm(8, 0, 0.8), 2); nw <- round(s + 0.4 + rnorm(8, 0, 0.8), 2)
add(list(name = "paired", input = list(test = I(nw), reference = I(old), margin = 1.5),
  output = toster(t_TOST(nw, old, paired = TRUE, eqb = 1.5))))

# 3. the ratio of means on the log scale (bioequivalence-style margins 0.8 ... 1.25)
set.seed(843)
r0 <- round(exp(rnorm(12, log(20), 0.15)), 3); r1 <- round(exp(rnorm(12, log(20.8), 0.15)), 3)
add(list(name = "ratio of means", input = list(test = I(r1), reference = I(r0), lower = 0.8, upper = 1.25),
  output = toster(log_TOST(r1, r0, var.equal = TRUE, eqb = c(0.8, 1.25)))))

# 4. three new suppliers against the current one, in a model with the day as a block (fixed)
set.seed(844)
d4 <- expand.grid(G = c("Current", "S-B", "S-C", "S-D"), day = 1:5)
d4$y <- round(80 + c(0, 0.4, -1.8, 0.9)[as.integer(factor(d4$G, levels = c("Current", "S-B", "S-C", "S-D")))] + rnorm(5, 0, 1.5)[d4$day] + rnorm(20, 0, 0.7), 2)
{
  d <- d4; d$G <- factor(d$G, levels = c("Current", "S-B", "S-C", "S-D")); d$day <- factor(d$day)
  pr <- contrast(emmeans(lm(y ~ G + day, d), "G"), "trt.vs.ctrl")
  add(list(name = "suppliers with days as blocks", input = list(rows = unname(lapply(seq_len(nrow(d4)), function(i) as.list(d4[i, ]))), margin = 1.5),
    output = list(comparisons = emm_rows(pr, 1.5, ">"))))
  # the same with the days random (Kenward-Roger)
  g <- lmer(y ~ G + (1 | day), d, REML = TRUE, control = ctrl)
  pr2 <- contrast(emmeans(g, "G", lmer.df = "kenward-roger"), "trt.vs.ctrl")
  add(list(name = "suppliers with days random", input = list(rows = unname(lapply(seq_len(nrow(d4)), function(i) as.list(d4[i, ]))), margin = 1.5),
    output = list(comparisons = emm_rows(pr2, 1.5, ">"))))
}

# 5. a factor in a larger model: a new method (M) against the old one, two temperatures, with
# their interaction; compared at the average over temperature (emmeans' default)
set.seed(845)
d5 <- expand.grid(M = c("old", "new"), temp = c("low", "high"), rep = 1:4)
d5$y <- round(12 + 0.15 * (d5$M == "new") + 1.1 * (d5$temp == "high") + 0.2 * (d5$M == "new") * (d5$temp == "high") + rnorm(16, 0, 0.35), 3)
{
  d <- d5; d$M <- factor(d$M, levels = c("old", "new")); d$temp <- factor(d$temp, levels = c("low", "high"))
  pr <- contrast(emmeans(lm(y ~ M * temp, d), "M"), "trt.vs.ctrl")
  add(list(name = "method in a larger model", input = list(rows = unname(lapply(seq_len(nrow(d5)), function(i) list(M = as.character(d5$M[i]), temp = as.character(d5$temp[i]), y = d5$y[i]))), margin = 0.5),
    output = list(comparisons = emm_rows(pr, 0.5, ">"))))
}

# 6. counts: colonies with a new medium lot against the current, as a rate ratio (Poisson);
# margins 0.8 ... 1.25 (delta = log 1.25 on the log scale)
set.seed(8461)
d6 <- data.frame(lot = rep(c("current", "new"), each = 8)); d6$count <- rpois(16, ifelse(d6$lot == "new", 104, 100))
{
  d <- d6; d$lot <- factor(d$lot, levels = c("current", "new"))
  pr <- contrast(emmeans(glm(count ~ lot, poisson, d), "lot"), "trt.vs.ctrl")
  add(list(name = "counts rate ratio", input = list(rows = unname(lapply(seq_len(nrow(d6)), function(i) list(lot = as.character(d6$lot[i]), count = d6$count[i]))), lower = 0.8, upper = 1.25),
    output = list(comparisons = emm_rows(pr, log(1.25), ">"))))
}

# 7. proportions: germination out of 50 seeds with a new seed lot, as a difference of proportions
# (regrid: the delta method on the response scale), margin 0.1; also the odds ratio, margin 1.5
set.seed(847)
d7 <- data.frame(lot = rep(c("current", "new"), each = 10)); d7$germ <- rbinom(20, 50, ifelse(d7$lot == "new", 0.83, 0.85))
{
  d <- d7; d$lot <- factor(d$lot, levels = c("current", "new"))
  f <- glm(cbind(germ, 50 - germ) ~ lot, binomial, d)
  pr <- contrast(regrid(emmeans(f, "lot")), "trt.vs.ctrl")
  pr_or <- contrast(emmeans(f, "lot"), "trt.vs.ctrl")
  add(list(name = "proportions difference", input = list(rows = unname(lapply(seq_len(nrow(d7)), function(i) list(lot = as.character(d7$lot[i]), germ = d7$germ[i]))), margin = 0.1),
    output = list(comparisons = emm_rows(pr, 0.1, ">"), oddsRatio = emm_rows(pr_or, log(1.5), ">"))))
}

write_fixture("equivalence-r", cases, "tests/ref/equivalence_r.R", c("TOSTER", "emmeans", "lme4", "pbkrtest"), tolerance = list(rel = 1e-6, abs = 1e-9))
