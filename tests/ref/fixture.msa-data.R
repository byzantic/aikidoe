# Gauge R&R data sets shared by msa_r.R (base R) and msa_sixsigma.R (SixSigma::ss.rr): issue #17.
set.seed(20261105)
crossed <- function(p, o, r, sp, so, spo, se, mu = 10) {
  d <- expand.grid(rep = 1:r, operator = paste0("Op", 1:o), part = sprintf("P%02d", 1:p))
  up <- setNames(rnorm(p, sd = sp), sprintf("P%02d", 1:p)); uo <- setNames(rnorm(o, sd = so), paste0("Op", 1:o))
  upo <- matrix(rnorm(p * o, sd = spo), p, o, dimnames = list(names(up), names(uo)))
  d$value <- round(mu + up[as.character(d$part)] + uo[as.character(d$operator)] + upo[cbind(as.character(d$part), as.character(d$operator))] + rnorm(nrow(d), sd = se), 4)
  d$rep <- NULL; d
}
msa_sets <- list(
  list(name = "crossed 10 x 3 x 3, operator x part interaction", design = "crossed", d = crossed(10, 3, 3, 1, 0.3, 0.25, 0.15), tol = 8),
  list(name = "crossed 10 x 3 x 2, no interaction (pooled)", design = "crossed", d = crossed(10, 3, 2, 1, 0.2, 0, 0.2), tol = 6),
  list(name = "crossed 5 x 2 x 3, operator variance estimated negative", design = "crossed", d = crossed(5, 2, 3, 0.8, 0, 0, 0.3), tol = 5)
)
nd <- expand.grid(rep = 1:3, part = 1:5, operator = paste0("Op", 1:3)); nd$part <- paste0(nd$operator, "-P", nd$part)
up <- setNames(rnorm(15, sd = 1), unique(nd$part)); uo <- setNames(rnorm(3, sd = 0.3), paste0("Op", 1:3))
nd$value <- round(20 + up[nd$part] + uo[as.character(nd$operator)] + rnorm(nrow(nd), sd = 0.2), 4); nd$rep <- NULL
msa_sets[[4]] <- list(name = "nested: 3 operators x 5 parts each x 3 (destructive)", design = "nested", d = nd, tol = 10)
rd <- expand.grid(rep = 1:5, part = sprintf("W%02d", 1:10)); rd$value <- round(100 + rnorm(10, sd = 2)[as.integer(rd$part)] + rnorm(50, sd = 0.4), 4); rd$rep <- NULL
msa_sets[[5]] <- list(name = "repeatability only: 10 parts x 5 repeats (automated tool)", design = "repeatability", d = rd, tol = 20)
msa_rows <- function(d) lapply(seq_len(nrow(d)), function(i) { x <- as.list(d[i, , drop = FALSE]); lapply(x, function(v) if (is.factor(v)) as.character(v) else v) })
