# Canonical analysis of fitted second-order models (issue #88, phase 2), in base R: lm of the full
# quadratic in coded units; b the first-order coefficients, B the symmetric matrix of the second-
# order ones (B_ii the squares, B_ij half the interaction); the stationary point x_s = −½ B⁻¹ b,
# the fitted value there (predict.lm) and the eigenvalues (and eigenvectors, up to sign) of B — the
# same quantities as rsm::canonical. Also predict.lm on a slice of the surface. Data simulated
# with a fixed seed: a 2-factor maximum (CCD), a 3-factor saddle (CCD) and a 2-factor quadratic
# with a categorical factor shifting it.
source("tests/ref/fixture.R")
set.seed(20261111)
cases <- list()

canon <- function(m, ids) {
  cf <- coef(m); k <- length(ids)
  b <- cf[ids]; B <- matrix(0, k, k)
  for (i in seq_len(k)) B[i, i] <- cf[paste0("I(", ids[i], "^2)")]
  for (i in seq_len(k)) for (j in seq_len(k)) if (i < j) { nm <- paste0(ids[i], ":", ids[j]); B[i, j] <- B[j, i] <- cf[nm] / 2 }
  xs <- -0.5 * solve(B, b); e <- eigen(B, symmetric = TRUE)
  list(b = b, B = B, xs = xs, values = e$values, vectors = e$vectors)
}
rows_of <- function(d) unname(lapply(seq_len(nrow(d)), function(i) lapply(as.list(d[i, , drop = FALSE]), function(v) if (is.factor(v)) as.character(v) else v)))

ccdk <- function(k, n0) { a <- (2^k)^(1/4); cube <- as.matrix(expand.grid(rep(list(c(-1, 1)), k))); ax <- do.call(rbind, lapply(seq_len(k), function(j) { r <- matrix(0, 2, k); r[1, j] <- -a; r[2, j] <- a; r }))
  d <- as.data.frame(rbind(cube, ax, matrix(0, n0, k))); names(d) <- LETTERS[seq_len(k)]; d }

# 1. two factors, a maximum
d <- ccdk(2, 5); d$y <- with(d, 60 + 4 * A - 3 * B - 3 * A^2 - 2.5 * B^2 + 1.2 * A * B + rnorm(nrow(d), sd = 0.6))
m <- lm(y ~ A + B + I(A^2) + I(B^2) + A:B, d); cn <- canon(m, c("A", "B"))
slice <- expand.grid(A = c(-1.2, 0, 0.7), B = c(-0.5, 0.9))
cases[[1]] <- list(name = "2 factors, maximum", input = list(rows = rows_of(d), formula = "y ~ A + B + I(A^2) + I(B^2) + A:B", factors = I(c("A", "B")), slice = rows_of(slice)),
  output = list(xs = I(unname(cn$xs)), value = unname(predict(m, as.data.frame(t(setNames(cn$xs, c("A", "B")))))), eigenvalues = I(cn$values), vectors = unname(lapply(seq_along(cn$values), function(j) I(cn$vectors[, j]))), slice = I(unname(predict(m, slice)))))

# 2. three factors, a saddle
d <- ccdk(3, 4); d$y <- with(d, 40 + 2 * A + 1 * B - 1.5 * C - 2 * A^2 + 1.5 * B^2 - 1 * C^2 + 0.8 * A * B - 0.6 * B * C + rnorm(nrow(d), sd = 0.5))
m <- lm(y ~ A + B + C + I(A^2) + I(B^2) + I(C^2) + A:B + A:C + B:C, d); cn <- canon(m, c("A", "B", "C"))
cases[[2]] <- list(name = "3 factors, saddle", input = list(rows = rows_of(d), formula = "y ~ A + B + C + I(A^2) + I(B^2) + I(C^2) + A:B + A:C + B:C", factors = I(c("A", "B", "C"))),
  output = list(xs = I(unname(cn$xs)), value = unname(predict(m, as.data.frame(t(setNames(cn$xs, c("A", "B", "C")))))), eigenvalues = I(cn$values), vectors = unname(lapply(seq_along(cn$values), function(j) I(cn$vectors[, j])))))

# 3. two factors and a categorical shift G (the stationary point does not depend on G; the value at
#    it is for G's first level, a)
d <- ccdk(2, 3); d <- rbind(d, d); d$G <- factor(rep(c("a", "b"), each = nrow(d) / 2))
d$y <- with(d, 30 + 2 * A + 1 * B - 2 * A^2 - 1.5 * B^2 + 0.5 * A * B + 3 * (G == "b") + rnorm(nrow(d), sd = 0.4))
m <- lm(y ~ A + B + I(A^2) + I(B^2) + A:B + G, d); cn <- canon(m, c("A", "B"))
cases[[3]] <- list(name = "2 factors and a categorical shift", input = list(rows = rows_of(d), formula = "y ~ A + B + I(A^2) + I(B^2) + A:B + G", factors = I(c("A", "B")), levels = I(c("a", "b"))),
  output = list(xs = I(unname(cn$xs)), value = unname(predict(m, data.frame(A = cn$xs[1], B = cn$xs[2], G = factor("a", levels = c("a", "b"))))), eigenvalues = I(cn$values), vectors = unname(lapply(seq_along(cn$values), function(j) I(cn$vectors[, j])))))

write_fixture("surface-r", cases, "tests/ref/surface_r.R", character(), tolerance = list(rel = 1e-9, abs = 1e-12))
