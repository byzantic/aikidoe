# Scaled prediction variance and the variance dispersion graph (issue #88), in base R:
# v(x) = N f(x)ᵀ (FᵀF)⁻¹ f(x) with F = model.matrix of the design for the model (R's own formula
# machinery and treatment contrasts — the variance does not depend on how a categorical factor is
# coded), at given points; and its min, mean and max over given directions at given radii.
# Designs (built here, recorded in the input): a rotatable CCD (k = 3, 4 centre runs), a
# Box–Behnken (k = 3, 3 centre runs), an irregular 14-run design (seeded points of the 3³ grid, as
# an optimal search might leave), and 2² × a three-level categorical factor for the 2fi model.
source("tests/ref/fixture.R")
set.seed(20261110)
cases <- list()

spv <- function(D, form, P) {
  F <- model.matrix(form, D); M <- solve(crossprod(F)); N <- nrow(D)
  Fp <- model.matrix(delete.response(terms(form)), P)
  N * rowSums((Fp %*% M) * Fp)
}
rows <- function(d) unname(lapply(seq_len(nrow(d)), function(i) unname(unlist(lapply(d[i, , drop = FALSE], function(v) if (is.factor(v)) as.integer(v) - 1 else v)))))

addcase <- function(name, D, model, form, P, radii = NULL, dirs = NULL) {
  out <- list(spv = I(unname(spv(D, form, P))))
  if (!is.null(radii)) {
    out$vdg <- lapply(radii, function(r) { Q <- as.data.frame(dirs * r); names(Q) <- names(D); v <- spv(D, form, Q); list(radius = r, min = min(v), mean = mean(v), max = max(v)) })
  }
  cases[[length(cases) + 1]] <<- list(name = name, input = list(factors = I(names(D)), design = rows(D), model = model, points = rows(P),
    radii = if (is.null(radii)) NULL else I(radii), directions = if (is.null(dirs)) NULL else unname(lapply(seq_len(nrow(dirs)), function(i) unname(dirs[i, ])))), output = out)
}
quad3 <- ~ A + B + C + I(A^2) + I(B^2) + I(C^2) + A:B + A:C + B:C
cube <- as.matrix(expand.grid(A = c(-1, 1), B = c(-1, 1), C = c(-1, 1)))
pts <- data.frame(A = c(0, 1, 0.5, -0.3, 1.2, 0.9), B = c(0, 0, -0.7, 0.8, 1.2, -0.9), C = c(0, 0, 0.2, -0.6, 0, 0.9))
dirs <- rbind(diag(3), as.matrix(expand.grid(c(-1, 1), c(-1, 1), c(-1, 1))) / sqrt(3), matrix(c(1, 2, -2, -3, 1, 1), 2, byrow = TRUE) / c(3, sqrt(11)))

a <- 8^(1/4)
ccd3 <- as.data.frame(rbind(cube, rbind(c(-a, 0, 0), c(a, 0, 0), c(0, -a, 0), c(0, a, 0), c(0, 0, -a), c(0, 0, a)), matrix(0, 4, 3))); names(ccd3) <- c("A", "B", "C")
addcase("ccd k = 3 rotatable, quadratic", ccd3, "quadratic", quad3, pts, radii = c(0, 0.5, 1, 1.5, a), dirs = dirs)

e <- expand.grid(a = c(-1, 1), b = c(-1, 1))
bbd3 <- as.data.frame(rbind(cbind(e$a, e$b, 0), cbind(e$a, 0, e$b), cbind(0, e$a, e$b), matrix(0, 3, 3))); names(bbd3) <- c("A", "B", "C")
addcase("box-behnken k = 3, quadratic", bbd3, "quadratic", quad3, pts, radii = c(0, 0.5, 1, sqrt(2)), dirs = dirs)

grid3 <- expand.grid(A = c(-1, 0, 1), B = c(-1, 0, 1), C = c(-1, 0, 1))
irr <- grid3[sort(sample(nrow(grid3), 14)), ]; rownames(irr) <- NULL
addcase("irregular 14 runs, quadratic", irr, "quadratic", quad3, pts, radii = c(0, 0.5, 1), dirs = dirs)
addcase("irregular 14 runs, A*B + C", irr, "A*B + C", ~ A * B + C, pts)

mixd <- expand.grid(A = c(-1, 1), B = c(-1, 1), G = factor(c("a", "b", "c"))); mixd <- mixd[c(1:12, 1, 6, 11), ]; rownames(mixd) <- NULL
pm <- data.frame(A = c(0, 1, -0.5), B = c(0, 1, 0.3), G = factor(c("a", "c", "b"), levels = c("a", "b", "c")))
addcase("2^2 x categorical G (3 levels), (A+B+G)^2", mixd, "(A+B+G)^2", ~ (A + B + G)^2, pm)

write_fixture("space-r", cases, "tests/ref/space_r.R", character(), tolerance = list(rel = 1e-9, abs = 1e-12))
