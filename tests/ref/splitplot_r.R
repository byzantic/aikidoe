# Issue #14 references (run on CI: FrF2 and skpr are not needed locally):
#  - FrF2 split-plot fractions (WPs, nfac.WP): FrF2 takes the first design of its
#    minimum-aberration catalogue that accommodates the split-plot structure; the test compares
#    word-length patterns and checks that whole-plot factors are constant within whole plots.
#  - skpr optimal split-plot designs (gen_design with splitplotdesign, blocksizes,
#    varianceratio), with the GLS log-determinant computed here directly:
#    log |Xᵀ V⁻¹ X|, V = I + η Z Zᵀ, X with contr.sum for categorical factors.
source("tests/ref/fixture.R")
suppressPackageStartupMessages({ library(FrF2); library(skpr) })
set.seed(20261105)
cases <- list()
safe <- function(name, input, f) {
  out <- tryCatch(f(), error = function(e) list(error = conditionMessage(e)))
  cases[[length(cases) + 1]] <<- list(name = name, input = input, output = out)
}
for (s in list(c(16, 4, 2, 3), c(32, 8, 3, 4), c(32, 4, 2, 5), c(64, 8, 3, 5), c(64, 16, 4, 6), c(32, 8, 3, 2), c(64, 8, 2, 7)))
  safe(sprintf("FrF2 %d runs, %d whole plots, %d WP + %d SP factors", s[1], s[2], s[3], s[4]), list(kind = "fraction", runs = s[1], wholePlots = s[2], k1 = s[3], k2 = s[4]), function() {
    d <- FrF2(nruns = s[1], nfactors = s[3] + s[4], WPs = s[2], nfac.WP = s[3], randomize = FALSE)
    fn <- names(factor.names(d))
    X <- sapply(fn, function(v) as.numeric(as.character(d[[v]])))
    list(X = unname(X), factors = I(fn))
  })

gls_logdet <- function(form, d, eta, wp) {
  X <- model.matrix(form, d, contrasts.arg = if ("G" %in% names(d)) list(G = "contr.sum") else NULL)
  Z <- model.matrix(~ factor(wp) - 1)
  V <- diag(nrow(X)) + eta * Z %*% t(Z)
  as.numeric(determinant(t(X) %*% solve(V, X), logarithm = TRUE)$modulus)
}
opt <- list(
  list(name = "skpr: A htc; B, C, D; (A+B+C+D)^2; 8 x 4; eta 1", wpc = expand.grid(A = c(-1, 1)), wpm = ~ A,
       spc = expand.grid(B = c(-1, 1), C = c(-1, 1), D = c(-1, 1)), model = ~ (A + B + C + D)^2, aikidoe = "(A+B+C+D)^2", W = 8, m = 4, eta = 1),
  list(name = "skpr: A, B htc; C, D; quadratic; 8 x 4; eta 1", wpc = expand.grid(A = c(-1, 0, 1), B = c(-1, 0, 1)), wpm = ~ A + B + I(A^2) + I(B^2) + A:B,
       spc = expand.grid(C = c(-1, 0, 1), D = c(-1, 0, 1)), model = ~ A + B + C + D + I(A^2) + I(B^2) + I(C^2) + I(D^2) + A:B + A:C + A:D + B:C + B:D + C:D, aikidoe = "quadratic", W = 8, m = 4, eta = 1),
  list(name = "skpr: A htc; B, G (3 levels); 2fi; 6 x 4; eta 2", wpc = expand.grid(A = c(-1, 1)), wpm = ~ A,
       spc = expand.grid(B = c(-1, 1), G = factor(c("b", "c", "a"), levels = c("b", "c", "a"))), model = ~ (A + B + G)^2, aikidoe = "(A+B+G)^2", W = 6, m = 4, eta = 2, levels = c("a", "b", "c"))
)
for (o in opt) safe(o$name, list(kind = "optimal", model = o$aikidoe, wholePlots = o$W, perWholePlot = o$m, eta = o$eta, levels = o$levels), function() {
  wp <- gen_design(o$wpc, o$wpm, trials = o$W, repeats = 20)
  d <- gen_design(o$spc, o$model, trials = o$W * o$m, splitplotdesign = wp, blocksizes = o$m, varianceratio = o$eta, repeats = 50,
                  contrast = if ("G" %in% names(o$spc)) contr.sum else NULL)
  d <- as.data.frame(d)
  wpid <- d[[grep("^Block", names(d))[1]]]
  vars <- setdiff(names(d), grep("^Block", names(d), value = TRUE))
  if ("G" %in% vars) d$G <- factor(as.character(d$G), levels = c("b", "c", "a"))
  rows <- lapply(seq_len(nrow(d)), function(i) lapply(as.list(d[i, vars, drop = FALSE]), function(v) if (is.factor(v)) as.character(v) else v))
  list(rows = rows, wholePlot = I(as.integer(factor(wpid, levels = unique(wpid)))), logDet = gls_logdet(o$model, d, o$eta, wpid))
})
write_fixture("splitplot-r", cases, "tests/ref/splitplot_r.R", c("FrF2", "skpr"), tolerance = list(rel = 1e-6, abs = 1e-8))
