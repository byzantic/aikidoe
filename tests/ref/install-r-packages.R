# Install the packages listed in tests/ref/r-packages.txt that are missing.
# (Not a generator: tools/regen-fixtures.mjs skips files starting with "install".)
# A line "pkg@version" pins a package that CRAN has archived: it is installed from source, from the
# CRAN archive or else the github.com/cran mirror's tag, after the others (list its dependencies
# as ordinary lines).
pk <- trimws(readLines("tests/ref/r-packages.txt"))
pk <- pk[nzchar(pk) & !startsWith(pk, "#")]
pinned <- grepl("@", pk, fixed = TRUE)
ver <- setNames(sub("^.*@", "", pk[pinned]), sub("@.*$", "", pk[pinned]))
pk <- sub("@.*$", "", pk)
repos <- getOption("repos")
if (!length(repos) || identical(unname(repos[1]), "@CRAN@")) repos <- c(CRAN = "https://cloud.r-project.org")
need <- setdiff(pk[!pinned], rownames(installed.packages()))
if (length(need)) install.packages(need, repos = repos)
for (p in names(ver)) if (!p %in% rownames(installed.packages())) {
  urls <- c(sprintf("https://cloud.r-project.org/src/contrib/Archive/%s/%s_%s.tar.gz", p, p, ver[[p]]),
            sprintf("https://github.com/cran/%s/archive/refs/tags/%s.tar.gz", p, ver[[p]]))
  tgz <- file.path(tempdir(), sprintf("%s_%s.tar.gz", p, ver[[p]]))
  ok <- FALSE
  for (u in urls) if (!ok) ok <- tryCatch({ download.file(u, tgz, mode = "wb", quiet = TRUE); TRUE }, error = function(e) FALSE, warning = function(w) FALSE)
  if (!ok) stop("cannot download ", p, " ", ver[[p]])
  install.packages(tgz, repos = NULL, type = "source")
}
for (p in pk) suppressPackageStartupMessages(library(p, character.only = TRUE))
cat("R packages ok:", paste(pk, collapse = ", "), "\n")
