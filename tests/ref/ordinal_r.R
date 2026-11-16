# Ordinal scores (issue #83, phase 2): cumulative link models, ordinal::clm — coefficients, standard
# errors, thresholds, the log-likelihood; sequential likelihood-ratio tests (nested clm fits) and
# drop1's; the test of proportional odds (nominal_test); the category probabilities and the mean
# score at new settings with delta-method standard errors (emmeans, modes "prob" and "mean.class");
# and MASS::polr's estimates as a second implementation.
# The model matrix is written with R's assign (0 = intercept), so the test builds the same columns.
source("tests/ref/fixture.R")
suppressPackageStartupMessages({ library(ordinal); library(MASS); library(emmeans) })
cases <- list()
add <- function(x) cases[[length(cases) + 1]] <<- x
mat_rows <- function(m) unname(lapply(seq_len(nrow(m)), function(i) I(unname(m[i, ]))))
num_or_null <- function(v) lapply(v, function(x) if (is.na(x)) NULL else x)

fit_case <- function(name, d, rhs, link, newdata, polr_too = FALSE, nominal = TRUE) {
  assign("dd", d, envir = globalenv())
  fo <- as.formula(paste("f ~", rhs))
  f <- eval(bquote(clm(.(fo), data = dd, link = .(link))), globalenv())
  tt <- terms(fo); tl <- attr(tt, "term.labels")
  X <- model.matrix(delete.response(tt), d)
  s <- summary(f)$coefficients
  K <- nlevels(d$f); th <- s[1:(K - 1), , drop = FALSE]; be <- s[-(1:(K - 1)), , drop = FALSE]
  out <- list(coef = I(unname(be[, 1])), se = I(unname(be[, 2])), thresholds = I(unname(th[, 1])), thresholdsSe = I(unname(th[, 2])), loglik = as.numeric(logLik(f)))
  # sequential likelihood-ratio tests: the terms added one at a time
  ll <- sapply(0:length(tl), function(k) as.numeric(logLik(clm(as.formula(paste("f ~", if (k) paste(tl[1:k], collapse = " + ") else "1")), data = d, link = link))))
  out$sequential <- I(2 * diff(ll))
  d1 <- drop1(f, test = "Chisq"); out$drop1 <- list(terms = I(rownames(d1)[-1]), chisq = I(unname(d1$LRT[-1])))
  if (nominal) { nt <- suppressWarnings(nominal_test(f)); out$nominal <- list(terms = I(rownames(nt)[-1]), chisq = num_or_null(unname(nt$LRT[-1])), df = num_or_null(unname(nt$Df[-1]))) }
  # predictions at new settings, one emmeans call per row
  out$probs <- list(); out$probsSe <- list(); out$mean <- c(); out$meanSe <- c()
  for (i in seq_len(nrow(newdata))) {
    at <- as.list(newdata[i, , drop = FALSE])
    pr <- summary(emmeans(f, ~ f, at = at, mode = "prob"))
    mc <- summary(emmeans(f, ~ 1, at = at, mode = "mean.class"))
    out$probs[[i]] <- I(pr$prob); out$probsSe[[i]] <- I(pr$SE); out$mean[i] <- mc$mean.class; out$meanSe[i] <- mc$SE
  }
  out$mean <- I(out$mean); out$meanSe <- I(out$meanSe)
  if (polr_too) { p <- eval(bquote(polr(.(fo), data = dd, method = .(c(logit = "logistic", probit = "probit", cloglog = "cloglog")[[link]]))), globalenv())
    out$polr <- list(coef = I(unname(coef(p))), zeta = I(unname(p$zeta)), loglik = as.numeric(logLik(p))) }
  add(list(name = name, input = list(link = link, K = K, columns = I(colnames(X)), assign = I(attr(X, "assign")), terms = I(tl),
    X = mat_rows(X), y = I(as.integer(d$f)), newX = mat_rows(model.matrix(delete.response(tt), newdata))), output = out))
}

# 1. the app's example: appearance of a coating scored by five judges (poor, fair, good, excellent)
#    in a 2^3 of cure temperature and time (coded) and primer (none, applied)
sc <- list(c(1, 1, 1, 1, 1), c(2, 1, 2, 1, 1), c(4, 3, 1, 1, 1), c(1, 2, 2, 1, 1), c(3, 1, 1, 2, 2), c(3, 3, 3, 4, 4), c(3, 4, 3, 2, 3), c(4, 4, 3, 4, 4))
g <- expand.grid(temp = c(-1, 1), time = c(-1, 1), primer = c("none", "applied"), stringsAsFactors = FALSE)
co <- do.call(rbind, lapply(1:8, function(i) data.frame(temp = g$temp[i], time = g$time[i], primer = g$primer[i], y = sc[[i]])))
co$primer <- factor(co$primer, levels = c("none", "applied")); co$f <- factor(co$y, levels = 1:4, ordered = TRUE)
ndc <- data.frame(temp = c(1, -1, 0), time = c(1, -1, 0.5), primer = factor(c("applied", "none", "applied"), levels = c("none", "applied")))
fit_case("coating logit", co, "temp * time + primer", "logit", ndc, polr_too = TRUE)
fit_case("coating probit", co, "temp + time + primer", "probit", ndc, polr_too = TRUE)
fit_case("coating cloglog", co, "temp + time + primer", "cloglog", ndc, nominal = FALSE)

# 2. ordinal::wine (Randall 1989): bitterness rated 1 ... 5 against temperature and contact
w <- data.frame(temp = wine$temp, contact = wine$contact, f = wine$rating)
ndw <- data.frame(temp = factor(c("cold", "warm"), levels = levels(wine$temp)), contact = factor(c("no", "yes"), levels = levels(wine$contact)))
fit_case("wine logit", w, "temp + contact", "logit", ndw, polr_too = TRUE)
fit_case("wine logit interaction", w, "temp * contact", "logit", ndw)

write_fixture("ordinal-r", cases, "tests/ref/ordinal_r.R", c("ordinal", "MASS", "emmeans"), tolerance = list(rel = 1e-5, abs = 1e-7))
