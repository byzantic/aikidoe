# Robust-design checks (issue #85, phase 3).
# 1. Alias correlations: the largest |correlation| between a main-effect column and a two-factor
#    interaction column (and between main effects), with continuous factors as coded values and
#    categorical ones by contr.poly, for designs built here with FrF2 and DoE.base.
# 2. Taguchi's analysis of a crossed array (inner L9 x outer 2^2): the signal-to-noise ratios of each
#    inner run (larger, smaller, nominal the best; formulas written out), the mean, s and log s, and
#    the response table (average S/N per level of each control factor, its range).
source("tests/ref/fixture.R")
suppressPackageStartupMessages({ library(FrF2); library(DoE.base) })
cases <- list()
add <- function(x) cases[[length(cases) + 1]] <<- x

ac <- function(d, kinds) {
  # main-effect columns
  cols <- list(); nm <- c(); fac <- c()
  for (j in seq_along(kinds)) {
    if (kinds[[j]] == "c") { cols[[length(cols) + 1]] <- d[, j]; fac <- c(fac, j) }
    else { C <- contr.poly(kinds[[j]]); for (t in seq_len(ncol(C))) { cols[[length(cols) + 1]] <- C[d[, j] + 1, t]; fac <- c(fac, j) } }
  }
  M <- do.call(cbind, cols)
  I <- list()
  for (a in seq_len(ncol(M))) for (b in seq_len(ncol(M))) if (fac[a] < fac[b]) I[[length(I) + 1]] <- M[, a] * M[, b]
  I <- do.call(cbind, I)
  r <- abs(suppressWarnings(cor(M, I))); r[is.na(r)] <- 0
  mm <- abs(suppressWarnings(cor(M))); mm[is.na(mm)] <- 0; mm[outer(fac, fac, "==")] <- 0
  list(max = max(r), mainMax = max(mm), rms = sqrt(mean(r^2)))
}
num <- function(D) as.matrix(sapply(as.data.frame(D), function(x) as.numeric(as.character(x))))
idx <- function(D) as.matrix(sapply(as.data.frame(D), function(x) as.integer(x) - 1L))
designs <- list(
  list("2^(5-2) resolution III", num(FrF2(8, 5, randomize = FALSE)), as.list(rep("c", 5))),
  list("2^(5-1) resolution V", num(FrF2(16, 5, randomize = FALSE)), as.list(rep("c", 5))),
  list("Plackett-Burman 12, 6 factors", num(pb(12, 6, randomize = FALSE)), as.list(rep("c", 6))),
  list("L18 columns 1-5", idx(oa.design(L18, randomize = FALSE)[, 1:5]), list(2, 3, 3, 3, 3)),
  list("L16 4^5 columns 1-4", idx(oa.design(L16.4.5, randomize = FALSE)[, 1:4]), list(4, 4, 4, 4)),
  list("irregular 10 runs", rbind(c(-1, -1, 0), c(1, -1, 1), c(-1, 1, 2), c(1, 1, 0), c(0, 0, 1), c(-1, 0, 2), c(1, 0, 0), c(0, -1, 2), c(0, 1, 1), c(-1, -1, 1)), list("c", "c", 3))
)
for (ds in designs) add(list(name = sprintf("alias correlation %s", ds[[1]]), input = list(kind = "alias", X = lapply(seq_len(nrow(ds[[2]])), function(i) I(unname(ds[[2]][i, ]))), kinds = ds[[3]]), output = ac(ds[[2]], ds[[3]])))

# 2. a crossed array: inner L9 for three control factors A, B, C (levels 0, 1, 2), outer 2^2 for noise M, N
set.seed(851)
inner <- idx(oa.design(L9.3.4, randomize = FALSE)[, 1:3]); outer <- as.matrix(expand.grid(M = c(-1, 1), N = c(-1, 1)))
d <- do.call(rbind, lapply(seq_len(nrow(inner)), function(i) data.frame(inner = i, A = inner[i, 1], B = inner[i, 2], C = inner[i, 3], M = outer[, 1], N = outer[, 2])))
d$y <- round(20 + 2 * d$A - 1.5 * (d$B == 2) + d$M * (1.5 - 0.6 * d$C) + 0.8 * d$N + rnorm(nrow(d), 0, 0.7), 3)
sn <- list(larger = function(y) -10 * log10(mean(1 / y^2)), smaller = function(y) -10 * log10(mean(y^2)), nominal = function(y) 10 * log10(mean(y)^2 / var(y)))
for (goal in names(sn)) {
  s <- aggregate(y ~ inner + A + B + C, d, function(y) c(sn = sn[[goal]](y), mean = mean(y), sd = sd(y)))
  s <- s[order(s$inner), ]; S <- s$y
  tab <- lapply(c("A", "B", "C"), function(f) { m <- tapply(S[, "sn"], s[[f]], mean); list(factor = f, levels = I(as.integer(names(m))), sn = I(unname(m)), range = max(m) - min(m), best = as.integer(names(m)[which.max(m)])) })
  add(list(name = sprintf("taguchi L9 x 2^2 %s the better", goal), input = list(kind = "taguchi", goal = goal, runs = lapply(seq_len(nrow(d)), function(i) list(A = d$A[i], B = d$B[i], C = d$C[i], M = d$M[i], N = d$N[i], y = d$y[i]))),
    output = list(sn = I(unname(S[, "sn"])), mean = I(unname(S[, "mean"])), sd = I(unname(S[, "sd"])), table = tab)))
}
write_fixture("robustdesign-r", cases, "tests/ref/robustdesign_r.R", c("FrF2", "DoE.base"), tolerance = list(rel = 1e-9, abs = 1e-10))
