# Smoke fixture (issue #1): straight-line fit with R's lm().
# Exists to prove the R → JSON → Node path works; the JS side checks it in closed form.
source("tests/ref/fixture.R")

data <- list(
  list(name = "five points", x = c(1, 2, 3, 4, 5), y = c(2.1, 3.9, 6.2, 7.8, 10.1)),
  list(name = "negative slope, uneven x", x = c(0.5, 1.5, 4, 7, 7.5, 9), y = c(9.8, 9.1, 6.9, 4.2, 3.9, 2.0))
)
cases <- lapply(data, function(d) {
  m <- lm(y ~ x, data = data.frame(x = d$x, y = d$y))
  s <- summary(m)
  list(name = d$name, input = list(x = d$x, y = d$y),
       output = list(coef = unname(coef(m)), rss = sum(residuals(m)^2), r2 = s$r.squared,
                     sigma = s$sigma, pSlope = coef(s)[2, 4]))
})
write_fixture("smoke-r", cases, "tests/ref/smoke_r.R", c("stats", "jsonlite"))
