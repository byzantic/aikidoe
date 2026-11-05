# Issue #15 references: REML fits by lme4::lmer (variance components, fixed effects, REML
# criterion, model-based covariance) and Kenward–Roger by pbkrtest (vcovAdj with its W
# attribute, KRmodcomp per model term: ddf, F scaling, F), on balanced and unbalanced split-plot
# and nested (run / wafer / site, lot / wafer) data. Categorical factors use contr.sum with the
# levels reordered so that aikidoe's first level is R's last (aikidoe's effect coding).
source("tests/ref/fixture.R")
suppressPackageStartupMessages({ library(lme4); library(pbkrtest) })
set.seed(20261105)
ctrl <- lmerControl(optimizer = "bobyqa", optCtrl = list(maxfun = 1e5), check.conv.singular = "ignore",
                    check.nobs.vs.nlev = "ignore", check.nobs.vs.nRE = "ignore")

rows_of <- function(d) lapply(seq_len(nrow(d)), function(i) lapply(as.list(d[i, , drop = FALSE]), function(v) if (is.factor(v)) as.character(v) else v))
reference <- function(name, d, rform, aikidoe, groups, factors, note = NULL) {
  ctr <- list(); for (v in names(d)) if (is.factor(d[[v]]) && !(v %in% groups)) ctr[[v]] <- "contr.sum"
  fit <- lmer(rform, d, REML = TRUE, control = ctrl, contrasts = if (length(ctr)) ctr else NULL)
  X <- getME(fit, "X"); asg <- attr(X, "assign"); labs <- attr(terms(nobars(rform)), "term.labels")
  vc <- as.data.frame(VarCorr(fit))
  Phi <- vcovAdj(fit)
  kr <- lapply(seq_along(labs), function(t) {
    S <- which(asg == t); L <- matrix(0, length(S), ncol(X)); L[cbind(seq_along(S), S)] <- 1
    k <- KRmodcomp(fit, L)$stats
    list(term = labs[t], ndf = k$ndf, ddf = k$ddf, Fscaling = k$F.scaling, F = k$Fstat, Funscaled = k$FstatU)
  })
  for (g in groups) d[[g]] <- as.character(d[[g]])
  list(name = name, input = list(rows = rows_of(d), formula = aikidoe, groups = I(groups), factors = factors, note = note),
       output = list(coef = I(unname(fixef(fit))), columns = I(colnames(X)), vcov = unname(as.matrix(vcov(fit))),
                     varcomp = setNames(as.list(vc$vcov), ifelse(is.na(vc$var1) & vc$grp == "Residual", "Residual", vc$grp)),
                     REML = REMLcrit(fit), vcovKR = unname(as.matrix(Phi)), W = unname(as.matrix(attr(Phi, "W"))), kr = kr,
                     singular = isSingular(fit)))
}
cont <- function(id) list(id = id, low = -1, high = 1)
catf <- function(id, levels) list(id = id, levels = I(levels))
cases <- list()
add <- function(x) cases[[length(cases) + 1]] <<- x

# 1. balanced split-plot: A, B whole-plot (2^2 x 2 = 8 plots), C, D subplot (2^2 per plot)
wp <- expand.grid(A = c(-1, 1), B = c(-1, 1)); wp <- wp[rep(1:4, 2), ]; wp$wp <- 1:8
d1 <- merge(wp, expand.grid(C = c(-1, 1), D = c(-1, 1))); d1 <- d1[order(d1$wp), ]
u <- rnorm(8, sd = 1.2)
d1$y <- with(d1, 10 + 2 * A - B + 1.5 * C + 0.5 * A * C + u[wp] + rnorm(nrow(d1), sd = 0.6))
d1$wp <- factor(d1$wp)
add(reference("split-plot, balanced, 8 whole plots x 4", d1, y ~ (A + B + C + D)^2 + (1 | wp), "y ~ (A+B+C+D)^2", "wp", list(cont("A"), cont("B"), cont("C"), cont("D"))))
# 2. the same, unbalanced (3 runs lost)
add(reference("split-plot, unbalanced (3 runs missing)", d1[-c(3, 14, 22), ], y ~ (A + B + C + D)^2 + (1 | wp), "y ~ (A+B+C+D)^2", "wp", list(cont("A"), cont("B"), cont("C"), cont("D"))))
# 3. split-plot with a 3-level categorical subplot factor
wp3 <- data.frame(A = rep(c(-1, 1), 3), wp = 1:6)
d3 <- merge(wp3, expand.grid(B = c(-1, 1), G = c("a", "b", "c"))); d3 <- d3[order(d3$wp), ]
u3 <- rnorm(6, sd = 1)
d3$y <- with(d3, 5 + A + 0.8 * B + c(a = 0, b = 1, c = -0.5)[as.character(G)] + 0.6 * A * (G == "b") + u3[wp] + rnorm(nrow(d3), sd = 0.5))
d3$G <- factor(d3$G, levels = c("b", "c", "a")); d3$wp <- factor(d3$wp)
add(reference("split-plot, 3-level categorical subplot factor", d3, y ~ A + B + G + A:B + A:G + B:G + (1 | wp), "y ~ A + B + G + A:B + A:G + B:G", "wp", list(cont("A"), cont("B"), catf("G", c("a", "b", "c")))))
# 4. nested: 2^3 x 2 runs, 2 wafers per run, 5 sites per wafer (random run, wafer; residual = site)
r4 <- expand.grid(X1 = c(-1, 1), X2 = c(-1, 1), X3 = c(-1, 1)); r4 <- r4[rep(1:8, 2), ]; r4$run <- 1:16
d4 <- merge(merge(r4, data.frame(w = 1:2)), data.frame(site = 1:5)); d4 <- d4[order(d4$run, d4$w, d4$site), ]
d4$wafer <- paste0(d4$run, "-", d4$w)
ur <- rnorm(16, sd = 0.8); uw <- setNames(rnorm(32, sd = 0.5), unique(d4$wafer))
d4$y <- with(d4, 50 + 3 * X1 - 2 * X2 + X1 * X3 + ur[run] + uw[wafer] + rnorm(nrow(d4), sd = 0.3))
d4$run <- factor(d4$run); d4$wafer <- factor(d4$wafer); d4$w <- NULL; d4$site <- NULL
add(reference("nested: runs, 2 wafers per run, 5 sites per wafer", d4, y ~ (X1 + X2 + X3)^2 + (1 | run) + (1 | wafer), "y ~ (X1+X2+X3)^2", c("run", "wafer"), list(cont("X1"), cont("X2"), cont("X3"))))
# 5. the same with 15 % of the sites missing
add(reference("nested, unbalanced (15 % of sites missing)", d4[-sample(nrow(d4), 24), ], y ~ (X1 + X2 + X3)^2 + (1 | run) + (1 | wafer), "y ~ (X1+X2+X3)^2", c("run", "wafer"), list(cont("X1"), cont("X2"), cont("X3"))))
# 6. split-plot with two wafers per run: whole plot, run (residual = wafer)
d6 <- d1[, c("A", "B", "C", "D", "wp")]; d6$run <- seq_len(nrow(d6)); d6 <- d6[rep(seq_len(nrow(d6)), each = 2), ]
ur6 <- rnorm(32, sd = 0.5)
d6$y <- with(d6, 10 + 2 * A - B + 1.5 * C + u[as.integer(as.character(wp))] + ur6[run] + rnorm(nrow(d6), sd = 0.3))
d6$run <- factor(d6$run)
add(reference("split-plot with 2 wafers per run: whole plot and run", d6, y ~ A + B + C + D + A:C + (1 | wp) + (1 | run), "y ~ A + B + C + D + A:C", c("wp", "run"), list(cont("A"), cont("B"), cont("C"), cont("D"))))
# 7. boundary: no whole-plot variance in the data, few plots
d7 <- d1[d1$wp %in% 1:6, c("A", "B", "C", "D", "wp")]; d7$wp <- droplevels(d7$wp)
d7$y <- with(d7, 3 + A + C + rnorm(nrow(d7), sd = 1))
add(reference("boundary: whole-plot variance estimated at 0", d7, y ~ A + B + C + D + (1 | wp), "y ~ A + B + C + D", "wp", list(cont("A"), cont("B"), cont("C"), cont("D"))))
# 8. fixed blocks (days, 2 levels) with whole plots inside
d8 <- d1; d8$day <- factor(ifelse(as.integer(as.character(d8$wp)) <= 4, "d1", "d2"), levels = c("d2", "d1"))
d8$y <- d8$y + ifelse(d8$day == "d2", 1.5, 0)
add(reference("split-plot with fixed days (blocks)", d8, y ~ day + A + B + C + D + A:C + (1 | wp), "y ~ day + A + B + C + D + A:C", "wp", list(catf("day", c("d1", "d2")), cont("A"), cont("B"), cont("C"), cont("D"))))
# 9. quadratic split-plot, unequal whole plots: A (3 levels) per plot, B within
sizes <- c(3, 3, 4, 2, 3, 3); Awp <- c(-1, 0, 1, -1, 0, 1)
d9 <- do.call(rbind, lapply(1:6, function(w) data.frame(wp = w, A = Awp[w], B = rep(c(-1, 0, 1, 0), length.out = sizes[w]))))
u9 <- rnorm(6, sd = 0.7)
d9$y <- with(d9, 20 + 2 * A - 1.5 * A^2 + B - B^2 + 0.5 * A * B + u9[wp] + rnorm(nrow(d9), sd = 0.4))
d9$wp <- factor(d9$wp)
add(reference("quadratic split-plot, unequal whole plots", d9, y ~ A + B + I(A^2) + I(B^2) + A:B + (1 | wp), "y ~ A + B + I(A^2) + I(B^2) + A:B", "wp", list(cont("A"), cont("B"))))
# 10. lot / wafer: a wafer-level treatment applied to wafers within lots; sites within wafers
d10 <- expand.grid(site = 1:4, w = 1:4, lot = 1:5); d10$X <- ifelse(d10$w %% 2 == 1, -1, 1); d10$Z <- ifelse(d10$w <= 2, -1, 1)
d10$wafer <- paste0(d10$lot, "-", d10$w)
ul <- rnorm(5, sd = 1); uw10 <- setNames(rnorm(20, sd = 0.4), unique(d10$wafer))
d10$y <- with(d10, 100 + 2 * X + 0.5 * Z + ul[lot] + uw10[wafer] + rnorm(nrow(d10), sd = 0.5))
d10$lot <- factor(d10$lot); d10$wafer <- factor(d10$wafer); d10$site <- NULL; d10$w <- NULL
add(reference("lot / wafer / site with a wafer-level treatment", d10, y ~ X * Z + (1 | lot) + (1 | wafer), "y ~ X*Z", c("lot", "wafer"), list(cont("X"), cont("Z"))))
write_fixture("reml-r", cases, "tests/ref/reml_r.R", c("lme4", "pbkrtest", "Matrix"), tolerance = list(rel = 1e-5, abs = 1e-7))
