# Negative binomial counts with a random intercept (issue #78): y | z ~ NB(μ, θ) (variance μ + μ²/θ,
# MASS's and glmmTMB's nbinom2), log μ = xβ + log(exposure) + σ z_g, z_g ~ N(0, 1).
#   direct:  the marginal likelihood written out, each group's integral over z by stats::integrate
#            (adaptive, relative tolerance 1e-11), maximised over (β, log σ, log θ) by optim (BFGS,
#            from glmmTMB's estimates, then Nelder–Mead polish); the covariance of β and the
#            standard error of θ from the numDeriv Hessian over (β, σ, log θ). The reference for
#            aikidoe's adaptive Gauss–Hermite fit (nAGQ = 25), independent of any GLMM package.
#   lme4:    the Laplace approximation with Fisher weights at the conditional modes, as aikidoe's
#            nAGQ = 1: glmer with family negative.binomial(θ), its log-likelihood maximised over θ by
#            optimize — what glmer.nb does, but glmer.nb's own outer loop stopped at a poor local
#            optimum (θ in the hundreds, log-likelihood 4.5 lower) on case 1. (glmer.nb accepts
#            nAGQ > 1, but its θ is then unreliable.)
#   glmmTMB: the Laplace approximation with the observed curvature — a cross-check of glmer.nb (the
#            two Laplace approximations differ a little, since the log link is not canonical for the
#            negative binomial).
# Also the likelihood-ratio test of one term (direct fits with and without it) and σ = 0 against
# σ > 0 (the direct fit against MASS::glm.nb).
source("tests/ref/fixture.R")
suppressPackageStartupMessages({ library(lme4); library(glmmTMB); library(MASS); library(numDeriv) })
set.seed(20261110)
cases <- list()
ctrl <- glmerControl(optimizer = "bobyqa", optCtrl = list(maxfun = 1e5, rhoend = 1e-10), tolPwrss = 1e-11, check.conv.singular = "ignore", check.conv.grad = "ignore")

# the log-likelihood at (β, σ, θ): Σ_g log ∫ φ(z) Π_i f(y_i | μ_i(z)) dz, centred and scaled at the
# group's mode so that integrate sees a well-conditioned integrand
groupLL <- function(y, eta, sigma, theta) {
  h <- function(z) vapply(z, function(zz) sum(dnbinom(y, size = theta, mu = exp(eta + sigma * zz), log = TRUE)) + dnorm(zz, log = TRUE), 0)
  if (sigma == 0) return(sum(dnbinom(y, size = theta, mu = exp(eta), log = TRUE)))
  o <- optimize(h, c(-12, 12), maximum = TRUE); m <- o$maximum; c0 <- o$objective
  r <- integrate(function(z) exp(h(z) - c0), m - 12, m + 12, rel.tol = 1e-11, subdivisions = 500L)
  c0 + log(r$value)
}
directLL <- function(par, X, y, off, g) {
  p <- ncol(X); beta <- par[1:p]; sigma <- exp(par[p + 1]); theta <- exp(par[p + 2])
  eta <- drop(X %*% beta) + off
  sum(vapply(split(seq_along(y), g), function(I) groupLL(y[I], eta[I], sigma, theta), 0))
}
directFit <- function(X, y, off, g, start) {
  f <- function(par) -directLL(par, X, y, off, g)
  o <- optim(start, f, method = "BFGS", control = list(reltol = 1e-14, maxit = 500))
  o <- optim(o$par, f, method = "Nelder-Mead", control = list(reltol = 1e-15, maxit = 5000))
  o <- optim(o$par, f, method = "BFGS", control = list(reltol = 1e-15, maxit = 500))
  p <- ncol(X); par <- o$par
  message(sprintf("direct fit: sigma %.4g, theta %.4g", exp(par[p + 1]), exp(par[p + 2])))
  # covariance from the Hessian over (β, log σ, log θ): at the maximum, the β-block of its inverse
  # is the same whichever scale σ and θ are on
  H <- hessian(function(q) -directLL(q, X, y, off, g), par)
  V <- solve(H)
  list(beta = par[1:p], sigma = exp(par[p + 1]), theta = exp(par[p + 2]), loglik = -o$value,
       se = sqrt(diag(V)[1:p]), thetaSE = exp(par[p + 2]) * sqrt(V[p + 2, p + 2]))
}

nbcase <- function(name, rhs, drop, d, exposure = NULL) {
  d$.off <- if (is.null(exposure)) 0 else log(exposure)
  f <- as.formula(paste("y ~", rhs, "+ (1 | g)")); f0 <- update(f, as.formula(paste(". ~ . -", drop)))
  X <- model.matrix(as.formula(paste("~", rhs)), d)
  tmb <- glmmTMB(f, d, family = nbinom2, offset = .off)
  st <- c(fixef(tmb)$cond, log(max(1e-3, sqrt(VarCorr(tmb)$cond$g[1]))), log(sigma(tmb)))
  dir <- directFit(X, d$y, d$.off, d$g, st)
  X0 <- model.matrix(as.formula(paste("~", rhs, "-", drop)), d)
  tmb0 <- glmmTMB(f0, d, family = nbinom2, offset = .off)
  dir0 <- directFit(X0, d$y, d$.off, d$g, c(fixef(tmb0)$cond, log(max(1e-3, sqrt(VarCorr(tmb0)$cond$g[1]))), log(sigma(tmb0))))
  nb <- glm.nb(as.formula(paste("y ~", rhs, "+ offset(.off)")), d)
  # σ below 1e-3 is the boundary (0): the optimisers stop anywhere in 1e-7 … 1e-4 there, which would drift
  bs <- function(s) if (s < 1e-3) 0 else s
  lr <- 2 * (dir$loglik - dir0$loglik); s0 <- 2 * (dir$loglik - as.numeric(logLik(nb))); if (s0 < 1e-6) s0 <- 0
  lapAt <- function(lt) glmer(f, d, family = negative.binomial(exp(lt)), control = ctrl, offset = .off)
  lt <- optimize(function(lt) as.numeric(logLik(lapAt(lt))), log(sigma(tmb)) + c(-3, 3), maximum = TRUE, tol = 1e-9)$maximum
  lap <- lapAt(lt)
  list(name = name,
       input = list(formula = rhs, drop = drop, data = list(A = I(d$A), B = I(d$B), C = I(d$C), g = I(as.integer(d$g)), y = I(d$y),
                    exposure = if (is.null(exposure)) NULL else I(exposure))),
       output = list(names = I(colnames(X)),
                     direct = list(coef = I(unname(dir$beta)), se = I(unname(dir$se)), sigma = bs(dir$sigma), theta = dir$theta, thetaSE = dir$thetaSE, loglik = dir$loglik,
                                   lr = list(chisq = lr, df = ncol(X) - ncol(X0), p = pchisq(lr, ncol(X) - ncol(X0), lower.tail = FALSE)),
                                   sigmaTest = list(chisq = s0, p = if (s0 > 0) 0.5 * pchisq(s0, 1, lower.tail = FALSE) else 1)),
                     laplace = list(coef = I(unname(fixef(lap))), sigma = bs(unname(getME(lap, "theta"))), theta = exp(lt), loglik = as.numeric(logLik(lap))),
                     tmb = list(coef = I(unname(fixef(tmb)$cond)), sigma = bs(sqrt(VarCorr(tmb)$cond$g[1])), theta = sigma(tmb), loglik = as.numeric(logLik(tmb)))))
}

# 1. A split-plot: A hard to change (16 whole plots of 2 runs), B and C within; θ = 2, σ = 0.6
d <- data.frame(g = rep(1:16, each = 2)); d$A <- rep(c(-1, 1), each = 2, length.out = 32)
d$B <- rep(c(-1, 1), length.out = 32); d$C <- rep(c(-1, 1, 1, -1), length.out = 32)
u <- rnorm(16, 0, 0.6)
d$y <- rnbinom(32, size = 2, mu = exp(log(12) + 0.3 * d$A - 0.25 * d$B + 0.1 * d$C + u[d$g])); d$g <- factor(d$g)
cases[[1]] <- nbcase("negbin-splitplot", "A + B + C", "B", d)

# 2. Colonies in 10 blocks of a replicated 2^3 (half replicates on C), volume plated as the
#    exposure; θ = 3, σ = 0.7
d <- expand.grid(A = c(-1, 1), B = c(-1, 1), C = c(-1, 1)); d <- d[rep(1:8, 5), ]; d$g <- rep(1:10, each = 4)
vol <- rep(c(10, 50, 100, 200), length.out = 40); v <- rnorm(10, 0, 0.7)
d$y <- rnbinom(40, size = 3, mu = vol * exp(log(0.3) + 0.4 * d$A + 0.2 * d$A * d$B + v[d$g])); d$g <- factor(d$g)
cases[[2]] <- nbcase("negbin-blocks-exposure", "A * B + C", "A:B", d, exposure = vol)

# 3. No block effect at all (σ = 0 in truth): the fit on the boundary, where it is glm.nb's
d <- expand.grid(A = c(-1, 1), B = c(-1, 1), C = c(-1, 1)); d <- d[rep(1:8, 3), ]; d$g <- factor(rep(1:6, each = 4))
d$y <- rnbinom(24, size = 4, mu = exp(log(20) + 0.3 * d$A))
cases[[3]] <- nbcase("negbin-boundary", "A + B", "B", d)

write_fixture("glmm-nb-r", cases, "tests/ref/glmm_nb_r.R", c("lme4", "glmmTMB", "MASS", "numDeriv"), tolerance = list(rel = 1e-4, abs = 1e-6))
