# Issue #11 references from base R: a model with a block factor (effect coded as aikidoe does:
# contr.sum with the first level last) and predictions with confidence and prediction
# intervals, at the average block (block columns zero) and for an unblocked model.
source("tests/ref/fixture.R")
set.seed(20261105)

pred_manual <- function(fit, X0, level = 0.95) {
  b <- coef(fit); V <- vcov(fit); s <- summary(fit)$sigma; t <- qt(1 - (1 - level) / 2, fit$df.residual)
  fitv <- drop(X0 %*% b); se <- sqrt(rowSums((X0 %*% V) * X0)); sp <- sqrt(se^2 + s^2)
  list(fit = I(fitv), se = I(se), lower = I(fitv - t * se), upper = I(fitv + t * se), predLower = I(fitv - t * sp), predUpper = I(fitv + t * sp))
}

# 1. three blocks, quadratic in two factors
n <- 18
d <- data.frame(x1 = round(runif(n, -1, 1), 3), x2 = round(runif(n, -1, 1), 3), block = rep(c("1", "2", "3"), each = 6))
d$y <- 10 + 2 * d$x1 - d$x2 + 1.5 * d$x1 * d$x2 - 2 * d$x1^2 + c(`1` = 0, `2` = 1.2, `3` = -0.7)[d$block] + rnorm(n, 0, 0.3)
d$Block <- factor(d$block, levels = c("2", "3", "1")); contrasts(d$Block) <- contr.sum(3)
fit <- lm(y ~ Block + x1 + x2 + I(x1^2) + x1:x2, data = d)
new <- data.frame(x1 = c(0, 0.5, -0.8), x2 = c(0, -0.3, 0.9))
X0 <- cbind(1, 0, 0, new$x1, new$x2, new$x1^2, new$x1 * new$x2)       # average block: block columns 0
a <- anova(fit)
case1 <- list(name = "three blocks, quadratic", input = list(rows = lapply(seq_len(n), function(i) list(x1 = d$x1[i], x2 = d$x2[i], block = d$block[i])), y = I(d$y),
  formula = "y ~ x1 + x2 + I(x1^2) + x1:x2", newdata = lapply(seq_len(nrow(new)), function(i) as.list(new[i, ]))),
  output = list(coef = I(unname(coef(fit))), sigma = summary(fit)$sigma,
    anova = lapply(seq_len(nrow(a)), function(i) list(term = rownames(a)[i], df = a$Df[i], ss = a$`Sum Sq`[i])),
    predict = pred_manual(fit, X0)))

# 2. unblocked, predict.lm intervals directly
d2 <- data.frame(x1 = runif(12, -1, 1), x2 = runif(12, -1, 1)); d2$y <- 3 + d2$x1 - 2 * d2$x2 + 0.5 * d2$x1 * d2$x2 + rnorm(12, 0, 0.2)
f2 <- lm(y ~ x1 * x2, data = d2)
new2 <- data.frame(x1 = c(0.2, -1, 1.5), x2 = c(0.1, 1, -0.5))
pc <- predict(f2, new2, interval = "confidence"); pp <- predict(f2, new2, interval = "prediction")
case2 <- list(name = "unblocked, predict.lm", input = list(rows = lapply(seq_len(12), function(i) list(x1 = d2$x1[i], x2 = d2$x2[i])), y = I(d2$y),
  formula = "y ~ x1*x2", newdata = lapply(seq_len(3), function(i) as.list(new2[i, ]))),
  output = list(predict = list(fit = I(unname(pc[, 1])), lower = I(unname(pc[, 2])), upper = I(unname(pc[, 3])), predLower = I(unname(pp[, 2])), predUpper = I(unname(pp[, 3])))))
write_fixture("augment-r", list(case1, case2), "tests/ref/augment_r.R", c("stats"))
