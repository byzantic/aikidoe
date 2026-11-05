# Designs and models shared by power_r.R (base R) and power_skpr.R (skpr, pwr): issue #12.
# Each design is a data frame in coded units (continuous −1…+1, categorical as factors).
ff <- function(k, rep = 1) { d <- do.call(expand.grid, setNames(rep(list(c(-1, 1)), k), paste0("x", 1:k))); d[rep(seq_len(nrow(d)), rep), , drop = FALSE] }
frac51 <- function() { d <- ff(4); d$x5 <- d$x1 * d$x2 * d$x3 * d$x4; d }
ccd3 <- function() {
  a <- 8^(1/4)
  ax <- rbind(c(-a, 0, 0), c(a, 0, 0), c(0, -a, 0), c(0, a, 0), c(0, 0, -a), c(0, 0, a))
  d <- rbind(as.matrix(ff(3)), ax, matrix(0, 6, 3)); colnames(d) <- paste0("x", 1:3); as.data.frame(d)
}
bbd3 <- function() {
  e <- expand.grid(a = c(-1, 1), b = c(-1, 1))
  d <- rbind(cbind(e$a, e$b, 0), cbind(e$a, 0, e$b), cbind(0, e$a, e$b), matrix(0, 3, 3)); colnames(d) <- paste0("x", 1:3); as.data.frame(d)
}
mixed <- function() { d <- expand.grid(x1 = c(-1, 1), g = c("a", "b", "c")); d <- d[rep(1:6, 2), ]; d$g <- factor(d$g, levels = c("b", "c", "a")); d }
one <- function() data.frame(x1 = rep(c(-1, 1), each = 6))

designs <- list(
  list(name = "2^3 replicated twice, (x1+x2+x3)^2", d = ff(3, 2), aikidoe = "(x1+x2+x3)^2", r = ~ (x1 + x2 + x3)^2, delta = 2, alpha = 0.05),
  list(name = "2^(5-1), main + x1:x2 + x3:x4", d = frac51(), aikidoe = "main + x1:x2 + x3:x4", r = ~ x1 + x2 + x3 + x4 + x5 + x1:x2 + x3:x4, delta = 2, alpha = 0.05),
  list(name = "CCD k = 3 rotatable, 6 centre, quadratic", d = ccd3(), aikidoe = "quadratic", r = ~ x1 + x2 + x3 + I(x1^2) + I(x2^2) + I(x3^2) + x1:x2 + x1:x3 + x2:x3, delta = 2, alpha = 0.05),
  list(name = "BBD k = 3, 3 centre, quadratic, delta 3, alpha 0.1", d = bbd3(), aikidoe = "quadratic", r = ~ x1 + x2 + x3 + I(x1^2) + I(x2^2) + I(x3^2) + x1:x2 + x1:x3 + x2:x3, delta = 3, alpha = 0.1),
  list(name = "2 x 3 mixed, replicated, x1*g", d = mixed(), aikidoe = "x1*g", r = ~ x1 * g, delta = 2, alpha = 0.05, levels = c("a", "b", "c")),
  list(name = "one factor, 6 + 6 runs, delta 1.5", d = one(), aikidoe = "x1", r = ~ x1, delta = 1.5, alpha = 0.05)
)
rows_of <- function(d) lapply(seq_len(nrow(d)), function(i) lapply(as.list(d[i, , drop = FALSE]), function(v) if (is.factor(v)) as.character(v) else v))
