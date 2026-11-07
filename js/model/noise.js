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
//   residuals(fit)       { response, standardised, studentised }
//   compare(big, small)  test of dropping terms: small is big without them → { df, F, p }
//                        (for normal noise the partial F test, as R's drop1(test = "F"))
//   loglik(fit)          { loglik, k }: the maximised log-likelihood and the number of
//                        parameters it counts (for AIC and AICc)
//   weights(X, o)        information weight per row at the anticipated mean o.mean, relative to
//                        the scale used by power (null: equal weights, as for normal noise)
//   capabilities         what the classical normal-theory tools that are not part of the
//                        interface may be used with: lackOfFit, boxCox, lenth, mixed
//
// Only the normal model exists yet; a response's distribution will select another (phase 1).
import { fitOLS, olsPredict, olsAnova } from './ols.js';
import { fDist } from '../dist.js';

const identity = { name: 'identity', fun: (m) => m, inv: (e) => e, deriv: () => 1 };

/** Normal noise with constant variance: ordinary least squares (ols.js). */
export const normal = Object.freeze({
  id: 'normal',
  label: 'normal, constant variance (least squares)',
  link: identity,
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

export const NOISE_MODELS = Object.freeze({ normal });

/** The noise model with this id (default normal). */
export function noiseModel(id = 'normal') {
  const m = NOISE_MODELS[id];
  if (!m) throw new Error(`unknown noise model "${id}" (known: ${Object.keys(NOISE_MODELS).join(', ')})`);
  return m;
}

/** The noise model of a study's response: its distribution, normal unless it says otherwise. */
export function noiseModelOf(study, responseId) {
  const r = study.responses.find(x => x.id === responseId);
  return noiseModel(r?.distribution ?? 'normal');
}

/** The noise model a fit was made with (fits made before the interface are normal). */
export const noiseOf = (fit) => noiseModel(fit?.noise ?? 'normal');
