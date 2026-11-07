# GLM references (issue #64): R's glm for Poisson, quasi-Poisson and binomial models (logit, probit,
# cloglog; quasi-binomial), MASS::glm.nb for the negative binomial, brglm2 (type "AS_mean") for
# Firth's penalised likelihood under separation. Coefficients, standard errors, deviances, AIC,
# dispersion, θ, residuals and influence, sequential analysis of deviance (anova.glm), type II and
# III likelihood-ratio tests (car::Anova), profile intervals (MASS confint) and predictions.
# The data are coded factors ±1 of a replicated 2³, generated here with a fixed seed.
source("tests/ref/fixture.R")
suppressPackageStartupMessages({ library(MASS); library(car); library(brglm2) })
set.seed(20261108)
cases <- list()

d <- expand.grid(A = c(-1, 1), B = c(-1, 1), C = c(-1, 1))
d <- rbind(d, d)
n <- nrow(d)
d$volume <- rep(c(0.5, 1, 2, 1), length.out = n)
eta <- 2 + 0.5 * d$A - 0.3 * d$B + 0.25 * d$A * d$B + 0.1 * d$C
d$count <- rpois(n, d$volume * exp(eta))
d$overd <- rnbinom(n, mu = exp(eta), size = 1.5)
p <- plogis(0.2 + 0.9 * d$A - 0.5 * d$B + 0.4 * d$A * d$C)
d$trials <- rep(c(20, 25), length.out = n)
d$germ <- rbinom(n, d$trials, p)
d$germod <- pmin(d$trials, rbinom(n, d$trials, pmin(0.99, pmax(0.01, p + rnorm(n, 0, 0.15)))))
at <- data.frame(A = c(0.5, -1, 1), B = c(-0.2, 1, -1), C = c(1, 0, 0.3))

rows <- function(m) unname(lapply(seq_len(nrow(m)), function(i) unname(as.numeric(m[i, ]))))
tab <- function(a, stat) list(term = I(rownames(a)), df = I(as.numeric(a$Df)), deviance = I(as.numeric(a$Deviance)), stat = I(as.numeric(if (is.null(stat)) NA else a[[stat]])), p = I(as.numeric(a[[ncol(a)]])))

glmcase <- function(name, m, input, dispersionFixed = TRUE) {
  s <- summary(m)
  cf <- s$coefficients
  disp <- s$dispersion
  a1 <- anova(m, test = if (dispersionFixed) "Chisq" else "F")
  # influence measures written out (R 4.6 changed several of R's own for glm objects): standardised
  # deviance residuals, studentised residuals (leave-one-out Pearson dispersion only when it is
  # estimated), Cook's distance with Pearson residuals
  h <- hatvalues(m); dr <- residuals(m, "deviance"); pr <- residuals(m, "pearson")
  rstd <- dr / sqrt(disp * (1 - h))
  s1 <- if (dispersionFixed) 1 else sqrt((sum(pr^2) - pr^2 / (1 - h)) / (df.residual(m) - 1))
  rstu <- sign(dr) * sqrt(dr^2 + h * pr^2 / (1 - h)) / s1
  cooks <- (pr / (1 - h))^2 * h / (disp * m$rank)
  out <- list(
    columns = I(rownames(cf)), coef = I(unname(cf[, 1])), se = I(unname(cf[, 2])), stat = I(unname(cf[, 3])), p = I(unname(cf[, 4])),
    deviance = deviance(m), nullDeviance = m$null.deviance, dfRes = df.residual(m), dispersion = disp,
    aic = if (dispersionFixed) AIC(m) else NA,
    fitted = I(unname(fitted(m))), pearson = I(unname(residuals(m, "pearson"))), devres = I(unname(residuals(m, "deviance"))),
    hat = I(unname(h)), rstandard = I(unname(rstd)), rstudent = I(unname(rstu)), cooks = I(unname(cooks)),
    anova1 = list(term = I(rownames(a1)[-1]), df = I(a1$Df[-1]), deviance = I(a1$Deviance[-1]), p = I(a1[-1, ncol(a1)])))
  if (dispersionFixed) {
    a2 <- Anova(m, type = 2, test.statistic = "LR"); a3 <- Anova(m, type = 3, test.statistic = "LR")
    out$anova2 <- list(term = I(rownames(a2)), chi2 = I(a2[["LR Chisq"]]), df = I(a2$Df), p = I(a2[["Pr(>Chisq)"]]))
    out$anova3 <- list(term = I(rownames(a3)), chi2 = I(a3[["LR Chisq"]]), df = I(a3$Df), p = I(a3[["Pr(>Chisq)"]]))
    ci <- suppressMessages(confint(m))
    out$confint <- list(lower = I(unname(ci[, 1])), upper = I(unname(ci[, 2])))
  }
  pr <- predict(m, newdata = cbind(at, volume = 1), type = "link", se.fit = TRUE)
  out$predict <- list(link = I(unname(pr$fit)), se = I(unname(pr$se.fit)))
  cases[[length(cases) + 1]] <<- list(name = name, input = c(input, list(A = I(d$A), B = I(d$B), C = I(d$C), at = list(A = I(at$A), B = I(at$B), C = I(at$C)))), output = out)
}

f2 <- count ~ (A + B + C)^2
glmcase("Poisson, log link, volume as exposure", glm(f2, family = poisson, offset = log(volume), data = d),
  list(distribution = "poisson", link = "log", formula = "count ~ (A + B + C)^2", y = I(d$count), exposure = I(d$volume)))
glmcase("Poisson, square-root link", glm(count ~ A + B + C, family = poisson(link = "sqrt"), data = d),
  list(distribution = "poisson", link = "sqrt", formula = "count ~ A + B + C", y = I(d$count)))
glmcase("quasi-Poisson on overdispersed counts", glm(overd ~ (A + B + C)^2, family = quasipoisson, data = d),
  list(distribution = "quasipoisson", link = "log", formula = "overd ~ (A + B + C)^2", y = I(d$overd)), dispersionFixed = FALSE)
glmcase("Poisson on overdispersed counts (overdispersion check)", glm(overd ~ (A + B + C)^2, family = poisson, data = d),
  list(distribution = "poisson", link = "log", formula = "overd ~ (A + B + C)^2", y = I(d$overd)))

# negative binomial: θ by maximum likelihood
nb <- glm.nb(overd ~ A + B + C + A:B, data = d)
glmcase("negative binomial (glm.nb)", nb, list(distribution = "negbin", link = "log", formula = "overd ~ A + B + C + A:B", y = I(d$overd)))
cases[[length(cases)]]$output$theta <- nb$theta
cases[[length(cases)]]$output$thetaSE <- nb$SE.theta
cases[[length(cases)]]$output$aic <- nb$aic

for (lk in c("logit", "probit", "cloglog")) {
  fm <- if (lk == "logit") cbind(germ, trials - germ) ~ (A + B + C)^2 else cbind(germ, trials - germ) ~ A + B + C + A:C
  glmcase(sprintf("binomial, %s link", lk), glm(fm, family = binomial(link = lk), data = d),
    list(distribution = "binomial", link = lk, formula = if (lk == "logit") "germ ~ (A + B + C)^2" else "germ ~ A + B + C + A:C", y = I(d$germ), trials = I(d$trials)))
}
glmcase("quasi-binomial", glm(cbind(germod, trials - germod) ~ A + B + C + A:C, family = quasibinomial, data = d),
  list(distribution = "quasibinomial", link = "logit", formula = "germod ~ A + B + C + A:C", y = I(d$germod), trials = I(d$trials)), dispersionFixed = FALSE)

# separation: pass/fail that A separates completely; Firth's estimates exist (brglm2, AS_mean)
s <- data.frame(A = rep(c(-1, -1, 1, 1), 4), B = rep(c(-1, 1), 8), C = rep(c(-1, -1, -1, -1, 1, 1, 1, 1), 2))
s$pass <- as.numeric(s$A > 0)
s$pass[c(3, 12)] <- c(0, 0)   # quasi-separation: a few failures at A = +1, none passing at A = −1
mf <- suppressWarnings(glm(pass ~ A + B + C, family = binomial, data = s))
mb <- glm(pass ~ A + B + C, family = binomial, data = s, method = "brglmFit", type = "AS_mean")
cf <- summary(mb)$coefficients
cases[[length(cases) + 1]] <- list(name = "pass/fail separated by A: Firth (brglm2)", input = list(distribution = "binomial", link = "logit", formula = "pass ~ A + B + C", y = I(s$pass), trials = I(rep(1, nrow(s))), A = I(s$A), B = I(s$B), C = I(s$C)),
  output = list(glmFitted = I(unname(fitted(mf))), glmCoefA = unname(coef(mf)["A"]), coef = I(unname(cf[, 1])), se = I(unname(cf[, 2])), deviance = deviance(mb)))
# Firth for a Poisson log-linear model (brglm2's mean bias reduction is Firth's for canonical links)
mpb <- glm(count ~ A + B + C, family = poisson, data = d, method = "brglmFit", type = "AS_mean")
cf <- summary(mpb)$coefficients
cases[[length(cases) + 1]] <- list(name = "Poisson with Firth's penalty (brglm2)", input = list(distribution = "poisson", link = "log", formula = "count ~ A + B + C", y = I(d$count), A = I(d$A), B = I(d$B), C = I(d$C)),
  output = list(coef = I(unname(cf[, 1])), se = I(unname(cf[, 2]))))

write_fixture("glm-r", cases, "tests/ref/glm_r.R", c("stats", "MASS", "car", "brglm2"), tolerance = list(rel = 1e-6, abs = 1e-8))
