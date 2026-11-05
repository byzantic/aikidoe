# Two-level design references (issue #5) from FrF2: minimum-aberration catalogue entries
# (generators, word-length pattern, resolution, alias structure, run matrix), designs from
# user-given generators, blocked full factorials, and Plackett-Burman designs.
# Each case is wrapped in tryCatch so one failure is recorded rather than stopping the script.
source("tests/ref/fixture.R")
suppressPackageStartupMessages(library(FrF2))

safe <- function(name, input, f) {
  out <- tryCatch(f(), error = function(e) list(error = conditionMessage(e)))
  list(name = name, input = input, output = out)
}
mat <- function(d) unname(as.matrix(desnum(d)))
aliasinfo <- function(d) {
  a <- design.info(d)$aliased
  list(main = I(as.character(unlist(a$main))), fi2 = I(as.character(unlist(a$fi2))))
}
cases <- list()

# minimum-aberration catalogue: k-p.1 for N = 8 ... 128, k <= 15
for (N in c(8, 16, 32, 64, 128)) {
  q <- log2(N)
  for (k in (q + 1):min(15, N - 1)) {
    p <- k - q
    nm <- paste0(k, "-", p, ".1")
    cases[[length(cases) + 1]] <- safe(paste("MA", nm, "N", N), list(kind = "catalogue", runs = N, factors = k), function() {
      e <- catlg[[nm]]
      if (is.null(e)) return(list(error = "not in catlg"))
      out <- list(catlg = nm, gen = I(as.integer(e$gen)), res = e$res, WLP = I(as.numeric(e$WLP)))
      if (N <= 64) {
        d <- FrF2(nruns = N, nfactors = k, randomize = FALSE, alias.info = 2)
        out$runsMatrix <- mat(d)
        out$aliases <- aliasinfo(d)
        out$designGen <- I(as.character(design.info(d)$catlg.name))
      }
      out
    })
  }
}

# user-specified generators
for (g in list(list(N = 16, k = 6, gen = c("ABC", "BCD")),
               list(N = 16, k = 5, gen = c("ABCD")),
               list(N = 8, k = 5, gen = c("AB", "AC")),
               list(N = 32, k = 8, gen = c("ABC", "ABD", "ACDE")))) {
  cases[[length(cases) + 1]] <- safe(paste("generators", paste(g$gen, collapse = ","), "N", g$N),
    list(kind = "generators", runs = g$N, factors = g$k, generators = I(g$gen)), function() {
      d <- FrF2(nruns = g$N, nfactors = g$k, generators = g$gen, randomize = FALSE, alias.info = 2)
      list(runsMatrix = mat(d), aliases = aliasinfo(d))
    })
}

# blocked full factorials with given block generators
for (b in list(list(N = 16, k = 4, blocks = c("ABCD")),
               list(N = 16, k = 4, blocks = c("ABC", "ABD")),
               list(N = 32, k = 5, blocks = c("ABC", "CDE")))) {
  cases[[length(cases) + 1]] <- safe(paste("blocks", paste(b$blocks, collapse = ","), "N", b$N),
    list(kind = "blocked", runs = b$N, factors = b$k, blocks = I(b$blocks)), function() {
      d <- FrF2(nruns = b$N, nfactors = b$k, blocks = b$blocks, randomize = FALSE, alias.block.2fis = TRUE)
      blk <- as.character(d$Blocks)
      x <- d[, setdiff(names(d), "Blocks")]
      list(runsMatrix = unname(sapply(x, function(v) as.numeric(as.character(v)))), block = I(blk))
    })
}

# Plackett-Burman
for (N in c(12, 16, 20, 24, 28, 32, 36, 40, 44, 48)) {
  cases[[length(cases) + 1]] <- safe(paste("PB", N), list(kind = "pb", runs = N), function() {
    d <- pb(nruns = N, randomize = FALSE)
    list(runsMatrix = mat(d))
  })
}

write_fixture("design-frf2", cases, "tests/ref/design_frf2.R", c("FrF2", "DoE.base"))
