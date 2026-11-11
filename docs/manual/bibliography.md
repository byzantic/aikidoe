# Bibliography

Books for learning and reference, and the papers behind specific methods in aikidoe.

## Books

- Box, G. E. P., Hunter, J. S. & Hunter, W. G. (2005). *Statistics for Experimenters: Design,
  Innovation, and Discovery*, 2nd ed. Wiley. (The reactor data of the
  [screening example](example-screening.md) are from the first edition: Box, Hunter & Hunter
  (1978), p. 379.)
- Cornell, J. A. (2002). *Experiments with Mixtures: Designs, Models, and the Analysis of Mixture
  Data*, 3rd ed. Wiley. (The yarn data of the [mixture analysis](designs-mixture.md#analysis).)
- Agresti, A. (2013). *Categorical Data Analysis*, 3rd ed. Wiley.
- Finney, D. J. (1978). *Statistical Method in Biological Assay*, 3rd ed. Griffin. (Relative
  potency and parallel-line assays; see [dose–response](dose-response.md#relative-potency).)
- McCullagh, P. & Nelder, J. A. (1989). *Generalized Linear Models*, 2nd ed. Chapman & Hall.
- Montgomery, D. C. (2017). *Design and Analysis of Experiments*, 9th ed. Wiley. (The
  filtration-rate data of the [robust-design example](optimisation.md#an-example) are its
  example 6.2.)
- Milliken, G. A. & Johnson, D. E. (2002). *Analysis of Messy Data, Volume III: Analysis of
  Covariance*. Chapman & Hall/CRC. ([Covariates](analysis.md#covariates): one slope or several,
  adjusted means.)
- Hsu, J. C. (1996). *Multiple Comparisons: Theory and Methods*. Chapman & Hall. (Tukey's method
  for all pairwise comparisons.)
- Montgomery, D. C. & Runger, G. C. (2018). *Applied Statistics and Probability for Engineers*,
  7th ed. Wiley.
- Myers, R. H., Montgomery, D. C. & Anderson-Cook, C. M. (2016). *Response Surface Methodology*,
  4th ed. Wiley.
- Atkinson, A. C., Donev, A. N. & Tobias, R. D. (2007). *Optimum Experimental Designs, with SAS*.
  Oxford University Press.
- Goos, P. & Jones, B. (2011). *Optimal Design of Experiments: A Case Study Approach*. Wiley.
- Venables, W. N. & Ripley, B. D. (2002). *Modern Applied Statistics with S*, 4th ed. Springer.
  (The negative binomial fit of `MASS::glm.nb`, and profile intervals.)
- Santner, T. J., Williams, B. J. & Notz, W. I. (2018). *The Design and Analysis of Computer
  Experiments*, 2nd ed. Springer.
- Cano, E. L., Moguerza, J. M. & Redchuk, A. (2012). *Six Sigma with R*. Springer. (The R package
  SixSigma and the data of the [gauge example](example-gauge.md).)
- Automotive Industry Action Group (2010). *Measurement Systems Analysis*, 4th ed. AIAG.

## Papers

- Bingham, D. & Sitter, R. R. (1999). Minimum-aberration two-level fractional factorial split-plot
  designs. *Technometrics* 41, 62–70.
- Box, G. E. P. & Behnken, D. W. (1960). Some new three level designs for the study of quantitative
  variables. *Technometrics* 2, 455–475.
- Bates, D., Mächler, M., Bolker, B. & Walker, S. (2015). Fitting linear mixed-effects models
  using lme4. *Journal of Statistical Software* 67(1), 1–48. (The GLMMs for counts and proportions
  are checked against its `glmer`.)
- Box, G. E. P. & Tyssedal, J. (1996). Projective properties of certain orthogonal arrays.
  *Biometrika* 83, 950–955. (Projectivity.)
- Box, G. E. P. & Wilson, K. B. (1951). On the experimental attainment of optimum conditions.
  *Journal of the Royal Statistical Society B* 13, 1–45.
- Brooks, M. E., Kristensen, K., van Benthem, K. J., Magnusson, A., Berg, C. W., Nielsen, A.,
  Skaug, H. J., Mächler, M. & Bolker, B. M. (2017). glmmTMB balances speed and flexibility among
  packages for zero-inflated generalized linear mixed modeling. *The R Journal* 9(2), 378–400.
  (A cross-check of the negative binomial with a random effect.)
- Brideau, C., Gunter, B., Pikounis, B. & Liaw, A. (2003). Improved statistical methods for hit
  selection in high-throughput screening. *Journal of Biomolecular Screening* 8, 634–647. (B-scores:
  median polish of plate rows and columns; see [microplates](plates.md#analysis).)
- Cox, D. R. & McCullagh, P. (1982). Some aspects of analysis of covariance. *Biometrics* 38,
  541–561. (What adjusting for a covariate does and does not do; why it must not be affected by
  the treatments.)
- Cox, D. R. (1971). A note on polynomial response functions for mixtures. *Biometrika* 58,
  155–159.
- Copenhaver, M. D. & Holland, B. (1988). Computation of the distribution of the maximum
  studentized range statistic with application to multiple significance testing of simple
  effects. *Journal of Statistical Computation and Simulation* 30, 1–15. (Algorithm AS 190, as
  R's `ptukey`: the studentized range behind Tukey's comparisons.)
- Deng, L.-Y. & Tang, B. (1999). Generalized resolution and minimum aberration criteria for
  Plackett–Burman and other nonregular factorial designs. *Statistica Sinica* 9, 1071–1082.
  (Generalised resolution of Plackett–Burman designs.)
- Derringer, G. & Suich, R. (1980). Simultaneous optimization of several response variables.
  *Journal of Quality Technology* 12, 214–219.
- Firth, D. (1993). Bias reduction of maximum likelihood estimates. *Biometrika* 80, 27–38.
- Fries, A. & Hunter, W. G. (1980). Minimum aberration 2^(k−p) designs. *Technometrics* 22, 601–608.
- Goos, P. & Vandebroek, M. (2003). D-optimal split-plot designs with given numbers and sizes of
  whole plots. *Technometrics* 45, 235–245.
- Heinze, G. & Schemper, M. (2002). A solution to the problem of separation in logistic regression.
  *Statistics in Medicine* 21, 2409–2419.
- Jansen, M. J. W. (1999). Analysis of variance designs for model output. *Computer Physics
  Communications* 117, 35–43.
- Jones, B. & Nachtsheim, C. J. (2009). Split-plot designs: what, why, and how. *Journal of Quality
  Technology* 41, 340–361.
- Jones, B. & Nachtsheim, C. J. (2011). A class of three-level designs for definitive screening in
  the presence of second-order effects. *Journal of Quality Technology* 43, 1–15.
- Jones, B. & Nachtsheim, C. J. (2013). Definitive screening designs with added two-level
  categorical factors. *Journal of Quality Technology* 45, 121–129.
- Kenward, M. G. & Roger, J. H. (1997). Small sample inference for fixed effects from restricted
  maximum likelihood. *Biometrics* 53, 983–997.
- Kosmidis, I. & Firth, D. (2021). Jeffreys-prior penalty, finiteness and shrinkage in
  binomial-response generalized linear models. *Biometrika* 108, 71–82. (brglm2, which aikidoe's
  Firth estimates are checked against.)
- Lenth, R. V. (1989). Quick and easy analysis of unreplicated factorials. *Technometrics* 31,
  469–473.
- Lin, D. K. J. & Draper, N. R. (1992). Projection properties of Plackett and Burman designs.
  *Technometrics* 34, 423–428. (Projectivity 3 of the Plackett–Burman designs.)
- Lin, D. K. J. & Tu, W. (1995). Dual response surface optimization. *Journal of Quality
  Technology* 27, 34–39.
- Lawson, J. & Willden, C. (2016). Mixture experiments in R using mixexp. *Journal of Statistical
  Software* 72, Code Snippet 2. (The mixexp package that aikidoe's mixture designs are checked
  against.)
- McKay, M. D., Beckman, R. J. & Conover, W. J. (1979). A comparison of three methods for selecting
  values of input variables in the analysis of output from a computer code. *Technometrics* 21,
  239–245.
- McLean, R. A. & Anderson, V. L. (1966). Extreme vertices design of mixture experiments.
  *Technometrics* 8, 447–454.
- Meyer, R. K. & Nachtsheim, C. J. (1995). The coordinate-exchange algorithm for constructing exact
  optimal experimental designs. *Technometrics* 37, 60–69.
- Morris, M. D. & Mitchell, T. J. (1995). Exploratory designs for computational experiments.
  *Journal of Statistical Planning and Inference* 43, 381–402.
- Nelder, J. A. & Wedderburn, R. W. M. (1972). Generalized linear models. *Journal of the Royal
  Statistical Society A* 135, 370–384.
- Piepel, G. F. (1982). Measuring component effects in constrained mixture experiments.
  *Technometrics* 24, 29–39.
- Plackett, R. L. & Burman, J. P. (1946). The design of optimum multifactorial experiments.
  *Biometrika* 33, 305–325.
- Ritz, C., Baty, F., Streibig, J. C. & Gerhard, D. (2015). Dose-response analysis using R.
  *PLoS ONE* 10, e0146021. (The drc package: the models and parameterisation of
  [dose–response](dose-response.md), and the reference for its tests.)
- Searle, S. R., Speed, F. M. & Milliken, G. A. (1980). Population marginal means in the linear
  model: an alternative to least squares means. *The American Statistician* 34, 216–221.
  ([Adjusted means](analysis.md#adjusted-means); the reference grid of R's `emmeans`, which
  aikidoe follows and is checked against.)
- Saltelli, A., Annoni, P., Azzini, I., Campolongo, F., Ratto, M. & Tarantola, S. (2010). Variance
  based sensitivity analysis of model output: design and estimator for the total sensitivity
  index. *Computer Physics Communications* 181, 259–270.
- Scheffé, H. (1958). Experiments with mixtures. *Journal of the Royal Statistical Society B* 20,
  344–360.
- Scheffé, H. (1963). The simplex-centroid design for experiments with mixtures. *Journal of the
  Royal Statistical Society B* 25, 235–263.
- Snee, R. D. & Marquardt, D. W. (1976). Screening concepts and designs for experiments with
  mixtures. *Technometrics* 18, 19–29.
- Sobol', I. M. (2001). Global sensitivity indices for nonlinear mathematical models and their
  Monte Carlo estimates. *Mathematics and Computers in Simulation* 55, 271–280.
- United States Pharmacopeia. General chapters ⟨1032⟩ Design and development of biological
  assays and ⟨1034⟩ Analysis of biological assays. (Equivalence testing of parallelism; see
  [relative potency](dose-response.md#relative-potency).)
- Vining, G. G. & Myers, R. H. (1990). Combining Taguchi and response surface philosophies: a dual
  response approach. *Journal of Quality Technology* 22, 38–45.
- Zhang, J.-H., Chung, T. D. Y. & Oldenburg, K. R. (1999). A simple statistical parameter for use in
  evaluation and validation of high throughput screening assays. *Journal of Biomolecular Screening*
  4, 67–73. (The Z′ factor of [plate controls](plates.md#controls).)

## Software used as references in the tests

R (`lm`, `anova`, `car::Anova`, `MASS::boxcox`, `nls`), lme4 and pbkrtest (mixed models), drc and
numDeriv (dose–response), FrF2
(fractions and split-plot fractions), rsm, AlgDesign, skpr (power), SixSigma (gauge R&R),
desirability, BsMD (Lenth); NumPy and SciPy. The fixtures they produce are in `tests/fixtures/`.
