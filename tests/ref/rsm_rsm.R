# Response-surface design references (issue #9) from R rsm: ccd() with each alpha rule, with
# a fractional cube, inscribed, and blocked; bbd() for k = 3 ... 7 and its blocked forms.
# Designs are written in rsm's (unrandomised) order with coded values and block labels; the
# test compares them as sets of rows within blocks.
source("tests/ref/fixture.R")
suppressPackageStartupMessages(library(rsm))

safe <- function(name, input, f) {
  out <- tryCatch(f(), error = function(e) list(error = conditionMessage(e)))
  list(name = name, input = input, output = out)
}
coded <- function(d, k) unname(as.matrix(as.data.frame(d)[, paste0("x", 1:k)]))
blocks <- function(d) if ("Block" %in% names(d)) I(as.character(d$Block)) else NULL
star_alpha <- function(X, k) max(abs(X[rowSums(X != 0) == 1, , drop = FALSE]))

cases <- list()
add <- function(...) cases[[length(cases) + 1]] <<- safe(...)

for (a in c("rotatable", "orthogonal", "spherical", "faces")) for (k in 2:4) {
  add(paste("ccd k", k, a, "n0 = c(3, 2)"), list(kind = "ccd", k = k, alpha = a, n0 = I(c(3, 2))), function() {
    d <- ccd(k, n0 = c(3, 2), alpha = a, randomize = FALSE)
    X <- coded(d, k); list(X = X, block = blocks(d), alpha = star_alpha(X, k))
  })
}
add("ccd k 3 alpha 1.5 one block", list(kind = "ccd", k = 3, alpha = 1.5, n0 = I(c(4, 2)), oneblock = TRUE), function() {
  d <- ccd(3, n0 = c(4, 2), alpha = 1.5, randomize = FALSE, oneblock = TRUE)
  X <- coded(d, 3); list(X = X, alpha = star_alpha(X, 3))
})
add("ccd k 3 rotatable inscribed", list(kind = "ccd", k = 3, alpha = "rotatable", n0 = I(c(2, 2)), inscribed = TRUE), function() {
  d <- ccd(3, n0 = c(2, 2), alpha = "rotatable", inscribed = TRUE, randomize = FALSE)
  X <- coded(d, 3); list(X = X, block = blocks(d), alpha = star_alpha(X, 3))
})
add("ccd k 5 half-fraction cube (x5 = x1 x2 x3 x4) rotatable", list(kind = "ccd", k = 5, alpha = "rotatable", n0 = I(c(4, 2)), cubeGenerators = I("ABCD")), function() {
  d <- ccd(~ x1 + x2 + x3 + x4, x5 ~ x1 * x2 * x3 * x4, n0 = c(4, 2), alpha = "rotatable", randomize = FALSE)
  X <- coded(d, 5); list(X = X, block = blocks(d), alpha = star_alpha(X, 5))
})
add("ccd k 5 half-fraction cube orthogonal", list(kind = "ccd", k = 5, alpha = "orthogonal", n0 = I(c(6, 1)), cubeGenerators = I("ABCD")), function() {
  d <- ccd(~ x1 + x2 + x3 + x4, x5 ~ x1 * x2 * x3 * x4, n0 = c(6, 1), alpha = "orthogonal", randomize = FALSE)
  X <- coded(d, 5); list(X = X, block = blocks(d), alpha = star_alpha(X, 5))
})
add("ccd k 4 cube in 2 blocks (x1 x2 x3 x4) orthogonal", list(kind = "ccd", k = 4, alpha = "orthogonal", n0 = I(c(2, 2)), cubeBlocks = 2), function() {
  d <- ccd(4, blocks = Block ~ c(x1 * x2 * x3 * x4), n0 = c(2, 2), alpha = "orthogonal", randomize = FALSE)
  X <- coded(d, 4); list(X = X, block = blocks(d), alpha = star_alpha(X, 4))
})
for (k in 3:7) add(paste("bbd k", k), list(kind = "bbd", k = k, n0 = 3, blocked = FALSE), function() {
  d <- bbd(k, n0 = 3, block = FALSE, randomize = FALSE); list(X = coded(d, k))
})
for (k in 4:5) add(paste("bbd k", k, "blocked"), list(kind = "bbd", k = k, n0 = 2, blocked = TRUE), function() {
  d <- bbd(k, n0 = 2, randomize = FALSE); list(X = coded(d, k), block = blocks(d))
})
write_fixture("rsm-rsm", cases, "tests/ref/rsm_rsm.R", c("rsm"))
