"""Distribution references (issue #3) from scipy.stats / scipy.special.
Checked by tests/dist.test.mjs. Values below ~1e-300 are left out (they underflow in JSON
round trips and are not needed)."""
import numpy as np
from scipy import stats, special
from fixture import write_fixture

cases = []


def add(dist, fn, params, xs, values):
    keep = [(x, v) for x, v in zip(xs, values) if np.isfinite(v) and (v == 0 or abs(v) > 1e-300)]
    cases.append({'name': f'{dist}.{fn} {params}', 'input': {'dist': dist, 'fn': fn, 'params': list(params),
                                                            'x': [float(x) for x, _ in keep]},
                  'output': {'y': [float(v) for _, v in keep]}})


P = [1e-300, 1e-100, 1e-30, 1e-12, 1e-6, 1e-3, 0.025, 0.2, 0.5, 0.7, 0.975, 0.999, 1 - 1e-9]

# special functions
xs = [1e-8, 0.1, 0.5, 1, 1.5, 2, 3.7, 9.99, 10, 25.5, 100, 1e3, 1e5, 1e8]
add('special', 'lgamma', [], xs, special.gammaln(xs))
for a, b in [(0.5, 0.5), (1, 3), (2.5, 7), (10, 10), (0.5, 5000), (5000, 0.5), (30, 2000), (1e4, 1e4)]:
    add('special', 'lbeta', [a, b], [0], [special.betaln(a, b)])
for a in [0.5, 1, 3, 15.5, 100, 5000]:
    x = [a * f for f in (1e-3, 0.2, 0.7, 0.95, 1, 1.05, 1.5, 3, 10)]
    add('special', 'gammaP', [a], x, special.gammainc(a, x))
    add('special', 'gammaQ', [a], x, special.gammaincc(a, x))
for a, b in [(0.5, 0.5), (2, 3), (0.5, 50), (50, 0.5), (15, 25), (300, 400), (5000, 0.5)]:
    m = a / (a + b)
    x = sorted({min(max(m * f, 1e-12), 1 - 1e-12) for f in (1e-6, 0.1, 0.5, 0.9, 1, 1.05, 1.2)} | {0.5})
    add('special', 'betaI', [a, b], x, special.betainc(a, b, x))
    add('special', 'betaIc', [a, b], x, special.betaincc(a, b, x))

# normal
xn = [-38, -30, -20, -10, -5, -3, -2.5, -1.5, -0.5, 0, 0.3, 1, 2.4, 2.6, 6, 9, 37]
for fn in ('pdf', 'cdf', 'sf'):
    add('normal', fn, [], xn, getattr(stats.norm, fn)(xn))
add('normal', 'ppf', [], P, stats.norm.ppf(P))
add('normal', 'isf', [], P, stats.norm.isf(P))

# t
xt = [-1e6, -50, -5, -2, -0.5, 0, 0.5, 1, 2, 5, 50, 1e6]
for df in [1, 2, 2.5, 3, 5, 10, 30, 100, 1e3, 1e4]:
    for fn in ('pdf', 'cdf', 'sf'):
        add('t', fn, [df], xt, getattr(stats.t, fn)(xt, df))
    add('t', 'ppf', [df], P[3:], stats.t.ppf(P[3:], df))
    add('t', 'isf', [df], P[3:], stats.t.isf(P[3:], df))

# chi-square
for df in [1, 2, 3, 7, 30, 100, 1e3, 1e4]:
    x = [df * f for f in (1e-6, 0.01, 0.3, 0.8, 1, 1.2, 2, 5)]
    for fn in ('pdf', 'cdf', 'sf'):
        add('chi2', fn, [df], x, getattr(stats.chi2, fn)(x, df))
    add('chi2', 'ppf', [df], P[3:], stats.chi2.ppf(P[3:], df))
    add('chi2', 'isf', [df], P[3:], stats.chi2.isf(P[3:], df))

# F
xf = [1e-8, 0.01, 0.2, 1, 2, 5, 50, 1e4]
for d1, d2 in [(1, 1), (1, 10), (3, 20), (5, 5), (10, 1e4), (1e4, 10), (50, 50), (1, 1e4)]:
    for fn in ('pdf', 'cdf', 'sf'):
        add('F', fn, [d1, d2], xf, getattr(stats.f, fn)(xf, d1, d2))
    # stats.f.isf inverts 1 − q, losing ~eps/q; invert the beta tail that holds the probability
    # instead: F > f ⇔ y = d2/(d1 f + d2) < y_q with y ~ Beta(d2/2, d1/2), and likewise for ppf.
    # Always invert the smaller tail probability (1 − q is exact for q ≥ ½).
    def f_upper(q):          # P(F > f) = q
        if q <= 0.5:
            y = special.betaincinv(d2 / 2, d1 / 2, q)
            return d2 * (1 - y) / (d1 * y)
        return f_lower(1 - q)

    def f_lower(p):          # P(F < f) = p
        if p <= 0.5:
            x = special.betaincinv(d1 / 2, d2 / 2, p)
            return d2 * x / (d1 * (1 - x))
        return f_upper(1 - p)

    add('F', 'isf', [d1, d2], P[3:], [f_upper(q) for q in P[3:]])
    add('F', 'ppf', [d1, d2], P[3:], [f_lower(p) for p in P[3:]])

# non-central t (scipy uses Boost)
xnt = [-5, -1, 0, 0.5, 1, 2, 4, 8, 20]
for df in [2, 5, 10, 30, 100]:
    for nc in [0, 0.5, 2, 5, 10, -2]:
        add('nct', 'cdf', [df, nc], xnt, stats.nct.cdf(xnt, df, nc))
        add('nct', 'sf', [df, nc], xnt, stats.nct.sf(xnt, df, nc))

# non-central F
xnf = [0.1, 1, 3, 10, 30]
for d1, d2 in [(1, 10), (3, 20), (5, 100), (2, 5)]:
    for nc in [0.5, 5, 20, 60]:
        add('ncf', 'cdf', [d1, d2, nc], xnf, stats.ncf.cdf(xnf, d1, d2, nc))
        add('ncf', 'sf', [d1, d2, nc], xnf, stats.ncf.sf(xnf, d1, d2, nc))

write_fixture('dist-scipy', cases, __file__, ['numpy', 'scipy'], tolerance={'rel': 1e-9, 'abs': 1e-300})
