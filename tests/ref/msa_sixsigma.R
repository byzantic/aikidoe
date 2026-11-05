# Issue #17 reference: SixSigma::ss.rr (crossed and nested gauge R&R by ANOVA) on the data sets of
# fixture.msa-data.R and on the package's own example ss.data.rr. Run on CI (SixSigma is not
# needed locally). ss.rr's printed tables are captured; its returned list gives the components.
source("tests/ref/fixture.R")
source("tests/ref/fixture.msa-data.R")
suppressPackageStartupMessages(library(SixSigma))
run <- function(name, d, design, tol) {
  out <- tryCatch({
    d$part <- factor(d$part); d$operator <- factor(d$operator)
    pdf(NULL)
    r <- ss.rr(var = value, part = part, appr = operator, data = d, sigma = 6, lsl = 0, usl = tol, method = design, alphaLim = 0.05, print_plot = FALSE, signifstars = FALSE)
    dev.off()
    message("ss.rr returns: ", paste(names(r), collapse = ", "))
    vc <- r$varComp; sv <- r$studyVar
    list(varCompRows = I(rownames(vc)), varComp = I(unname(vc[, 1])), contrib = I(unname(vc[, 2])), studyVarRows = I(rownames(sv)),
         studyVar = unname(as.matrix(sv)), studyVarCols = I(colnames(sv)), ncat = r$ncat)
  }, error = function(e) list(error = conditionMessage(e)))
  list(name = name, input = list(design = design, tolerance = tol, rows = msa_rows(d)), output = out)
}
cases <- lapply(Filter(function(s) s$design != "repeatability", msa_sets), function(s) run(paste("ss.rr:", s$name), s$d, s$design, s$tol))
data(ss.data.rr)
ex <- data.frame(part = ss.data.rr$prototype, operator = ss.data.rr$operator, value = ss.data.rr$time1)
cases[[length(cases) + 1]] <- run("ss.rr: SixSigma example ss.data.rr (prototype x operator x run)", ex, "crossed", 1)
write_fixture("msa-sixsigma", cases, "tests/ref/msa_sixsigma.R", c("SixSigma"), tolerance = list(rel = 1e-8, abs = 1e-10))
