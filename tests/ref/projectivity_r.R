# Projection properties of screening designs (issue #79), measured independently of aikidoe on its
# own designs (tests/ref/fixture.screening-designs.json, written by export-screening-designs.mjs):
#   - generalised resolution: DoE.base::GR (Groemping's GR, which for two-level designs is Deng &
#     Tang's r + 1 − max |J_r|/N);
#   - projectivity: brute force over every set of 2, 3 and 4 columns (combn), counting the sets
#     whose two-level rows contain all 2^s sign combinations; P the largest s with all full;
#   - Plackett–Burman: in how many 4-column sets main effects and all 2fis are estimable (qr rank);
#   - definitive screening: in how many 3- and 4-column sets of the continuous columns the full
#     quadratic is estimable (qr rank).
source("tests/ref/fixture.R")
suppressPackageStartupMessages({ library(jsonlite); library(DoE.base) })
inp <- fromJSON("tests/ref/fixture.screening-designs.json", simplifyMatrix = TRUE)$designs
cases <- list()

fullCount <- function(X, s) {
  R <- X[apply(X, 1, function(r) all(abs(r) == 1)), , drop = FALSE]; B <- (R + 1) / 2
  cs <- combn(ncol(X), s); w <- 2^(0:(s - 1))
  full <- 0
  for (i in seq_len(ncol(cs))) if (length(unique(drop(B[, cs[, i], drop = FALSE] %*% w))) == 2^s) full <- full + 1
  c(full = full, total = ncol(cs))
}
estimable <- function(X, s, cols, quad) {
  cs <- combn(cols, s); ok <- 0
  for (i in seq_len(ncol(cs))) {
    S <- cs[, i]; M <- cbind(1, X[, S], if (quad) X[, S]^2)
    for (a in 1:(s - 1)) for (b in (a + 1):s) M <- cbind(M, X[, S[a]] * X[, S[b]])
    if (nrow(M) >= ncol(M) && qr(M, tol = 1e-9)$rank == ncol(M)) ok <- ok + 1
  }
  c(estimable = ok, total = ncol(cs))
}

for (i in seq_len(nrow(inp))) {
  name <- inp$name[i]; kind <- inp$kind[i]; X <- inp$X[[i]]; k <- ncol(X)
  out <- list()
  if (kind != "dsd") {
    out$gr <- unname(GR(as.data.frame(X), digits = 10)$GR)
    P <- 1; nxt <- NULL
    for (s in 2:min(4, k)) {
      # large designs: the 4-column count only up to 31 columns (combn(47, 4) is slow in R); P is then 3 if any set of 4 is not full
      if (s == 4 && k > 31) { nxt <- list(size = 4, full = NULL, total = choose(k, 4)); break }
      fc <- fullCount(X, s)
      if (fc[["full"]] < fc[["total"]]) { nxt <- list(size = s, full = fc[["full"]], total = fc[["total"]]); break }
      P <- s
    }
    out$projectivity <- P; out$`next` <- nxt
    if (kind == "pb" && k >= 4 && k <= 23) out$fourFactor2fi <- as.list(estimable(X, 4, seq_len(k), FALSE))
  } else {
    cats <- unlist(inp$categorical[[i]]) + 1
    cols <- setdiff(seq_len(k), cats)
    out$quadratic3 <- as.list(estimable(X, 3, cols, TRUE))
    out$quadratic4 <- as.list(estimable(X, 4, cols, TRUE))
  }
  cases[[length(cases) + 1]] <- list(name = name, input = list(design = name, runs = nrow(X), factors = k), output = out)
}

write_fixture("projectivity-r", cases, "tests/ref/projectivity_r.R", c("DoE.base"))
