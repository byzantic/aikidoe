# Issue #17 reference: gauge R&R by the ANOVA method computed from R's own ANOVA tables (lm +
# anova) with the expected-mean-square formulas (Montgomery & Runger; AIAG MSA 4th ed.):
# crossed with and without (pooled) the operator × part interaction, nested, repeatability-only.
source("tests/ref/fixture.R")
source("tests/ref/fixture.msa-data.R")
case <- function(s) {
  d <- s$d; d$part <- factor(d$part); if (!is.null(d$operator)) d$operator <- factor(d$operator)
  out <- list()
  if (s$design == "crossed") {
    p <- nlevels(d$part); o <- nlevels(d$operator); r <- nrow(d) / (p * o)
    a <- anova(lm(value ~ part * operator, d)); MS <- a[["Mean Sq"]]; names(MS) <- rownames(a)
    # tests of part and operator against the interaction (random effects)
    Fp <- MS["part:operator"] / MS["Residuals"]; pint <- pf(Fp, a["part:operator", "Df"], a["Residuals", "Df"], lower.tail = FALSE)
    out$interactionP <- unname(pint)
    if (pint > 0.05) {
      a2 <- anova(lm(value ~ part + operator, d)); M2 <- setNames(a2[["Mean Sq"]], rownames(a2))
      vc <- c(rep = M2[["Residuals"]], op = max(0, (M2[["operator"]] - M2[["Residuals"]]) / (p * r)), po = 0, part = max(0, (M2[["part"]] - M2[["Residuals"]]) / (o * r)))
      out$pooled <- TRUE; out$anovaReduced <- list(df = I(a2$Df), ss = I(a2[["Sum Sq"]]))
    } else {
      vc <- c(rep = MS[["Residuals"]], op = max(0, (MS[["operator"]] - MS[["part:operator"]]) / (p * r)), po = max(0, (MS[["part:operator"]] - MS[["Residuals"]]) / r), part = max(0, (MS[["part"]] - MS[["part:operator"]]) / (o * r)))
      out$pooled <- FALSE
    }
    out$anova <- list(df = I(a$Df), ss = I(a[["Sum Sq"]]))
  } else if (s$design == "nested") {
    o <- nlevels(d$operator); np <- nlevels(d$part) / o; r <- nrow(d) / nlevels(d$part)
    a <- anova(lm(value ~ operator / part, d)); MS <- setNames(a[["Mean Sq"]], rownames(a))
    vc <- c(rep = MS[["Residuals"]], op = max(0, (MS[["operator"]] - MS[["operator:part"]]) / (np * r)), po = 0, part = max(0, (MS[["operator:part"]] - MS[["Residuals"]]) / r))
    out$anova <- list(df = I(a$Df), ss = I(a[["Sum Sq"]]))
  } else {
    r <- nrow(d) / nlevels(d$part)
    a <- anova(lm(value ~ part, d)); MS <- setNames(a[["Mean Sq"]], rownames(a))
    vc <- c(rep = MS[["Residuals"]], op = 0, po = 0, part = max(0, (MS[["part"]] - MS[["Residuals"]]) / r))
    out$anova <- list(df = I(a$Df), ss = I(a[["Sum Sq"]]))
  }
  grr <- vc[["rep"]] + vc[["op"]] + vc[["po"]]; tot <- grr + vc[["part"]]
  out$varcomp <- as.list(vc); out$grr <- grr; out$total <- tot
  out$pctStudyVar <- 100 * sqrt(grr / tot); out$pctTolerance <- 100 * 6 * sqrt(grr) / s$tol
  out$ndc <- max(1, floor(sqrt(2) * sqrt(vc[["part"]]) / sqrt(grr)))
  list(name = s$name, input = list(design = s$design, tolerance = s$tol, rows = msa_rows(s$d)), output = out)
}
write_fixture("msa-r", lapply(msa_sets, case), "tests/ref/msa_r.R", c("stats"))
