# Install the packages listed in tests/ref/r-packages.txt that are missing.
# (Not a generator: tools/regen-fixtures.mjs skips files starting with "install".)
pk <- trimws(readLines("tests/ref/r-packages.txt"))
pk <- pk[nzchar(pk) & !startsWith(pk, "#")]
need <- setdiff(pk, rownames(installed.packages()))
if (length(need)) install.packages(need, repos = getOption("repos", "https://cloud.r-project.org"))
for (p in pk) suppressPackageStartupMessages(library(p, character.only = TRUE))
cat("R packages ok:", paste(pk, collapse = ", "), "\n")
