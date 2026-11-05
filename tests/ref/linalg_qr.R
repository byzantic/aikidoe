# QR reference (issue #2): R's qr() (LINPACK dqrdc2, limited pivoting, tol 1e-7), which is what
# lm() uses to decide which terms are aliased. Checked by tests/linalg.test.mjs with pivot 'limited'.
source("tests/ref/fixture.R")
set.seed(20261105)

hilbert <- function(n) outer(1:n, 1:n, function(i, j) 1 / (i + j - 1))
# 2^(4-1) design, D = ABC, coded ±1
d <- expand.grid(A = c(-1, 1), B = c(-1, 1), C = c(-1, 1)); d$D <- d$A * d$B * d$C
mm <- function(f) unname(model.matrix(f, d))

mats <- list(
  list("random 10x3", matrix(rnorm(30), 10)),
  list("random 20x6", matrix(rnorm(120), 20)),
  list("random 50x10, column scales 1e-3..1e3", matrix(rnorm(500), 50) %*% diag(10^seq(-3, 3, length.out = 10))),
  list("random square 6x6", matrix(rnorm(36), 6)),
  list("2^(4-1) main effects + AB + CD (CD aliased with AB)", mm(~ A + B + C + D + A:B + C:D)),
  list("2^(4-1) all two-factor interactions", mm(~ (A + B + C + D)^2)),
  list("zero column in the middle", cbind(1, rnorm(7), 0, rnorm(7))),
  list("duplicate column", { x <- matrix(rnorm(24), 8); cbind(x, x[, 2]) }),
  list("wide 3x5", matrix(rnorm(15), 3)),
  list("Hilbert 6", hilbert(6)),
  list("Hilbert 8", hilbert(8)),
  list("Hilbert 10", hilbert(10))
)

cases <- lapply(mats, function(c) {
  A <- c[[2]]; m <- nrow(A); n <- ncol(A)
  y <- rnorm(m)
  q <- qr(A)                       # LAPACK = FALSE: dqrdc2, tol 1e-7
  k <- min(m, n); r <- q$rank; piv <- q$pivot
  R <- qr.R(q, complete = FALSE)   # k x n, pivoted column order
  b <- qr.coef(q, y)               # NA for aliased columns
  cov <- matrix(NA_real_, n, n)
  if (r > 0) { ci <- chol2inv(R[1:r, 1:r, drop = FALSE]); cov[piv[1:r], piv[1:r]] <- ci }
  list(name = c[[1]],
       input = list(A = A, y = I(y)),
       output = list(rank = r, perm = I(piv - 1L), R = R, coef = I(unname(b)),
                     fitted = I(unname(qr.fitted(q, y))), covUnscaled = cov))
})
# The Hilbert cases are ill-conditioned: R and coefficients are only meaningful to ~cond·eps,
# so the test checks rank, pivots and backward error for them, not R itself.
write_fixture("linalg-qr", cases, "tests/ref/linalg_qr.R", c("base"), tolerance = list(rel = 1e-9, abs = 1e-12))
