// Distributions (issue #3) against scipy (fixture dist-scipy) and the p-values in the smoke
// fixtures (R lm and scipy linregress).
import { section, check, near, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import * as D from '../js/dist.js';

const fn = {
  special: { lgamma: (x) => D.lgamma(x), lbeta: (_, a, b) => D.lbeta(a, b), gammaP: (x, a) => D.gammaP(a, x),
    gammaQ: (x, a) => D.gammaQ(a, x), betaI: (x, a, b) => D.betaInc(x, a, b).I, betaIc: (x, a, b) => D.betaInc(x, a, b).Ic },
  normal: D.normal, t: D.studentT, chi2: D.chi2, F: D.fDist, nct: D.nct, ncf: D.ncf,
};

// central: 1e-10 relative. Non-central: 1e-9 relative or 1e-14 absolute.
// lgamma: absolute near its zeros at 1 and 2. Values below 1e-300 (subnormal) compare absolutely.
const tolFor = (dist, f) => (dist === 'nct' || dist === 'ncf') ? { rel: 1e-9, abs: 1e-14 }
  : f === 'lgamma' ? { rel: 1e-10, abs: 1e-13 } : { rel: 1e-10, abs: 1e-300 };

const groups = {};
for (const c of loadFixture('dist-scipy').cases) {
  const { dist, fn: f, params, x } = c.input;
  const got = x.map(v => fn[dist][f](v, ...params));
  (groups[dist] ??= []).push([c.name, got, c.output.y, tolFor(dist, f)]);
}
for (const [dist, list] of Object.entries(groups)) {
  section(`${dist} vs scipy`);
  for (const [name, got, want, tol] of list) near(name, got, want, tol);
}

// a round trip can only be as good as the conditioning of p(x): |d ln p / d ln x| reaches ~700
section('round trips');
for (const p of [1e-200, 1e-15, 0.01, 0.3, 0.5, 0.8, 0.999999]) {
  near(`normal cdf(ppf(${p}))`, D.normal.cdf(D.normal.ppf(p)), p, { rel: 1e-12 });
  near(`t(3) sf(isf(${p}))`, D.studentT.sf(D.studentT.isf(p, 3), 3), p, { rel: 1e-12 });
  near(`chi2(4) cdf(ppf(${p}))`, D.chi2.cdf(D.chi2.ppf(p, 4), 4), p, { rel: 1e-12 });
  near(`F(3,7) sf(isf(${p}))`, D.fDist.sf(D.fDist.isf(p, 3, 7), 3, 7), p, { rel: 1e-12 });
}

section('identities and edge cases');
near('nct with nc = 0 is t', [0.3, 2, -4].map(x => D.nct.cdf(x, 7, 0)), [0.3, 2, -4].map(x => D.studentT.cdf(x, 7)), { rel: 1e-12 });
near('ncf with nc = 0 is F', [0.3, 2, 9].map(x => D.ncf.sf(x, 3, 12, 0)), [0.3, 2, 9].map(x => D.fDist.sf(x, 3, 12)), { rel: 1e-12 });
near('t² with df ν is F(1, ν)', D.studentT.sf(2.3, 9) * 2, D.fDist.sf(2.3 ** 2, 1, 9), { rel: 1e-12 });
near('chi2(2) cdf = 1 − e^(−x/2)', D.chi2.cdf(3, 2), -Math.expm1(-1.5), { rel: 1e-13 });
near('t(1) is Cauchy', D.studentT.cdf(-3, 1), 0.5 + Math.atan(-3) / Math.PI, { rel: 1e-13 });
check('cdf + sf = 1', [D.normal.cdf(0.7) + D.normal.sf(0.7), D.studentT.cdf(1.1, 4) + D.studentT.sf(1.1, 4),
  D.chi2.cdf(5, 3) + D.chi2.sf(5, 3), D.fDist.cdf(2, 3, 9) + D.fDist.sf(2, 3, 9), D.nct.cdf(1, 5, 1) + D.nct.sf(1, 5, 1)]
  .every(s => Math.abs(s - 1) < 1e-13));
check('limits', D.normal.ppf(0) === -Infinity && D.normal.isf(0) === Infinity && D.chi2.ppf(0, 3) === 0
  && D.studentT.isf(0.5, 3) === 0 && D.fDist.isf(1, 2, 3) === 0);
check('invalid arguments give NaN', [D.normal.ppf(1.5), D.studentT.cdf(1, -1), D.chi2.isf(-0.1, 2), D.lgamma(-1)].every(Number.isNaN));

section('p-values in the smoke fixtures');
for (const name of ['smoke-r', 'smoke-py']) for (const c of loadFixture(name).cases) {
  const { x, y } = c.input, n = x.length, o = c.output;
  const mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n;
  let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); }
  const b = sxy / sxx, se = Math.sqrt(o.rss / (n - 2) / sxx);
  near(`${name} ${c.name}: slope p-value`, 2 * D.studentT.sf(Math.abs(b / se), n - 2), o.pSlope, { rel: 1e-9 });
}
done();
