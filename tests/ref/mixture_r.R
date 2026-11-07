# Mixture references (issue #62): mixexp for simplex-lattice, simplex-centroid and extreme-vertices
# designs (vertices, edge and face centroids, overall centroid); lm for Scheffe models fitted to
# L-pseudo-components (computed here independently), with R² about the mean (the "implied
# intercept" of mixture models) and the grouped ANOVA; AlgDesign's Federov exchange for a
# D-optimal design from the same candidate blends (aikidoe must do at least as well).
source("tests/ref/fixture.R")
suppressPackageStartupMessages({ library(mixexp); library(AlgDesign) })
set.seed(20261107)
cases <- list()
rows <- function(m) unname(lapply(seq_len(nrow(m)), function(i) unname(as.numeric(m[i, ]))))

# designs
for (qm in list(c(3, 2), c(3, 3), c(4, 2))) {
  d <- SLD(qm[1], qm[2])
  cases[[length(cases) + 1]] <- list(name = sprintf("simplex lattice {%d,%d}", qm[1], qm[2]), input = list(kind = "lattice", q = qm[1], m = qm[2]), output = list(points = rows(as.matrix(d))))
}
for (q in 3:4) {
  d <- SCD(q)
  cases[[length(cases) + 1]] <- list(name = sprintf("simplex centroid q = %d", q), input = list(kind = "centroid", q = q), output = list(points = rows(as.matrix(d))))
}
xv <- function(name, lc, uc, ndm) {
  q <- length(lc)
  d <- Xvert(q, uc = uc, lc = lc, ndm = ndm, plot = FALSE)
  m <- as.matrix(d[, 1:q])
  cases[[length(cases) + 1]] <<- list(name = name, input = list(kind = "vertices", lower = I(lc), upper = I(uc), ndm = ndm),
    output = list(points = rows(m), dim = I(d$dimen)))
}
xv("extreme vertices, 3 components", c(0.1, 0.1, 0.2), c(0.7, 0.6, 0.5), 1)
xv("extreme vertices, 4 components with faces", c(0.05, 0.1, 0.15, 0.2), c(0.5, 0.6, 0.4, 0.5), 2)

# Scheffe fits on pseudo-components; R² and F about the mean
fitcase <- function(name, X, y, lc, terms) {
  q <- ncol(X); Z <- sweep(X, 2, lc) / (1 - sum(lc)); colnames(Z) <- paste0("x", 1:q)
  d <- data.frame(Z, y = y)
  m <- lm(as.formula(paste("y ~ -1 +", terms)), data = d)
  rss <- sum(residuals(m)^2); tss <- sum((y - mean(y))^2); dfm <- length(coef(m)) - 1
  F <- ((tss - rss) / dfm) / (rss / df.residual(m))
  # grouped ANOVA: linear blending against the mean, then each further term sequentially
  lin <- lm(as.formula(paste("y ~ -1 +", paste(colnames(Z), collapse = "+"))), data = d)
  lin_ss <- sum((fitted(lin) - mean(y))^2)
  a <- anova(m)
  more <- a[!(rownames(a) %in% c(colnames(Z), "Residuals")), ]
  s <- summary(m)$coefficients
  cases[[length(cases) + 1]] <<- list(name = name, input = list(x = rows(X), y = I(y), lower = I(lc), model = terms),
    output = list(names = I(rownames(s)), estimate = I(unname(s[, 1])), se = I(unname(s[, 2])), r2 = 1 - rss / tss, F = F, dfModel = dfm, dfRes = df.residual(m),
      anova = list(linearSS = lin_ss, linearDf = q - 1, terms = I(rownames(more)), ss = I(unname(more[, "Sum Sq"])))))
}
# Cornell's yarn elongation data (simplex lattice {3,2}, replicated)
yarn <- rbind(c(1,0,0), c(1,0,0), c(0,1,0), c(0,1,0), c(0,0,1), c(0,0,1), c(.5,.5,0), c(.5,.5,0), c(.5,.5,0), c(.5,0,.5), c(.5,0,.5), c(.5,0,.5), c(0,.5,.5), c(0,.5,.5), c(0,.5,.5))
yy <- c(11.0, 12.4, 8.8, 10.0, 16.8, 16.0, 15.0, 14.8, 16.1, 17.7, 16.4, 16.6, 10.0, 9.7, 11.8)
fitcase("yarn elongation, Scheffe quadratic", yarn, yy, c(0, 0, 0), "x1 + x2 + x3 + x1:x2 + x1:x3 + x2:x3")
# a constrained region: extreme vertices and centroids, a simulated response, special cubic
d3 <- Xvert(3, uc = c(0.7, 0.6, 0.5), lc = c(0.1, 0.1, 0.2), ndm = 1, plot = FALSE)
X3 <- as.matrix(d3[, 1:3]); X3 <- rbind(X3, X3)
y3 <- round(5 + 3 * X3[, 1] - 2 * X3[, 2] + 9 * X3[, 1] * X3[, 3] + rnorm(nrow(X3), 0, 0.2), 3)
fitcase("constrained blends, Scheffe special cubic", X3, y3, c(0.1, 0.1, 0.2), "x1 + x2 + x3 + x1:x2 + x1:x3 + x2:x3 + x1:x2:x3")

# D-optimal from candidates (AlgDesign optFederov), Scheffe quadratic in pseudo-components
cand <- as.matrix(Xvert(3, uc = c(0.7, 0.6, 0.5), lc = c(0.1, 0.1, 0.2), ndm = 1, plot = FALSE)[, 1:3])
Zc <- data.frame(sweep(cand, 2, c(0.1, 0.1, 0.2)) / 0.6); colnames(Zc) <- c("x1", "x2", "x3")
o <- optFederov(~ -1 + x1 + x2 + x3 + x1:x2 + x1:x3 + x2:x3, data = Zc, nTrials = 10, criterion = "D", nRepeats = 20)
Xd <- model.matrix(~ -1 + x1 + x2 + x3 + x1:x2 + x1:x3 + x2:x3, o$design)
cases[[length(cases) + 1]] <- list(name = "D-optimal, 10 runs from the vertices and centroids", input = list(lower = I(c(0.1, 0.1, 0.2)), upper = I(c(0.7, 0.6, 0.5)), runs = 10, model = "mixquadratic"),
  output = list(logdet = as.numeric(determinant(crossprod(Xd))$modulus)))

write_fixture("mixture-r", cases, "tests/ref/mixture_r.R", c("mixexp", "AlgDesign", "stats"), tolerance = list(rel = 1e-6, abs = 1e-6))
