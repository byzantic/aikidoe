# Regular three-level fractions 3^(k-p) (issue #85, phase 1), with DoE.base.
# 1. Minimum aberration: the smallest generalised word-length pattern (A3, A4, ...) over every
#    choice of k columns of DoE.base's saturated arrays L9.3.4 and L27.3.13 (a complete search,
#    independent of how the app builds its fractions); for 81 runs, over the regular fractions with
#    four base factors and k - 4 added columns (k = 5 ... 7).
# 2. Fractions from given generators: DoE.base::GWLP of the design built here.
# For a regular three-level design GWLP counts each word twice (a word and its square): GWLP = 2 WLP.
source("tests/ref/fixture.R")
suppressPackageStartupMessages(library(DoE.base))
cases <- list()
add <- function(x) cases[[length(cases) + 1]] <<- x
# (oa.design finds its arrays by the name it is called with)
mat <- function(nm) as.matrix(sapply(eval(parse(text = sprintf("oa.design(%s, randomize = FALSE)", nm))), as.integer)) - 1
gw <- function(M, k) { g <- round(GWLP(M, kmax = k), 8); unname(g[-(1:3)]) }       # A3 ... Ak
lexmin <- function(a, b) { for (i in seq_along(a)) if (a[i] != b[i]) return(a[i] < b[i]); FALSE }

best_subset <- function(M, k) {
  best <- NULL
  for (cols in combn(ncol(M), k, simplify = FALSE)) { g <- gw(M[, cols], k); if (is.null(best) || lexmin(g, best)) best <- g }
  best
}
L9 <- mat("L9.3.4"); L27 <- mat("L27.3.13")
for (k in 3:4) add(list(name = sprintf("minimum aberration 9 runs k %d", k), input = list(kind = "ma", runs = 9, k = k), output = list(gwlp = I(best_subset(L9, k)))))
for (k in 4:13) add(list(name = sprintf("minimum aberration 27 runs k %d", k), input = list(kind = "ma", runs = 27, k = k), output = list(gwlp = I(best_subset(L27, k)))))

# 81 runs: four base factors, the added columns among the normalised combinations of two or more
b4 <- as.matrix(expand.grid(A = 0:2, B = 0:2, C = 0:2, D = 0:2))
vecs <- as.matrix(expand.grid(0:2, 0:2, 0:2, 0:2))[-1, ]
first <- apply(vecs, 1, function(v) v[v != 0][1]); vecs <- vecs[first == 1 & rowSums(vecs != 0) >= 2, ]
cols81 <- (b4 %*% t(vecs)) %% 3
for (k in 5:7) {
  best <- NULL
  for (s in combn(nrow(vecs), k - 4, simplify = FALSE)) { g <- gw(cbind(b4, cols81[, s, drop = FALSE]), k); if (is.null(best) || lexmin(g, best)) best <- g }
  add(list(name = sprintf("minimum aberration 81 runs k %d", k), input = list(kind = "ma", runs = 81, k = k), output = list(gwlp = I(best))))
}

# 2. given generators (exponent vectors over the base factors)
gen_case <- function(name, m, gens) {
  base <- as.matrix(expand.grid(rep(list(0:2), m)))
  M <- cbind(base, sapply(gens, function(g) (base %*% g) %% 3))
  k <- ncol(M)
  add(list(name = name, input = list(kind = "generators", m = m, generators = lapply(gens, I)), output = list(gwlp = I(gw(M, k)))))
}
gen_case("3^(4-1) D=ABC", 3, list(c(1, 1, 1)))
gen_case("3^(4-2) C=AB D=AB2", 2, list(c(1, 1), c(1, 2)))
gen_case("3^(5-2) D=AB E=AB2C", 3, list(c(1, 1, 0), c(1, 2, 1)))
gen_case("3^(6-3) D=AB E=AC F=BC2", 3, list(c(1, 1, 0), c(1, 0, 1), c(0, 1, 2)))
gen_case("3^(7-3) E=ABC F=AB2D G=BC2D2", 4, list(c(1, 1, 1, 0), c(1, 2, 0, 1), c(0, 1, 2, 2)))

write_fixture("threelevel-r", cases, "tests/ref/threelevel_r.R", c("DoE.base"), tolerance = list(rel = 0, abs = 1e-6))
