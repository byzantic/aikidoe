# GLMM references (issue #64, phase 5): lme4::glmer with one random intercept (a block or a whole
# plot) for Poisson counts (with an exposure offset), binomial proportions (successes out of trials)
# and pass/fail results; the Laplace approximation (nAGQ = 1) and adaptive Gauss–Hermite quadrature
# (nAGQ = 25), canonical and non-canonical links, and a fit whose block variance is estimated as 0.
# Recorded: the fixed effects and their standard errors (vcov from the Hessian over σ and β, lme4's
# default), σ of the random intercept, the log-likelihood, the conditional modes of the block
# effects, and the likelihood-ratio test of one term (anova of nested fits).
# The data are coded factors ±1 of replicated 2^k designs, simulated here with a fixed seed.
source("tests/ref/fixture.R")
suppressPackageStartupMessages(library(lme4))
set.seed(20261107)
cases <- list()

ctrl <- glmerControl(optimizer = "bobyqa", optCtrl = list(maxfun = 1e5))

# With nAGQ > 1, lme4's log-likelihood is built from the deviance residuals, so it leaves out the
# saturated model's log-likelihood (Σ log f(y | μ = y)); it is added back here, so that every case
# records the full log-likelihood (as logLik gives for nAGQ = 1).
saturated <- function(fam, y, n) switch(fam$family,
  poisson = sum(dpois(y, y, log = TRUE)),
  binomial = sum(dbinom(round(y * n), n, y, log = TRUE)))

glmmcase <- function(name, f, data, family, nAGQ, drop, input, offset = NULL, weights = NULL) {
  data$.off <- if (is.null(offset)) 0 else offset
  data$.w <- if (is.null(weights)) 1 else weights
  m <- glmer(f, data = data, family = family, nAGQ = nAGQ, control = ctrl, offset = .off, weights = .w)
  m0 <- update(m, as.formula(paste(". ~ . -", drop)))
  a <- anova(m0, m)
  re <- ranef(m)[[1]]
  y <- model.response(model.frame(m))
  ll <- as.numeric(logLik(m)) + (if (nAGQ > 1) saturated(stats::family(m), y, data$.w) else 0)
  list(name = name, input = c(input, list(nAGQ = nAGQ, drop = drop)),
       output = list(coef = I(unname(fixef(m))), names = I(names(fixef(m))),
                     se = I(unname(sqrt(diag(as.matrix(vcov(m)))))),
                     sigma = unname(getME(m, "theta")),
                     loglik = ll, lme4loglik = as.numeric(logLik(m)),
                     modes = I(unname(re[, 1])), groups = I(rownames(re)),
                     lr = list(chisq = a$Chisq[2], df = a$Df[2], p = a[["Pr(>Chisq)"]][2])))
}

# 1. Poisson counts in 8 blocks of a replicated 2^3 (each block a half replicate), volume plated as
#    the exposure
d <- expand.grid(A = c(-1, 1), B = c(-1, 1), C = c(-1, 1))
d <- d[rep(seq_len(nrow(d)), 6), ]
d$block <- rep(1:12, each = 4)
d$volume <- rep(c(10, 50, 100, 200), length.out = nrow(d))
b <- rnorm(12, 0, 0.35)
eta <- log(0.8) + 0.4 * d$A - 0.25 * d$B + 0.15 * d$A * d$B + b[d$block]
d$count <- rpois(nrow(d), d$volume * exp(eta))
inp <- list(distribution = "poisson", link = "log", formula = "count ~ A*B + C", group = "block",
            data = list(A = I(d$A), B = I(d$B), C = I(d$C), block = I(d$block), exposure = I(d$volume), y = I(d$count)))
for (q in c(1, 25)) cases[[length(cases) + 1]] <- glmmcase(paste0("poisson-blocks-agq", q), count ~ A * B + C + (1 | block), d, poisson, q, "C", inp, offset = log(d$volume))

# 2. binomial: seeds germinated out of 30 or 40 in a split-plot (A hard to change, 10 whole plots)
w <- expand.grid(B = c(-1, 1), C = c(-1, 1))
d2 <- do.call(rbind, lapply(1:10, function(k) data.frame(wp = k, A = ifelse(k %% 2 == 0, 1, -1), w)))
d2$trials <- rep(c(30, 40), length.out = nrow(d2))
u <- rnorm(10, 0, 0.5)
p <- plogis(-0.2 + 0.6 * d2$A + 0.45 * d2$B - 0.3 * d2$C + u[d2$wp])
d2$germ <- rbinom(nrow(d2), d2$trials, p)
d2$prop <- d2$germ / d2$trials
inp2 <- list(distribution = "binomial", link = "logit", formula = "germ ~ A + B + C", group = "wholePlot",
             data = list(A = I(d2$A), B = I(d2$B), C = I(d2$C), wholePlot = I(d2$wp), trials = I(d2$trials), y = I(d2$germ)))
for (q in c(1, 25)) cases[[length(cases) + 1]] <- glmmcase(paste0("binomial-wholeplots-agq", q), prop ~ A + B + C + (1 | wp), d2, binomial, q, "A", inp2, weights = d2$trials)

# the same with the probit link (Fisher weights at the conditional mode, as lme4)
inp2p <- inp2; inp2p$link <- "probit"
cases[[length(cases) + 1]] <- glmmcase("binomial-probit-agq1", prop ~ A + B + C + (1 | wp), d2, binomial(link = "probit"), 1, "B", inp2p, weights = d2$trials)
cases[[length(cases) + 1]] <- glmmcase("binomial-probit-agq25", prop ~ A + B + C + (1 | wp), d2, binomial(link = "probit"), 25, "B", inp2p, weights = d2$trials)

# 3. pass/fail: 0 or 1 per run, 12 days of 8 runs
d3 <- expand.grid(A = c(-1, 1), B = c(-1, 1), C = c(-1, 1))
d3 <- d3[rep(seq_len(nrow(d3)), 12), ]
d3$day <- rep(1:12, each = 8)
v <- rnorm(12, 0, 0.8)
d3$pass <- rbinom(nrow(d3), 1, plogis(0.3 + 0.7 * d3$A - 0.5 * d3$C + v[d3$day]))
inp3 <- list(distribution = "bernoulli", link = "logit", formula = "pass ~ A + B + C", group = "block",
             data = list(A = I(d3$A), B = I(d3$B), C = I(d3$C), block = I(d3$day), y = I(d3$pass)))
for (q in c(1, 25)) cases[[length(cases) + 1]] <- glmmcase(paste0("passfail-days-agq", q), pass ~ A + B + C + (1 | day), d3, binomial, q, "B", inp3)

# 4. no block-to-block variation beyond Poisson: σ estimated as 0 (a singular fit), the fixed
#    effects those of the GLM
d4 <- d[, c("A", "B", "C", "block")]
d4$count <- rpois(nrow(d4), exp(2.5 + 0.3 * d4$A))
d4$count[d4$block %% 2 == 0] <- d4$count[d4$block %% 2 == 1][seq_len(sum(d4$block %% 2 == 0))]
inp4 <- list(distribution = "poisson", link = "log", formula = "count ~ A + B", group = "block",
             data = list(A = I(d4$A), B = I(d4$B), C = I(d4$C), block = I(d4$block), y = I(d4$count)))
cases[[length(cases) + 1]] <- glmmcase("poisson-boundary-agq25", count ~ A + B + (1 | block), d4, poisson, 25, "B", inp4)

write_fixture("glmm-r", cases, "tests/ref/glmm_r.R", c("lme4"), tolerance = list(rel = 2e-4, abs = 1e-5))
