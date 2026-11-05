# Issue #18 references (run on CI): the R package `desirability` (Kuhn) — the individual
# desirability functions dMax, dMin, dTarget, dBox on grids with several shape (scale) values,
# dOverall (geometric mean), and the package vignette's example (Myers & Montgomery: percent
# conversion and thermal activity, three factors). The vignette's prediction functions are taken
# from the installed vignette code, evaluated on the 3^3 grid and refitted as quadratics (exact),
# so the test can rebuild them; its optimisation (Nelder–Mead from a grid of starts, square
# and circular regions) is repeated here and the best desirability recorded.
source("tests/ref/fixture.R")
suppressPackageStartupMessages(library(desirability))
cases <- list()
y <- seq(-1, 7, by = 0.25)
d1 <- list(
  list(kind = "max", args = list(low = 1, high = 5, scale = 1)),
  list(kind = "max", args = list(low = 1, high = 5, scale = 0.5)),
  list(kind = "max", args = list(low = 1, high = 5, scale = 3)),
  list(kind = "min", args = list(low = 2, high = 6, scale = 1)),
  list(kind = "min", args = list(low = 2, high = 6, scale = 2)),
  list(kind = "target", args = list(low = 0, target = 3, high = 5, lowScale = 1, highScale = 1)),
  list(kind = "target", args = list(low = 0, target = 3, high = 5, lowScale = 0.5, highScale = 4)),
  list(kind = "box", args = list(low = 2, high = 4)))
for (d in d1) {
  f <- switch(d$kind, max = dMax, min = dMin, target = dTarget, box = dBox)
  obj <- do.call(f, d$args)
  cases[[length(cases) + 1]] <- list(name = paste0("d", d$kind, " ", paste(names(d$args), unlist(d$args), sep = "=", collapse = ", ")),
    input = list(kind = d$kind, args = d$args, y = I(y)), output = list(d = I(unname(predict(obj, y)))))
}
o <- dOverall(dMax(1, 5), dTarget(0, 3, 5))
yy <- expand.grid(a = c(0, 2, 4, 6), b = c(-1, 1, 3, 4.5))
cases[[length(cases) + 1]] <- list(name = "dOverall: geometric mean of dMax(1, 5) and dTarget(0, 3, 5)", input = list(kind = "overall", y = unname(as.matrix(yy))),
  output = list(D = I(unname(predict(o, as.data.frame(as.matrix(yy)))))))

# the vignette example
vig <- tryCatch({
  src <- system.file("doc", "desirability.R", package = "desirability")
  message("vignette code: ", src, " (", file.exists(src), ")")
  ex <- parse(src); env <- new.env()
  for (e in ex) { txt <- paste(deparse(e), collapse = " "); if (grepl("^(conversionPred|activityPred) <-", txt)) eval(e, env) }
  message("found: ", paste(ls(env), collapse = ", "))
  g <- expand.grid(x1 = c(-1, 0, 1), x2 = c(-1, 0, 1), x3 = c(-1, 0, 1))
  fitq <- function(f) { v <- apply(g, 1, f); cf <- coef(lm(v ~ x1 + x2 + x3 + I(x1^2) + I(x2^2) + I(x3^2) + x1:x2 + x1:x3 + x2:x3, data = g)); stopifnot(max(abs(resid(lm(v ~ x1 + x2 + x3 + I(x1^2) + I(x2^2) + I(x3^2) + x1:x2 + x1:x3 + x2:x3, data = g)))) < 1e-8); unname(cf) }
  convD <- dMax(80, 97); actD <- dTarget(55, 57.5, 60); ov <- dOverall(convD, actD)
  rsmOpt <- function(x, dObject, space = "square") {
    conv <- env$conversionPred(x); acty <- env$activityPred(x)
    out <- predict(dObject, data.frame(conv = conv, acty = acty))
    if (space == "circular") { if (sqrt(sum(x^2)) > 1.682) out <- 0 } else if (space == "square") if (any(abs(x) > 1.682)) out <- 0
    out
  }
  best <- function(space) {
    sg <- expand.grid(time = seq(-1.5, 1.5, length = 5), temperature = seq(-1.5, 1.5, length = 5), catalyst = seq(-1.5, 1.5, length = 5))
    b <- NULL
    for (i in seq_len(nrow(sg))) { r <- optim(as.vector(as.matrix(sg[i, ])), rsmOpt, dObject = ov, space = space, control = list(fnscale = -1)); if (is.null(b) || r$value > b$value) b <- r }
    list(x = I(b$par), D = b$value, conv = env$conversionPred(b$par), acty = env$activityPred(b$par))
  }
  list(conversion = I(fitq(env$conversionPred)), activity = I(fitq(env$activityPred)), square = best("square"), circular = best("circular"))
}, error = function(e) list(error = conditionMessage(e)))
cases[[length(cases) + 1]] <- list(name = "vignette: percent conversion (dMax 80, 97) and thermal activity (dTarget 55, 57.5, 60)", input = list(kind = "vignette"), output = vig)
write_fixture("desirability-r", cases, "tests/ref/desirability_r.R", c("desirability"), tolerance = list(rel = 1e-6, abs = 1e-8))
