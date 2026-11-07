# Bibliography

Books for learning and reference, and the papers behind specific methods in aikidoe.

## Books

- Box, G. E. P., Hunter, J. S. & Hunter, W. G. (2005). *Statistics for Experimenters: Design,
  Innovation, and Discovery*, 2nd ed. Wiley. (The reactor data of the
  [screening example](example-screening.md) are from the first edition: Box, Hunter & Hunter
  (1978), p. 379.)
- Montgomery, D. C. (2017). *Design and Analysis of Experiments*, 9th ed. Wiley. (The
  filtration-rate data of the [robust-design example](optimisation.md#an-example) are its
  example 6.2.)
- Montgomery, D. C. & Runger, G. C. (2018). *Applied Statistics and Probability for Engineers*,
  7th ed. Wiley.
- Myers, R. H., Montgomery, D. C. & Anderson-Cook, C. M. (2016). *Response Surface Methodology*,
  4th ed. Wiley.
- Atkinson, A. C., Donev, A. N. & Tobias, R. D. (2007). *Optimum Experimental Designs, with SAS*.
  Oxford University Press.
- Goos, P. & Jones, B. (2011). *Optimal Design of Experiments: A Case Study Approach*. Wiley.
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
- Box, G. E. P. & Wilson, K. B. (1951). On the experimental attainment of optimum conditions.
  *Journal of the Royal Statistical Society B* 13, 1–45.
- Brideau, C., Gunter, B., Pikounis, B. & Liaw, A. (2003). Improved statistical methods for hit
  selection in high-throughput screening. *Journal of Biomolecular Screening* 8, 634–647. (B-scores:
  median polish of plate rows and columns; see [microplates](plates.md#analysis).)
- Derringer, G. & Suich, R. (1980). Simultaneous optimization of several response variables.
  *Journal of Quality Technology* 12, 214–219.
- Fries, A. & Hunter, W. G. (1980). Minimum aberration 2^(k−p) designs. *Technometrics* 22, 601–608.
- Goos, P. & Vandebroek, M. (2003). D-optimal split-plot designs with given numbers and sizes of
  whole plots. *Technometrics* 45, 235–245.
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
- Lenth, R. V. (1989). Quick and easy analysis of unreplicated factorials. *Technometrics* 31,
  469–473.
- Lin, D. K. J. & Tu, W. (1995). Dual response surface optimization. *Journal of Quality
  Technology* 27, 34–39.
- McKay, M. D., Beckman, R. J. & Conover, W. J. (1979). A comparison of three methods for selecting
  values of input variables in the analysis of output from a computer code. *Technometrics* 21,
  239–245.
- Meyer, R. K. & Nachtsheim, C. J. (1995). The coordinate-exchange algorithm for constructing exact
  optimal experimental designs. *Technometrics* 37, 60–69.
- Morris, M. D. & Mitchell, T. J. (1995). Exploratory designs for computational experiments.
  *Journal of Statistical Planning and Inference* 43, 381–402.
- Plackett, R. L. & Burman, J. P. (1946). The design of optimum multifactorial experiments.
  *Biometrika* 33, 305–325.
- Saltelli, A., Annoni, P., Azzini, I., Campolongo, F., Ratto, M. & Tarantola, S. (2010). Variance
  based sensitivity analysis of model output: design and estimator for the total sensitivity
  index. *Computer Physics Communications* 181, 259–270.
- Sobol', I. M. (2001). Global sensitivity indices for nonlinear mathematical models and their
  Monte Carlo estimates. *Mathematics and Computers in Simulation* 55, 271–280.
- Vining, G. G. & Myers, R. H. (1990). Combining Taguchi and response surface philosophies: a dual
  response approach. *Journal of Quality Technology* 22, 38–45.
- Zhang, J.-H., Chung, T. D. Y. & Oldenburg, K. R. (1999). A simple statistical parameter for use in
  evaluation and validation of high throughput screening assays. *Journal of Biomolecular Screening*
  4, 67–73. (The Z′ factor of [plate controls](plates.md#controls).)

## Software used as references in the tests

R (`lm`, `anova`, `car::Anova`, `MASS::boxcox`), lme4 and pbkrtest (mixed models), FrF2
(fractions and split-plot fractions), rsm, AlgDesign, skpr (power), SixSigma (gauge R&R),
desirability, BsMD (Lenth); NumPy and SciPy. The fixtures they produce are in `tests/fixtures/`.
