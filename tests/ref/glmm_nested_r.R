# Nested random intercepts for counts and proportions (issue #78): lme4::glmer with (1 | a/b) or
# (1 | a/b/c), the Laplace approximation (lme4's only method for several random effects), as
# aikidoe's fit of nested groupings.
# Recorded: the fixed effects; their standard errors from the Hessian of glmer's own Laplace
# deviance over (σ's, β) by numDeriv (lme4's vcov for nAGQ = 1 comes from its own finite differences,
# which moved by up to 0.3 % between lme4 versions; these move by < 0.1 %, since the deviance itself
# changes a little); σ of each grouping, outermost first (below 1e-3 recorded as 0); the
# log-likelihood; the outermost groups' effects (ranef); the likelihood-ratio test of one term; and
# each σ = 0 test (the fit without that grouping, ½χ²₀ + ½χ²₁). The negative binomial: glmer with
# negative.binomial(θ), its log-likelihood maximised over θ by optimize (as in glmm_nb_r.R).
source("tests/ref/fixture.R")
suppressPackageStartupMessages({ library(lme4); library(MASS); library(numDeriv) })
set.seed(20261111)
ctrl <- glmerControl(optimizer = "bobyqa", optCtrl = list(maxfun = 1e5, rhoend = 1e-10), tolPwrss = 1e-11,
                     check.conv.singular = "ignore", check.conv.grad = "ignore", check.conv.hess = "ignore")
cases <- list()

# levels: grouping columns, outermost first; their labels are unique overall (so (1|a) + (1|b) is nested)
nestedcase <- function(name, rhs, levels, drop, d, family, trials = NULL, theta = NULL) {
  re <- paste0("(1 | ", levels, ")", collapse = " + ")
  f <- as.formula(paste("y ~", rhs, "+", re))
  if (!is.null(trials)) { d$p <- d$y / trials; f <- update(f, p ~ .); d$.w <- trials } else d$.w <- 1
  fitAt <- function(form, fam) glmer(form, d, family = fam, weights = .w, control = ctrl, nAGQ = 1)
  famOf <- function(th) if (is.null(theta)) family else negative.binomial(th)
  lt <- NULL
  if (!is.null(theta)) {
    lt <- optimize(function(x) as.numeric(logLik(fitAt(f, negative.binomial(exp(x))))), log(theta) + c(-2.5, 2.5), maximum = TRUE, tol = 1e-9)$maximum
  }
  fam <- famOf(if (is.null(lt)) NULL else exp(lt))
  m <- fitAt(f, fam)
  # σ's in the order of `levels`; lme4's theta vector is ordered its own way
  vc <- as.data.frame(VarCorr(m)); sig <- vapply(levels, function(l) vc$sdcor[vc$grp == l], 0)
  sig[sig < 1e-3] <- 0   # the boundary: optimisers stop anywhere below 1e-4 there, which would drift
  # the Hessian of the Laplace deviance over (σ's, β), as aikidoe's covariance
  dev <- update(m, devFunOnly = TRUE)
  th <- getME(m, "theta"); ord <- match(levels, names(getME(m, "flist"))[getME(m, "Gp")[-1] > -1][seq_along(th)])
  par <- c(th, fixef(m))
  H <- hessian(function(x) dev(x) / 2, par)
  V <- solve(H); p <- length(fixef(m)); se <- sqrt(diag(V))[length(th) + seq_len(p)]
  # LR test of one term, and σ = 0 for each grouping (θ re-estimated for the negative binomial)
  refitLL <- function(form) {
    if (is.null(theta)) return(as.numeric(logLik(fitAt(form, family))))
    has <- grepl("\\(1 \\|", deparse(form)[1]) || any(grepl("\\(1 \\|", deparse(form)))
    if (!has) return(as.numeric(logLik(glm.nb(form, d))))
    optimize(function(x) as.numeric(logLik(fitAt(form, negative.binomial(exp(x))))), log(theta) + c(-2.5, 2.5), maximum = TRUE, tol = 1e-9)$objective
  }
  ll <- as.numeric(logLik(m))
  f0 <- update(f, as.formula(paste(". ~ . -", drop)))
  lr <- 2 * (ll - refitLL(f0))
  stests <- lapply(seq_along(levels), function(k) {
    rest <- levels[-k]
    form <- as.formula(paste(deparse(f[[2]]), "~", rhs, "+", paste0("(1 | ", rest, ")", collapse = " + ")))
    x <- max(0, 2 * (ll - refitLL(form)))
    list(chisq = x, p = if (x > 1e-6) 0.5 * pchisq(x, 1, lower.tail = FALSE) else 1)
  })
  re1 <- ranef(m)[[levels[1]]]
  dd <- lapply(c(all.vars(as.formula(paste("~", rhs))), levels, "y"), function(v) I(d[[v]])); names(dd) <- c(all.vars(as.formula(paste("~", rhs))), levels, "y")
  list(name = name,
       input = list(formula = rhs, levels = I(levels), drop = drop, distribution = if (!is.null(theta)) "negbin" else family$family, trials = trials, data = dd),
       output = list(names = I(names(fixef(m))), coef = I(unname(fixef(m))), se = I(unname(se)), sigma = I(unname(sig)),
                     theta = if (is.null(lt)) NULL else exp(lt), loglik = ll,
                     modes = I(unname(re1[, 1])), groups = I(rownames(re1)),
                     lr = list(chisq = lr, df = 1, p = pchisq(lr, 1, lower.tail = FALSE)),
                     sigmaTest = list(chisq = I(vapply(stests, function(t) t$chisq, 0)), p = I(vapply(stests, function(t) t$p, 0)))))
}

# 1. Poisson counts: 6 days, 4 whole plots a day, 2 runs a whole plot. D changes between days, A
#    between whole plots within a day, B within whole plots. Day σ 0.4, whole-plot σ 0.3.
d <- expand.grid(run = 1:2, wp = 1:4, day = 1:6); d$wp <- (d$day - 1) * 4 + d$wp
d$D <- ifelse(d$day %% 2 == 1, -1, 1); d$A <- ifelse(d$wp %% 2 == 1, -1, 1); d$B <- ifelse(d$run == 1, -1, 1)
ud <- rnorm(6, 0, 0.4); uw <- rnorm(24, 0, 0.3)
d$y <- rpois(nrow(d), exp(log(15) + 0.25 * d$D + 0.3 * d$A - 0.2 * d$B + ud[d$day] + uw[d$wp]))
cases[[1]] <- nestedcase("poisson-day-wholeplot", "D + A + B", c("day", "wp"), "B", d, poisson())

# 2. Binomial proportions (20 trials): 8 days, 3 runs a day, 2 plates a run; A between runs, B
#    within. Day σ 0.5, run σ 0.35.
d <- expand.grid(plate = 1:2, run = 1:3, day = 1:8); d$run <- (d$day - 1) * 3 + d$run
d$A <- rep(c(-1, 1, -1, 1, -1, 1), length.out = nrow(d))[ (d$run - 1) * 2 + 1 ]; d$B <- ifelse(d$plate == 1, -1, 1)
d$A <- ifelse(d$run %% 2 == 1, -1, 1)
ud <- rnorm(8, 0, 0.5); ur <- rnorm(24, 0, 0.35)
d$y <- rbinom(nrow(d), 20, plogis(0.2 + 0.4 * d$A + 0.3 * d$B + ud[d$day] + ur[d$run]))
cases[[2]] <- nestedcase("binomial-day-run", "A * B", c("day", "run"), "A:B", d, binomial(), trials = 20)

# 3. Three levels, Poisson: 5 days, 3 whole plots a day, 2 runs a whole plot, 2 plates a run;
#    A between whole plots, B between runs, C within runs.
d <- expand.grid(plate = 1:2, run = 1:2, wp = 1:3, day = 1:5); d$wp <- (d$day - 1) * 3 + d$wp; d$run <- (d$wp - 1) * 2 + d$run
d$A <- ifelse(d$wp %% 2 == 1, -1, 1); d$B <- ifelse(d$run %% 2 == 1, -1, 1); d$C <- ifelse(d$plate == 1, -1, 1)
ud <- rnorm(5, 0, 0.3); uw <- rnorm(15, 0, 0.3); ur <- rnorm(30, 0, 0.25)
d$y <- rpois(nrow(d), exp(log(25) + 0.3 * d$A + 0.2 * d$B + 0.1 * d$C + ud[d$day] + uw[d$wp] + ur[d$run]))
cases[[3]] <- nestedcase("poisson-day-wholeplot-run", "A + B + C", c("day", "wp", "run"), "C", d, poisson())

# 4. Negative binomial (θ = 4): case 1's layout, 8 days.
d <- expand.grid(run = 1:2, wp = 1:4, day = 1:8); d$wp <- (d$day - 1) * 4 + d$wp
d$D <- ifelse(d$day %% 2 == 1, -1, 1); d$A <- ifelse(d$wp %% 2 == 1, -1, 1); d$B <- ifelse(d$run == 1, -1, 1)
ud <- rnorm(8, 0, 0.4); uw <- rnorm(32, 0, 0.35)
d$y <- rnbinom(nrow(d), size = 4, mu = exp(log(15) + 0.25 * d$D + 0.3 * d$A - 0.2 * d$B + ud[d$day] + uw[d$wp]))
cases[[4]] <- nestedcase("negbin-day-wholeplot", "D + A + B", c("day", "wp"), "B", d, NULL, theta = 4)

# 5. No variation between whole plots within days in truth (σ_wp = 0), estimated small; case 3 has a σ
#    estimated as 0
d <- expand.grid(run = 1:2, wp = 1:4, day = 1:6); d$wp <- (d$day - 1) * 4 + d$wp
d$A <- ifelse(d$wp %% 2 == 1, -1, 1); d$B <- ifelse(d$run == 1, -1, 1)
ud <- rnorm(6, 0, 0.5)
d$y <- rpois(nrow(d), exp(log(20) + 0.3 * d$A - 0.2 * d$B + ud[d$day]))
cases[[5]] <- nestedcase("poisson-weak-wholeplot", "A + B", c("day", "wp"), "B", d, poisson())

write_fixture("glmm-nested-r", cases, "tests/ref/glmm_nested_r.R", c("lme4", "MASS", "numDeriv"), tolerance = list(rel = 2e-3, abs = 1e-6))
