// Noise models (issue #64, phase 0): what the analysis assumes about the variation of a response
// around its mean. Everything that fits, tests, predicts or plans goes through one of these, so
// counts and proportions (generalised linear models) can be added beside normal least squares.
//
// A noise model has:
//   id, label            'normal', …
//   link                 { name, fun(μ) → η, inv(η) → μ, deriv(η) → dμ/dη }: the scale the
//                        model is linear on (identity for normal noise)
//   fit(mm, y, opts)     fit a model matrix (formula.js) to responses → a fit object with at least
//                        model, columns, assign, n, rank, dfRes, coef, se, cov, covUnscaled,
//                        fitted, residuals, y
//   predict(fit, X, o)   at model-matrix rows: [{ fit, se, lower, upper, predLower, predUpper }]
//                        on the response scale, intervals at o.level
//   tests(fit, type)     the table of tests for the model's terms (ANOVA for normal noise):
//                        [{ term, df, …, p }] ending with the residual row
//   prepare(rows)        the response table's rows → { y, weights, offset } for fit
//   residuals(fit)       { response, standardised, studentised } (and pearson, deviance)
//   compare(big, small)  test of dropping terms: small is big without them → { df, F, p }
//                        (for normal noise the partial F test, as R's drop1(test = "F"))
//   loglik(fit)          { loglik, k }: the maximised log-likelihood and the number of
//                        parameters it counts (for AIC and AICc)
//   weights(X, o)        information weight per row at the anticipated mean o.mean, relative to
//                        the scale used by power (null: equal weights, as for normal noise)
//   capabilities         what the classical normal-theory tools that are not part of the
//                        interface may be used with: lackOfFit, boxCox, lenth, mixed
//
// A response's distribution selects the model: normal (least squares, ols.js), or a generalised
// linear model (glm.js) for counts (poisson, quasipoisson, negbin) and proportions (binomial,
// quasibinomial, bernoulli), with the response's link.
import { fitOLS, olsPredict, olsAnova } from './ols.js';
import { fitGLM, glmPredict, glmTests, glmCompare, glmWeights, LINKS, canonicalLink, DISTRIBUTIONS } from './glm.js';
import { fDist } from '../dist.js';

const identity = { name: 'identity', fun: (m) => m, inv: (e) => e, deriv: () => 1 };

/** Normal noise with constant variance: ordinary least squares (ols.js). */
export const normal = Object.freeze({
  id: 'normal',
  label: 'normal, constant variance (least squares)',
  link: identity,
  prepare: (rows) => ({ y: rows.map(r => r.y) }),
  fit: (mm, y, opts) => fitOLS(mm, y, opts),
  predict: (fit, X, opts) => olsPredict(fit, X, opts),
  tests: (fit, type = 1) => olsAnova(fit, type),
  residuals: (fit) => ({ response: fit.residuals, standardised: fit.rstandard, studentised: fit.rstudent }),
  compare(big, small) {
    const df = big.rank - small.rank;
    const F = df > 0 && big.dfRes > 0 ? ((small.rss - big.rss) / df) / (big.rss / big.dfRes) : NaN;
    return { df, F, p: df > 0 && big.dfRes > 0 ? fDist.sf(Math.max(F, 0), df, big.dfRes) : df === 0 ? 1 : NaN };
  },
  // σ counts as a parameter, as in R's logLik.lm; a perfect fit (RSS 0) has log-likelihood +∞
  loglik: (fit) => ({ loglik: fit.rss > 0 ? -fit.n / 2 * (Math.log(2 * Math.PI) + Math.log(fit.rss / fit.n) + 1) : Infinity, k: fit.rank + 1 }),
  weights: () => null,
  capabilities: Object.freeze({ lackOfFit: true, boxCox: true, lenth: true, mixed: true }),
});

const LABELS = {
  poisson: 'Poisson counts', quasipoisson: 'quasi-Poisson counts (overdispersed)', negbin: 'negative binomial counts (overdispersed)',
  binomial: 'binomial proportions (successes out of trials)', quasibinomial: 'quasi-binomial proportions (overdispersed)', bernoulli: 'pass/fail (Bernoulli)',
};

/**
 * A generalised linear model (glm.js) for a distribution and link. Rows of the response table
 * carry trials (binomial) and exposure (counts: the log of it is the offset); y is the count of
 * successes, fitted as a proportion of the trials.
 */
function glmNoise(id, link) {
  const distribution = id === 'bernoulli' ? 'binomial' : id;
  const lk = link ?? canonicalLink(distribution);
  const binom = !DISTRIBUTIONS[distribution].counts;
  return Object.freeze({
    id, label: LABELS[id], link: { ...LINKS[lk] }, distribution,
    prepare(rows) {
      if (binom) {
        const trials = rows.map(r => (id === 'bernoulli' ? 1 : r.trials));
        if (trials.some(t => !(t >= 1))) throw new Error('a binomial response needs the number of trials for every run');
        return { y: rows.map((r, i) => r.y / trials[i]), weights: trials };
      }
      const offset = rows.map(r => Math.log(r.exposure ?? 1));
      return { y: rows.map(r => r.y), ...(offset.some(v => v !== 0) ? { offset } : {}) };
    },
    fit: (mm, y, opts = {}) => fitGLM(mm, y, { distribution, link: lk, weights: opts.weights, offset: opts.offset, firth: opts.firth, theta: opts.theta }),
    predict: (fit, X, opts) => glmPredict(fit, X, opts),
    tests: (fit, type = 1) => glmTests(fit, type),
    residuals: (fit) => ({ response: fit.residuals, standardised: fit.rstandard, studentised: fit.rstudent, pearson: fit.pearson, deviance: fit.devianceResiduals }),
    compare: (big, small) => glmCompare(big, small),
    loglik: (fit) => ({ loglik: fit.loglik, k: fit.k }),
    weights: (X, { mean, trials, theta } = {}) => (mean ? glmWeights(distribution, lk, mean, { trials, theta }) : null),
    capabilities: Object.freeze({ lackOfFit: false, boxCox: false, lenth: false, mixed: false }),
  });
}

export const NOISE_MODELS = Object.freeze({ normal, ...Object.fromEntries(['poisson', 'quasipoisson', 'negbin', 'binomial', 'quasibinomial', 'bernoulli'].map(id => [id, glmNoise(id)])) });

/** The noise model with this id (default normal), with a link other than the canonical one. */
export function noiseModel(id = 'normal', { link } = {}) {
  const m = NOISE_MODELS[id];
  if (!m) throw new Error(`unknown noise model "${id}" (known: ${Object.keys(NOISE_MODELS).join(', ')})`);
  return id === 'normal' || !link || link === m.link.name ? m : glmNoise(id, link);
}

/** The noise model of a study's response: its distribution and link, normal unless it says otherwise. */
export function noiseModelOf(study, responseId) {
  const r = study.responses.find(x => x.id === responseId);
  return noiseModel(r?.distribution ?? 'normal', { link: r?.link });
}

/** The noise model a fit was made with (fits made before the interface are normal). */
export const noiseOf = (fit) => noiseModel(fit?.noise ?? 'normal', { link: fit?.link });
