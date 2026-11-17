# Orthogonal arrays for factors with more than two levels (issue #85, phase 2), with DoE.base.
# 1. The generalised word-length pattern (GWLP, Xu & Wu 2001) of DoE.base's arrays: the app builds
#    its own (regular arrays over GF(s), difference matrices, expansive replacement), which must
#    have the same patterns.
# 2. Generalised minimum aberration on (A3, A4): a complete search over the columns of DoE.base's
#    arrays for factors of given numbers of levels, which the app's choice of columns must reach.
# 3. GWLP of random mixed-level matrices (not orthogonal), to check the formula itself.
source("tests/ref/fixture.R")
suppressPackageStartupMessages(library(DoE.base))
cases <- list()
add <- function(x) cases[[length(cases) + 1]] <<- x
arr <- function(nm) { A <- eval(parse(text = sprintf("oa.design(%s, randomize = FALSE)", nm))); unname(sapply(A, as.integer)) - 1 }
g <- function(M, k) { v <- round(GWLP(M, kmax = k), 9); unname(v[-1]) }                      # A1 ... Ak

# 1. the arrays' patterns (up to length 8); the app's id for each
ids <- list(L9 = "L9.3.4", L12 = "L12.2.11", L16 = "L16.2.15", L16.4.5 = "L16.4.5", L16.2.3.4.4 = "L16.2.3.4.4", L16.2.6.4.3 = "L16.2.6.4.3",
  L16.2.9.4.2 = "L16.2.9.4.2", L16.2.12.4.1 = "L16.2.12.4.1", L18 = "L18", L18.6.1.3.6 = "L18.3.6.6.1", L25 = "L25.5.6", L27 = "L27.3.13",
  L36 = "L36.2.11.3.12", L36.3.13.4.1 = "L36.3.13.4.1")
A <- list()
for (id in names(ids)) {
  M <- arr(ids[[id]]); A[[id]] <- M
  levels <- apply(M, 2, function(x) length(unique(x)))
  add(list(name = sprintf("gwlp of %s", ids[[id]]), input = list(kind = "array", id = id, levels = I(sort(levels))), output = list(gwlp = I(g(M, min(ncol(M), 8))))))
}

# 2. complete searches: minimum (A3, A4) over every choice of columns with the right numbers of levels
best <- function(M, need) {
  lv <- apply(M, 2, function(x) length(unique(x)))
  sets <- lapply(names(need), function(s) combn(which(lv == as.integer(s)), need[[s]], simplify = FALSE))
  grid <- expand.grid(lapply(sets, seq_along))
  b <- NULL
  for (r in seq_len(nrow(grid))) {
    cols <- unlist(lapply(seq_along(sets), function(t) sets[[t]][[grid[r, t]]]))
    v <- c(g(M[, cols], min(4, length(cols)))[-(1:2)], 0, 0)[1:2]   # (A4 is 0 for three columns)
    if (is.null(b) || v[1] < b[1] - 1e-9 || (abs(v[1] - b[1]) < 1e-9 && v[2] < b[2] - 1e-9)) b <- v
  }
  b
}
for (s in list(list("L18", c(`2` = 1, `3` = 4)), list("L18", c(`3` = 5)), list("L18", c(`3` = 6)), list("L18", c(`2` = 1, `3` = 5)),
               list("L16.2.3.4.4", c(`2` = 2, `4` = 3)), list("L16.2.3.4.4", c(`2` = 1, `4` = 2)), list("L16.4.5", c(`4` = 3)), list("L16.4.5", c(`4` = 4)),
               list("L25", c(`5` = 4)), list("L27", c(`3` = 5)), list("L36", c(`2` = 1, `3` = 3)), list("L36", c(`3` = 4)), list("L36", c(`2` = 2, `3` = 2)),
               list("L36.3.13.4.1", c(`3` = 3, `4` = 1)))) {
  need <- as.list(s[[2]])
  add(list(name = sprintf("minimum A3 A4 in %s for %s", ids[[s[[1]]]], paste(sprintf("%s^%d", names(need), unlist(need)), collapse = " ")),
    input = list(kind = "gma", id = s[[1]], need = need), output = list(a34 = I(best(A[[s[[1]]]], need)))))
}

# 3. random mixed-level matrices
set.seed(85)
for (cs in list(c(2, 3, 3), c(2, 2, 3, 4), c(3, 3, 3, 3, 5), c(2, 3, 4, 4, 2, 3))) {
  N <- 12 + 6 * length(cs)
  M <- sapply(cs, function(s) sample(0:(s - 1), N, replace = TRUE))
  for (j in seq_along(cs)) M[seq_len(cs[j]), j] <- 0:(cs[j] - 1)              # every level present
  add(list(name = sprintf("gwlp of a random %d-run matrix, levels %s", N, paste(cs, collapse = " ")), input = list(kind = "random", X = lapply(seq_len(N), function(i) I(M[i, ])), levels = I(cs)),
    output = list(gwlp = I(g(M, length(cs))))))
}

write_fixture("arrays-r", cases, "tests/ref/arrays_r.R", c("DoE.base"), tolerance = list(rel = 1e-8, abs = 1e-8))
