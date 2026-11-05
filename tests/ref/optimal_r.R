# Issue #10 references:
#  - daewr::DefScreen: published definitive screening designs (Jones & Nachtsheim 2011, 2013)
#  - skpr::gen_design and AlgDesign::optFederov: D- and I-optimal designs on candidate grids for
#    6 benchmark problems (one with a constrained region). The test evaluates their designs and
#    aikidoe's with the same criteria and compares efficiencies.
source("tests/ref/fixture.R")
suppressPackageStartupMessages({ library(daewr); library(skpr); library(AlgDesign) })
set.seed(20261105)

safe <- function(name, input, f) {
  out <- tryCatch(f(), error = function(e) list(error = conditionMessage(e)))
  list(name = name, input = input, output = out)
}
rows <- function(d) lapply(seq_len(nrow(d)), function(i) lapply(as.list(d[i, , drop = FALSE]), function(v) if (is.factor(v)) as.character(v) else v))
cases <- list()
add <- function(...) cases[[length(cases) + 1]] <<- safe(...)

for (m in c(4, 5, 6, 8, 10, 12, 14)) add(paste("DefScreen m =", m), list(kind = "dsd", m = m, c = 0), function() {
  d <- DefScreen(m = m, c = 0, randomize = FALSE)
  list(X = unname(sapply(d, function(v) as.numeric(as.character(v)))))
})
for (mc in list(c(6, 1), c(8, 2))) add(paste("DefScreen m =", mc[1], "c =", mc[2]), list(kind = "dsd", m = mc[1], c = mc[2]), function() {
  d <- DefScreen(m = mc[1], c = mc[2], randomize = FALSE)
  X <- sapply(d, function(v) { v <- as.character(v); suppressWarnings(n <- as.numeric(v)); if (any(is.na(n))) as.numeric(factor(v)) * 2 - 3 else n })
  list(X = unname(X))
})

grid <- function(k, step, cat = NULL) {
  g <- do.call(expand.grid, setNames(rep(list(seq(-1, 1, by = step)), k), paste0("x", 1:k)))
  if (!is.null(cat)) { g <- merge(g, data.frame(g = factor(cat))); }
  g
}
bench <- list(
  list(name = "D, 4 factors, main + 2fi, 12 runs", k = 4, model = "~ (x1 + x2 + x3 + x4)^2", runs = 12, crit = "D", step = 0.5),
  list(name = "I, 3 factors, quadratic, 15 runs", k = 3, model = "~ x1 + x2 + x3 + I(x1^2) + I(x2^2) + I(x3^2) + x1:x2 + x1:x3 + x2:x3", runs = 15, crit = "I", step = 0.25),
  list(name = "D, 2 factors, quadratic, 9 runs", k = 2, model = "~ x1 + x2 + I(x1^2) + I(x2^2) + x1:x2", runs = 9, crit = "D", step = 0.1),
  list(name = "I, 4 factors, quadratic, 20 runs", k = 4, model = "~ (x1 + x2 + x3 + x4)^2 + I(x1^2) + I(x2^2) + I(x3^2) + I(x4^2)", runs = 20, crit = "I", step = 0.5),
  list(name = "D, 2 continuous + 3-level categorical, 12 runs", k = 2, cat = c("a", "b", "c"), model = "~ x1 + x2 + g + x1:x2", runs = 12, crit = "D", step = 0.5),
  list(name = "I, 2 factors, quadratic, x1 + x2 <= 0.5, 10 runs", k = 2, model = "~ x1 + x2 + I(x1^2) + I(x2^2) + x1:x2", runs = 10, crit = "I", step = 0.1, constraint = "x1 + x2 <= 0.5")
)
for (b in bench) add(b$name, list(kind = "optimal", k = b$k, categorical = if (is.null(b$cat)) NULL else I(b$cat), model = b$model, runs = b$runs,
                                   criterion = b$crit, step = b$step, constraint = b$constraint), function() {
  cand <- grid(b$k, b$step, b$cat)
  if (!is.null(b$constraint)) cand <- cand[with(cand, eval(parse(text = b$constraint))), , drop = FALSE]
  rownames(cand) <- NULL
  sk <- gen_design(candidateset = cand, model = as.formula(b$model), trials = b$runs, optimality = b$crit, repeats = 50)
  af <- optFederov(as.formula(b$model), data = cand, nTrials = b$runs, criterion = b$crit, nRepeats = 20)
  list(skpr = rows(sk), algdesign = rows(af$design), candidates = nrow(cand))
})
write_fixture("optimal-r", cases, "tests/ref/optimal_r.R", c("daewr", "skpr", "AlgDesign"))
