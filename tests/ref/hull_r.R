# Whether settings lie in the convex hull of the runs (issue #88, phase 3): membership from
# geometry::inhulln (Qhull's facets), and the residual of the non-negative least-squares problem
# min ‖Aλ − b‖, λ ≥ 0, with A = [Xᵀ; w·1ᵀ], b = [x; w] (w = 1000 weights in Σλ = 1) from nnls::nnls
# (Lawson & Hanson's Fortran), which aikidoe's inHull solves: 0 inside, about the distance to the
# hull outside. Designs: a 2² factorial with axial points (CCD), a 2^(3−1) half fraction (a
# tetrahedron), a Box–Behnken, and seeded points in 4 factors. Query points are kept away from the
# hull's boundary, where membership turns on round-off.
source("tests/ref/fixture.R")
suppressPackageStartupMessages({ library(geometry); library(nnls) })
set.seed(20261112)
cases <- list()
w <- 1000

addcase <- function(name, X, P) {
  A <- rbind(t(X), rep(w, nrow(X)))
  res <- apply(P, 1, function(x) { r <- nnls(A, c(x, w)); sqrt(sum(r$residuals^2)) })
  inside <- as.logical(inhulln(convhulln(X), P))
  stopifnot(all(inside == (res < 1e-6)))
  cases[[length(cases) + 1]] <<- list(name = name, input = list(design = unname(lapply(seq_len(nrow(X)), function(i) I(unname(X[i, ])))), points = unname(lapply(seq_len(nrow(P)), function(i) I(unname(P[i, ]))))),
    output = list(inside = I(inside), residual = I(unname(res))))
}

a <- sqrt(2)
ccd2 <- rbind(as.matrix(expand.grid(c(-1, 1), c(-1, 1))), rbind(c(-a, 0), c(a, 0), c(0, -a), c(0, a)), c(0, 0))
addcase("ccd k = 2", ccd2, rbind(c(0, 0), c(0.9, 0.9), c(1.3, 0), c(1.2, 0.5), c(1.1, 1.1), c(2, 0), c(-1.5, -0.2)))

half <- rbind(c(-1, -1, 1), c(1, -1, -1), c(-1, 1, -1), c(1, 1, 1))
addcase("2^(3-1) half fraction", half, rbind(c(0, 0, 0), c(0.5, 0.4, 0), c(1, 1, -1), c(-1, -1, -1), c(0.9, 0.9, 0.9), c(0.2, -0.1, 0.3)))

e <- expand.grid(a = c(-1, 1), b = c(-1, 1))
bbd3 <- rbind(cbind(e$a, e$b, 0), cbind(e$a, 0, e$b), cbind(0, e$a, e$b), matrix(0, 3, 3))
addcase("box-behnken k = 3", bbd3, rbind(c(0, 0, 0), c(0.4, 0.4, 0.1), c(1, 1, 1), c(0.8, 0.8, 0.8), c(0.6, -0.6, 0.6), c(-0.3, 0.3, -0.3)))

X4 <- matrix(runif(4 * 18, -1, 1), 18, 4)
P4 <- rbind(colMeans(X4), matrix(runif(4 * 8, -1.2, 1.2), 8, 4))
addcase("18 seeded points, 4 factors", X4, P4)

write_fixture("hull-r", cases, "tests/ref/hull_r.R", c("geometry", "nnls"), tolerance = list(rel = 1e-6, abs = 1e-7))
