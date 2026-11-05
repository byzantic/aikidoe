# Helper for R fixture generators.  See tests/ref/README.md.
#
#   source("tests/ref/fixture.R")
#   write_fixture("smoke-r", cases, "tests/ref/smoke_r.R", c("stats"))
#
# Writes $AIKIDOE_FIXTURES/<name>.json (default tests/fixtures/), run from the repo root.
# Length-1 vectors are written as scalars (jsonlite auto_unbox); wrap a vector in I() to keep
# it as an array. Matrices are written as arrays of rows. Numbers are written with 15 significant
# digits. tolerance (optional) sets the drift-check tolerance, e.g. list(rel = 1e-9, abs = 1e-14).
suppressPackageStartupMessages(library(jsonlite))

write_fixture <- function(name, cases, generator, packages = character(), tolerance = NULL) {
  out_dir <- Sys.getenv("AIKIDOE_FIXTURES", "tests/fixtures")
  dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
  pk <- lapply(setNames(packages, packages), function(p) as.character(packageVersion(p)))
  doc <- list(
    fixture = name,
    generator = generator,
    meta = list(R = paste(R.version$major, R.version$minor, sep = "."), packages = pk),
    cases = cases
  )
  if (!is.null(tolerance)) doc$tolerance <- tolerance
  path <- file.path(out_dir, paste0(name, ".json"))
  writeLines(toJSON(doc, auto_unbox = TRUE, digits = NA, pretty = TRUE, null = "null", na = "null"), path)
  message(sprintf("wrote %s (%d cases)", path, length(cases)))
}
